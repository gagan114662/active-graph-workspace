"""INDEPENDENT acceptance for the Polsia billing invariant. The acceptance OWNS the
scenario (creates a user with a given stripe_status + 3 tasks) and imports ONLY the
builder's register_gate(). It asserts the invariant from the event log:
  free-tier  -> 0 tool.executed (tasks queued, never run)
  active-tier-> tool.executed allowed (gate isn't just "block everyone")
A no-gate impl breaches the free-tier invariant and fails. Referee-authored.

Usage: python accept_billing.py <builder-gate-module.py>
"""
from __future__ import annotations
import importlib.util, os, sys
os.environ.pop("ANTHROPIC_API_KEY", None); os.environ.pop("OPENAI_API_KEY", None)
from activegraph import Graph, Runtime, behavior, clear_registry

spec = importlib.util.spec_from_file_location("builder_gate", sys.argv[1])
gate_mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(gate_mod)

def run(status):
    clear_registry()
    @behavior(name="acc_planner", on=["goal.created"])
    def planner(event, graph, ctx):
        user = graph.add_object("user", {"name": "acme", "stripe_status": status})
        for i in range(3):
            graph.add_object("task", {"title": f"t{i}", "status": "queued", "user_id": user.id})
    gate_mod.register_gate()  # the builder's billing behavior ONLY
    g = Graph(); rt = Runtime(g, budget={"max_events": 300}); rt.run_goal(f"run {status}")
    types = [e.type for e in rt.graph.events]
    tasks = [o for o in rt.graph.all_objects() if o.type == "task"]
    return tasks, types.count("tool.executed")

fails = []
tf, ef = run("free")
if len(tf) != 3: fails.append(f"free: created {len(tf)} tasks, expected 3")
if ef != 0: fails.append(f"BILLING BREACH: free tier executed {ef} tool(s) — must be 0")
ta, ea = run("active")
if len(ta) != 3: fails.append(f"active: created {len(ta)} tasks, expected 3")
if ea < 1: fails.append(f"active executed {ea} — gate blocks everyone, not a billing gate")
if fails:
    print("BILLING_ACCEPT_FAIL"); [print("  -", f) for f in fails]; sys.exit(1)
print(f"BILLING_ACCEPT_PASS: free queued 3/executed {ef}; active queued 3/executed {ea}"); sys.exit(0)
