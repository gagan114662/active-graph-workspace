#!/usr/bin/env node
// Sasha (Spec Skeptic) — the dark factory's monitoring agent.
//
// Tails the factory event log and reacts to behavior.failed events.
// First wired role (CLAUDE.md backlog: "Wire Sasha (Spec Skeptic) into
// the gauntlet — highest priority because the role is real and being
// done by hand").
//
// What Sasha does today:
//   * Watches `frames/factory-events.jsonl` for new events (1s poll).
//   * On `behavior.failed reason=llm.rate_limited`: pauses the bridge
//     LaunchAgent for --pause-seconds (default 1800s = 30min). Avoids
//     burning more failed attempts during a rate-limit window. One pause
//     per Sasha session to prevent thrashing; second occurrence is
//     logged only.
//   * On `behavior.failed reason=agent.*`: logs an alert (no auto-action;
//     agent quality issues are operator territory).
//   * On `infrastructure.*`: logs an alert.
//   * Every action audited to `frames/sasha-actions.jsonl` so future
//     sessions can see what Sasha did and why.
//
// Usage:
//   node scripts/sasha-skeptic.mjs                          # live (will pause bridge on rate limit)
//   node scripts/sasha-skeptic.mjs --dry-run                # log actions, never bootout the bridge
//   node scripts/sasha-skeptic.mjs --pause-seconds 600      # custom pause window
//   node scripts/sasha-skeptic.mjs --tail-existing          # also process events that already exist
//
// To run as a daemon, wrap in a LaunchAgent plist similar to
// run.pentagon.trigger-bridge.plist. v1 is foreground-only.
//
// Honker (task #30) would replace the 1Hz file-poll with a SQLite LISTEN.

