#!/usr/bin/env node
// factory-health.mjs — one-screen answer to "what is the factory doing right now?"
//
// Shows:
//   * which daemons are alive (LaunchAgent state + PID)
//   * recent factory events grouped by type (last hour by default)
//   * open todos count by agent + priority
//   * recent dispatches + outcomes
//   * Blake's current cost totals (hour/day/session-since-start)
//
// Usage:
//   node scripts/factory-health.mjs           # default: last 1h window
//   node scripts/factory-health.mjs --since 4h
//   node scripts/factory-health.mjs --json    # machine-readable

import { execSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1] ?? fallback;
}
function has(name) { return process.argv.includes(name); }

const SINCE_SPEC = arg("--since", "1h");
const AS_JSON = has("--json");

function parseSince(spec) {
  const m = String(spec).match(/^(\d+)([smhd])$/);
  if (!m) return 3600_000;
  const n = Number(m[1]);
  const mult = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2]];
  return n * mult;
}
const SINCE_MS = parseSince(SINCE_SPEC);
const SINCE_CUTOFF = Date.now() - SINCE_MS;

const DAEMONS = [
  { label: "run.pentagon.trigger-bridge", role: "Pentagon dispatch (claims triggers, runs claude/codex)" },
  { label: "run.factory.honker-relay", role: "JSONL → SQLite + watcher (realtime substrate)" },
  { label: "run.factory.sasha-skeptic", role: "monitors failures, emits todo.created" },
  { label: "run.factory.blake-budget-marshal", role: "watches cost, can pause bridge on cap breach" },
  { label: "run.factory.phoenix-todo-keeper", role: "maintains todo list, dispatches via Pentagon REST" },
];

function checkDaemon(label) {
  try {
    const out = execSync(
      `launchctl print gui/$(id -u)/${label}`,
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
    const state = (out.match(/^\tstate = (\w+)/m) || [])[1] || "?";
    const pid = (out.match(/^\tpid = (\d+)/m) || [])[1] || null;
    const lastExit = (out.match(/^\tlast exit code = ([\-\d]+)/m) || [])[1] || null;
    return { loaded: true, state, pid, last_exit: lastExit };
  } catch {
    return { loaded: false, state: "not-loaded", pid: null, last_exit: null };
  }
}

function readFactoryEvents() {
  const path = resolve(process.env.FACTORY_EVENTS_PATH || "frames/factory-events.jsonl");
  if (!existsSync(path)) return [];
  // For performance, slice from end. Read whole file but only keep events within window.
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  const events = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const ev = JSON.parse(line);
      if (Date.parse(ev.created_at) >= SINCE_CUTOFF) events.push(ev);
    } catch {}
  }
  return events;
}

function readTodos() {
  const path = resolve(process.env.FACTORY_TODOS_PATH || "frames/factory-todos.jsonl");
  if (!existsSync(path)) return [];
  const rows = [];
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch {}
  }
  return rows;
}

// Inner-layer llm.responded emissions that duplicate the outermost
// bridge.runClaude emit. Pre-2026-05-28 dispatches emit at all three
// labels; the FACTORY_SUPPRESS_LLM_RESPONDED_EMIT env var fix stops it
// for new dispatches but historical events stay triple-counted. Skip
// the inner labels here so the $$$ line matches Blake's view + reality.
const COST_EMIT_INNER_LAYERS = new Set([
  "bridge.runClaude.via.bridge_dispatch.py",
  "activegraph.ClaudeCodeCliProvider",
]);

function summarizeEvents(events) {
  const byType = {};
  const byReason = {};
  let costInWindow = 0;
  for (const ev of events) {
    byType[ev.type] = (byType[ev.type] || 0) + 1;
    if (ev.payload?.reason) {
      byReason[ev.payload.reason] = (byReason[ev.payload.reason] || 0) + 1;
    }
    if (ev.type === "llm.responded" && ev.payload?.cost_usd) {
      if (COST_EMIT_INNER_LAYERS.has(ev.payload?.behavior)) continue;
      costInWindow += Number(ev.payload.cost_usd);
    }
  }
  return { byType, byReason, costInWindow };
}

function summarizeTodos(todos) {
  const open = todos.filter((t) => !t.completed_at);
  const completed = todos.filter((t) => t.completed_at);
  const dispatched = open.filter((t) => t.dispatched_at);
  const byAgent = {};
  const byPriority = { p0: 0, p1: 0, p2: 0 };
  for (const t of open) {
    byAgent[t.recommended_agent] = (byAgent[t.recommended_agent] || 0) + 1;
    if (t.priority) byPriority[t.priority] = (byPriority[t.priority] || 0) + 1;
  }
  // Last 5 dispatches by dispatched_at
  const recentDispatches = todos
    .filter((t) => t.dispatched_at)
    .sort((a, b) => (b.dispatched_at || "").localeCompare(a.dispatched_at || ""))
    .slice(0, 5)
    .map((t) => ({
      todo_id: t.id,
      agent: t.recommended_agent,
      dispatched_at: t.dispatched_at,
      done: !!t.completed_at,
      receipt_string_present: t.receipt_string_present ?? null,
    }));
  return {
    total: todos.length,
    open: open.length,
    completed: completed.length,
    dispatched_open: dispatched.length,
    by_agent: byAgent,
    by_priority: byPriority,
    recent_dispatches: recentDispatches,
  };
}

