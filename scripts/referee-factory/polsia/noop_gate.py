"""No-gate control: always executes, ignores billing (negative control). Must FAIL."""
from activegraph import behavior
def register_gate():
    @behavior(name="billing_gate", on=["object.created"], where={"object.type": "task"})
    def billing_gate(event, graph, ctx):
        task = event.payload["object"]
        graph.emit("tool.executed", {"task_id": task["id"]})  # NO billing check!
        graph.patch_object(task["id"], {"status": "executed"})
