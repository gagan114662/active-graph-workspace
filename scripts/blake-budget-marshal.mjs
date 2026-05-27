#!/usr/bin/env node
// Blake (Budget Marshal) — wires the Pentagon agent of the same name to
// the factory event log. Tails llm.responded events, aggregates cost,
// and pauses the bridge LaunchAgent when configured budget caps are
// exceeded.
//
// From CLAUDE.md backlog: "Pancake-gap-3: explicit spend/scope approval
// gates + Blake agent wiring". The Pentagon org chart already provisions
// Blake as the on-demand budget specialist; this wires the role for the
// first time, mirroring Sasha-skeptic's pattern.
//
// Usage:
//   node scripts/blake-budget-marshal.mjs                       # live
//   node scripts/blake-budget-marshal.mjs --dry-run             # log decisions only
//   node scripts/blake-budget-marshal.mjs --cap-per-hour 5      # $5/hr cap
//   node scripts/blake-budget-marshal.mjs --cap-per-day 50      # $50/day cap
//   node scripts/blake-budget-marshal.mjs --cap-per-session 20  # $20 since Blake started
//   node scripts/blake-budget-marshal.mjs --tail-existing       # also count existing events

import { readFileSync, existsSync, statSync, appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { installCrashGuard } from "./factory-crash-guard.mjs";
import { emitFactoryEvent } from "./factory-events.mjs";

installCrashGuard("blake-budget-marshal");

const EVENTS_PATH = resolve(
  process.env.FACTORY_EVENTS_PATH || "frames/factory-events.jsonl"
);
const ACTIONS_PATH = resolve("frames/blake-actions.jsonl");
const BRIDGE_LABEL = "run.pentagon.trigger-bridge";
const BRIDGE_PLIST = process.env.HOME + "/Library/LaunchAgents/run.pentagon.trigger-bridge.plist";

function arg(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  return idx === -1 ? fallback : process.argv[idx + 1] ?? fallback;
}
function has(name) { return process.argv.includes(name); }

const CAP_HOUR = Number(arg("--cap-per-hour", "999999"));
const CAP_DAY = Number(arg("--cap-per-day", "999999"));
const CAP_SESSION = Number(arg("--cap-per-session", "999999"));
const POLL_INTERVAL_MS = Number(arg("--poll-interval-ms", "5000"));
const DRY_RUN = has("--dry-run");
const TAIL_EXISTING = has("--tail-existing");

let lastSize = 0;
let pauseActiveUntil = null;
const sessionStartMs = Date.now();

function logAction(type, message, extras = {}) {
  const record = {
    id: "blake_" + new Date().toISOString().replace(/[:.]/g, "-"),
    detected_at: new Date().toISOString(),
    type,
    dry_run: DRY_RUN,
    message,
    ...extras,
  };
  appendFileSync(ACTIONS_PATH, JSON.stringify(record) + "\n");
  console.log(`[blake] ${type} → ${message}`);
  // Also mirror to factory event log so the dashboard sees Blake's decisions.
  try {
    emitFactoryEvent({
      type: "blake." + type,
      behavior: "blake-budget-marshal",
      reason: "blake." + type,
      message,
      extras,
    });
  } catch {}
  return record;
}

function readAllEvents() {
  if (!existsSync(EVENTS_PATH)) return [];
  return readFileSync(EVENTS_PATH, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
}

function computeWindows() {
  const now = Date.now();
  const oneHourAgo = now - 3600 * 1000;
  const oneDayAgo = now - 86400 * 1000;
  const events = readAllEvents();
  let hour = 0, day = 0, session = 0;
  for (const ev of events) {
    if (ev.type !== "llm.responded") continue;
    const cost = Number(ev.payload?.cost_usd ?? 0);
    if (!cost) continue;
    const ts = Date.parse(ev.created_at);
    if (ts >= oneHourAgo) hour += cost;
    if (ts >= oneDayAgo) day += cost;
    if (ts >= sessionStartMs) session += cost;
  }
  return { hour, day, session };
}

function pauseBridge(reason, totals) {
  if (pauseActiveUntil && pauseActiveUntil > Date.now()) {
    logAction("budget_pause_already_active", `already paused until ${new Date(pauseActiveUntil).toISOString()}`, {
      cap_breached: reason,
      totals,
    });
    return;
  }
  if (DRY_RUN) {
    logAction("budget_pause_would_apply", `[dry-run] would bootout ${BRIDGE_LABEL}`, {
      cap_breached: reason,
      totals,
    });
    pauseActiveUntil = Date.now() + 3600 * 1000; // 1h pretend
    return;
  }
  const uid = process.getuid?.() ?? process.env.UID;
  const result = spawnSync("launchctl", ["bootout", `gui/${uid}/${BRIDGE_LABEL}`], { encoding: "utf8" });
  pauseActiveUntil = Date.now() + 3600 * 1000;
  logAction("budget_pause", `bootout ${BRIDGE_LABEL} (exit=${result.status}); auto-resume in 1h unless cap still breached`, {
    cap_breached: reason,
    totals,
    pause_until: new Date(pauseActiveUntil).toISOString(),
  });
  // Schedule an auto-unpause + cap recheck.
  setTimeout(() => maybeUnpause(), 3600 * 1000);
}

function maybeUnpause() {
  const totals = computeWindows();
  if (totals.hour < CAP_HOUR && totals.day < CAP_DAY && totals.session < CAP_SESSION) {
    if (DRY_RUN) {
      logAction("budget_unpause_would_apply", "[dry-run] would re-bootstrap bridge", { totals });
      pauseActiveUntil = null;
      return;
    }
    const uid = process.getuid?.() ?? process.env.UID;
    const result = spawnSync("launchctl", ["bootstrap", `gui/${uid}`, BRIDGE_PLIST], { encoding: "utf8" });
    logAction("budget_unpause", `bootstrap ${BRIDGE_LABEL} (exit=${result.status})`, { totals });
    pauseActiveUntil = null;
  } else {
    logAction("budget_unpause_blocked", "still over cap; staying paused another hour", { totals });
    pauseActiveUntil = Date.now() + 3600 * 1000;
    setTimeout(() => maybeUnpause(), 3600 * 1000);
  }
}

function checkCaps() {
  const totals = computeWindows();
  if (totals.hour >= CAP_HOUR) {
    pauseBridge(`cap_per_hour ($${CAP_HOUR})`, totals);
    return;
  }
  if (totals.day >= CAP_DAY) {
    pauseBridge(`cap_per_day ($${CAP_DAY})`, totals);
    return;
  }
  if (totals.session >= CAP_SESSION) {
    pauseBridge(`cap_per_session ($${CAP_SESSION})`, totals);
    return;
  }
}

function pollNewEvents() {
  if (!existsSync(EVENTS_PATH)) return;
  const size = statSync(EVENTS_PATH).size;
  if (size <= lastSize) return;
  lastSize = size;
  checkCaps();
}

if (existsSync(EVENTS_PATH)) {
  lastSize = TAIL_EXISTING ? 0 : statSync(EVENTS_PATH).size;
}

console.log(JSON.stringify({
  status: "blake_started",
  events_path: EVENTS_PATH,
  actions_path: ACTIONS_PATH,
  cap_per_hour: CAP_HOUR,
  cap_per_day: CAP_DAY,
  cap_per_session: CAP_SESSION,
  poll_interval_ms: POLL_INTERVAL_MS,
  dry_run: DRY_RUN,
  tail_existing: TAIL_EXISTING,
}));

// Initial check + then poll loop.
checkCaps();
const interval = setInterval(pollNewEvents, POLL_INTERVAL_MS);

function shutdown(signal) {
  console.log(JSON.stringify({ status: "blake_shutting_down", signal }));
  clearInterval(interval);
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
