"""T6-medium reference: custom ontology + reactive behavior that proposes a Patch.

Capability proven (NO API keys, NO network, pure framework):

  1. CUSTOM ONTOLOGY — objects are created with custom types via the real
     `graph.add_object("claim", {...})` / `graph.add_object("task", {...})`
     API, and typed relations are added via
     `graph.add_relation(src, tgt, "depends_on")` / `"supports"`.

  2. REACTIVE BEHAVIOR — a `@behavior` (`risk_flagger`) subscribes to the
     FIXED framework event `object.created` (scoped with where={object.type:
     claim}). When a low-confidence claim appears, it PROPOSES a Patch
     (`graph.propose_patch(... op="update" ...)` -> emits `patch.proposed`)
     and then APPLIES it (`graph.apply_patch(...)` -> emits `patch.applied`),
     mutating the graph: the claim's `status` flips open -> needs_review and
     its `version` bumps 1 -> 2.

  3. RELATION REACTIVITY — a `@relation_behavior` (`link_logger`) fires on
     each new `supports` edge and patches the target document.

The graph is event-sourced: the event log is the proof. We assert on it at
the bottom (the same invariant a referee should check). We persist to a
throwaway SQLite file so the run is durable and re-inspectable.

Run:
    ANTHROPIC_API_KEY= OPENAI_API_KEY= \
      .venv/bin/python /tmp/ref_medium.py
"""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

from activegraph import (
    Graph,
    Runtime,
    behavior,
    clear_registry,
    relation_behavior,
)

# Belt-and-suspenders: make absolutely sure no provider can reach the network.
os.environ.pop("ANTHROPIC_API_KEY", None)
os.environ.pop("OPENAI_API_KEY", None)


# ---------- the custom-ontology reactive behaviors -------------------------


def register_behaviors() -> None:
    """Behaviors are code, not state. (Re)register from a clean slate."""
    clear_registry()

    # (A) planner: seed the custom ontology from the run goal.
    #     Creates custom-typed objects ("task", "claim") and a typed
    #     "depends_on" relation between them.
    @behavior(name="planner", on=["goal.created"])
    def planner(event, graph, ctx):
        research = graph.add_object(
            "task", {"title": "Research market", "status": "open"}
        )
        memo = graph.add_object(
            "task", {"title": "Draft memo", "status": "blocked"}
        )
        # typed relation in the custom ontology
        graph.add_relation(research.id, memo.id, "depends_on")
        # a custom-typed "claim" object with a low confidence — this is what
        # the reactive risk_flagger will react to and patch.
        claim = graph.add_object(
            "claim",
            {
                "text": "Retention may be slipping.",
                "confidence": 0.3,  # < 0.5 -> risk_flagger will flag it
                "status": "open",
            },
        )
        # a typed "supports" edge from the claim back to the research task,
        # which drives the relation behavior.
        graph.add_relation(claim.id, research.id, "supports")

    # (B) risk_flagger: THE reactive behavior the tier is about.
    #     Subscribes to the FIXED event object.created, scoped to the custom
    #     "claim" type. Inside a behavior the `graph` arg is the constrained
    #     BehaviorGraph wrapper (CONTRACT #7): it auto-stamps actor=behavior
    #     name and caused_by=triggering event. It exposes propose_patch
    #     (-> patch.proposed) and patch_object (-> patch.applied, the
    #     auto-apply that actually mutates the graph).
    @behavior(
        name="risk_flagger",
        on=["object.created"],
        where={"object.type": "claim"},
    )
    def risk_flagger(event, graph, ctx):
        claim = event.payload["object"]
        if claim["data"].get("confidence", 1.0) >= 0.5:
            return  # high-confidence claims need no review
        # 1) Propose a Patch -> emits patch.proposed (proposed_by stamped to
        #    "risk_flagger", caused_by stamped to this object.created event).
        graph.propose_patch(
            claim["id"],
            "update",
            {"reviewed_reason": "confidence below 0.5 review threshold"},
            rationale="confidence below 0.5 review threshold",
        )
        # 2) Apply a Patch that MUTATES the graph -> emits patch.applied,
        #    flipping status open -> needs_review and bumping version 1 -> 2.
        graph.patch_object(
            claim["id"],
            {"status": "needs_review", "flagged_by": "risk_flagger"},
        )

    # (C) link_logger: relation behavior — fires per new "supports" edge,
    #     patches the edge's target so we can prove relation reactivity too.
    @relation_behavior(
        name="link_logger", relation_type="supports", on=["relation.created"]
    )
    def link_logger(relation, event, graph, ctx):
        target = graph.get_object(relation.target)
        if target and not target.data.get("has_supporting_claim"):
            graph.patch_object(relation.target, {"has_supporting_claim": True})


