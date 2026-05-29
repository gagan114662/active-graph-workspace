"""Reference parallel-queue consumer: 10 tasks queued, a consumer drains them all.
Run to observe the real event-log behavior (concurrency, completion)."""
import os
os.environ.pop("ANTHROPIC_API_KEY", None); os.environ.pop("OPENAI_API_KEY", None)
from activegraph import Graph, Runtime, behavior, clear_registry
from collections import Counter

def register():
    clear_registry()
    @behavior(name="planner", on=["goal.created"])
    def planner(event, graph, ctx):
        for i in range(10):
            graph.add_object("task", {"title": f"t{i}", "status": "queued"})
    @behavior(name="consumer", on=["object.created"], where={"object.type": "task"})
    def consumer(event, graph, ctx):
        task = event.payload["object"]
        if task["data"].get("status") == "queued":
            graph.emit("task.completed", {"task_id": task["id"]})
            graph.patch_object(task["id"], {"status": "completed"})

register()
g = Graph(); rt = Runtime(g, budget={"max_events": 600}); rt.run_goal("drain queue")
types = [e.type for e in rt.graph.events]
tasks = [o for o in rt.graph.all_objects() if o.type == "task"]
print("event_type_counts:", dict(Counter(types)))
print("task_status_counts:", dict(Counter(o.data.get("status") for o in tasks)))
print("n_tasks:", len(tasks), "task.completed events:", types.count("task.completed"), "patch.rejected:", types.count("patch.rejected"))
