"""INDEPENDENT acceptance for the parallel task-queue consumer. Owns the scenario
(queues 10 tasks for an active user), imports ONLY the builder's register_consumer().
invariant_strong: every queued task reaches a terminal state (completed/failed).
parallel_execution_safe: exactly-once (10 terminal events, no dupes) AND zero
patch.rejected (optimistic concurrency, no race/lock failures). Referee-authored.

Usage: python accept_queue.py <builder-consumer-module.py>
"""
from __future__ import annotations
import importlib.util, os, sys
os.environ.pop("ANTHROPIC_API_KEY", None); os.environ.pop("OPENAI_API_KEY", None)
from activegraph import Graph, Runtime, behavior, clear_registry

spec = importlib.util.spec_from_file_location("builder_consumer", sys.argv[1])
builder = importlib.util.module_from_spec(spec); spec.loader.exec_module(builder)

clear_registry()
@behavior(name="acc_planner", on=["goal.created"])
def planner(event, graph, ctx):
    for i in range(10):
        graph.add_object("task", {"title": f"t{i}", "status": "queued"})
builder.register_consumer()
g = Graph(); rt = Runtime(g, budget={"max_events": 800}); rt.run_goal("drain the queue")
types = [e.type for e in rt.graph.events]
tasks = [o for o in rt.graph.all_objects() if o.type == "task"]

fails = []
if len(tasks) != 10: fails.append(f"created {len(tasks)} tasks != 10")
queued = [o for o in tasks if o.data.get("status") == "queued"]
if queued: fails.append(f"invariant_strong BREACH: {len(queued)} tasks never reached terminal (still queued)")
terminal_events = types.count("task.completed") + types.count("task.failed")
if terminal_events != 10:
    fails.append(f"parallel_execution_safe BREACH: {terminal_events} terminal events != 10 (double-process or miss)")
if types.count("patch.rejected") > 0:
    fails.append(f"concurrency BREACH: {types.count('patch.rejected')} patch.rejected (race/lock failure)")
if fails:
    print("QUEUE_ACCEPT_FAIL"); [print("  -", f) for f in fails]; sys.exit(1)
print(f"QUEUE_ACCEPT_PASS: 10 tasks drained to terminal, {terminal_events} terminal events (exactly-once), 0 patch.rejected"); sys.exit(0)
