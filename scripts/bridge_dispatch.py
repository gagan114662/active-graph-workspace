#!/usr/bin/env python3
"""Python dispatcher invoked by the Node bridge per Pentagon trigger.

#28 capstone: unifies the dark factory's claude-CLI dispatch logic
into ONE code path that lives inside activegraph. The Node bridge
shells out to this script per trigger; this script uses
`activegraph.llm.ClaudeCodeCliProvider` to actually invoke claude.

After this lands, the bridge's `runClaude()` function is a thin Node
wrapper that:
  1. Builds the trigger payload (token, MCP URL, prompt, model).
  2. Spawns `python3 scripts/bridge_dispatch.py < payload.json`.
  3. Reads the dispatcher's result JSON from stdout.

The dispatcher:
  1. Imports activegraph.
  2. Constructs ClaudeCodeCliProvider with Pentagon MCP config.
  3. Calls provider.complete() with the trigger prompt as a single
     user message.
  4. Emits llm.requested / llm.responded / behavior.completed /
     behavior.failed factory events for the activegraph dispatch.
  5. Returns the response as JSON to stdout (text + token counts + cost
     + finish_reason + session_id + error if any).

Why this matters:
  - Before #28, the Node bridge had its OWN claude-CLI dispatch code
    that paralleled ClaudeCodeCliProvider. Two copies of the same
    logic, drifting over time.
  - After #28, Pullfrog (#20) and the dog-fooding rewrite share this
    exact dispatcher.
  - Tool support (#27) lands here once and benefits the bridge AND
    activegraph use cases simultaneously.

Input format (stdin, JSON):
  {
    "trigger_id": "uuid",
    "agent_id": "uuid",
    "agent_name": "Maya (Code Owner)",
    "conversation_id": "uuid",
    "message_id": "uuid",
    "token": "jwt for Pentagon MCP",
    "mcp_url": "https://auth.pentagon.run/functions/v1/mcp",
    "prompt": "full prompt text the bridge would normally pipe to claude",
    "model": "claude-opus-4-7",
    "timeout_seconds": 540,
    "harness": "claude-code"
  }

Output format (stdout, JSON):
  {
    "ok": true|false,
    "text": "final agent message",
    "input_tokens": N,
    "output_tokens": N,
    "cost_usd": "0.xx",
    "latency_seconds": N.NN,
    "finish_reason": "end_turn|stop_sequence|...",
    "session_id": "claude-session-id",
    "model": "claude-opus-4-7",
    "cache_read_input_tokens": N,
    "cache_creation_input_tokens": N,
    "error_reason": "llm.rate_limited|llm.network_error|...",
    "error_message": "..."
  }

Exit code: 0 on success or graceful failure (error_reason set), non-zero
only on hard internal errors that prevent emitting a structured result.
"""

from __future__ import annotations

import json
import os
import sys
import traceback
from decimal import Decimal
from pathlib import Path
from typing import Any

# Make the inner-repo activegraph package importable without uv environments.
# Resolution order: $VIRTUAL_ENV/bin/python (if set), then add inner repo to path.
HERE = Path(__file__).resolve().parent
INNER_REPO = HERE.parent / "activegraph"
if INNER_REPO.is_dir() and str(INNER_REPO) not in sys.path:
    sys.path.insert(0, str(INNER_REPO))
# Also make scripts/ importable for factory_events.
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

try:
    from activegraph.llm.claude_code_cli import ClaudeCodeCliProvider
    from activegraph.llm.errors import LLMBehaviorError
    from activegraph.llm.types import LLMMessage
except ImportError as e:
    sys.stderr.write(f"[bridge_dispatch] cannot import activegraph: {e}\n")
    sys.stderr.write(f"[bridge_dispatch] sys.path[:5]: {sys.path[:5]}\n")
    sys.stderr.write(f"[bridge_dispatch] INNER_REPO={INNER_REPO} exists={INNER_REPO.is_dir()}\n")
    print(json.dumps({
        "ok": False,
        "error_reason": "dispatcher.import_failed",
        "error_message": str(e),
    }))
    sys.exit(2)

try:
    import factory_events
except ImportError:
    factory_events = None  # Best-effort; dispatcher works without event emission.


def _emit(event_type: str, **kwargs: Any) -> None:
    if factory_events is None:
        return
    try:
        if event_type == "behavior.failed":
            factory_events.emit_behavior_failed(**kwargs)
        elif event_type == "behavior.completed":
            factory_events.emit_behavior_completed(**kwargs)
        elif event_type == "llm.requested":
            factory_events.emit_factory_event(type="llm.requested", **kwargs)
        elif event_type == "llm.responded":
            factory_events.emit_factory_event(type="llm.responded", **kwargs)
        else:
            factory_events.emit_factory_event(type=event_type, **kwargs)
    except Exception:
        pass  # Never let event emission break the dispatch.


