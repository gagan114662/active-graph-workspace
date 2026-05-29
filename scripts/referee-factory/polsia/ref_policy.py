"""Correct billing policy (positive control): trusts only verified payment."""
import os
from activegraph import behavior
def register_policy():
    @behavior(name="verify_payment", on=["payment.received"])
    def verify_payment(event, graph, ctx):
        p = event.payload
        if p.get("signature") == os.environ.get("POLSIA_WEBHOOK_SECRET") and p.get("status") == "succeeded":
            graph.patch_object(p["user_id"], {"paid_verified": True})
    @behavior(name="billing_gate", on=["object.created"], where={"object.type": "task"})
    def billing_gate(event, graph, ctx):
        task = event.payload["object"]; user = graph.get_object(task["data"]["user_id"])
        if not (user and user.data.get("paid_verified") is True): return
        graph.emit("llm.requested", {"task_id": task["id"]})
        graph.emit("tool.executed", {"task_id": task["id"]})
        graph.patch_object(task["id"], {"status": "executed"})
