import os
os.environ.pop("ANTHROPIC_API_KEY", None); os.environ.pop("OPENAI_API_KEY", None)
from activegraph import Graph, Runtime, behavior, clear_registry
from collections import Counter
clear_registry()
@behavior(name="planner", on=["goal.created"])
def planner(event, graph, ctx):
    graph.add_object("task", {"title": "x", "status": "queued"})
    graph.emit("custom.signal", {"k": 1})            # a custom (behavior-emitted) event
@behavior(name="on_custom", on=["custom.signal"])    # does a behavior fire on a custom event?
def on_custom(event, graph, ctx):
    graph.emit("custom_fired", {})
@behavior(name="on_completed", on=["behavior.completed"])  # does it fire on a lifecycle event?
def on_completed(event, graph, ctx):
    graph.emit("completed_fired", {})
register = None
g = Graph(); rt = Runtime(g, budget={"max_events": 200}); rt.run_goal("probe")
types = [e.type for e in rt.graph.events]
print("custom_fired (behavior reacts to CUSTOM event):", "custom_fired" in types)
print("completed_fired (behavior reacts to LIFECYCLE event):", "completed_fired" in types)
print("counts:", dict(Counter(types)))
