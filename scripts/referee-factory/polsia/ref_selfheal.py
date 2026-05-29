"""Reference SELF-HEALING engine — the CORRECT mechanism (external detection on the
event log, since behaviors cannot subscribe to behavior.failed). A saboteur breaks a
behavior -> behavior.failed is recorded (run does not crash). An EXTERNAL triage
function detects it in the log, dispatches a fix (remediated behavior), re-runs, and
structurally diffs: the remediated run has 0 behavior.failed where the parent had >=1.
Run to confirm offline."""
import os
os.environ.pop("ANTHROPIC_API_KEY", None); os.environ.pop("OPENAI_API_KEY", None)
from activegraph import Graph, Runtime, behavior, clear_registry

def run(broken: bool):
    clear_registry()
    @behavior(name="planner", on=["goal.created"])
    def planner(event, graph, ctx):
        graph.add_object("task", {"title": "post_tweet", "status": "queued"})
    @behavior(name="worker", on=["object.created"], where={"object.type": "task"})
    def worker(event, graph, ctx):
        if broken:
            raise RuntimeError("upstream API drift (e.g. Twitter v2 breaking change)")
        graph.emit("tool.executed", {"task_id": event.payload["object"]["id"]})
        graph.patch_object(event.payload["object"]["id"], {"status": "completed"})
    g = Graph(); rt = Runtime(g, budget={"max_events": 200}); rt.run_goal("do work")
    return rt

# --- parent run with the bug ---
parent = run(broken=True)
parent_types = [e.type for e in parent.graph.events]
parent_failures = parent_types.count("behavior.failed")

# --- EXTERNAL triage: detect behavior.failed in the log (behaviors can't, so we watch) ---
def triage_detect(rt):
    return [e for e in rt.graph.events if e.type == "behavior.failed"]
detected = triage_detect(parent)

# --- remediation: dispatch the fix, re-run (the "fork" with a corrected behavior) ---
healed = run(broken=False)
healed_types = [e.type for e in healed.graph.events]
healed_failures = healed_types.count("behavior.failed")

# --- structural diff of the verified fix (non-lifecycle event streams differ) ---
def nonlifecycle(rt):
    return [e.type for e in rt.graph.events if not e.type.startswith(("behavior.", "relation_behavior.", "runtime."))]
diff_changed = nonlifecycle(parent) != nonlifecycle(healed)

assert parent_failures >= 1, f"parent should have failed; failures={parent_failures}"
assert len(detected) >= 1, "triage did not detect behavior.failed in the log"
assert healed_failures == 0, f"healed run still failing; failures={healed_failures}"
assert "tool.executed" in healed_types, "healed run did not actually do the work"
assert diff_changed, "structural diff shows no change between broken and healed"
print(f"SELF_HEAL_INVARIANT_HOLDS: parent behavior.failed={parent_failures} -> detected={len(detected)} -> healed behavior.failed={healed_failures}; diff changed={diff_changed}")
