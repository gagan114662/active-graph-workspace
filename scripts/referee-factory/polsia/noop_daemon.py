"""No-gate daemon (negative control): executes EVERY task immediately, ignoring
billing and dependencies. Breaches billing (free task runs) AND dep order. Must FAIL."""
from activegraph import behavior
def register_daemon():
    @behavior(name="executor", on=["object.created"], where={"object.type": "task"})
    def executor(event, graph, ctx):
        task = event.payload["object"]
        graph.emit("tool.executed", {"task_id": task["id"]}); graph.emit("task.completed", {"task_id": task["id"]})
        graph.patch_object(task["id"], {"status": "completed"})
