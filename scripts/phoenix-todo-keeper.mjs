#!/usr/bin/env node
// Phoenix (Todo Keeper) — the consumer side of the closed-loop flywheel.
//
// Subscribes to factory events in realtime via honker. For each todo.created
// event, maintains the persistent todo backlog at frames/factory-todos.jsonl
// with:
//   * dedup: a recurring failure (same dedup_key) increments the existing
//     todo's occurrence counter instead of creating a duplicate row
//   * priority aging: a p2 that's been open > 24h gets bumped to p1
//   * completion tracking: when todo.completed events arrive, the matching
//     todo row is marked done with completed_at + evidence
//
// What Phoenix does NOT do (yet — task is still in flight):
//   * Insert Pentagon agent_triggers automatically. The extension point is
//     marked with TODO(pentagon-dispatch). Adding it makes the loop fully
//     autonomous; until then, the operator pulls from frames/factory-todos.jsonl.
//
// Usage:
//   node scripts/phoenix-todo-keeper.mjs               # foreground
//   node scripts/phoenix-todo-keeper.mjs --dry-run     # log decisions, no JSONL writes
//   node scripts/phoenix-todo-keeper.mjs --legacy-poll # bypass honker
//
// To run 24/7, wrap in a LaunchAgent plist similar to sasha-skeptic's.

import {
  appendFileSync,
  existsSync,
  readFileSync,
  statSync,
  writeFileSync,
  renameSync,
  mkdirSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { installCrashGuard } from "./factory-crash-guard.mjs";
import { subscribeToFactoryEvents } from "./honker-subscribe.mjs";
import { emitFactoryEvent } from "./factory-events.mjs";
import { dispatchTodo } from "./pentagon-rest.mjs";

installCrashGuard("phoenix-todo-keeper");

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1] ?? fallback;
}
function has(name) { return process.argv.includes(name); }

const TODOS_PATH = resolve(
  process.env.FACTORY_TODOS_PATH || "frames/factory-todos.jsonl"
);
const DRY_RUN = has("--dry-run");
const LEGACY_POLL = has("--legacy-poll");
const AGE_TO_P1_HOURS = Number(arg("--age-to-p1-hours", "24"));

// Autonomous Pentagon dispatch — opt-in. Off by default so existing
// deployments don't suddenly start spawning agent_triggers; turn on with
// --autodispatch (or env FACTORY_TODO_AUTODISPATCH=1).
const AUTODISPATCH =
  has("--autodispatch") ||
  process.env.FACTORY_TODO_AUTODISPATCH === "1" ||
  process.env.FACTORY_TODO_AUTODISPATCH === "true";

// Rate limit: max N new dispatches per ROLLING window (default: 5 per 60s).
// Recurring failures dedup before they ever reach dispatch, so this only
// guards against bursty distinct-failure storms.
const DISPATCH_MAX_PER_WINDOW = Number(arg("--dispatch-max-per-window", "5"));
const DISPATCH_WINDOW_MS = Number(arg("--dispatch-window-ms", "60000"));

// Circuit breaker: if N consecutive dispatches fail, pause dispatching for
// COOLDOWN_MS (default 5m). Auto-resets on first success.
const DISPATCH_CIRCUIT_THRESHOLD = Number(arg("--dispatch-circuit-threshold", "3"));
const DISPATCH_CIRCUIT_COOLDOWN_MS = Number(arg("--dispatch-circuit-cooldown-ms", "300000"));

const counts = {
  events_seen: 0,
  todos_created: 0,
  todos_deduped: 0,
  todos_completed: 0,
  malformed_events: 0,
  dispatches_attempted: 0,
  dispatches_succeeded: 0,
  dispatches_failed: 0,
  dispatches_skipped_rate_limit: 0,
  dispatches_skipped_circuit_open: 0,
  dispatches_skipped_dry_run: 0,
};

const dispatchTimestamps = [];   // ms timestamps of recent dispatch attempts
let dispatchCircuitOpenUntil = 0;
let dispatchConsecutiveFailures = 0;

