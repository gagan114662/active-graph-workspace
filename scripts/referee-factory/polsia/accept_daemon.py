"""INDEPENDENT acceptance for the always-on daemon orchestration. Owns the scenario
(paid user: research, memo[depends_on research], standalone; free user: free-task),
imports ONLY the builder's register_daemon(). Asserts: paid+unblocked tasks execute
in dependency order; free-tier tasks never execute. Referee-authored.

Usage: python accept_daemon.py <builder-daemon-module.py>
"""
from __future__ import annotations
import importlib.util, os, sys
os.environ.pop("ANTHROPIC_API_KEY", None); os.environ.pop("OPENAI_API_KEY", None)
from activegraph import Graph, Runtime, behavior, clear_registry

spec = importlib.util.spec_from_file_location("builder_daemon", sys.argv[1])
builder = importlib.util.module_from_spec(spec); spec.loader.exec_module(builder)

clear_registry()
@behavior(name="acc_planner", on=["goal.created"])
def planner(event, graph, ctx):
    paid = graph.add_object("user", {"paid_verified": True})
    free = graph.add_object("user", {"paid_verified": False})
    research = graph.add_object("task", {"title": "research", "status": "queued", "user_id": paid.id})
    memo = graph.add_object("task", {"title": "memo", "status": "blocked", "user_id": paid.id})
    graph.add_relation(research.id, memo.id, "depends_on")
    graph.add_object("task", {"title": "standalone", "status": "queued", "user_id": paid.id})
    graph.add_object("task", {"title": "free-task", "status": "queued", "user_id": free.id})
builder.register_daemon()
g = Graph(); rt = Runtime(g, budget={"max_events": 700}); rt.run_goal("run daemon")
events = list(rt.graph.events); types = [e.type for e in events]
objs = {o.data.get("title"): o for o in rt.graph.all_objects() if o.type == "task"}
def st(t): return objs[t].data.get("status")
def ex_pos(t):
    tid = objs[t].id
    for i, e in enumerate(events):
        if e.type == "tool.executed" and e.payload.get("task_id") == tid: return i
    return None
fails = []
for t in ("research", "memo", "standalone"):
    if st(t) != "completed": fails.append(f"paid task {t} not completed (status={st(t)})")
if st("free-task") == "completed" or ex_pos("free-task") is not None:
    fails.append("BILLING BREACH: free-tier task executed")
te = types.count("tool.executed")
if te != 3: fails.append(f"expected 3 executions (paid only), got {te}")
r, m = ex_pos("research"), ex_pos("memo")
if r is None or m is None or m <= r:
    fails.append(f"DEPENDENCY BREACH: memo({m}) did not execute strictly after research({r})")
if fails:
    print("DAEMON_ACCEPT_FAIL"); [print("  -", f) for f in fails]; sys.exit(1)
print(f"DAEMON_ACCEPT_PASS: paid tasks executed in dep order (research@{r}<memo@{m}); free-tier executed 0"); sys.exit(0)
