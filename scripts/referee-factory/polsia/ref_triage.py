"""Reference self-healing TRIAGE: a behavior subscribes to behavior.failed (a
first-class event — failures don't crash the run) and wakes remediation. Run to
confirm the framework emits behavior.failed and a behavior can react to it."""
import os
os.environ.pop("ANTHROPIC_API_KEY", None); os.environ.pop("OPENAI_API_KEY", None)
from activegraph import Graph, Runtime, behavior, clear_registry
from collections import Counter

def register():
    clear_registry()
    @behavior(name="planner", on=["goal.created"])
    def planner(event, graph, ctx):
        graph.add_object("task", {"title": "flaky", "status": "queued"})
    @behavior(name="flaky_worker", on=["object.created"], where={"object.type": "task"})
    def flaky_worker(event, graph, ctx):
        raise RuntimeError("simulated upstream API change (e.g. Twitter v2 breaking change)")
    @behavior(name="triage", on=["behavior.failed"])
    def triage(event, graph, ctx):
        failed = event.payload.get("behavior")
        graph.emit("remediation.requested", {"failed_behavior": failed, "reason": event.payload.get("reason")})
        graph.add_object("remediation", {"target": failed, "status": "open"})

register()
g = Graph(); rt = Runtime(g, budget={"max_events": 300}); rt.run_goal("trigger a failure")
types = [e.type for e in rt.graph.events]
print("event_type_counts:", dict(Counter(types)))
print("reached runtime.idle (no crash):", types[-1] == "runtime.idle")
print("behavior.failed present:", "behavior.failed" in types)
print("remediation.requested present:", "remediation.requested" in types)
print("remediation objects:", len([o for o in rt.graph.all_objects() if o.type == "remediation"]))
