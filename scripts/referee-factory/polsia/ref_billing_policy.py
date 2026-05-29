"""EXTRA-HARD billing invariant on Active Graph.

Invariant: NO execution events (llm.requested / tool.executed) may exist for a user
unless that user's payment is VERIFIED. Verification requires a payment.received
event carrying a valid signature AND status=succeeded — NOT a settable
stripe_status field (which a spoofer can forge). Free / spoofed-webhook /
payment-failed users may QUEUE tasks but never execute; only genuinely-paid users
execute. Active Graph's Policy is v0/permissive, so enforcement is in behavior logic.

Run: ANTHROPIC_API_KEY= OPENAI_API_KEY= .venv/bin/python ref_billing_policy.py
"""
from __future__ import annotations

import os

os.environ.pop("ANTHROPIC_API_KEY", None)
os.environ.pop("OPENAI_API_KEY", None)

from activegraph import Graph, Runtime, behavior, clear_registry  # noqa: E402

# The webhook signing secret. A spoofer does NOT have it.
WEBHOOK_SECRET = "whsec_polsia_demo_secret"

# scenario knobs (set before each run)
SCENARIO = {"stripe_status": "free", "payment": None}  # payment: None | dict(signature=, status=)


def register() -> None:
    clear_registry()

    @behavior(name="planner", on=["goal.created"])
    def planner(event, graph, ctx):
        user = graph.add_object("user", {"name": "acme", "stripe_status": SCENARIO["stripe_status"], "paid_verified": False})
        # a (possibly spoofed/failed) payment webhook arrives BEFORE work is queued
        pay = SCENARIO.get("payment")
        if pay is not None:
            graph.emit("payment.received", {"user_id": user.id, "signature": pay.get("signature"), "status": pay.get("status")})
        for i in range(3):
            graph.add_object("task", {"title": f"t{i}", "status": "queued", "user_id": user.id})

    @behavior(name="verify_payment", on=["payment.received"])
    def verify_payment(event, graph, ctx):
        p = event.payload
        # ONLY a valid signature + succeeded status grants verified-paid status.
        if p.get("signature") == WEBHOOK_SECRET and p.get("status") == "succeeded":
            graph.patch_object(p["user_id"], {"paid_verified": True, "stripe_status": "active"})
        # else: spoofed or failed -> nothing changes; user stays unverified.

    @behavior(name="billing_gate", on=["object.created"], where={"object.type": "task"})
    def billing_gate(event, graph, ctx):
        task = event.payload["object"]
        user = graph.get_object(task["data"]["user_id"])
        # TRUST ONLY paid_verified (set by verify_payment), NOT raw stripe_status.
        if not (user and user.data.get("paid_verified") is True):
            return  # free / spoofed / failed: stays queued, NO execution events
        graph.emit("llm.requested", {"task_id": task["id"]})
        graph.emit("tool.executed", {"task_id": task["id"]})
        graph.patch_object(task["id"], {"status": "executed"})


def run_scenario(stripe_status, payment):
    SCENARIO["stripe_status"] = stripe_status
    SCENARIO["payment"] = payment
    register()
    g = Graph()
    rt = Runtime(g, budget={"max_events": 400})
    rt.run_goal("process tasks")
    types = [e.type for e in rt.graph.events]
    return {
        "tasks": len([o for o in rt.graph.all_objects() if o.type == "task"]),
        "llm_requested": types.count("llm.requested"),
        "tool_executed": types.count("tool.executed"),
    }


if __name__ == "__main__":
    scenarios = {
        "free":           ("free",   None),
        "spoofed_webhook": ("free",  {"signature": "whsec_FAKE", "status": "succeeded"}),
        "payment_failed":  ("free",  {"signature": WEBHOOK_SECRET, "status": "failed"}),
        "genuinely_paid":  ("active", {"signature": WEBHOOK_SECRET, "status": "succeeded"}),
    }
    out = {name: run_scenario(*args) for name, args in scenarios.items()}
    breaches = []
    for name in ("free", "spoofed_webhook", "payment_failed"):
        r = out[name]
        if r["tasks"] != 3:
            breaches.append(f"{name}: {r['tasks']} tasks != 3")
        if r["llm_requested"] != 0 or r["tool_executed"] != 0:
            breaches.append(f"BILLING BREACH [{name}]: llm={r['llm_requested']} tool={r['tool_executed']} (must be 0)")
    paid = out["genuinely_paid"]
    if paid["llm_requested"] != 3 or paid["tool_executed"] != 3:
        breaches.append(f"genuinely_paid: llm={paid['llm_requested']} tool={paid['tool_executed']} (expected 3/3)")
    if breaches:
        print("BILLING_POLICY_BREACH")
        for b in breaches:
            print("  -", b)
        raise SystemExit(1)
    print("BILLING_POLICY_INVARIANT_HOLDS:", {k: (v["llm_requested"], v["tool_executed"]) for k, v in out.items()})
