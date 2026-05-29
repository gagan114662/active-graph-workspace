"""INDEPENDENT acceptance for the EXTRA-HARD Polsia billing policy. Owns the
scenario (user + webhook + tasks); imports ONLY the builder's register_policy().
Asserts: no llm.requested/tool.executed unless payment is VERIFIED (valid signature
+ succeeded). Adversaries: spoofed_status (active w/o payment), spoofed_webhook
(bad signature). Holdout: payment_failed. Referee-authored.

Usage: python accept_billing_policy.py <builder-policy-module.py>
"""
from __future__ import annotations
import importlib.util, os, sys
SECRET = "whsec_polsia_demo_secret"
os.environ["POLSIA_WEBHOOK_SECRET"] = SECRET
os.environ.pop("ANTHROPIC_API_KEY", None); os.environ.pop("OPENAI_API_KEY", None)
from activegraph import Graph, Runtime, behavior, clear_registry

spec = importlib.util.spec_from_file_location("builder_policy", sys.argv[1])
builder = importlib.util.module_from_spec(spec); spec.loader.exec_module(builder)
CFG = {"status": "free", "payment": None}

def run(status, payment):
    CFG["status"] = status; CFG["payment"] = payment
    clear_registry()
    @behavior(name="acc_planner", on=["goal.created"])
    def planner(event, graph, ctx):
        u = graph.add_object("user", {"name": "acme", "stripe_status": CFG["status"], "paid_verified": False})
        if CFG["payment"] is not None:
            graph.emit("payment.received", {"user_id": u.id, "signature": CFG["payment"]["signature"], "status": CFG["payment"]["status"]})
        for i in range(3):
            graph.add_object("task", {"title": f"t{i}", "status": "queued", "user_id": u.id})
    builder.register_policy()
    g = Graph(); rt = Runtime(g, budget={"max_events": 400}); rt.run_goal("process")
    types = [e.type for e in rt.graph.events]
    return {"tasks": len([o for o in rt.graph.all_objects() if o.type == "task"]),
            "llm": types.count("llm.requested"), "tool": types.count("tool.executed")}

scenarios = {
    "free": ("free", None),
    "spoofed_status": ("active", None),
    "spoofed_webhook": ("free", {"signature": "whsec_FAKE", "status": "succeeded"}),
    "payment_failed": ("free", {"signature": SECRET, "status": "failed"}),
    "genuinely_paid": ("active", {"signature": SECRET, "status": "succeeded"}),
}
out = {n: run(*a) for n, a in scenarios.items()}
fails = []
for n in ("free", "spoofed_status", "spoofed_webhook", "payment_failed"):
    r = out[n]
    if r["tasks"] != 3: fails.append(f"{n}: tasks {r['tasks']}!=3")
    if r["llm"] != 0 or r["tool"] != 0: fails.append(f"BILLING BREACH [{n}]: llm={r['llm']} tool={r['tool']} (must be 0)")
p = out["genuinely_paid"]
if p["llm"] < 1 or p["tool"] < 1: fails.append(f"genuinely_paid BLOCKED (llm={p['llm']} tool={p['tool']}) — gate blocks paying customers")
if fails:
    print("BILLING_POLICY_ACCEPT_FAIL"); [print("  -", f) for f in fails]; sys.exit(1)
print("BILLING_POLICY_ACCEPT_PASS:", {k: (v["llm"], v["tool"]) for k, v in out.items()}); sys.exit(0)
