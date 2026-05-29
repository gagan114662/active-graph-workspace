"""INDEPENDENT acceptance for the self-healing TRIAGE detector. The triage module
exposes should_remediate(events) -> bool (detect behavior.failed in the log, since
behaviors can't subscribe to it). The oracle drives a broken run + a fixed run and
asserts: detector fires on the broken log, does NOT fire on the healed log, and the
heal actually drives behavior.failed 1 -> 0. A no-op detector (never fires) fails.

Usage: python accept_selfheal.py <triage-module.py>
"""
from __future__ import annotations
import importlib.util, os, sys
os.environ.pop("ANTHROPIC_API_KEY", None); os.environ.pop("OPENAI_API_KEY", None)
from activegraph import Graph, Runtime, behavior, clear_registry
spec = importlib.util.spec_from_file_location("triage", sys.argv[1])
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
should_remediate = mod.should_remediate

def run(broken):
    clear_registry()
    @behavior(name="planner", on=["goal.created"])
    def planner(event, graph, ctx): graph.add_object("task", {"title": "t", "status": "queued"})
    @behavior(name="worker", on=["object.created"], where={"object.type": "task"})
    def worker(event, graph, ctx):
        if broken: raise RuntimeError("api drift")
        graph.emit("tool.executed", {"task_id": event.payload["object"]["id"]})
    g = Graph(); rt = Runtime(g, budget={"max_events": 200}); rt.run_goal("work")
    return list(rt.graph.events)

broken = run(True); fixed = run(False)
bf = sum(1 for e in broken if e.type == "behavior.failed")
hf = sum(1 for e in fixed if e.type == "behavior.failed")
fails = []
if bf < 1: fails.append("test setup: broken run did not fail")
if not should_remediate(broken): fails.append("SELF-HEAL BREACH: detector did NOT fire on a failed run (failures go unnoticed)")
if should_remediate(fixed): fails.append("detector fires on a healthy run (false alarm — would loop forever)")
if hf != 0: fails.append(f"healed run still has {hf} behavior.failed")
if fails:
    print("SELFHEAL_ACCEPT_FAIL"); [print("  -", f) for f in fails]; sys.exit(1)
print(f"SELFHEAL_ACCEPT_PASS: detector fired on broken({bf} failed), silent on healed({hf} failed) -> self-heal triggers exactly when needed"); sys.exit(0)
