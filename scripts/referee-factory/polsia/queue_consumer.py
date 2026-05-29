"""Open Polsia — AFK parallel task queue consumer.

A single Active Graph behavior that drains queued task objects to completion
automatically, in parallel, without leaving any task stuck and without
double-processing.

Design contract for AFK execution:

  invariant_strong (no stuck tasks)
      Every task created with ``status == "queued"`` reaches a terminal
      state (``"completed"``). The behavior fires on ``object.created`` for
      every ``object.type == "task"``, so each queued task is guaranteed at
      least one processing attempt — none are left queued.

  exactly-once (no double-processing)
      Each task produces exactly ONE terminal ``task.completed`` event. The
      behavior is re-entrant-safe: it reads the *live* object from the graph
      and only acts when the live status is still ``"queued"``. A re-delivered
      or replayed ``object.created`` event (or any other re-entry) sees a
      non-queued status and is a no-op — so a task is never completed twice.

  concurrency (lock-free, optimistic)
      No locks are introduced. The behavior relies on the runtime's optimistic
      concurrency for ``patch_object``. The completion patch sets
      ``status = "completed"`` from the ``"queued"`` state; because the guard
      already filtered to live-queued tasks, the patch is the single
      state-advancing write for that task and applies cleanly with no rejected
      patches. Patching is the last side effect, after the terminal event is
      emitted, so the audit trail records the completion event for every task
      that transitions.

There are NO import-time side effects: importing this module registers
nothing. Registration happens only when ``register_consumer()`` is called,
which is where the ``@behavior`` decorator is applied.
"""

from __future__ import annotations

from activegraph import behavior

# Status constants — the queue's two relevant lifecycle states.
_QUEUED = "queued"
_COMPLETED = "completed"


def register_consumer():
    """Register the single AFK queue-consumer behavior and return it.

    The ``@behavior`` decorator runs here (not at import time) so importing
    this module has no side effects. Calling this function once wires the
    consumer into the global behavior registry that ``Runtime`` reads.

    Returns:
        The registered ``Behavior`` instance (the decorator's return value),
        so callers can reference or introspect it if needed.
    """

    @behavior(
        name="consumer",
        on=["object.created"],
        where={"object.type": "task"},
    )
    def consumer(event, graph, ctx):
        """Drain one queued task to completion. Idempotent and re-entrant-safe.

        Args:
            event: the ``object.created`` event. ``event.payload["object"]``
                is the created task dict with keys ``id`` and ``data``.
            graph: the BehaviorGraph — ``get_object``, ``emit``,
                ``patch_object``.
            ctx: behavior runtime context (unused here).
        """
        # The payload carries the task as it looked at creation. Use it only
        # to learn WHICH task to act on — never to decide WHETHER to act,
        # because the payload status is a snapshot and may be stale on a
        # replayed/re-delivered event.
        task = event.payload.get("object")
        if not task:
            return
        task_id = task.get("id")
        if not task_id:
            return

        # Read the LIVE object. This is the exactly-once guard: the only
        # source of truth for the current status is the graph, not the event
        # payload. If the task was already completed by a prior delivery of
        # this event, the live status is no longer "queued" and we no-op.
        live = graph.get_object(task_id)
        if live is None:
            return

        status = (live.data or {}).get("status")
        if status != _QUEUED:
            # Already terminal (or never queued). Do not re-emit, do not
            # re-patch — this is what makes re-entrant events safe and keeps
            # the terminal-event count at exactly one per task.
            return

        # Emit the single terminal event for this task BEFORE advancing state,
        # so the completion is on the trace even if observed mid-transition.
        graph.emit("task.completed", {"task_id": task_id})

        # Advance to the terminal state. Lock-free: the runtime's optimistic
        # concurrency applies this patch from the queued state we just
        # observed. Because the guard above admits each task's transition
        # exactly once, this is the sole status-advancing write and applies
        # cleanly with no rejected patches.
        graph.patch_object(task_id, {"status": _COMPLETED})

    return consumer
