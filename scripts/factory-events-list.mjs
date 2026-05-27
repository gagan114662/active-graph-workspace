#!/usr/bin/env node
// CLI for the factory event log. Lists/filters events from
// frames/factory-events.jsonl.
//
// Usage:
//   node scripts/factory-events-list.mjs                           # last 30 events
//   node scripts/factory-events-list.mjs --tail 100                # last 100
//   node scripts/factory-events-list.mjs --type behavior.failed    # filter by type
//   node scripts/factory-events-list.mjs --reason llm.rate_limited # filter by reason
//   node scripts/factory-events-list.mjs --since 2026-05-27T16:00:00Z
//   node scripts/factory-events-list.mjs --behavior bridge.runClaude
//   node scripts/factory-events-list.mjs --counts                  # histogram only
//   node scripts/factory-events-list.mjs --json                    # raw JSONL

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const PATH = resolve(
  process.env.FACTORY_EVENTS_PATH || "frames/factory-events.jsonl"
);

function arg(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  return idx === -1 ? fallback : process.argv[idx + 1] ?? fallback;
}
function has(name) {
  return process.argv.includes(name);
}

if (!existsSync(PATH)) {
  console.log(`No factory events yet. Path: ${PATH}`);
  process.exit(0);
}

const raw = readFileSync(PATH, "utf8").trim();
if (!raw) {
  console.log(`Factory event log is empty. Path: ${PATH}`);
  process.exit(0);
}

const all = raw.split(/\r?\n/).filter(Boolean).map((line) => {
  try { return JSON.parse(line); } catch { return null; }
}).filter(Boolean);

const typeFilter = arg("--type");
const reasonFilter = arg("--reason");
const behaviorFilter = arg("--behavior");
const since = arg("--since");
const tail = Number(arg("--tail", "30"));

let filtered = all;
if (typeFilter) filtered = filtered.filter((e) => e.type === typeFilter);
if (reasonFilter) filtered = filtered.filter((e) => (e.payload?.reason ?? null) === reasonFilter);
if (behaviorFilter) filtered = filtered.filter((e) => (e.payload?.behavior ?? null) === behaviorFilter);
if (since) {
  const sinceMs = Date.parse(since);
  if (!Number.isNaN(sinceMs)) filtered = filtered.filter((e) => Date.parse(e.created_at) >= sinceMs);
}

if (has("--counts")) {
  const byType = {};
  const byReason = {};
  const byBehavior = {};
  for (const e of filtered) {
    byType[e.type] = (byType[e.type] || 0) + 1;
    const r = e.payload?.reason;
    if (r) byReason[r] = (byReason[r] || 0) + 1;
    const b = e.payload?.behavior;
    if (b) byBehavior[b] = (byBehavior[b] || 0) + 1;
  }
  console.log("=== Total events: " + filtered.length + " ===");
  console.log("By type:");
  for (const [k, v] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(v).padStart(4)}  ${k}`);
  }
  console.log("By reason:");
  for (const [k, v] of Object.entries(byReason).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(v).padStart(4)}  ${k}`);
  }
  console.log("By behavior:");
  for (const [k, v] of Object.entries(byBehavior).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(v).padStart(4)}  ${k}`);
  }
  process.exit(0);
}

if (has("--json")) {
  for (const e of filtered.slice(-tail)) console.log(JSON.stringify(e));
  process.exit(0);
}

const slice = filtered.slice(-tail);
console.log(`=== ${slice.length} of ${filtered.length} matching events (path: ${PATH}) ===\n`);
for (const e of slice) {
  const reason = e.payload?.reason ?? "";
  const behavior = e.payload?.behavior ?? "";
  const msg = String(e.payload?.message ?? "").slice(0, 180);
  console.log(`${e.id}  ${e.created_at}  ${e.type}`);
  if (behavior || reason) {
    console.log(`         behavior=${behavior}  reason=${reason}`);
  }
  if (msg) console.log(`         message: ${msg}`);
  const extras = { ...e.payload };
  delete extras.reason;
  delete extras.behavior;
  delete extras.message;
  const keys = Object.keys(extras).sort();
  if (keys.length) {
    console.log(`         extras: ${keys.slice(0, 8).map((k) => `${k}=${JSON.stringify(extras[k])}`.slice(0, 80)).join(", ")}`);
  }
  console.log();
}
