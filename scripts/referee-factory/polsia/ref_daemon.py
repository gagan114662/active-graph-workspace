"""Reference always-on daemon orchestration: a task executes ONLY if (a) its user is
paid_verified AND (b) it is unblocked (its dependency completed). Dependency ordering
via an unblock relation behavior. Free-tier tasks never execute. Run to observe."""
import os
os.environ.pop("ANTHROPIC_API_KEY", None); os.environ.pop("OPENAI_API_KEY", None)
from activegraph import Graph, Runtime, behavior, relation_behavior, clear_registry

def try_execute(graph, task_id):
    t = graph.get_object(task_id)
    if not t or t.data.get("status") not in ("queued", "open"):
        return
    u = graph.get_object(t.data["user_id"])
    if not (u and u.data.get("paid_verified") is True):
        return
    graph.emit("tool.executed", {"task_id": task_id})
    graph.emit("task.completed", {"task_id": task_id})  # signal for unblock relation behavior
    graph.patch_object(task_id, {"status": "completed"})

def register():
    clear_registry()
    @behavior(name="planner", on=["goal.created"])
    def planner(event, graph, ctx):
        paid = graph.add_object("user", {"paid_verified": True})
        free = graph.add_object("user", {"paid_verified": False})
        research = graph.add_object("task", {"title": "research", "status": "queued", "user_id": paid.id})
        memo = graph.add_object("task", {"title": "memo", "status": "blocked", "user_id": paid.id})
        graph.add_relation(research.id, memo.id, "depends_on")   # research done -> unblock memo
        graph.add_object("task", {"title": "standalone", "status": "queued", "user_id": paid.id})
        graph.add_object("task", {"title": "free-task", "status": "queued", "user_id": free.id})
    @behavior(name="executor", on=["object.created"], where={"object.type": "task"})
    def executor(event, graph, ctx):
        task = event.payload["object"]
        if task["data"].get("status") == "queued":
            try_execute(graph, task["id"])
    @relation_behavior(name="unblock", relation_type="depends_on", on=["task.completed"])
    def unblock(relation, event, graph, ctx):
        if event.payload.get("task_id") == relation.source:
            graph.patch_object(relation.target, {"status": "open"})
            try_execute(graph, relation.target)

register()
g = Graph(); rt = Runtime(g, budget={"max_events": 600}); rt.run_goal("run daemon")
events = list(rt.graph.events); types = [e.type for e in events]
objs = {o.data.get("title"): o for o in rt.graph.all_objects() if o.type == "task"}
def st(t): return objs[t].data.get("status")
def ex_pos(title):
    tid = objs[title].id
    for i, e in enumerate(events):
        if e.type == "tool.executed" and e.payload.get("task_id") == tid: return i
    return None
assert st("research") == "completed", f"research={st('research')}"
assert st("memo") == "completed", f"memo={st('memo')}"
assert st("standalone") == "completed", f"standalone={st('standalone')}"
assert st("free-task") != "completed", f"BILLING BREACH: free-task={st('free-task')}"
assert types.count("tool.executed") == 3, f"expected 3 executions, got {types.count('tool.executed')}"
r, m = ex_pos("research"), ex_pos("memo")
assert r is not None and m is not None and m > r, f"DEP BREACH: memo({m}) not after research({r})"
print(f"DAEMON_INVARIANT_HOLDS: 3 paid tasks executed in dep order (research@{r}<memo@{m}); free-tier executed 0")
