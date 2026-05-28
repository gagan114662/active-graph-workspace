#!/usr/bin/env node
// Factory alerting daemon (Gap G).
//
// Polls factory daemon liveness + cost burn rate + event-log staleness on a
// fixed interval. When an alert condition fires:
//   * writes to ~/.factory/ALERT (atomic; latest condition wins)
//   * emits an `infrastructure.factory_alert` factory event so downstream
//     consumers (Sasha, future Slack adapter) can react
//   * optionally POSTs to FACTORY_ALERT_WEBHOOK (Slack/Discord-compatible JSON)
//
// Alert conditions (all configurable):
//   * Any required daemon not in running state for > ALERT_DAEMON_DOWN_S (default 60s)
//   * Bridge cost burn > ALERT_COST_PER_HOUR_USD over last hour (default $100)
//   * Phoenix dispatch failure-streak > ALERT_DISPATCH_FAIL_STREAK (default 5)
//   * Honker substrate degraded (latency > ALERT_HONKER_LATENCY_MS, default 2000)
//   * No factory events for > ALERT_QUIET_SECONDS (default 1800 = 30min during business hours)
//
// Usage:
//   node scripts/factory-alert.mjs                                  # foreground
//   node scripts/factory-alert.mjs --once                           # single check, exit
//   node scripts/factory-alert.mjs --interval-ms 60000              # custom interval
//   FACTORY_ALERT_WEBHOOK=https://hooks.slack.com/... \
//     node scripts/factory-alert.mjs                                # post to Slack

import { existsSync, readFileSync, writeFileSync, statSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { emitFactoryEvent } from "./factory-events.mjs";
import { installCrashGuard } from "./factory-crash-guard.mjs";

installCrashGuard("factory-alert");

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i < 0) return fallback;
  return process.argv[i + 1];
}
function flag(name) { return process.argv.includes(name); }

const intervalMs = Number(arg("--interval-ms", 60_000));
const once = flag("--once");
const dryRun = flag("--dry-run");

const ALERT_FILE = resolve(process.env.FACTORY_ALERT_FILE || `${process.env.HOME}/.factory/ALERT`);
const PANIC_FILE = resolve(process.env.FACTORY_PANIC_FILE || `${process.env.HOME}/.factory/PANIC`);
const ALERT_WEBHOOK = process.env.FACTORY_ALERT_WEBHOOK || null;

const DAEMON_DOWN_S = Number(process.env.ALERT_DAEMON_DOWN_S || 60);
const COST_PER_HOUR_USD = Number(process.env.ALERT_COST_PER_HOUR_USD || 100);
const DISPATCH_FAIL_STREAK = Number(process.env.ALERT_DISPATCH_FAIL_STREAK || 5);
const HONKER_LATENCY_MS = Number(process.env.ALERT_HONKER_LATENCY_MS || 2000);
const QUIET_SECONDS = Number(process.env.ALERT_QUIET_SECONDS || 1800);

const REQUIRED_DAEMONS = [
  "run.pentagon.trigger-bridge",
  "run.factory.honker-relay",
  "run.factory.sasha-skeptic",
  "run.factory.blake-budget-marshal",
  "run.factory.phoenix-todo-keeper",
];

// Cooldowns so we don't flood downstream consumers
const lastAlertAt = new Map();
const ALERT_COOLDOWN_MS = 5 * 60 * 1000;

function log(...args) { console.log(new Date().toISOString(), "[factory-alert]", ...args); }

function panicCheck() {
  if (existsSync(PANIC_FILE)) { log("PANIC file present, exiting"); process.exit(2); }
}

function checkDaemonState(label) {
  const r = spawnSync("launchctl", ["print", `gui/${process.getuid()}/${label}`], { encoding: "utf-8" });
  if (r.status !== 0) return { loaded: false, state: "not-loaded" };
  const state = (r.stdout.match(/^\tstate = (\w+)/m) || [])[1] || "?";
  const pid = (r.stdout.match(/^\tpid = (\d+)/m) || [])[1] || null;
  return { loaded: true, state, pid };
}

function readRecentEvents(sinceMs) {
  const path = resolve(process.env.FACTORY_EVENTS_PATH || "frames/factory-events.jsonl");
  if (!existsSync(path)) return [];
  const cutoff = Date.now() - sinceMs;
  const events = [];
  for (const line of readFileSync(path, "utf-8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const ev = JSON.parse(line);
      if (Date.parse(ev.created_at) >= cutoff) events.push(ev);
    } catch {}
  }
  return events;
}

