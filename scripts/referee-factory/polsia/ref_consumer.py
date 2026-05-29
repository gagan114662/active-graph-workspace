"""Correct queue consumer (positive control)."""
from activegraph import behavior
def register_consumer():
    @behavior(name="consumer", on=["object.created"], where={"object.type": "task"})
    def consumer(event, graph, ctx):
        task = event.payload["object"]
        if task["data"].get("status") == "queued":
            graph.emit("task.completed", {"task_id": task["id"]})
            graph.patch_object(task["id"], {"status": "completed"})
