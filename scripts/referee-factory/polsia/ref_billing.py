"""Reference: Polsia billing invariant on Active Graph.

Invariant: NO `tool.executed` event may exist for a user whose stripe_status is not
"active". Free-tier users can QUEUE tasks but the tool never executes. Active users
execute. Proven by forking two scenarios and reading the event log.

Run: ANTHROPIC_API_KEY= OPENAI_API_KEY= .venv/bin/python ref_billing.py
"""
from __future__ import annotations

import os

os.environ.pop("ANTHROPIC_API_KEY", None)
os.environ.pop("OPENAI_API_KEY", None)

from activegraph import Graph, Runtime, behavior, clear_registry  # noqa: E402

# scenario knob (set before each run_goal; behaviors read it at fire time)
SCENARIO_STATUS = "free"


def register(gate_enabled: bool = True) -> None:
    clear_registry()

    @behavior(name="planner", on=["goal.created"])
    def planner(event, graph, ctx):
        user = graph.add_object("user", {"name": "acme", "stripe_status": SCENARIO_STATUS})
        for i in range(3):
            graph.add_object("task", {"title": f"task {i}", "status": "queued", "user_id": user.id})

    @behavior(name="billing_gate", on=["object.created"], where={"object.type": "task"})
    def billing_gate(event, graph, ctx):
        task = event.payload["object"]
        user = graph.get_object(task["data"]["user_id"])
        active = bool(user) and user.data.get("stripe_status") == "active"
        # The gate: execute the tool ONLY for active subscribers.
        if gate_enabled and not active:
            return  # free tier: task stays queued, NO tool.executed
        graph.emit("tool.executed", {"task_id": task["id"], "by": "billing_gate"})
        graph.patch_object(task["id"], {"status": "executed"})


def run_scenario(status: str, gate_enabled: bool = True):
    global SCENARIO_STATUS
    SCENARIO_STATUS = status
    register(gate_enabled=gate_enabled)
    g = Graph()
    rt = Runtime(g, budget={"max_events": 300})
    rt.run_goal(f"process tasks for {status} user")
    types = [e.type for e in rt.graph.events]
    tasks = [o for o in rt.graph.all_objects() if o.type == "task"]
    executed = types.count("tool.executed")
    return tasks, executed


if __name__ == "__main__":
    tasks_free, exec_free = run_scenario("free", gate_enabled=True)
    assert len(tasks_free) == 3, f"free: expected 3 tasks queued, got {len(tasks_free)}"
    assert exec_free == 0, f"BILLING BREACH: free tier executed {exec_free} tools (must be 0)"

    tasks_active, exec_active = run_scenario("active", gate_enabled=True)
    assert len(tasks_active) == 3, f"active: expected 3 tasks, got {len(tasks_active)}"
    assert exec_active == 3, f"active: expected 3 tool.executed, got {exec_active}"

    print(f"BILLING_INVARIANT_HOLDS: free-tier queued 3 / executed {exec_free}; "
          f"active-tier queued 3 / executed {exec_active}")
