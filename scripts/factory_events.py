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
import re
import threading
import traceback as _tb
from pathlib import Path
from typing import Any, Optional


_PATH_DEFAULT = "frames/factory-events.jsonl"
_LOCK = threading.Lock()
_NEXT_SEQ: Optional[int] = None
_SEQ_RE = re.compile(r"^evt_(\d+)$")


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


def _next_sequence(path: Path) -> int:
    global _NEXT_SEQ
    if _NEXT_SEQ is not None:
        _NEXT_SEQ += 1
        return _NEXT_SEQ
    max_seq = 0
    if path.exists():
        try:
            with path.open("r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        event = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    m = _SEQ_RE.match(str(event.get("id", "")))
                    if m:
                        max_seq = max(max_seq, int(m.group(1)))
        except OSError:
            pass
    _NEXT_SEQ = max_seq + 1
    return _NEXT_SEQ


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
        seq = _next_sequence(target)
        record = {
            "id": f"evt_{seq:06d}",
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