// --- Render ---

const daemonStatus = DAEMONS.map((d) => ({ ...d, ...checkDaemon(d.label) }));
const events = readFactoryEvents();
const todos = readTodos();
const eventSummary = summarizeEvents(events);
const todoSummary = summarizeTodos(todos);

const report = {
  generated_at: new Date().toISOString(),
  window: SINCE_SPEC,
  daemons: daemonStatus,
  events_in_window: {
    total: events.length,
    by_type: eventSummary.byType,
    by_reason: eventSummary.byReason,
    cost_usd: Number(eventSummary.costInWindow.toFixed(4)),
  },
  todos: todoSummary,
};

if (AS_JSON) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

// Pretty render.
const aliveCount = daemonStatus.filter((d) => d.state === "running").length;
const totalDaemons = daemonStatus.length;
const verdictColor = aliveCount === totalDaemons ? "\x1b[32m" : aliveCount > 0 ? "\x1b[33m" : "\x1b[31m";
const RESET = "\x1b[0m";

console.log(`${verdictColor}FACTORY HEALTH${RESET}  ${aliveCount}/${totalDaemons} daemons alive  window=${SINCE_SPEC}  generated=${report.generated_at}`);
console.log();
console.log("DAEMONS");
for (const d of daemonStatus) {
  const mark = d.state === "running" ? "\x1b[32m●\x1b[0m" : d.loaded ? "\x1b[33m●\x1b[0m" : "\x1b[31m○\x1b[0m";
  const pidStr = d.pid ? `pid=${d.pid}` : "no-pid";
  console.log(`  ${mark} ${d.label.padEnd(36)} ${d.state.padEnd(12)} ${pidStr.padEnd(10)} — ${d.role}`);
}

console.log();
console.log(`EVENTS (last ${SINCE_SPEC}, ${events.length} total, $${eventSummary.costInWindow.toFixed(2)} spent)`);
const topTypes = Object.entries(eventSummary.byType).sort((a, b) => b[1] - a[1]).slice(0, 8);
for (const [t, n] of topTypes) {
  console.log(`  ${String(n).padStart(4)}  ${t}`);
}
if (Object.keys(eventSummary.byReason).length) {
  console.log();
  console.log("  failure reasons:");
  const topReasons = Object.entries(eventSummary.byReason).sort((a, b) => b[1] - a[1]).slice(0, 6);
  for (const [r, n] of topReasons) {
    console.log(`  ${String(n).padStart(4)}  ${r}`);
  }
}

console.log();
console.log(`TODOS  total=${todoSummary.total}  open=${todoSummary.open}  completed=${todoSummary.completed}  dispatched-open=${todoSummary.dispatched_open}`);
if (Object.keys(todoSummary.by_agent).length) {
  const agents = Object.entries(todoSummary.by_agent).sort((a, b) => b[1] - a[1]);
  console.log(`  by agent:    ${agents.map(([a, n]) => `${a}=${n}`).join(", ")}`);
}
const pri = todoSummary.by_priority;
console.log(`  by priority: p0=${pri.p0 || 0}, p1=${pri.p1 || 0}, p2=${pri.p2 || 0}`);

if (todoSummary.recent_dispatches.length) {
  console.log();
  console.log("RECENT DISPATCHES");
  for (const d of todoSummary.recent_dispatches) {
    const status = d.done ? "✓ done" : "open ";
    const receipt = d.receipt_string_present === false ? " [no-receipt]" : "";
    console.log(`  ${d.dispatched_at}  ${status}  ${d.agent.padEnd(8)}  ${d.todo_id}${receipt}`);
  }
}

console.log();
const anyDispatched = todoSummary.dispatched_open > 0 || todoSummary.recent_dispatches.length > 0;
const phoenixAlive = daemonStatus.find((d) => d.label === "run.factory.phoenix-todo-keeper")?.state === "running";
const sashaAlive = daemonStatus.find((d) => d.label === "run.factory.sasha-skeptic")?.state === "running";
const relayAlive = daemonStatus.find((d) => d.label === "run.factory.honker-relay")?.state === "running";
const bridgeAlive = daemonStatus.find((d) => d.label === "run.pentagon.trigger-bridge")?.state === "running";

let verdict;
if (aliveCount === totalDaemons && anyDispatched) {
  verdict = "factory is RUNNING and producing work";
} else if (aliveCount === totalDaemons) {
  verdict = "factory is ALIVE but no dispatches yet (waiting for failures)";
} else if (bridgeAlive && relayAlive && sashaAlive && phoenixAlive) {
  verdict = "core loop is alive (Blake optional)";
} else if (bridgeAlive && !relayAlive) {
  verdict = "bridge running but no realtime substrate — Phoenix can't see new events. Run scripts/factory-activate.sh";
} else if (!bridgeAlive) {
  verdict = "BRIDGE DOWN — Pentagon dispatch is offline. launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/run.pentagon.trigger-bridge.plist";
} else {
  verdict = `${totalDaemons - aliveCount} daemon(s) down — run scripts/factory-activate.sh`;
}
console.log(`VERDICT: ${verdict}`);
