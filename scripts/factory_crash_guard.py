"""Python mirror of factory-crash-guard.mjs (pt.18).

Guarantees that a Python entry point's uncaught exception becomes a `script.crash`
factory event, and that its lifecycle (started/shutdown) is recorded — the same
"every failure is an event" invariant the Node scripts already satisfy.

Usage (at the top of an entry point's __main__):
    from factory_crash_guard import install_crash_guard
    install_crash_guard("bridge_dispatch")

Import-safe: never raises at import or install time. Built on
factory_events.emit_script_crash / emit_factory_event.
"""
from __future__ import annotations

import atexit
import os
import sys
import time
from typing import Optional

try:
    import factory_events
except Exception:  # noqa: BLE001 - dispatcher must work even if the emitter is broken
    factory_events = None  # type: ignore[assignment]

_installed = False


def _safe_emit(**kwargs) -> None:
    if factory_events is None:
        return
    try:
        factory_events.emit_factory_event(**kwargs)
    except Exception as exc:  # noqa: BLE001 - never let the guard crash the process
        sys.stderr.write(f"[crash-guard] emit failed: {exc}\n")


def install_crash_guard(script_label: str) -> None:
    """Register top-level handlers so uncaught exceptions emit script.crash."""
    global _installed
    if _installed:
        return
    _installed = True
    started = time.time()

    _safe_emit(
        type="script.started",
        behavior=script_label,
        extras={"pid": os.getpid(), "argv": sys.argv, "python": sys.version.split()[0], "cwd": os.getcwd()},
    )

    prev_hook = sys.excepthook

    def _hook(exc_type, exc_val, exc_tb):
        try:
            if factory_events is not None and isinstance(exc_val, BaseException):
                factory_events.emit_script_crash(
                    script=script_label,
                    exc=exc_val,
                    extras={"source": "excepthook", "pid": os.getpid(),
                            "uptime_seconds": round(time.time() - started)},
                )
        except Exception as exc:  # noqa: BLE001
            sys.stderr.write(f"[crash-guard] crash emit failed: {exc}\n")
        # Chain to the original hook so the traceback still prints.
        try:
            prev_hook(exc_type, exc_val, exc_tb)
        except Exception:  # noqa: BLE001
            sys.__excepthook__(exc_type, exc_val, exc_tb)

    sys.excepthook = _hook

    _shutdown_emitted = {"v": False}

    def _shutdown() -> None:
        if _shutdown_emitted["v"]:
            return
        _shutdown_emitted["v"] = True
        _safe_emit(
            type="script.shutdown",
            behavior=script_label,
            extras={"pid": os.getpid(), "uptime_seconds": round(time.time() - started)},
        )

    atexit.register(_shutdown)
