"""Correct daemon (positive control): paid + unblocked executes, in dep order."""
from activegraph import behavior, relation_behavior
def _try(graph, tid):
    t = graph.get_object(tid)
    if not t or t.data.get("status") not in ("queued", "open"): return
    u = graph.get_object(t.data["user_id"])
    if not (u and u.data.get("paid_verified") is True): return
    graph.emit("tool.executed", {"task_id": tid}); graph.emit("task.completed", {"task_id": tid})
    graph.patch_object(tid, {"status": "completed"})
def register_daemon():
    @behavior(name="executor", on=["object.created"], where={"object.type": "task"})
    def executor(event, graph, ctx):
        task = event.payload["object"]
        if task["data"].get("status") == "queued": _try(graph, task["id"])
    @relation_behavior(name="unblock", relation_type="depends_on", on=["task.completed"])
    def unblock(relation, event, graph, ctx):
        if event.payload.get("task_id") == relation.source:
            graph.patch_object(relation.target, {"status": "open"}); _try(graph, relation.target)
