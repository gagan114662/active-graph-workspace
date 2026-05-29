"""Correct billing gate (positive control)."""
from activegraph import behavior
def register_gate():
    @behavior(name="billing_gate", on=["object.created"], where={"object.type": "task"})
    def billing_gate(event, graph, ctx):
        task = event.payload["object"]
        user = graph.get_object(task["data"]["user_id"])
        if not (user and user.data.get("stripe_status") == "active"):
            return  # free tier: stays queued, no tool.executed
        graph.emit("tool.executed", {"task_id": task["id"]})
        graph.patch_object(task["id"], {"status": "executed"})