function rateLimitOk() {
  const now = Date.now();
  const cutoff = now - DISPATCH_WINDOW_MS;
  while (dispatchTimestamps.length && dispatchTimestamps[0] < cutoff) {
    dispatchTimestamps.shift();
  }
  return dispatchTimestamps.length < DISPATCH_MAX_PER_WINDOW;
}

function circuitOk() {
  return Date.now() >= dispatchCircuitOpenUntil;
}

// In-memory index: dedup_key → todo row. Reloaded from disk at startup.
const index = new Map();

function ensureTodosFile() {
  if (!existsSync(TODOS_PATH)) {
    mkdirSync(dirname(TODOS_PATH), { recursive: true });
    if (!DRY_RUN) writeFileSync(TODOS_PATH, "");
  }
}

function loadExistingTodos() {
  if (!existsSync(TODOS_PATH)) return;
  const lines = readFileSync(TODOS_PATH, "utf8").split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row.dedup_key) index.set(row.dedup_key, row);
    } catch {
      counts.malformed_events++;
    }
  }
  console.log(
    JSON.stringify({
      status: "phoenix_loaded_existing_todos",
      count: index.size,
      open: [...index.values()].filter((t) => !t.completed_at).length,
    })
  );
}

function persistRow(row) {
  if (DRY_RUN) return;
  appendFileSync(TODOS_PATH, JSON.stringify(row) + "\n");
}

function rewriteAllTodos() {
  // Used after marking todos completed — append-only would leave the JSONL
  // ambiguous (latest-row-wins). Rewriting is cheap for typical sizes.
  if (DRY_RUN) return;
  const tmpPath = TODOS_PATH + ".rewriting";
  const data = [...index.values()].map((r) => JSON.stringify(r)).join("\n") + "\n";
  writeFileSync(tmpPath, data);
  renameSync(tmpPath, TODOS_PATH);
}

function handleTodoCreated(event) {
  const payload = event.payload || {};
  const dedupKey = payload.dedup_key;
  if (!dedupKey) {
    counts.malformed_events++;
    console.error("[phoenix] todo.created missing dedup_key", event.id);
    return;
  }
  const existing = index.get(dedupKey);
  if (existing && !existing.completed_at) {
    existing.occurrences = (existing.occurrences || 1) + 1;
    existing.last_seen_at = event.created_at;
    existing.last_failure_event_id = payload.failure_event_id;
    counts.todos_deduped++;
    // Age open todos: bump to p1 if they've been open long enough.
    const openHours =
      (Date.parse(existing.last_seen_at) - Date.parse(existing.created_at)) /
      3_600_000;
    if (
      existing.priority === "p2" &&
      openHours >= AGE_TO_P1_HOURS &&
      !existing._aged_to_p1
    ) {
      existing.priority = "p1";
      existing._aged_to_p1 = true;
    }
    rewriteAllTodos();
    console.log(
      JSON.stringify({
        status: "phoenix_deduped",
        dedup_key: dedupKey,
        occurrences: existing.occurrences,
        priority: existing.priority,
      })
    );
    return;
  }
  const row = {
    id: "todo_" + (event.id || Date.now()),
    created_at: event.created_at,
    last_seen_at: event.created_at,
    completed_at: null,
    dedup_key: dedupKey,
    title: payload.title || "(no title)",
    failure_event_id: payload.failure_event_id,
    last_failure_event_id: payload.failure_event_id,
    failure_reason: payload.failure_reason,
    recommended_agent: payload.recommended_agent,
    priority: payload.priority || "p2",
    occurrences: 1,
    source_event_type: payload.source_event_type || null,
    source_behavior: payload.source_behavior || null,
  };
  index.set(dedupKey, row);
  persistRow(row);
  counts.todos_created++;
  console.log(
    JSON.stringify({
      status: "phoenix_created",
      dedup_key: dedupKey,
      todo_id: row.id,
      recommended_agent: row.recommended_agent,
      priority: row.priority,
    })
  );

  // Autonomous Pentagon dispatch — completes the closed loop.
  maybeDispatch(row);
}

