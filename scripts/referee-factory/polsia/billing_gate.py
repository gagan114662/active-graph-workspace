"""Open Polsia billing gate.

Revenue-protecting Active Graph behavior: a task created by a free-tier user may
sit QUEUED forever, but the tool must never execute. Only when the owning user's
Stripe subscription is "active" does the gate emit `tool.executed` and mark the
task executed. This is the billing invariant — free tier can queue but never runs.
"""

from activegraph import behavior


def register_gate():
    """Register the single billing-gate behavior.

    The decorator is applied here (not at import time) so registration happens
    only when the factory explicitly calls register_gate().
    """

    @behavior(
        name="billing_gate",
        on=["object.created"],
        where={"object.type": "task"},
    )
    def billing_gate(event, graph, ctx):
        # The created task dict: {"id": ..., "data": {..., "user_id": ...}}
        task = event.payload["object"]
        task_data = task.get("data") or {}
        user_id = task_data.get("user_id")

        # No owning user => cannot prove an active subscription => stay queued.
        if not user_id:
            return

        user = graph.get_object(user_id)
        if user is None:
            return

        user_data = getattr(user, "data", None) or {}

        # Billing invariant: execute IF AND ONLY IF the user is an active subscriber.
        if user_data.get("stripe_status") != "active":
            # Free / inactive tier: do nothing. Task stays queued, no execution.
            return

        # Active subscriber: release the task to run.
        graph.emit("tool.executed", {"task_id": task["id"]})
        graph.patch_object(task["id"], {"status": "executed"})

    return billing_gate
