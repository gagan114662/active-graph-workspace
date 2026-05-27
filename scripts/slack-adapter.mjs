#!/usr/bin/env node
// Slack adapter — posts factory events to a Slack incoming webhook URL.
//
// Pancake-gap-2 from getpancake.ai analysis. Pancake's pitch: "agents
// operate within Slack channels". Today the operator's only visibility
// into the dark factory is the local Pentagon desktop UI + the factory
// event log on disk. This adapter forwards selected event types to
// Slack so the operator can monitor + approve from anywhere.
//
// What it posts (by default):
//   - behavior.failed (any reason)            — alarms
//   - daemon.down                             — alarms
//   - script.crash                            — alarms
//   - script.silently_died                    — alarms
//   - blake.budget_pause                      — budget enforcement
//   - verifier.check_failed                   — verifier red
//
// What it does NOT post (too noisy):
//   - llm.requested / llm.responded / behavior.completed (success path)
//   - script.started / script.shutdown (lifecycle)
//   - daemon.heartbeat (every 5 min)
//
// Usage:
//   SLACK_WEBHOOK_URL="https://hooks.slack.com/services/..." \
//     node scripts/slack-adapter.mjs
//   node scripts/slack-adapter.mjs --dry-run        # log payload, never POST
//   node scripts/slack-adapter.mjs --types behavior.failed,blake.budget_pause
//   node scripts/slack-adapter.mjs --tail-existing  # also forward existing matching events

import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { installCrashGuard } from "./factory-crash-guard.mjs";

installCrashGuard("slack-adapter");

const EVENTS_PATH = resolve(
  process.env.FACTORY_EVENTS_PATH || "frames/factory-events.jsonl"
);

function arg(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  return idx === -1 ? fallback : process.argv[idx + 1] ?? fallback;
}
function has(name) { return process.argv.includes(name); }

const WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL || "";
const POLL_INTERVAL_MS = Number(arg("--poll-interval-ms", "5000"));
const DRY_RUN = has("--dry-run") || !WEBHOOK_URL;
const TAIL_EXISTING = has("--tail-existing");
const TYPES = (arg("--types") || "behavior.failed,daemon.down,script.crash,script.silently_died,blake.budget_pause,verifier.check_failed").split(",").map((s) => s.trim());

let lastSize = 0;
let posted = 0;
let skipped = 0;

function shouldForward(ev) {
  return TYPES.includes(ev.type);
}

function formatMessage(ev) {
  const lines = [];
  const emoji = ev.type === "behavior.failed" ? ":x:"
    : ev.type === "script.crash" || ev.type === "script.silently_died" ? ":boom:"
    : ev.type === "daemon.down" ? ":fire:"
    : ev.type === "blake.budget_pause" ? ":money_with_wings:"
    : ev.type === "verifier.check_failed" ? ":mag:"
    : ":bell:";
  const behavior = ev.payload?.behavior || "(unknown)";
  const reason = ev.payload?.reason || "";
  const message = (ev.payload?.message || "").slice(0, 300);
  lines.push(`${emoji} *${ev.type}*  \`${behavior}\``);
  if (reason) lines.push(`> reason: \`${reason}\``);
  if (message) lines.push(`> ${message}`);
  lines.push(`> _event: ${ev.id} @ ${ev.created_at}_`);
  return { text: lines.join("\n") };
}

async function post(payload) {
  if (DRY_RUN) {
    console.log("[slack-adapter] [dry-run] would POST:", JSON.stringify(payload).slice(0, 400));
    return;
  }
  try {
    const res = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error(`[slack-adapter] POST failed: ${res.status} ${await res.text()}`);
    }
  } catch (err) {
    console.error("[slack-adapter] POST error:", err.message);
  }
}

async function forwardEvent(ev) {
  if (!shouldForward(ev)) {
    skipped++;
    return;
  }
  await post(formatMessage(ev));
  posted++;
}

async function pollNewEvents() {
  if (!existsSync(EVENTS_PATH)) return;
  const stats = statSync(EVENTS_PATH);
  if (stats.size <= lastSize) return;
  const all = readFileSync(EVENTS_PATH, "utf8");
  const newBuf = stats.size < lastSize ? all : all.slice(lastSize);
  lastSize = stats.size;
  for (const line of newBuf.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      await forwardEvent(JSON.parse(line));
    } catch {}
  }
}

if (existsSync(EVENTS_PATH)) {
  lastSize = TAIL_EXISTING ? 0 : statSync(EVENTS_PATH).size;
}

console.log(JSON.stringify({
  status: "slack_adapter_started",
  webhook_configured: Boolean(WEBHOOK_URL),
  dry_run: DRY_RUN,
  poll_interval_ms: POLL_INTERVAL_MS,
  forwarded_types: TYPES,
  tail_existing: TAIL_EXISTING,
}));

await pollNewEvents();
const interval = setInterval(() => pollNewEvents().catch(() => {}), POLL_INTERVAL_MS);

function shutdown(signal) {
  console.log(JSON.stringify({ status: "slack_adapter_shutting_down", signal, posted, skipped }));
  clearInterval(interval);
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