import { readFileSync, existsSync, statSync, appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { installCrashGuard } from "./factory-crash-guard.mjs";
import { subscribeToFactoryEvents } from "./honker-subscribe.mjs";
import { emitTodoCreated } from "./factory-events.mjs";

installCrashGuard("sasha-skeptic");

// Routing: which agent picks up a todo for a given failure event.
//
// Logic is data-driven (task #18 from the factory-autonomous goal doc):
// rules live in agent-os/factory-routing-config.json. This makes routing
// changes a versioned data delta that factory-learn.mjs can propose +
// apply deterministically, instead of a code edit that requires a daemon
// restart. The config is reloaded each tick (cheap; ~2KB read) so the
// next-event-after-edit picks up new rules without a restart.
import { readFileSync as _readFileSyncSasha, existsSync as _existsSyncSasha } from "node:fs";
const ROUTING_CONFIG_PATH = process.env.FACTORY_ROUTING_CONFIG ||
  "/Users/gaganarora/Desktop/my projects/active_graph/agent-os/factory-routing-config.json";

let _cachedRouting = null;
let _cachedRoutingMtime = 0;
function loadRoutingConfig() {
  if (!_existsSyncSasha(ROUTING_CONFIG_PATH)) return null;
  try {
    const stat = _readFileSyncSasha(ROUTING_CONFIG_PATH).length;  // cheap freshness check
    if (_cachedRouting && stat === _cachedRoutingMtime) return _cachedRouting;
    _cachedRouting = JSON.parse(_readFileSyncSasha(ROUTING_CONFIG_PATH, "utf8"));
    _cachedRoutingMtime = stat;
    return _cachedRouting;
  } catch {
    return _cachedRouting;  // keep last good config if reload fails
  }
}

function matchPredicate(when, event) {
  if (!when) return false;
  if (when.always === true) return true;
  const reason = event?.payload?.reason || null;
  const behavior = event?.payload?.behavior || null;
  if ("extras.synthetic" in when) {
    if ((event?.payload?.synthetic === true) !== (when["extras.synthetic"] === true)) return false;
  }
  if (when.reason_equals !== undefined && reason !== when.reason_equals) return false;
  if (when.reason_prefix !== undefined && !(reason && reason.startsWith(when.reason_prefix))) return false;
  if (when.behavior_equals !== undefined && behavior !== when.behavior_equals) return false;
  return true;
}

function routeFailureToAgent(event) {
  // Support legacy string-only callers (reason as bare string).
  if (typeof event === "string") event = { payload: { reason: event } };
  const config = loadRoutingConfig();
  if (config?.rules?.length) {
    for (const rule of config.rules) {
      if (!matchPredicate(rule.when, event)) continue;
      if (rule.skip_todo) return null;
      if (rule.route) return { agent: rule.route.agent, priority: rule.route.priority, matched_rule: rule.name };
    }
  }
  // Fall back to the original hardcoded ladder if config is missing/empty.
  const reason = event?.payload?.reason;
  const synthetic = event?.payload?.synthetic === true;
  if (synthetic) return null;
  if (!reason) return { agent: "sasha", priority: "p2" };
  if (reason === "llm.rate_limited") return null;
  if (reason === "llm.network_error") return null;
  if (reason === "llm.provider_error") return { agent: "sasha", priority: "p1" };
  if (reason.startsWith("agent.")) return { agent: "sasha", priority: "p1" };
  if (reason === "verifier.check_failed") return { agent: "maya", priority: "p1" };
  if (reason === "script.crash") return { agent: "maya", priority: "p1" };
  if (reason.startsWith("infrastructure.")) return { agent: "sasha", priority: "p2" };
  return { agent: "sasha", priority: "p2" };
}

function todoTitleFor(event) {
  const reason = event.payload?.reason || "unknown";
  const behavior = event.payload?.behavior || "unknown";
  const msg = event.payload?.message;
  if (msg) return `${reason} in ${behavior}: ${String(msg).slice(0, 140)}`;
  return `${reason} in ${behavior}`;
}

function dedupKeyFor(event) {
  const reason = event.payload?.reason || "unknown";
  const behavior = event.payload?.behavior || "unknown";
  // Include the first 32 chars of message so different failure modes within
  // the same reason+behavior get distinct todos.
  const msgPrefix = String(event.payload?.message || "").slice(0, 32);
  return `${reason}::${behavior}::${msgPrefix}`;
}

function maybeCreateTodo(event) {
  const routed = routeFailureToAgent(event);
  if (!routed) return null;
  const reason = event.payload?.reason;
  try {
    return emitTodoCreated({
      failure_event_id: event.id,
      dedup_key: dedupKeyFor(event),
      recommended_agent: routed.agent,
      priority: routed.priority,
      title: todoTitleFor(event),
      failure_reason: reason,
      extras: {
        source_event_type: event.type,
        source_behavior: event.payload?.behavior || null,
      },
    });
  } catch (err) {
    console.error("[sasha] emitTodoCreated failed:", err.message);
    return null;
  }
}

const EVENTS_PATH = resolve(
  process.env.FACTORY_EVENTS_PATH || "frames/factory-events.jsonl"
);
const ACTIONS_PATH = resolve("frames/sasha-actions.jsonl");
const BRIDGE_LABEL = "run.pentagon.trigger-bridge";
const BRIDGE_PLIST = process.env.HOME + "/Library/LaunchAgents/run.pentagon.trigger-bridge.plist";

function arg(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  return idx === -1 ? fallback : process.argv[idx + 1] ?? fallback;
}
function has(name) {
  return process.argv.includes(name);
}

const PAUSE_SECONDS = Number(arg("--pause-seconds", "1800"));
const POLL_INTERVAL_MS = Number(arg("--poll-interval-ms", "1000"));
const DRY_RUN = has("--dry-run");
const TAIL_EXISTING = has("--tail-existing");
const LEGACY_POLL = has("--legacy-poll");  // force JSONL file polling (skip honker)

let pausedThisSession = false;
let pauseExpiresAt = null;
let pauseTimer = null;
let lastSize = 0;
const counts = {
  events_seen: 0,
  rate_limit_paused: 0,
  rate_limit_noted: 0,
  agent_failure_alerts: 0,
  infrastructure_alerts: 0,
  other_failures: 0,
};

function logAction(type, event, actionTaken, extras = {}) {
  const record = {
    id: "sasha_" + new Date().toISOString().replace(/[:.]/g, "-"),
    detected_at: new Date().toISOString(),
    type,
    dry_run: DRY_RUN,
    triggering_event_id: event?.id ?? null,
    triggering_event_type: event?.type ?? null,
    triggering_event_reason: event?.payload?.reason ?? null,
    triggering_event_behavior: event?.payload?.behavior ?? null,
    action_taken: actionTaken,
    ...extras,
  };
  appendFileSync(ACTIONS_PATH, JSON.stringify(record) + "\n");
  console.log(
    `[sasha] ${type}` +
      (event ? ` from ${event.id} (${event.payload?.reason ?? event.type})` : "") +
      ` → ${actionTaken}`
  );
  return record;
}

function bridgeIsLoaded() {
  const out = spawnSync("launchctl", ["list", BRIDGE_LABEL], { encoding: "utf8" });
  return out.status === 0;
}

function pauseBridge(reason, event) {
  if (pausedThisSession) {
    logAction("rate_limit_noted", event, "bridge already paused this session — skipping repeat");
    counts.rate_limit_noted++;
    return;
  }
  if (DRY_RUN) {
    logAction(
      "rate_limit_pause",
      event,
      `[dry-run] would have bootout'd ${BRIDGE_LABEL} for ${PAUSE_SECONDS}s`,
      { reason, pause_seconds: PAUSE_SECONDS }
    );
    counts.rate_limit_paused++;
    pausedThisSession = true;
    return;
  }
  const uid = process.getuid?.() ?? process.env.UID;
  const bootout = spawnSync(
    "launchctl",
    ["bootout", `gui/${uid}/${BRIDGE_LABEL}`],
    { encoding: "utf8" }
  );
  pausedThisSession = true;
  pauseExpiresAt = new Date(Date.now() + PAUSE_SECONDS * 1000);
  logAction(
    "rate_limit_pause",
    event,
    `bootout exit=${bootout.status}; pause expires at ${pauseExpiresAt.toISOString()}`,
    {
      reason,
      pause_seconds: PAUSE_SECONDS,
      bootout_exit: bootout.status,
      pause_expires_at: pauseExpiresAt.toISOString(),
    }
  );
  counts.rate_limit_paused++;
  pauseTimer = setTimeout(() => {
    if (DRY_RUN) return;
    const reload = spawnSync(
      "launchctl",
      ["bootstrap", `gui/${uid}`, BRIDGE_PLIST],
      { encoding: "utf8" }
    );
    logAction(
      "rate_limit_unpause",
      null,
      `bootstrap exit=${reload.status} after ${PAUSE_SECONDS}s pause`,
      { bootstrap_exit: reload.status, bootstrap_stderr: String(reload.stderr || "").slice(0, 500) }
    );
    pausedThisSession = false;
    pauseExpiresAt = null;
  }, PAUSE_SECONDS * 1000);
}

function processEvent(event) {
  counts.events_seen++;
  if (event.type !== "behavior.failed") return;
  const reason = event.payload?.reason || "";

  if (reason === "llm.rate_limited") {
    pauseBridge(reason, event);
    return;  // no todo — transient, handled by pause
  }

  // For all other failure types: log the action AND emit a todo.created
  // event for the flywheel. Phoenix-todo-keeper picks them up downstream.
  if (reason.startsWith("agent.")) {
    logAction("agent_failure_alert", event, "logged for human review");
    counts.agent_failure_alerts++;
  } else if (reason.startsWith("infrastructure.")) {
    logAction("infrastructure_alert", event, "logged for human review");
    counts.infrastructure_alerts++;
  } else {
    logAction("other_failure", event, "logged for human review (unrecognized reason code)");
    counts.other_failures++;
  }

  // Todo emission is best-effort and gated by routing (some failures
  // intentionally produce no todo — see routeFailureToAgent).
  const todoEvent = maybeCreateTodo(event);
  if (todoEvent) {
    counts.todos_created = (counts.todos_created || 0) + 1;
  }
}

function pollNewEvents() {
  if (!existsSync(EVENTS_PATH)) return;
  const stats = statSync(EVENTS_PATH);
  if (stats.size <= lastSize) return;
  const allBuf = readFileSync(EVENTS_PATH, "utf8");
  // Slice from lastSize onward to get only new lines. If the file was truncated
  // (size went down), re-parse from the start.
  const newBuf = stats.size < lastSize ? allBuf : allBuf.slice(lastSize);
  lastSize = stats.size;
  for (const line of newBuf.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      processEvent(JSON.parse(line));
    } catch {
      // Skip malformed lines.
    }
  }
}

