"""Open Polsia billing policy — protects token spend.

Security invariant: a user may QUEUE tasks freely, but a task must NEVER trigger
`llm.requested` or `tool.executed` unless the user has a cryptographically
VERIFIED payment.

The only field trusted for execution is `paid_verified`, which is set EXCLUSIVELY
by `verify_payment` after checking the webhook signature against the signing
secret. `stripe_status` is an UNTRUSTED, forgeable string and is NEVER consulted
when deciding to execute — that would be the security hole this policy closes.
"""

import hmac
import os

from activegraph import behavior


def register_policy():
    """Register the billing-protection behaviors on the Active Graph.

    Decorators are invoked here (not at import time) so registration is an
    explicit, side-effect-free-until-called operation.
    """

    @behavior(name="verify_payment", on=["payment.received"])
    def verify_payment(event, graph, ctx):
        """Mark a user paid_verified ONLY on a genuine, succeeded payment.

        Verification requires BOTH:
          1. The webhook signature equals the server-side signing secret
             (proves the event came from the payment provider, not a forger).
          2. status == "succeeded" (the payment actually went through).

        Any failure -> do nothing (user stays unverified).
        """
        payload = event.payload or {}

        secret = os.environ.get("POLSIA_WEBHOOK_SECRET")
        if secret is None:
            # No secret configured -> cannot trust anything. Fail closed.
            return

        signature = payload.get("signature")
        status = payload.get("status")
        user_id = payload.get("user_id")

        if signature is None or user_id is None:
            return

        # Constant-time compare to avoid timing side-channels on the secret.
        if not hmac.compare_digest(str(signature), str(secret)):
            return

        if status != "succeeded":
            return

        # Cryptographically verified, succeeded payment -> grant verification.
        graph.patch_object(user_id, {"paid_verified": True})

    @behavior(
        name="billing_gate",
        on=["object.created"],
        where={"object.type": "task"},
    )
    def billing_gate(event, graph, ctx):
        """Gate task execution on the user's VERIFIED payment state.

        Free / spoofed / payment-failed users may queue tasks, but execution
        (llm.requested + tool.executed) fires ONLY when the owning user has
        paid_verified == True. Trust nothing else — especially not the
        forgeable stripe_status.
        """
        payload = event.payload or {}
        task = payload.get("object")
        if not task:
            return

        task_data = task.get("data") or {}
        user_id = task_data.get("user_id")
        if user_id is None:
            # No owner -> cannot establish payment -> never execute.
            return

        user = graph.get_object(user_id)
        if user is None:
            return

        user_data = getattr(user, "data", None) or {}

        # The ONLY field that authorizes execution. stripe_status is ignored.
        if user_data.get("paid_verified") is not True:
            # Not verified -> leave the task queued, spend nothing.
            return

        task_id = task.get("id")
        graph.emit("llm.requested", {"task_id": task_id})
        graph.emit("tool.executed", {"task_id": task_id})
        graph.patch_object(task_id, {"status": "executed"})

    return {"verify_payment": verify_payment, "billing_gate": billing_gate}
