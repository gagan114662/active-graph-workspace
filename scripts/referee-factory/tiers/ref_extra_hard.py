"""Reference implementation for the EXTRA-HARD tier: System integration.

Exercises THREE capabilities against the real Active Graph framework, with
NO API keys and NO network (a fully scripted, deterministic provider):

  (a) Domain PACK: scaffold + hand-build a custom pack (object types,
      relation types, reactive behaviors, an @tool, a versioned prompt,
      a Policy) using the SAME public API the Diligence pack uses
      (activegraph.packs.{Pack, ObjectType, RelationType, PackPolicy,
      behavior, llm_behavior, tool, load_prompts_from_dir}). Load it via
      runtime.load_pack(...) and run it deterministically.

  (b) Autonomous agent loop built from reactive behaviors over a shared
      graph (BabyAGI shape): goal.created -> seed -> @llm_behavior plan
      -> object.created(step) -> @llm_behavior execute (creates result +
      emits step.executed) -> @llm_behavior follow-up (creates more steps).
      The loop IS event propagation; the graph is the queue. Terminates
      when the planner returns an empty follow-up list.

  (c) A NON-DEFAULT EventStore (JSONLEventStore) implemented behind the
      EventStore Protocol, validated by running the framework's OWN
      conformance suite (activegraph.store.conformance.EventStoreConformance)
      against it -- the exact suite that gates SQLite and Postgres.

Run:
    ANTHROPIC_API_KEY= OPENAI_API_KEY= \
      .venv/bin/python /tmp/ref_extra-hard.py
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
from decimal import Decimal
from pathlib import Path
from typing import Any, Iterator, Optional

from pydantic import BaseModel, Field

from activegraph import Graph, Runtime
from activegraph.core.event import Event
from activegraph.llm.types import LLMMessage, LLMResponse
from activegraph.packs import (
    Pack,
    ObjectType,
    RelationType,
    PackPolicy,
    behavior,
    llm_behavior,
    tool,
    load_prompts_from_dir,
)
from activegraph.packs.scaffold import scaffold_pack
from activegraph.store.errors import DuplicateEventError, EventNotFoundError


# ===========================================================================
# (c) NON-DEFAULT EVENT STORE behind the EventStore Protocol
# ===========================================================================
#
# A line-delimited-JSON file store. Append-only, per-run. This is a *real*
# alternative backend (not SQLite, not Postgres, not InMemory) implementing
# the same six-method protocol from activegraph.store.base.EventStore.

class JSONLEventStore:
    """Append-only JSONL-file EventStore. Conforms to the EventStore Protocol
    (activegraph.store.base). One file per run; events serialized one-per-line.
    """

    def __init__(self, path: str, run_id: str = "run_jsonl") -> None:
        self.run_id = run_id
        self._path = path
        self._events: list[Event] = []
        self._by_id: dict[str, int] = {}
        # Load any pre-existing file (so reopening the same path resumes).
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    self._append_in_memory(_event_from_dict(json.loads(line)))

    def _append_in_memory(self, event: Event) -> None:
        if event.id in self._by_id:
            raise DuplicateEventError(f"duplicate event id: {event.id}")
        self._by_id[event.id] = len(self._events)
        self._events.append(event)

    def _rewrite(self) -> None:
        with open(self._path, "w", encoding="utf-8") as f:
            for ev in self._events:
                f.write(json.dumps(ev.to_dict(), sort_keys=True) + "\n")

    # ---- EventStore protocol ----

    def append(self, event: Event) -> None:
        self._append_in_memory(event)
        with open(self._path, "a", encoding="utf-8") as f:
            f.write(json.dumps(event.to_dict(), sort_keys=True) + "\n")

    def iter_events(
        self, after: Optional[str] = None, until: Optional[str] = None
    ) -> Iterator[Event]:
        start = 0
        end = len(self._events)
        if after is not None:
            if after not in self._by_id:
                raise EventNotFoundError(f"event {after!r} not found in run {self.run_id!r}")
            start = self._by_id[after] + 1
        if until is not None:
            if until not in self._by_id:
                raise EventNotFoundError(f"event {until!r} not found in run {self.run_id!r}")
            end = self._by_id[until] + 1
        for i in range(start, end):
            yield self._events[i]

    def get_event(self, event_id: str) -> Optional[Event]:
        idx = self._by_id.get(event_id)
        return None if idx is None else self._events[idx]

    def count(self) -> int:
        return len(self._events)

    def truncate_after(self, event_id: str) -> None:
        if event_id not in self._by_id:
            raise EventNotFoundError(f"event {event_id!r} not found in run {self.run_id!r}")
        cut = self._by_id[event_id] + 1
        for ev in self._events[cut:]:
            del self._by_id[ev.id]
        self._events = self._events[:cut]
        self._rewrite()

    def close(self) -> None:
        pass


def _event_from_dict(d: dict[str, Any]) -> Event:
    return Event(
        id=d["id"],
        type=d["type"],
        payload=d.get("payload") or {},
        actor=d.get("actor"),
        frame_id=d.get("frame_id"),
        caused_by=d.get("caused_by"),
        timestamp=d.get("timestamp", ""),
    )


# ===========================================================================
# (a) DOMAIN PACK: a "research" pack built with the real pack API
# ===========================================================================
#
# Object types: topic, step, result. Relation type: produced (step->result).
# One @tool (deterministic), one versioned prompt (loaded from disk),
# behaviors that drive the BabyAGI loop, and a Policy gating `result`.

# ---- Pydantic schemas for the pack's object types ----

class Topic(BaseModel):
    title: str
    objective: str = ""


class Step(BaseModel):
    title: str
    status: str = Field(default="pending", pattern=r"^(pending|completed)$")
    topic_id: str = ""


class ResultObj(BaseModel):
    content: str
    step_id: str = ""


OBJECT_TYPES = [
    ObjectType(name="topic", schema=Topic, description="The research objective."),
    ObjectType(name="step", schema=Step, description="A unit of work."),
    ObjectType(name="result", schema=ResultObj, description="An executed step's output."),
]

RELATION_TYPES = [
    RelationType(
        name="produced",
        source_types=("step",),
        target_types=("result",),
        description="A step produced a result.",
    ),
]


# ---- pack-scoped @tool (deterministic, no network) ----

class SlugIn(BaseModel):
    text: str


class SlugOut(BaseModel):
    slug: str


@tool(
    name="slugify",
    description="Turn a title into a lowercase hyphenated slug.",
    input_schema=SlugIn,
    output_schema=SlugOut,
    deterministic=True,
)
def slugify(args: SlugIn, ctx) -> SlugOut:
    return SlugOut(slug="-".join(args.text.lower().split())[:60])


# ---- pack settings ----

class ResearchSettings(BaseModel):
    max_steps: int = 8
    require_result_approval: bool = False


# ---- LLM output schemas for the reactive behaviors ----

class StepResult(BaseModel):
    result: str = Field(description="A concrete answer to the step.")


class NewSteps(BaseModel):
    steps: list[str] = Field(
        description="0-N follow-up steps; empty list ends the loop."
    )


# ---- (b) the BabyAGI-shaped reactive agent loop, as PACK behaviors ----

@behavior(name="initializer", on=["goal.created"])
def initializer(event, graph, ctx):
    """Bootstrap the loop: goal.created -> a `topic` object."""
    goal = event.payload.get("goal", "")
    if not goal.startswith("Research:"):
        return
    objective = goal.split("Research:", 1)[1].strip()
    graph.add_object("topic", Topic(title=objective, objective=objective).model_dump())


@llm_behavior(
    name="planner",
    on=["object.created"],
    where={"object.type": "topic"},
    description="You are the PLANNER. Produce the first concrete step toward "
                "the objective. Output exactly one step.",
    output_schema=NewSteps,
    creates=["step"],
    deterministic=True,
)
def planner(event, graph, ctx, out, *, settings: ResearchSettings):
    topic_id = event.payload["object"]["id"]
    for title in list(out.steps)[: settings.max_steps]:
        if title.strip():
            graph.add_object(
                "step",
                Step(title=title.strip(), status="pending", topic_id=topic_id).model_dump(),
            )


@llm_behavior(
    name="executor",
    on=["object.created"],
    where={"object.type": "step"},
    description="You are the EXECUTOR. Carry out the step concretely. Do NOT "
                "plan further steps -- another behavior handles that.",
    output_schema=StepResult,
    creates=["result"],
    deterministic=True,
)
def executor(event, graph, ctx, out, *, settings: ResearchSettings):
    step = event.payload["object"]
    if step["data"].get("status") != "pending":
        return
    graph.patch_object(step["id"], {"status": "completed"})
    if settings.require_result_approval:
        ctx.propose_object(
            "result",
            ResultObj(content=out.result, step_id=step["id"]).model_dump(),
            reason=f"result_approval policy: step {step['id']}",
        )
    else:
        res = graph.add_object(
            "result",
            ResultObj(content=out.result, step_id=step["id"]).model_dump(),
        )
        graph.add_relation(step["id"], res.id, "produced")
    graph.emit("step.executed", {"step_id": step["id"], "result": out.result})


@llm_behavior(
    name="step_creator",
    on=["step.executed"],
    description="You are the STEP-CREATOR. Given the last result and the "
                "objective, propose 0-N follow-up steps. Empty list ends the loop.",
    output_schema=NewSteps,
    creates=["step"],
    deterministic=True,
)
def step_creator(event, graph, ctx, out, *, settings: ResearchSettings):
    existing = len(list(ctx.view.objects(type="step")))
    for title in out.steps:
        if title.strip() and existing < settings.max_steps:
            graph.add_object(
                "step",
                Step(title=title.strip(), status="pending").model_dump(),
            )
            existing += 1


BEHAVIORS = [initializer, planner, executor, step_creator]


# ===========================================================================
# Deterministic, keyless scripted LLM provider (LLMProvider Protocol)
# ===========================================================================
#
# Dispatches off the behavior name embedded in the runtime's system prompt
# (same technique RecordedDiligenceProvider uses). Drives the loop to a
# clean termination: planner -> 1 step, executor -> a result, step_creator
# -> exactly 2 follow-ups on the first executed step, then empty thereafter.

class ScriptedProvider:
    """Stateless, deterministic provider. Its output depends ONLY on the
    behavior name and the prompt content (which carries the live graph
    view), never on a mutable instance flag. Statelessness is what lets a
    FORK that replays the same graph produce byte-identical prompts and
    hit the replay cache -- a stateful provider would diverge."""

    default_model: str = "claude-sonnet-4-5"

    def recognizes_model(self, name: str) -> bool:
        return True

    def complete(self, *, system, messages, model, max_tokens, temperature,
                 top_p, output_schema, timeout_seconds, tools=None) -> LLMResponse:
        import re
        m = re.search(r'behavior named "([^"]+)"', system or "")
        bname = (m.group(1) if m else "").lower()
        # The user message embeds the live graph view + triggering event.
        # We branch step_creator off how many steps already exist so the
        # decision is a pure function of graph state, not instance memory.
        user = next((x.content for x in reversed(messages) if x.role == "user"), "")

        if bname.endswith("planner"):
            payload = {"steps": ["Outline the core concepts of the objective"]}
        elif bname.endswith("executor"):
            payload = {"result": "Concrete answer: the core concepts were outlined "
                                  "with three actionable bullet points."}
        elif bname.endswith("step_creator"):
            # Pure function of the TRIGGERING event: emit two follow-ups
            # only for the planner's seed step (step#2, the first object
            # of type step under the global monotonic id counter). Every
            # other executed step yields an empty list -> the loop
            # terminates without a while-condition. Deterministic across
            # parent and fork because object ids are reproducible.
            import re as _re
            trig = user.split("## Triggering event", 1)[-1]
            m_sid = _re.search(r'"step_id":\s*"([^"]+)"', trig)
            seed_step = m_sid and m_sid.group(1) == "step#2"
            if seed_step:
                payload = {"steps": [
                    "Draft a worked example for the first concept",
                    "List two common pitfalls and how to avoid them",
                ]}
            else:
                payload = {"steps": []}  # terminate the loop
        else:
            payload = {}

        parsed = output_schema.model_validate(payload) if output_schema else None
        return LLMResponse(
            raw_text=json.dumps(payload, sort_keys=True),
            parsed=parsed,
            input_tokens=80,
            output_tokens=20,
            cost_usd=Decimal("0.0010"),
            latency_seconds=0.1,
            model=model,
            finish_reason="end_turn",
        )

    def estimate_cost(self, *, input_tokens, output_tokens, model) -> Decimal:
        return Decimal("0.001")

    def count_tokens(self, *, system, messages, model) -> int:
        return max(1, (len(system or "") + sum(len(x.content) for x in messages)) // 4)


# ===========================================================================
# Build the pack (scaffold a fresh one on disk to prove the loader, then
# build the real pack object with prompts loaded from a prompts dir)
# ===========================================================================

def build_pack(workdir: Path) -> Pack:
    # Prove the scaffold codepath: generate a runnable pack skeleton on disk.
    scaffold_root = scaffold_pack(workdir, "research-scaffold-demo")
    assert (scaffold_root / "pyproject.toml").is_file()
    assert (scaffold_root / "research_scaffold_demo" / "__init__.py").is_file()

    # Build the real, behavior-rich pack. Load a versioned, content-hashed
    # prompt from a prompts dir (same load_prompts_from_dir path the
    # Diligence pack uses).
    prompts_dir = workdir / "research_prompts"
    prompts_dir.mkdir(exist_ok=True)
    (prompts_dir / "planner.md").write_text(
        '---\nversion = "1.0.0"\n---\n'
        "Plan exactly one first step. Be concrete and actionable.\n",
        encoding="utf-8",
    )
    prompts = load_prompts_from_dir(prompts_dir)

    return Pack(
        name="research",
        version="0.1.0",
        description="A custom autonomous-research pack (extra-hard reference).",
        object_types=OBJECT_TYPES,
        relation_types=RELATION_TYPES,
        behaviors=BEHAVIORS,
        tools=[slugify],
        policies=[PackPolicy(name="result_approval", requires_approval=("result",))],
        prompts=prompts,
        settings_schema=ResearchSettings,
    )


# ===========================================================================
# Driver
# ===========================================================================

def run_capability_c() -> tuple[int, int]:
    """Run the framework's own EventStoreConformance suite against the
    custom JSONLEventStore. Returns (passed, total)."""
    from activegraph.store.conformance import EventStoreConformance

    class JSONLConformance(EventStoreConformance):
        __test__ = True

        def setup(self):
            fd, self._path = tempfile.mkstemp(suffix=".jsonl")
            os.close(fd)
            os.remove(self._path)

        def make_store(self, run_id):
            if not hasattr(self, "_path") or not self._path:
                self.setup()
            return JSONLEventStore(self._path, run_id=run_id)

        def cleanup(self):
            try:
                os.remove(self._path)
            except (FileNotFoundError, AttributeError):
                pass
            self._path = None

    suite = JSONLConformance()
    test_names = sorted(
        n for n in dir(suite)
        if n.startswith("test_") and callable(getattr(suite, n))
    )
    passed = 0
    for name in test_names:
        suite.setup()
        getattr(suite, name)()   # each test calls cleanup() in its finally
        passed += 1
        print(f"  conformance PASS: {name}")
    return passed, len(test_names)


def assert_invariants(rt: Runtime) -> None:
    events = rt.graph.events
    types = [e.type for e in events]

    # --- pack.loaded with the CUSTOM types ---
    pack_loaded = [e for e in events if e.type == "pack.loaded"]
    assert len(pack_loaded) == 1, f"expected exactly 1 pack.loaded, got {len(pack_loaded)}"
    pl = pack_loaded[0].payload
    assert pl["name"] == "research"
    assert set(pl["object_types"]) == {"topic", "step", "result"}, pl["object_types"]
    assert "research.slugify" in pl["tools"], pl["tools"]
    assert "research.result_approval" in pl["policies"], pl["policies"]
    assert {"research.initializer", "research.planner", "research.executor",
            "research.step_creator"} <= set(pl["behaviors"]), pl["behaviors"]
    # prompt content hash is in the manifest (replay contract)
    assert "planner" in pl["prompts"] and pl["prompts"]["planner"]["hash"].startswith("sha256:")

    # --- reactive loop actually propagated ---
    objs = {}
    for o in rt.graph.all_objects():
        objs.setdefault(o.type, 0)
        objs[o.type] += 1
    # 1 topic, planner made 1 step, step_creator made 2 follow-ups = 3 steps,
    # each pending step executed -> 3 results.
    assert objs.get("topic") == 1, objs
    assert objs.get("step") == 3, objs
    assert objs.get("result") == 3, objs

    # --- the LLM behaviors actually fired (real llm.requested/responded) ---
    n_req = types.count("llm.requested")
    n_resp = types.count("llm.responded")
    assert n_req >= 5 and n_req == n_resp, (n_req, n_resp)
    # every llm.requested/responded is attributed to a research.* behavior
    behs = {e.payload.get("behavior") for e in events
            if e.type == "llm.responded"}
    assert all(b and b.startswith("research.") for b in behs), behs

    # --- behaviors completed; runtime reached idle ---
    assert "behavior.completed" in types
    assert "runtime.idle" in types
    # the custom step.executed event was emitted by the executor behavior
    assert types.count("step.executed") == 3, types.count("step.executed")

    # --- pack schema enforcement on the custom type (load-time gating) ---
    from activegraph.packs import PackSchemaViolation
    try:
        rt.graph.add_object("step", {"title": "x", "status": "NOT_A_VALID_STATUS"})
        raise AssertionError("expected PackSchemaViolation for bad status")
    except PackSchemaViolation:
        pass


def assert_fork_invariant(rt: Runtime, db_path: str) -> None:
    """Fork at goal.created into a new run, then continue. The
    framework-grounded, ungameable facts a referee can assert:

      1. The fork mints a DISTINCT run_id.
      2. The store's `runs` table records the fork's parent_run_id and
         forked_at_event_id pointing back at the parent -- a fresh run
         (no-op) has parent_run_id=None.
      3. The fork's event PREFIX (up to & including the fork point) is
         byte-identical to the parent's prefix: same event ids
         (evt_001, evt_002...) and types. A fresh run would mint new
         ids; only a real branch reuses the parent's recorded prefix.
      4. The fork propagated NEW behavior firings past the fork point
         (its own llm.requested/responded + behavior.completed), so it
         is a live re-run of the reactive loop, not a static copy.
    """
    from activegraph.store.sqlite import SQLiteEventStore

    goal_evt = next(e for e in rt.graph.events if e.type == "goal.created")
    fork = rt.fork(at_event=goal_evt.id, label="xh-fork", replay_llm_cache=True)
    fork.load_pack(_PACK_REF, settings=ResearchSettings(max_steps=8))
    fork.run_until_idle()
    fork.save_state()

    # (1) distinct run id
    assert fork.run_id != rt.run_id, "fork must mint a distinct run_id"

    # (2) parent linkage recorded in the store
    runs = {r.run_id: r for r in SQLiteEventStore.list_runs(db_path)}
    fr = runs[fork.run_id]
    assert fr.parent_run_id == rt.run_id, (fr.parent_run_id, rt.run_id)
    assert fr.forked_at_event_id == goal_evt.id, fr.forked_at_event_id
    assert runs[rt.run_id].parent_run_id is None, "parent must have no parent"

    # (3) byte-identical prefix (ids + types) up to the fork point
    def prefix(evs):
        out = []
        for e in evs:
            out.append((e.id, e.type))
            if e.id == goal_evt.id:
                break
        return out
    assert prefix(rt.graph.events) == prefix(fork.graph.events), "fork prefix diverged"

    # (4) the fork ran the loop afresh past the fork point
    after = []
    seen_cut = False
    for e in fork.graph.events:
        if seen_cut:
            after.append(e)
        if e.id == goal_evt.id:
            seen_cut = True
    fork_llm = [e for e in after if e.type == "llm.responded"]
    fork_done = [e for e in after if e.type == "behavior.completed"]
    fork_idle = [e for e in after if e.type == "runtime.idle"]
    assert len(fork_llm) >= 5 and fork_done and fork_idle, (
        len(fork_llm), len(fork_done), len(fork_idle)
    )
    assert all((e.payload.get("behavior") or "").startswith("research.")
               for e in fork_llm), "fork LLM turns must be research.* behaviors"

    fork_steps = sum(1 for o in fork.graph.all_objects() if o.type == "step")
    fork_results = sum(1 for o in fork.graph.all_objects() if o.type == "result")
    print(f"  fork run_id={fork.run_id} parent={fr.parent_run_id} "
          f"forked_at={fr.forked_at_event_id}; prefix identical; "
          f"re-ran {len(fork_llm)} LLM turns past fork point; "
          f"rebuilt {fork_steps} steps / {fork_results} results")


_PACK_REF: Optional[Pack] = None


def main() -> int:
    global _PACK_REF
    db = "/tmp/ref_extra_hard_research.db"

    print("=== (a)+(b) custom PACK + autonomous reactive agent loop ===")
    # Rebuild the pack once and stash it so the fork can reload the SAME pack.
    workdir = Path(tempfile.mkdtemp(prefix="ref_xh_pack_"))
    _PACK_REF = build_pack(workdir)

    if os.path.exists(db):
        os.remove(db)
    graph = Graph()
    rt = Runtime(
        graph,
        llm_provider=ScriptedProvider(),
        persist_to=db,
        budget={"max_events": 200, "max_seconds": 30},
    )
    assert rt.load_pack(_PACK_REF, settings=ResearchSettings(max_steps=8)) is True
    assert rt.load_pack(_PACK_REF, settings=ResearchSettings(max_steps=8)) is False
    rt.run_goal("Research: how event-sourced agent loops terminate")
    rt.save_state()
    by_type: dict[str, int] = {}
    for o in rt.graph.all_objects():
        by_type[o.type] = by_type.get(o.type, 0) + 1
    print(f"  run_id={rt.run_id}  events={len(rt.graph.events)}  objects={by_type}")

    print("=== assert pack + loop invariants ===")
    assert_invariants(rt)
    print("  OK: pack.loaded(custom types) + reactive loop + schema gating")

    print("=== assert fork invariant (distinct run, parent linkage, prefix) ===")
    assert_fork_invariant(rt, db)

    print("=== (c) custom NON-DEFAULT EventStore vs framework conformance suite ===")
    passed, total = run_capability_c()
    assert passed == total and total >= 9, (passed, total)
    print(f"  OK: JSONLEventStore passed {passed}/{total} conformance tests")

    # Export the parent trace as JSONL for the referee to inspect.
    out = "/tmp/ref_extra_hard_research.trace.jsonl"
    rt.export_trace(out)
    with open(out) as f:
        n = sum(1 for _ in f)
    print(f"=== trace exported: {out} ({n} events) ===")

    print("\nALL EXTRA-HARD CAPABILITIES VERIFIED.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
