// Factory event log — activegraph-shaped events written from any Node script
// in the dark factory. Single source of truth for dispatch failures (and,
// later, successes) so every failure mode that today lives in scattered
// logs (bridge stdout, runner JSON, classifier output, T7 ledger) is also
// recorded as a queryable activegraph event.
//
// Format: JSONL, one event per line. Schema mirrors activegraph.Event:
//   {
//     "id": "evt_<seq>",
//     "created_at": "<iso-8601>",
//     "type": "behavior.failed" | "behavior.completed" | "infrastructure.*",
//     "payload": { ...reason, behavior, extras }
//   }
//
// File path: frames/factory-events.jsonl (default; override via FACTORY_EVENTS_PATH env).
//
// Read by: scripts/factory-events-list.mjs (CLI) + any Python tool that
// imports activegraph and replays the JSONL into a Graph.

import { appendFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_PATH = resolve(
  process.env.FACTORY_EVENTS_PATH || "frames/factory-events.jsonl"
);

let _seq = null;
function nextSequence() {
  if (_seq !== null) return ++_seq;
  // Initialize from the file's last id so we never collide.
  if (!existsSync(DEFAULT_PATH)) {
    _seq = 0;
    return ++_seq;
  }
  const lines = readFileSync(DEFAULT_PATH, "utf8").trim().split(/\r?\n/);
  let maxSeq = 0;
  for (const line of lines) {
    if (!line) continue;
    try {
      const ev = JSON.parse(line);
      const m = String(ev.id || "").match(/^evt_(\d+)$/);
      if (m) maxSeq = Math.max(maxSeq, Number(m[1]));
    } catch {}
  }
  _seq = maxSeq;
  return ++_seq;
}

/**
 * Append one factory event.
 *
 * @param {object} args
 * @param {string} args.type           Event type (e.g. "behavior.failed",
 *                                     "infrastructure.ghost_completion").
 * @param {string} [args.behavior]     Behavior or component that failed
 *                                     (e.g. "bridge.runClaude", "Maya",
 *                                     "native_task_runner.dispatch").
 * @param {string} [args.reason]       Reason code (e.g. "llm.rate_limited",
 *                                     "infrastructure.ghost_completion").
 * @param {string} [args.message]      Human-readable message.
 * @param {object} [args.extras]       Free-form extras (agent_id, trigger_id,
 *                                     api_error_status, model, etc.).
 * @param {string} [args.path]         Override target JSONL path.
 * @returns {object} The appended event row.
 */
export function emitFactoryEvent({
  type,
  behavior = null,
  reason = null,
  message = null,
  extras = {},
  path = DEFAULT_PATH,
}) {
  if (!type) throw new Error("emitFactoryEvent: `type` is required");
  const seq = nextSequence();
  const event = {
    id: "evt_" + String(seq).padStart(6, "0"),
    created_at: new Date().toISOString(),
    type,
    payload: {
      ...(reason !== null ? { reason } : {}),
      ...(behavior !== null ? { behavior } : {}),
      ...(message !== null ? { message } : {}),
      ...extras,
    },
  };
  appendFileSync(path, JSON.stringify(event) + "\n");
  return event;
}

/**
 * Convenience helper: emit a behavior.failed event.
 */
export function emitBehaviorFailed({ behavior, reason, message, extras = {}, path }) {
  return emitFactoryEvent({
    type: "behavior.failed",
    behavior,
    reason,
    message,
    extras,
    path,
  });
}

/**
 * Convenience helper: emit an infrastructure event (no agent behavior was
 * even reached — Pentagon/bridge level).
 */
export function emitInfrastructureEvent({ subtype, message, extras = {}, path }) {
  return emitFactoryEvent({
    type: "infrastructure." + subtype,
    reason: "infrastructure." + subtype,
    message,
    extras,
    path,
  });
}

/**
 * Emit a behavior.completed event. Use for successful dispatch endpoints.
 */
export function emitBehaviorCompleted({ behavior, message, extras = {}, path }) {
  return emitFactoryEvent({
    type: "behavior.completed",
    behavior,
    message,
    extras,
    path,
  });
}

/**
 * Emit an llm.requested event right before invoking a provider/subprocess.
 * Mirrors the activegraph `llm.requested` event shape (model + prompt_chars).
 */
export function emitLlmRequested({ behavior, model, prompt_chars, extras = {}, path }) {
  return emitFactoryEvent({
    type: "llm.requested",
    behavior,
    extras: {
      model,
      prompt_chars,
      ...extras,
    },
    path,
  });
}

/**
 * Emit an llm.responded event after a successful subprocess return. Mirrors
 * activegraph's `llm.responded` event payload (model, tokens, cost, latency).
 */
export function emitLlmResponded({
  behavior,
  model,
  input_tokens,
  output_tokens,
  cost_usd,
  latency_seconds,
  finish_reason = null,
  cache_read_input_tokens = 0,
  cache_creation_input_tokens = 0,
  extras = {},
  path,
}) {
  return emitFactoryEvent({
    type: "llm.responded",
    behavior,
    extras: {
      model,
      input_tokens,
      output_tokens,
      cost_usd,
      latency_seconds,
      finish_reason,
      cache_read_input_tokens,
      cache_creation_input_tokens,
      ...extras,
    },
    path,
  });
}

export const FACTORY_EVENTS_PATH = DEFAULT_PATH;