async function maybeDispatch(row) {
  if (!AUTODISPATCH) return;
  counts.dispatches_attempted++;
  if (DRY_RUN) {
    counts.dispatches_skipped_dry_run++;
    console.log(
      JSON.stringify({
        status: "phoenix_dispatch_skipped_dry_run",
        todo_id: row.id,
        recommended_agent: row.recommended_agent,
      })
    );
    return;
  }
  if (!circuitOk()) {
    counts.dispatches_skipped_circuit_open++;
    console.log(
      JSON.stringify({
        status: "phoenix_dispatch_skipped_circuit_open",
        todo_id: row.id,
        cooldown_remaining_ms: dispatchCircuitOpenUntil - Date.now(),
      })
    );
    return;
  }
  if (!rateLimitOk()) {
    counts.dispatches_skipped_rate_limit++;
    console.log(
      JSON.stringify({
        status: "phoenix_dispatch_skipped_rate_limit",
        todo_id: row.id,
        recent_dispatches: dispatchTimestamps.length,
        window_ms: DISPATCH_WINDOW_MS,
        max_per_window: DISPATCH_MAX_PER_WINDOW,
      })
    );
    return;
  }
  dispatchTimestamps.push(Date.now());
  try {
    const result = await dispatchTodo(row);
    counts.dispatches_succeeded++;
    dispatchConsecutiveFailures = 0;
    row.dispatched_at = new Date().toISOString();
    row.dispatched_conversation_id = result.conversation_id;
    row.dispatched_message_id = result.message_id;
    row.dispatched_target_agent_id = result.target_agent_id;
    rewriteAllTodos();
    try {
      emitFactoryEvent({
        type: "todo.dispatched",
        behavior: "factory-flywheel",
        extras: {
          todo_id: row.id,
          dedup_key: row.dedup_key,
          recommended_agent: row.recommended_agent,
          conversation_id: result.conversation_id,
          message_id: result.message_id,
        },
      });
    } catch {}
    console.log(
      JSON.stringify({
        status: "phoenix_dispatched",
        todo_id: row.id,
        recommended_agent: row.recommended_agent,
        conversation_id: result.conversation_id,
        message_id: result.message_id,
      })
    );
  } catch (err) {
    counts.dispatches_failed++;
    dispatchConsecutiveFailures++;
    if (dispatchConsecutiveFailures >= DISPATCH_CIRCUIT_THRESHOLD) {
      dispatchCircuitOpenUntil = Date.now() + DISPATCH_CIRCUIT_COOLDOWN_MS;
      console.error(
        JSON.stringify({
          status: "phoenix_dispatch_circuit_opened",
          consecutive_failures: dispatchConsecutiveFailures,
          cooldown_ms: DISPATCH_CIRCUIT_COOLDOWN_MS,
        })
      );
    }
    console.error(
      JSON.stringify({
        status: "phoenix_dispatch_failed",
        todo_id: row.id,
        error: String(err?.message ?? err).slice(0, 500),
        consecutive_failures: dispatchConsecutiveFailures,
      })
    );
    try {
      emitFactoryEvent({
        type: "behavior.failed",
        behavior: "phoenix-todo-keeper",
        reason: "phoenix.dispatch_failed",
        message: String(err?.message ?? err).slice(0, 500),
        extras: {
          todo_id: row.id,
          recommended_agent: row.recommended_agent,
        },
      });
    } catch {}
  }
}

