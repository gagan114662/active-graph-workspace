from activegraph import behavior, relation_behavior


def register_daemon():                      # EXACTLY this signature — NO arguments
    def _execute_if_eligible(graph, task_id):
        """Shared helper: re-read the task + its user via get_object, then execute
        the task only if it is eligible.

        Eligibility:
          - task status is "queued" OR "open"  (never "blocked", never anything else)
          - the task's user is paid_verified == True  (never a free-tier user)

        Execution (in this required order so dependents unblock):
          graph.emit("tool.executed", {"task_id": id})
          graph.emit("task.completed", {"task_id": id})   # REQUIRED for unblock
          graph.patch_object(id, {"status": "completed"})

        Returns True if the task was executed, False otherwise.
        """
        if not task_id:
            return False

        # Re-read the task object fresh (obj.data is the dict, obj may be None).
        task_obj = graph.get_object(task_id)
        if task_obj is None:
            return False

        status = task_obj.data.get("status")
        if status not in ("queued", "open"):
            # "blocked" or any other status is not eligible.
            return False

        user_id = task_obj.data.get("user_id")
        if not user_id:
            return False

        # Re-read the user object fresh; gate on paid_verified being truthy bool.
        user_obj = graph.get_object(user_id)
        if user_obj is None:
            return False
        if user_obj.data.get("paid_verified") is not True:
            return False

        # Eligible — execute. task.completed emit is REQUIRED so dependents unblock.
        graph.emit("tool.executed", {"task_id": task_id})
        graph.emit("task.completed", {"task_id": task_id})
        graph.patch_object(task_id, {"status": "completed"})
        return True

    @behavior(name="executor", on=["object.created"], where={"object.type": "task"})
    def executor(event, graph, ctx):
        task = event.payload["object"]      # a DICT: {"id": str, "type": "task", "data": {"status":..., "user_id":...}}
        status = task["data"]["status"]     # status lives under ["data"]; task["status"] does NOT exist
        task_id = task["id"]

        # Only attempt the freshly-created task when it arrives "queued".
        # _execute_if_eligible re-reads + re-checks (paid_verified, status) so we
        # stay consistent with the unblock path and never execute a free-tier or
        # blocked task.
        if status == "queued":
            _execute_if_eligible(graph, task_id)

    @relation_behavior(name="unblock", relation_type="depends_on", on=["task.completed"])
    def unblock(relation, event, graph, ctx):
        completed_id = event.payload["task_id"]   # the task that just completed
        # relation.source and relation.target are id STRINGS (source completes -> unblock target)

        # Only react when the task that completed is THIS relation's source
        # (source completes -> unblock target). Ignore unrelated completions.
        if completed_id != relation.source:
            return

        target_id = relation.target

        # Unblock the target: flip it to "open" so it becomes eligible.
        graph.patch_object(target_id, {"status": "open"})

        # Then execute the target via the shared helper, which re-reads the target
        # and its user and only executes when paid_verified is True and the status
        # is now "open"/"queued".
        _execute_if_eligible(graph, target_id)
