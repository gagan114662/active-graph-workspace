#!/usr/bin/env node
// Operator-issued canary probe (Gap P).
//
// Emits a synthetic-but-canary-authorized event so the full factory loop
// (Sasha → todo → Phoenix → dispatch → completion) runs end-to-end on a
// controlled payload. Use to verify the closed loop is working in production
// without waiting for a real failure.
//
// Distinguishes from emitSyntheticProbe (test scaffolding, short-circuited)
// via extras.canary_authorized=true. The routing config has an explicit
// `canary_probe_authorized` rule matching the combination.
//
// Usage:
//   node scripts/factory-canary.mjs --reason script.crash
//   node scripts/factory-canary.mjs --reason verifier.check_failed --behavior canary-test
//   node scripts/factory-canary.mjs --reason script.crash --watch 60s
//
// --watch <DURATION>: poll factory-todos for matching todo and report
// dispatch + completion latency. Exits 0 on full closure within window,
// 1 on partial, 2 on no-todo-created. Useful in CI/cron.

import { emitCanaryProbe } from "./factory-events.mjs";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  if (i < 0) return fallback;
  return process.argv[i + 1];
}

const reason = arg("--reason");
if (!reason) {
  console.error("required: --reason <reason_code>");
  console.error("examples: script.crash, verifier.check_failed, agent.satisfaction_of_search");
  process.exit(64);
}

const behavior = arg("--behavior", "factory-canary");
const message = arg("--message", `canary probe — operator end-to-end test of ${reason}`);
const watchSpec = arg("--watch");

function parseDuration(spec) {
  if (!spec) return 0;
  const m = String(spec).match(/^(\d+)(s|m|h)?$/);
  if (!m) return 0;
  const n = Number(m[1]);
  const unit = m[2] || "s";
  if (unit === "s") return n * 1000;
  if (unit === "m") return n * 60 * 1000;
  if (unit === "h") return n * 60 * 60 * 1000;
  return 0;
}

const watchMs = parseDuration(watchSpec);

const ev = emitCanaryProbe(reason, {
  behavior,
  message,
  extras: { operator_initiated: true },
});

console.log(JSON.stringify({
  status: "canary_emitted",
  event_id: ev.id,
  reason,
  behavior,
  canary_id: ev.payload.canary_id,
  watch_window_ms: watchMs,
}));

if (!watchMs) process.exit(0);

const TODOS_PATH = resolve("frames/factory-todos.jsonl");

function findCanaryTodo() {
  if (!existsSync(TODOS_PATH)) return null;
  const lines = readFileSync(TODOS_PATH, "utf-8").split("\n").filter(Boolean);
  for (const line of lines) {
    try {
      const row = JSON.parse(line);
      if (row.failure_event_id === ev.id) return row;
    } catch {}
  }
  return null;
}

const start = Date.now();
let dispatchedAt = null;
let completedAt = null;

async function poll() {
  while (Date.now() - start < watchMs) {
    const t = findCanaryTodo();
    if (t) {
      if (t.dispatched_at && !dispatchedAt) {
        dispatchedAt = t.dispatched_at;
        console.log(JSON.stringify({ status: "canary_dispatched", todo_id: t.event_id, dispatched_at: dispatchedAt, latency_ms: Date.parse(dispatchedAt) - Date.parse(ev.created_at) }));
      }
      if (t.completed_at) {
        completedAt = t.completed_at;
        console.log(JSON.stringify({ status: "canary_completed", todo_id: t.event_id, completed_at: completedAt, latency_ms: Date.parse(completedAt) - Date.parse(ev.created_at) }));
        process.exit(0);
      }
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!dispatchedAt) {
    console.log(JSON.stringify({ status: "canary_no_dispatch", message: "no matching todo was dispatched within watch window" }));
    process.exit(2);
  }
  console.log(JSON.stringify({ status: "canary_partial", dispatched_at: dispatchedAt, message: "dispatched but never completed" }));
  process.exit(1);
}

poll().catch((e) => { console.error(e); process.exit(1); });
