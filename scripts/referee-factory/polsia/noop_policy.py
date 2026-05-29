"""Naive policy (negative control): trusts the SETTABLE stripe_status. Must FAIL on
spoofed_status (active without a real payment)."""
from activegraph import behavior
def register_policy():
    @behavior(name="billing_gate", on=["object.created"], where={"object.type": "task"})
    def billing_gate(event, graph, ctx):
        task = event.payload["object"]; user = graph.get_object(task["data"]["user_id"])
        if not (user and user.data.get("stripe_status") == "active"): return  # NAIVE: forgeable
        graph.emit("llm.requested", {"task_id": task["id"]})
        graph.emit("tool.executed", {"task_id": task["id"]})
        graph.patch_object(task["id"], {"status": "executed"})
