"""ref_hard.py — VERIFIED reference impl for Active Graph TIER=hard.

Exercises three advanced primitives against the REAL framework with a
scripted (no-network, no-key) LLM provider:

  (a) RELATION behavior — logic on an edge, fires only for events touching
      its endpoints. We add a `depends_on` edge research->memo. When the
      research task completes, the relation behavior `unblock` fires and
      patches the OTHER endpoint (memo) open. A task.completed for an
      unrelated task does NOT fire it.

  (b) Cypher-PATTERN subscription — fires only when a graph SHAPE forms:
      (cl:claim)<-[:cites]-(ev:evidence). The `corroborated` behavior is
      registered with on=["relation.created"] + pattern, so it fires
      exactly once, on the relation.created that completes the cited-by
      shape — not on claim/evidence creation, and not on unrelated edges.

  (c) FORK + DIFF with replay cache — an LLM behavior makes 1 real provider
      call in the parent. We fork at goal.created with replay_llm_cache=True
      and run to idle. The fork serves every LLM response FROM CACHE, so the
      fork provider's call_log is empty (ZERO new llm calls), and the fork's
      llm.responded event has cache_hit=True. Then diff parent vs fork to
      confirm structural identity (no divergence) — replay reproduced the run.

Run with empty keys:
  ANTHROPIC_API_KEY= OPENAI_API_KEY= .venv/bin/python /tmp/ref_hard.py
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Callable, Optional

from pydantic import BaseModel

from activegraph import (
    FrozenClock,
    Graph,
    Runtime,
    behavior,
    clear_registry,
    llm_behavior,
    relation_behavior,
)
from activegraph.llm import LLMCache, LLMMessage, LLMResponse


# --------------------------------------------------------------------------
# A no-network, no-key scripted LLM provider (mirrors tests/_llm_helpers.py).
# call_log lets us assert "ZERO new LLM calls on the cached fork".
# --------------------------------------------------------------------------
class Claim(BaseModel):
    text: str
    confidence: float


class ClaimList(BaseModel):
    claims: list[Claim]


@dataclass
class ScriptedProvider:
    respond_fn: Callable[[list, Optional[type]], Any]
    call_log: list[dict] = field(default_factory=list)
    token_count_log: list[dict] = field(default_factory=list)
    fixed_cost: Decimal = Decimal("0.0012")
    default_model: str = "claude-sonnet-4-5"

    def recognizes_model(self, name: str) -> bool:
        return True

    def complete(self, *, system, messages, model, max_tokens, temperature,
                 top_p, output_schema, timeout_seconds, tools=None) -> LLMResponse:
        self.call_log.append({"model": model, "messages": [m.to_dict() for m in messages]})
        out = self.respond_fn(messages, output_schema)
        raw = out.model_dump_json() if isinstance(out, BaseModel) else json.dumps(out, sort_keys=True)
        parsed = out
        return LLMResponse(
            raw_text=raw, parsed=parsed, input_tokens=42, output_tokens=11,
            cost_usd=self.fixed_cost, latency_seconds=0.012, model=model,
            finish_reason="end_turn",
        )

    def estimate_cost(self, *, input_tokens, output_tokens, model) -> Decimal:
        return self.fixed_cost

    def count_tokens(self, *, system, messages, model) -> int:
        self.token_count_log.append({"system": system})
        total = len(system) + sum(len(m.content) for m in messages)
        return max(1, total // 4)


def _scripted(text="Market is early but growing.") -> ScriptedProvider:
    return ScriptedProvider(
        respond_fn=lambda m, s: ClaimList(claims=[Claim(text=text, confidence=0.8)])
    )


# --------------------------------------------------------------------------
# Behaviors (re-registered fresh each run, since behaviors are code not state)
# --------------------------------------------------------------------------
def register_behaviors() -> None:
    clear_registry()

    # seed: build the graph shape.
    @behavior(name="planner", on=["goal.created"])
    def planner(event, graph, ctx):
        research = graph.add_object("task", {"title": "Research market", "status": "open"})
        memo = graph.add_object("task", {"title": "Draft memo", "status": "blocked"})
        # The edge whose logic lives in the relation behavior below.
        graph.add_relation(research.id, memo.id, "depends_on")
        # An UNRELATED task to prove the relation behavior is endpoint-scoped.
        graph.add_object("task", {"title": "Unrelated chore", "status": "open"})

    # researcher: complete the Research task. The task.completed payload
    # carries the title so the extractor (c) can gate on it.
    @behavior(name="researcher", on=["object.created"], where={"object.type": "task"})
    def researcher(event, graph, ctx):
        task = event.payload["object"]
        if task["data"]["status"] != "open" or "Research" not in task["data"]["title"]:
            return
        graph.emit("task.completed", {"task_id": task["id"], "title": task["data"]["title"]})

    # Fire a SPURIOUS task.completed for the unrelated task to PROVE the
    # relation behavior does NOT fire when the event doesn't touch its edge.
    @behavior(name="noise", on=["object.created"], where={"object.type": "task"})
    def noise(event, graph, ctx):
        task = event.payload["object"]
        if "Unrelated" in task["data"]["title"]:
            graph.emit("task.completed", {"task_id": task["id"], "title": task["data"]["title"]})

    # (a) RELATION BEHAVIOR — logic on the depends_on edge. Fires per matching
    # edge on task.completed; patches the OTHER endpoint open only when the
    # completed task is THIS edge's source.
    @relation_behavior(name="unblock", relation_type="depends_on", on=["task.completed"])
    def unblock(relation, event, graph, ctx):
        if event.payload["task_id"] == relation.source:
            graph.patch_object(relation.target, {"status": "open"})

    # (b) CYPHER-PATTERN SUBSCRIPTION — fires only when the cited-by shape
    # forms: (cl:claim)<-[:cites]-(ev:evidence). on=["relation.created"] gates
    # it to edge-creation, the pattern gates it to the exact shape.
    @behavior(
        name="corroborated",
        on=["relation.created"],
        pattern="(ev:evidence)-[r:cites]->(cl:claim)",
    )
    def corroborated(event, graph, ctx):
        # ctx.matches carries the bindings of the matched shape.
        for m in ctx.matches:
            cl_id = m.bindings["cl"]
            graph.patch_object(cl_id, {"corroborated": True})

    # (c) LLM BEHAVIOR — one real provider call in the parent; cached on fork.
    # A `where` gate ties extraction to the research task only, so exactly ONE
    # cited-by shape forms (keeps the pattern-subscription invariant crisp:
    # one shape => one match). The unrelated task.completed makes NO LLM call.
    @llm_behavior(
        name="extractor",
        on=["task.completed"],
        where={"title": "Research market"},
        description="Extract a market claim.",
        output_schema=ClaimList,
        deterministic=True,
    )
    def extractor(event, graph, ctx, llm_output):
        for c in llm_output.claims:
            cl = graph.add_object("claim", {"text": c.text, "confidence": c.confidence})
            ev = graph.add_object("evidence", {"source": "report-2026"})
            # Creating this edge completes the (evidence)-[cites]->(claim) shape,
            # which is what triggers the pattern subscription (b).
            graph.add_relation(ev.id, cl.id, "cites")


# --------------------------------------------------------------------------
def fail(msg: str) -> None:
    print(f"FAIL: {msg}")
    sys.exit(1)


def dump_log(label: str, graph: Graph) -> None:
    print(f"\n--- event log: {label} ---")
    for e in graph.events:
        extra = ""
        if e.type == "relation_behavior.started":
            extra = f" behavior={e.payload['behavior']} relation_id={e.payload['relation_id']}"
        elif e.type == "pattern.matched":
            extra = f" behavior={e.payload['behavior']} matches={e.payload['matches_count']}"
        elif e.type == "llm.responded":
            extra = f" cache_hit={e.payload.get('cache_hit')}"
        print(f"  {e.id}: {e.type}{extra}")


def main() -> None:
    db = tempfile.mktemp(suffix=".db")
    try:
        register_behaviors()
        provider = _scripted()
        graph = Graph(clock=FrozenClock())
        parent = Runtime(graph, llm_provider=provider, persist_to=db)
        parent.run_goal("Evaluate this startup idea")

        dump_log("PARENT", parent.graph)

        # ---- (a) relation behavior fired exactly once, on the depends_on edge.
        rb_started = [e for e in graph.events if e.type == "relation_behavior.started"
                      and e.payload["behavior"] == "unblock"]
        if len(rb_started) != 1:
            fail(f"(a) expected relation behavior 'unblock' started exactly once, "
                 f"got {len(rb_started)}")
        depends_edges = [r for r in graph.all_relations() if r.type == "depends_on"]
        if rb_started[0].payload["relation_id"] != depends_edges[0].id:
            fail("(a) relation behavior fired on the wrong edge")
        # The memo (target of depends_on) was unblocked -> status now 'open'.
        memo = graph.get_object(depends_edges[0].target)
        if memo.data["status"] != "open":
            fail(f"(a) memo not unblocked; status={memo.data['status']!r}")
        # There were TWO task.completed events (research + unrelated) but the
        # relation behavior fired only ONCE -> it is endpoint-scoped, not global.
        completed = [e for e in graph.events if e.type == "task.completed"]
        if len(completed) < 2:
            fail(f"(a) expected >=2 task.completed events, got {len(completed)}")
        print(f"\n[a] OK relation behavior 'unblock' fired 1x on edge "
              f"{depends_edges[0].id} across {len(completed)} task.completed events "
              f"(endpoint-scoped); memo status -> open")

        # ---- (b) pattern subscription fired exactly once, when the shape formed.
        pm = [e for e in graph.events if e.type == "pattern.matched"
              and e.payload["behavior"] == "corroborated"]
        if len(pm) != 1:
            fail(f"(b) expected pattern 'corroborated' matched exactly once, got {len(pm)}")
        if pm[0].payload["matches_count"] != 1:
            fail(f"(b) expected matches_count==1, got {pm[0].payload['matches_count']}")
        claims = [o for o in graph.all_objects() if o.type == "claim"]
        if not claims or not claims[0].data.get("corroborated"):
            fail("(b) claim was not marked corroborated by the pattern behavior")
        # depends_on relation.created did NOT match the cites-shape pattern.
        rel_created = [e for e in graph.events if e.type == "relation.created"]
        if len(rel_created) < 2:
            fail(f"(b) expected >=2 relation.created (depends_on + cites), "
                 f"got {len(rel_created)}")
        print(f"[b] OK cypher-pattern 'corroborated' matched 1x across "
              f"{len(rel_created)} relation.created events (shape-gated); "
              f"claim marked corroborated")

        # ---- (c) fork at goal.created, replay LLM cache => ZERO new llm calls.
        parent_calls = len(provider.call_log)
        if parent_calls < 1:
            fail(f"(c) parent should have made >=1 real LLM call, got {parent_calls}")
        cache = LLMCache.from_events(graph.events)
        if len(cache) < 1:
            fail(f"(c) expected >=1 cached llm response harvested from events, "
                 f"got {len(cache)}")

        goal_evt = next(e for e in graph.events if e.type == "goal.created")
        fork_provider = _scripted()  # fresh provider — call_log starts empty
        fork = parent.fork(
            at_event=goal_evt.id,
            label="replay-cached",
            replay_llm_cache=True,
            llm_provider=fork_provider,
        )
        fork.run_until_idle()

        dump_log("FORK (replay-cached)", fork.graph)

        if fork_provider.call_log != []:
            fail(f"(c) fork made {len(fork_provider.call_log)} NEW llm calls; "
                 f"expected ZERO (replay cache invariant violated)")
        fork_resp = [e for e in fork.graph.events if e.type == "llm.responded"]
        if not fork_resp:
            fail("(c) fork emitted no llm.responded event")
        if not all(e.payload.get("cache_hit") is True for e in fork_resp):
            fail("(c) fork llm.responded events were not all cache_hit=True")
        print(f"\n[c] OK fork '{fork.run_id}' replayed shared prefix with "
              f"{len(fork_provider.call_log)} new LLM calls "
              f"(parent made {parent_calls}); all {len(fork_resp)} fork "
              f"llm.responded events cache_hit=True")

        # ---- (c.2) diff parent vs fork — replay reproduced the FINAL STATE.
        # The framework guarantees zero divergent objects/relations for a
        # cache-replayed fork (see tests/test_diff.py
        # ::test_diff_identical_runs_has_no_divergence). Event-payload
        # provenance carries run-scoped fields, so the event-partition is
        # not bit-identical; final-state divergence is the structural test.
        diff = parent.diff(fork)
        print("\n=== diff: parent vs fork ===")
        print(f"  shared events:       {len(diff.shared_events)}")
        print(f"  parent-only events:  {len(diff.parent_only_events)}")
        print(f"  fork-only events:    {len(diff.fork_only_events)}")
        print(f"  divergent objects:   {len(diff.divergent_objects)}")
        print(f"  divergent relations: {len(diff.divergent_relations)}")
        print(f"  is_identical:        {diff.is_identical}")
        if diff.divergent_objects or diff.divergent_relations:
            fail("(c.2) replayed fork diverged in FINAL STATE from parent; "
                 f"objs={len(diff.divergent_objects)} rels={len(diff.divergent_relations)}")
        # Same object/relation populations on both sides proves the replay
        # reproduced the run rather than producing a degenerate empty fork.
        p_objs = {o.id for o in parent.graph.all_objects()}
        f_objs = {o.id for o in fork.graph.all_objects()}
        if p_objs != f_objs or len(p_objs) < 5:
            fail(f"(c.2) object populations differ or too small: "
                 f"parent={sorted(p_objs)} fork={sorted(f_objs)}")
        print(f"[c.2] OK replayed fork has 0 divergent objects/relations vs parent; "
              f"identical {len(p_objs)}-object final state (replay reproduced the run)")

        print("\nALL HARD INVARIANTS HELD — ref_hard.py PASS")
    finally:
        if os.path.exists(db):
            os.remove(db)


if __name__ == "__main__":
    main()