function computeAlerts() {
  const alerts = [];
  // Daemons
  for (const label of REQUIRED_DAEMONS) {
    const st = checkDaemonState(label);
    if (!st.loaded || st.state !== "running") {
      alerts.push({ code: "daemon_down", severity: "critical", daemon: label, state: st.state, detail: `${label} is ${st.state}` });
    }
  }
  // Cost rate (last hour)
  const hourEvents = readRecentEvents(3600_000);
  const costEvents = hourEvents.filter((e) => e.type === "llm.responded" && e.payload?.behavior === "bridge.runClaude");
  const hourCost = costEvents.reduce((s, e) => s + (e.payload?.cost_usd || 0), 0);
  if (hourCost > COST_PER_HOUR_USD) {
    alerts.push({ code: "cost_burn_high", severity: "warning", hour_cost_usd: hourCost, threshold: COST_PER_HOUR_USD, detail: `$${hourCost.toFixed(2)}/h > $${COST_PER_HOUR_USD}/h cap` });
  }
  // Dispatch failure streak (look at last 10 dispatch results)
  const dispatchEvents = hourEvents.filter((e) => e.type === "behavior.failed" && (e.payload?.reason === "phoenix.dispatch_failed"));
  if (dispatchEvents.length >= DISPATCH_FAIL_STREAK) {
    alerts.push({ code: "phoenix_dispatch_failing", severity: "critical", count: dispatchEvents.length, detail: `${dispatchEvents.length} phoenix.dispatch_failed in last hour` });
  }
  // Honker substrate health
  const healthcheck = spawnSync("node", [resolve("scripts/factory-honker-healthcheck.mjs")], { encoding: "utf-8", timeout: 15000 });
  const out = (healthcheck.stdout || "").trim();
  if (!out.includes("HONKER_HEALTHY")) {
    alerts.push({ code: "honker_degraded", severity: "critical", detail: out });
  } else {
    const latencyMatch = out.match(/latency_ms=(\d+)/);
    const latency = latencyMatch ? Number(latencyMatch[1]) : 0;
    if (latency > HONKER_LATENCY_MS) {
      alerts.push({ code: "honker_slow", severity: "warning", latency_ms: latency, detail: `honker latency ${latency}ms > ${HONKER_LATENCY_MS}ms` });
    }
  }
  // Event log staleness
  const path = resolve(process.env.FACTORY_EVENTS_PATH || "frames/factory-events.jsonl");
  if (existsSync(path)) {
    const ageS = (Date.now() - statSync(path).mtimeMs) / 1000;
    if (ageS > QUIET_SECONDS) {
      alerts.push({ code: "factory_quiet", severity: "info", age_seconds: Math.round(ageS), detail: `no factory events in ${Math.round(ageS / 60)}min` });
    }
  }
  return alerts;
}

async function postWebhook(alerts) {
  if (!ALERT_WEBHOOK || alerts.length === 0) return;
  const text = `:rotating_light: factory alerts:\n` + alerts.map((a) => `• [${a.severity}] ${a.code}: ${a.detail}`).join("\n");
  try {
    const res = await fetch(ALERT_WEBHOOK, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) log("webhook failed:", res.status);
  } catch (err) {
    log("webhook error:", err.message);
  }
}

function writeAlertFile(alerts) {
  mkdirSync(dirname(ALERT_FILE), { recursive: true });
  if (alerts.length === 0) {
    if (existsSync(ALERT_FILE)) {
      try { writeFileSync(ALERT_FILE, ""); } catch {}
    }
    return;
  }
  const payload = {
    updated_at: new Date().toISOString(),
    count: alerts.length,
    alerts,
  };
  writeFileSync(ALERT_FILE, JSON.stringify(payload, null, 2));
}

async function tick() {
  panicCheck();
  try {
    const alerts = computeAlerts();
    writeAlertFile(alerts);
    const now = Date.now();
    const toEmit = alerts.filter((a) => {
      const key = a.code;
      const last = lastAlertAt.get(key) || 0;
      if (now - last < ALERT_COOLDOWN_MS) return false;
      lastAlertAt.set(key, now);
      return true;
    });
    for (const a of toEmit) {
      if (dryRun) {
        log(`[dry-run] would emit alert:`, a.code, a.detail);
        continue;
      }
      emitFactoryEvent({
        type: "infrastructure.factory_alert",
        behavior: "factory-alert",
        reason: `alert.${a.code}`,
        message: a.detail,
        extras: { ...a, alert_code: a.code },
      });
    }
    if (toEmit.length > 0) {
      log(`${toEmit.length} new alerts:`, toEmit.map((a) => a.code).join(", "));
      await postWebhook(toEmit);
    }
  } catch (err) {
    log("tick error:", err.message);
  }
}

async function main() {
  log(`starting (interval=${intervalMs}ms, webhook=${ALERT_WEBHOOK ? "yes" : "no"}, dry-run=${dryRun})`);
  await tick();
  if (once) {
    const alerts = JSON.parse(existsSync(ALERT_FILE) ? readFileSync(ALERT_FILE, "utf-8") || "{}" : "{}");
    console.log(JSON.stringify(alerts, null, 2));
    return;
  }
  setInterval(tick, intervalMs);
  setInterval(panicCheck, 5000);
}

main().catch((err) => {
  console.error(err);
  // H9: the .catch pre-empts the crash-guard's unhandledRejection handler, so
  // emit explicitly. The alerting daemon dying is exactly the failure operators
  // most need surfaced. Wrapped so a broken emitter can't re-throw.
  try {
    emitFactoryEvent({
      type: "script.crash",
      behavior: "factory-alert",
      reason: `script.${err?.name || "Error"}`,
      message: String(err?.message || err),
      extras: { fatal: true, stack: String(err?.stack || "").slice(0, 2000) },
    });
  } catch {}
  process.exit(1);
});