// Initialize lastSize so we only react to events appended AFTER Sasha starts,
// unless --tail-existing is passed. Only relevant in legacy file-poll mode.
if (existsSync(EVENTS_PATH)) {
  lastSize = TAIL_EXISTING ? 0 : statSync(EVENTS_PATH).size;
}

// Choose subscription mechanism. Honker subscribe is preferred (sub-second
// notification via the SQLite update_watcher + the honker-relay JSONL tail
// daemon). Legacy polling stays available for environments without honker.
let interval = null;
let honkerSub = null;
const useHonker = !LEGACY_POLL;

console.log(JSON.stringify({
  status: "sasha_started",
  events_path: EVENTS_PATH,
  actions_path: ACTIONS_PATH,
  pause_seconds: PAUSE_SECONDS,
  poll_interval_ms: POLL_INTERVAL_MS,
  dry_run: DRY_RUN,
  tail_existing: TAIL_EXISTING,
  mode: useHonker ? "honker-subscribe" : "legacy-file-poll",
  starting_byte_offset: useHonker ? null : lastSize,
}));

if (useHonker) {
  honkerSub = subscribeToFactoryEvents(
    (event) => {
      // honker_listen.py yields events with shape {id, created_at, type, payload}.
      // Sasha's processEvent expects the same shape that file-poll produces
      // (which already used factory-events.mjs shape). They match.
      processEvent(event);
    },
    {
      onWarning: (msg) => {
        // Don't drown the operator in warnings — log once per unique message.
        console.error("[sasha:honker-subscribe]", msg);
      },
    }
  );
} else {
  interval = setInterval(pollNewEvents, POLL_INTERVAL_MS);
}

// Panic kill switch (Gap L). All factory daemons exit immediately if
// ~/.factory/PANIC exists.
const PANIC_PATH = `${process.env.HOME}/.factory/PANIC`;
const panicWatchInterval = setInterval(() => {
  if (existsSync(PANIC_PATH)) {
    console.error("[sasha] PANIC file detected — exiting immediately");
    process.exit(2);
  }
}, 5000);

function shutdown(signal) {
  console.log(JSON.stringify({ status: "sasha_shutting_down", signal, counts }));
  if (pauseTimer) clearTimeout(pauseTimer);
  if (interval) clearInterval(interval);
  if (honkerSub) honkerSub.close();
  clearInterval(panicWatchInterval);
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