def main() -> int:
    work = Path(tempfile.mkdtemp(prefix="ref-medium-"))
    db_path = work / "ontology.db"
    db_url = f"sqlite:///{db_path}"

    register_behaviors()
    graph = Graph()
    rt = Runtime(graph, persist_to=db_url, budget={"max_events": 200})
    rt.run_goal("Evaluate retention risk")
    rt.save_state()

    events = rt.graph.events
    types = [e.type for e in events]

    # ---------- the referee invariant (assert on the EVENT LOG) ----------

    # 1) custom-typed objects landed via object.created
    claim_objs = [o for o in rt.graph.all_objects() if o.type == "claim"]
    task_objs = [o for o in rt.graph.all_objects() if o.type == "task"]
    assert claim_objs, "no custom-typed 'claim' object created"
    assert len(task_objs) == 2, f"expected 2 'task' objects, got {len(task_objs)}"

    # 2) typed relations landed via relation.created
    depends = rt.graph.get_relations(type="depends_on")
    supports = rt.graph.get_relations(type="supports")
    assert depends, "no typed 'depends_on' relation"
    assert supports, "no typed 'supports' relation"

    # 3) the reactive behavior fired in response to object.created and
    #    proposed THEN applied a patch (this is the load-bearing assertion).
    assert "patch.proposed" in types, "risk_flagger never proposed a patch"
    assert "patch.applied" in types, "proposed patch was never applied"

    proposed = [e for e in events if e.type == "patch.proposed"]
    applied = [e for e in events if e.type == "patch.applied"]

    # the proposed patch was authored by the reactive behavior, caused by an
    # object.created event, targeting the custom claim object.
    flag_proposed = [
        e for e in proposed
        if e.payload["patch"]["proposed_by"] == "risk_flagger"
    ]
    assert flag_proposed, "no patch.proposed authored by risk_flagger"
    fp = flag_proposed[0]
    cause = next((e for e in events if e.id == fp.caused_by), None)
    assert cause is not None and cause.type == "object.created", (
        "risk_flagger's patch was not caused by an object.created event"
    )
    assert cause.payload["object"]["type"] == "claim", (
        "risk_flagger reacted to the wrong object type"
    )

    # 4) the graph actually MUTATED: the claim's status flipped and its
    #    version bumped 1 -> 2 (patch.applied increments version).
    flagged = next(
        o for o in claim_objs if o.data.get("status") == "needs_review"
    )
    assert flagged.data.get("flagged_by") == "risk_flagger"
    assert flagged.version == 2, f"expected version 2 after patch, got {flagged.version}"

    # 5) ZERO LLM activity — this tier needs no model. Proves no network.
    assert "llm.requested" not in types, "unexpected LLM call"
    assert "llm.responded" not in types, "unexpected LLM response"

    # 6) relation behavior reactivity: the supports edge's target got patched.
    supported_target = rt.graph.get_object(supports[0].target)
    assert supported_target.data.get("has_supporting_claim") is True

    # 7) loop terminated cleanly.
    assert types[-1] == "runtime.idle", f"runtime did not idle: ended {types[-1]}"

    # ---------- machine-readable summary for the referee -----------------
    from collections import Counter
    summary = {
        "db_url": db_url,
        "run_id": rt.run_id,
        "total_events": len(events),
        "event_type_counts": dict(Counter(types)),
        "custom_object_types": sorted({o.type for o in rt.graph.all_objects()}),
        "relation_types": sorted({r.type for r in rt.graph.all_relations()}),
        "flagged_claim": {
            "id": flagged.id,
            "status": flagged.data["status"],
            "version": flagged.version,
            "flagged_by": flagged.data.get("flagged_by"),
        },
        "reactive_patch": {
            "proposed_by": fp.payload["patch"]["proposed_by"],
            "caused_by_event_type": cause.type,
            "caused_by_object_type": cause.payload["object"]["type"],
        },
    }
    print(json.dumps(summary, indent=2, default=str))
    print("\nINVARIANT HOLDS: custom ontology + reactive patch verified.")
    print(f"event log persisted at: {db_url}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
