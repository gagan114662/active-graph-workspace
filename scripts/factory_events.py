"""Python emitter for the factory event log.

Mirror of scripts/factory-events.mjs. Both writers append to the same
JSONL file (frames/factory-events.jsonl by default) using activegraph's
Event-row shape. Either ecosystem (Node bridge/runner/sasha-skeptic OR
Python activegraph runtime + providers + demos) emits to ONE log so the
operator has a single queryable place to find every error or success.

The JSON line schema mirrors activegraph.runtime.event:

    {
      "id": "evt_<seq>",
      "created_at": "<iso8601>",
      "type": "behavior.failed" | "behavior.completed" | "llm.requested" |
              "llm.responded" | "infrastructure.*" | "script.crash" |
              "verifier.check_failed" | ...,
      "payload": { ...reason, behavior, message, extras }
    }

Append-only, file-locked best-effort, one JSON object per line.
"""

from __future__ import annotations

import datetime as _dt
import json
import os
import threading
import time
import traceback as _tb
from pathlib import Path
from typing import Any, Optional


_PATH_DEFAULT = "frames/factory-events.jsonl"
_LOCK = threading.Lock()
# Collision-resistant event IDs matching scripts/factory-events.mjs nextId():
#   evt_<unix_ms padded 15>_<pid padded 6>_<proc-seq padded 4>
# The previous evt_<seq:06d> scheme rescanned the JSONL for the max sequence
# and collided across concurrent writers (bridge_dispatch.py +
# claude_code_cli.py + this module). Honker's INSERT OR IGNORE then SILENTLY
# DROPPED the colliding row, so a failure could be emitted yet never logged —
# a direct violation of "all failures logged as events". Lexicographically
# sortable, so the Honker watcher's `WHERE id > last_id ORDER BY id ASC` stays
# correct, and any legacy evt_000xxx id sorts before every new id.
_PID_PADDED = str(os.getpid()).rjust(6, "0")
_PROC_SEQ = 0


def _resolve_path(path: Optional[str] = None) -> Path:
    if path:
        return Path(path).expanduser().resolve()
    env_path = os.environ.get("FACTORY_EVENTS_PATH")
    if env_path:
        return Path(env_path).expanduser().resolve()
    # Walk up to find frames/ in current dir or parent dirs.
    cwd = Path.cwd().resolve()
    for parent in [cwd, *cwd.parents]:
        candidate = parent / _PATH_DEFAULT
        if (parent / "frames").is_dir():
            return candidate
    # Fallback to cwd-relative.
    return (cwd / _PATH_DEFAULT).resolve()


def _next_event_id() -> str:
    """Return a collision-resistant event id. Caller must hold ``_LOCK``.

    Mirrors ``nextId()`` in scripts/factory-events.mjs so Node and Python
    writers share one monotonic, collision-resistant id space.
    """
    global _PROC_SEQ
    _PROC_SEQ += 1
    ts = str(time.time_ns() // 1_000_000).rjust(15, "0")
    return f"evt_{ts}_{_PID_PADDED}_{_PROC_SEQ:04d}"


def _iso_now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).isoformat().replace("+00:00", "Z")


def emit_factory_event(
    *,
    type: str,
    behavior: Optional[str] = None,
    reason: Optional[str] = None,
    message: Optional[str] = None,
    extras: Optional[dict[str, Any]] = None,
    path: Optional[str] = None,
) -> dict[str, Any]:
    """Append one factory event. Returns the written record."""
    if not type:
        raise ValueError("emit_factory_event: `type` is required")
    target = _resolve_path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    payload: dict[str, Any] = {}
    if reason is not None:
        payload["reason"] = reason
    if behavior is not None:
        payload["behavior"] = behavior
    if message is not None:
        payload["message"] = message
    if extras:
        payload.update(extras)
    with _LOCK:
        record = {
            "id": _next_event_id(),
            "created_at": _iso_now(),
            "type": type,
            "payload": payload,
        }
        with target.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, default=str) + "\n")
    return record


def emit_behavior_failed(
    *,
    behavior: str,
    reason: str,
    message: Optional[str] = None,
    extras: Optional[dict[str, Any]] = None,
    path: Optional[str] = None,
) -> dict[str, Any]:
    return emit_factory_event(
        type="behavior.failed",
        behavior=behavior,
        reason=reason,
        message=message,
        extras=extras,
        path=path,
    )


def emit_behavior_completed(
    *,
    behavior: str,
    message: Optional[str] = None,
    extras: Optional[dict[str, Any]] = None,
    path: Optional[str] = None,
) -> dict[str, Any]:
    return emit_factory_event(
        type="behavior.completed",
        behavior=behavior,
        message=message,
        extras=extras,
        path=path,
    )


def emit_infrastructure(
    *,
    subtype: str,
    message: Optional[str] = None,
    extras: Optional[dict[str, Any]] = None,
    path: Optional[str] = None,
) -> dict[str, Any]:
    return emit_factory_event(
        type=f"infrastructure.{subtype}",
        reason=f"infrastructure.{subtype}",
        message=message,
        extras=extras,
        path=path,
    )


def emit_script_crash(
    *,
    script: str,
    exc: BaseException,
    extras: Optional[dict[str, Any]] = None,
    path: Optional[str] = None,
) -> dict[str, Any]:
    """Convenience helper for top-level uncaught exception handlers."""
    return emit_factory_event(
        type="script.crash",
        behavior=script,
        reason=f"script.{type(exc).__name__}",
        message=str(exc),
        extras={
            "exception_type": type(exc).__name__,
            "traceback": "".join(_tb.format_exception(exc))[-4000:],
            **(extras or {}),
        },
        path=path,
    )


__all__ = [
    "emit_factory_event",
    "emit_behavior_failed",
    "emit_behavior_completed",
    "emit_infrastructure",
    "emit_script_crash",
]