function handleTodoCompletion(event) {
  // Completion can arrive in multiple shapes:
  //   1. Explicit todo.completed event from Phoenix itself (carries the
  //      real dedup_key).
  //   2. Implicit behavior.completed with extras.todo_id set (bridge does
  //      this for FLYWHEEL_TODO-originated triggers).
  //   3. todo.completed from the bridge where dedup_key is actually a
  //      todo_id (bridge doesn't carry the real dedup_key — see
  //      pentagon-trigger-bridge.mjs::emitTodoCompleted).
  const payload = event.payload || {};
  const candidateDedupKey = payload.dedup_key || null;
  const candidateTodoId = payload.todo_event_id || payload.todo_id || null;
  let dedupKey = null;

  // First try as a real dedup_key.
  if (candidateDedupKey && index.has(candidateDedupKey)) {
    dedupKey = candidateDedupKey;
  }
  // Otherwise, treat any candidate as a possible todo_id and reverse lookup.
  if (!dedupKey) {
    const probeId = candidateTodoId || candidateDedupKey;
    if (probeId) {
      for (const [k, row] of index) {
        if (row.id === probeId) {
          dedupKey = k;
          break;
        }
      }
    }
  }
  if (!dedupKey) return;  // not a flywheel-attributed completion
  const row = index.get(dedupKey);
  if (!row || row.completed_at) return;
  row.completed_at = event.created_at;
  row.completion_event_id = event.id;
  row.completion_evidence = payload.completion_evidence || null;
  // Capture the reply-quality signal the bridge surfaces, so operator
  // audits can spot agents that ignored the receipt-string contract.
  if (typeof payload.receipt_string_present === "boolean") {
    row.receipt_string_present = payload.receipt_string_present;
  }
  if (typeof payload.reply_chars === "number") {
    row.reply_chars = payload.reply_chars;
  }
  counts.todos_completed++;
  rewriteAllTodos();
  console.log(
    JSON.stringify({
      status: "phoenix_completed",
      dedup_key: dedupKey,
      todo_id: row.id,
      completion_event_id: event.id,
      receipt_string_present: row.receipt_string_present ?? null,
    })
  );
}

function processEvent(event) {
  counts.events_seen++;
  if (event.type === "todo.created") {
    handleTodoCreated(event);
  } else if (event.type === "todo.completed") {
    handleTodoCompletion(event);
  }
  // Also consider any behavior.completed with extras.todo_id as an implicit
  // todo completion (lets agents close their assigned todos by emitting the
  // standard completion event with a todo_id tag).
  if (event.type === "behavior.completed" && event.payload?.todo_id) {
    handleTodoCompletion(event);
  }
}

// --- Bootstrap ---

ensureTodosFile();
loadExistingTodos();

console.log(
  JSON.stringify({
    status: "phoenix_started",
    todos_path: TODOS_PATH,
    dry_run: DRY_RUN,
    mode: LEGACY_POLL ? "legacy-file-poll" : "honker-subscribe",
    age_to_p1_hours: AGE_TO_P1_HOURS,
    autodispatch: AUTODISPATCH,
    dispatch_rate_limit: AUTODISPATCH
      ? `${DISPATCH_MAX_PER_WINDOW}/${DISPATCH_WINDOW_MS}ms`
      : "off",
    dispatch_circuit_threshold: AUTODISPATCH ? DISPATCH_CIRCUIT_THRESHOLD : "off",
  })
);

let honkerSub = null;
if (!LEGACY_POLL) {
  honkerSub = subscribeToFactoryEvents(
    (event) => processEvent(event),
    {
      onWarning: (msg) => console.error("[phoenix:honker-subscribe]", msg),
    }
  );
} else {
  // Minimal file-poll fallback. Not realtime; primarily for dev environments
  // where the honker substrate is unavailable.
  const EVENTS_PATH = resolve(
    process.env.FACTORY_EVENTS_PATH || "frames/factory-events.jsonl"
  );
  let lastSize = existsSync(EVENTS_PATH) ? statSync(EVENTS_PATH).size : 0;
  const interval = setInterval(() => {
    if (!existsSync(EVENTS_PATH)) return;
    const size = statSync(EVENTS_PATH).size;
    if (size <= lastSize) return;
    const buf = readFileSync(EVENTS_PATH, "utf8").slice(lastSize);
    lastSize = size;
    for (const line of buf.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try { processEvent(JSON.parse(line)); } catch { counts.malformed_events++; }
    }
  }, 1000);
  process.on("SIGTERM", () => clearInterval(interval));
}

function shutdown(signal) {
  console.log(JSON.stringify({ status: "phoenix_shutting_down", signal, counts }));
  if (honkerSub) honkerSub.close();
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