def main() -> int:
    raw = sys.stdin.read()
    if not raw.strip():
        print(json.dumps({"ok": False, "error_reason": "dispatcher.empty_input", "error_message": "stdin was empty"}))
        return 0
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as e:
        print(json.dumps({"ok": False, "error_reason": "dispatcher.bad_json", "error_message": str(e)}))
        return 0

    behavior_name = f"bridge.runClaude.via.{Path(__file__).name}"
    trigger_id = payload.get("trigger_id")
    agent_id = payload.get("agent_id")
    agent_name = payload.get("agent_name")
    conversation_id = payload.get("conversation_id")
    message_id = payload.get("message_id")
    token = payload.get("token") or ""
    mcp_url = payload.get("mcp_url") or ""
    prompt = payload.get("prompt") or ""
    model = payload.get("model") or "claude-opus-4-7"
    timeout_seconds = float(payload.get("timeout_seconds") or 540)

    mcp_config = None
    if token and mcp_url:
        mcp_config = {
            "mcpServers": {
                "pentagon": {
                    "type": "http",
                    "url": mcp_url,
                    "headers": {"Authorization": f"Bearer {token}"},
                }
            }
        }

    provider = ClaudeCodeCliProvider(mcp_config=mcp_config)

    common_extras = {
        "agent_id": agent_id,
        "agent_name": agent_name,
        "trigger_id": trigger_id,
        "conversation_id": conversation_id,
        "message_id": message_id,
        "harness": payload.get("harness", "claude-code"),
        "via": "bridge_dispatch.py",
    }

    _emit("llm.requested", behavior=behavior_name, extras={**common_extras, "model": model, "prompt_chars": len(prompt)})

    try:
        response = provider.complete(
            system="",
            messages=[LLMMessage(role="user", content=prompt)],
            model=model,
            max_tokens=8000,
            temperature=0.0,
            top_p=1.0,
            output_schema=None,
            timeout_seconds=timeout_seconds,
            tools=None,
        )
    except LLMBehaviorError as e:
        # Provider already emitted behavior.failed via its internal hook,
        # but the bridge layer wants its OWN behavior-naming on the event
        # so the operator can distinguish "activegraph behavior failed"
        # from "bridge dispatch failed".
        _emit(
            "behavior.failed",
            behavior=behavior_name,
            reason=e.reason,
            message=str(e),
            extras={**common_extras, "model": model, "payload_extras": e.payload_extras},
        )
        result = {
            "ok": False,
            "error_reason": e.reason,
            "error_message": str(e),
            "model": model,
        }
        if e.payload_extras:
            result.update({
                "api_error_status": e.payload_extras.get("api_error_status"),
                "duration_ms": e.payload_extras.get("duration_ms"),
                "session_id": e.payload_extras.get("session_id"),
            })
        print(json.dumps(result, default=str))
        return 0
    except Exception as e:
        _emit(
            "behavior.failed",
            behavior=behavior_name,
            reason="dispatcher.unhandled_exception",
            message=str(e),
            extras={**common_extras, "exception_type": type(e).__name__, "traceback": traceback.format_exc()[-2000:]},
        )
        print(json.dumps({
            "ok": False,
            "error_reason": "dispatcher.unhandled_exception",
            "error_message": str(e),
            "exception_type": type(e).__name__,
        }))
        return 0

    _emit(
        "llm.responded",
        behavior=behavior_name,
        extras={
            **common_extras,
            "model": response.model,
            "input_tokens": response.input_tokens,
            "output_tokens": response.output_tokens,
            "cost_usd": float(response.cost_usd) if isinstance(response.cost_usd, Decimal) else response.cost_usd,
            "latency_seconds": response.latency_seconds,
            "finish_reason": response.finish_reason,
            "cache_read_input_tokens": response.provider_meta.get("cache_read_input_tokens", 0),
            "cache_creation_input_tokens": response.provider_meta.get("cache_creation_input_tokens", 0),
            "session_id": response.provider_meta.get("session_id"),
        },
    )
    _emit(
        "behavior.completed",
        behavior=behavior_name,
        message="bridge_dispatch.py completed claude dispatch",
        extras={**common_extras, "model": response.model, "latency_seconds": response.latency_seconds},
    )

    print(json.dumps({
        "ok": True,
        "text": response.raw_text,
        "input_tokens": response.input_tokens,
        "output_tokens": response.output_tokens,
        "cost_usd": str(response.cost_usd),
        "latency_seconds": response.latency_seconds,
        "finish_reason": response.finish_reason,
        "session_id": response.provider_meta.get("session_id"),
        "model": response.model,
        "cache_read_input_tokens": response.provider_meta.get("cache_read_input_tokens", 0),
        "cache_creation_input_tokens": response.provider_meta.get("cache_creation_input_tokens", 0),
        "duration_ms": response.provider_meta.get("duration_ms"),
        "duration_api_ms": response.provider_meta.get("duration_api_ms"),
    }, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
