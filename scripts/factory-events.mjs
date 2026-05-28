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

// Collision-resistant event IDs (post-pt.4 fix). Per-process sequence
// counters race when multiple writers (bridge + Sasha + Phoenix + ad-hoc)
// emit concurrently — same evt_000XXX id, Honker's INSERT OR IGNORE
// silently drops the second event. New format: evt_<unix_ms>_<pid>_<seq>,
// padded so lexicographic sort matches chronological + watcher's
// WHERE id > last_id ORDER BY id ASC still works. Old evt_000XXX events
// sort BEFORE new ones (evt_0 < evt_1).
const PID_PADDED = String(process.pid).padStart(6, "0");
let _procSeq = 0;
function nextId() {
  const ts = String(Date.now()).padStart(15, "0");
  _procSeq++;
  const seq = String(_procSeq).padStart(4, "0");
  return `evt_${ts}_${PID_PADDED}_${seq}`;
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
  const event = {
    id: nextId(),
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

/**
 * Emit a todo.created event — flywheel producer side.
 * Sasha calls this; Phoenix consumes via honker subscribe.
 * dedup_key shape: <reason>::<behavior>::<msg-prefix>
 */
export function emitTodoCreated({
  failure_event_id,
  dedup_key,
  recommended_agent,
  priority = null,
  title = null,
  failure_reason = null,
  extras = {},
  path,
}) {
  if (!failure_event_id) throw new Error("emitTodoCreated: failure_event_id required");
  if (!dedup_key) throw new Error("emitTodoCreated: dedup_key required");
  if (!recommended_agent) throw new Error("emitTodoCreated: recommended_agent required");
  return emitFactoryEvent({
    type: "todo.created",
    behavior: "factory-flywheel",
    extras: {
      failure_event_id,
      dedup_key,
      recommended_agent,
      priority,
      title,
      failure_reason,
      ...extras,
    },
    path,
  });
}

/**
 * Emit a todo.completed event — flywheel closure.
 * Bridge calls this when an agent reply contains FLYWHEEL_TODO_<id>_RECEIVED.
 */
export function emitTodoCompleted({
  todo_event_id,
  dedup_key,
  completion_evidence = null,
  extras = {},
  path,
}) {
  if (!todo_event_id) throw new Error("emitTodoCompleted: todo_event_id required");
  if (!dedup_key) throw new Error("emitTodoCompleted: dedup_key required");
  return emitFactoryEvent({
    type: "todo.completed",
    behavior: "factory-flywheel",
    extras: {
      todo_event_id,
      dedup_key,
      completion_evidence,
      ...extras,
    },
    path,
  });
}

/**
 * Emit a SYNTHETIC factory event — test scaffolding, probes, smoke tests.
 *
 * Designed after the 2026-05-28 synthetic-test contamination incident: an
 * unmarked synthetic todo cascaded into a multi-agent debate costing real
 * $$. This helper forces extras.synthetic=true AND auto-fills extras.probe_origin
 * from the caller's stack so the producer-side honor is guaranteed.
 *
 * Sasha's routeFailureToAgent short-circuits on synthetic=true (returns null,
 * no todo). The third guard (synthetic=true && !probe_origin) is the
 * adversarial-evasion case the verifier flags as a distinct WARN.
 */
export function emitSyntheticProbe(reason, opts = {}) {
  let probeOrigin = opts.probe_origin || null;
  if (!probeOrigin) {
    const stack = new Error().stack || "";
    const lines = stack.split("\n");
    const callerFrame = lines[2] || "";
    const match = callerFrame.match(/\((.+):(\d+):(\d+)\)/) ||
                  callerFrame.match(/at (.+):(\d+):(\d+)/);
    probeOrigin = match ? `${match[1]}:${match[2]}` : "unknown";
  }
  const probeId = "probe_" + Math.random().toString(36).slice(2, 10);
  return emitFactoryEvent({
    type: opts.type || "behavior.failed",
    behavior: opts.behavior || "synthetic-probe",
    reason: reason,
    message: opts.message || `synthetic probe: ${reason}`,
    extras: {
      synthetic: true,
      probe_origin: probeOrigin,
      probe_id: probeId,
      ...(opts.extras || {}),
    },
    path: opts.path,
  });
}

export const FACTORY_EVENTS_PATH = DEFAULT_PATH;
