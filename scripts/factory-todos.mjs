#!/usr/bin/env node
// Query the never-ending todo list maintained by phoenix-todo-keeper.
//
// Usage:
//   node scripts/factory-todos.mjs                       # open todos, table
//   node scripts/factory-todos.mjs --all                 # include completed
//   node scripts/factory-todos.mjs --agent maya          # filter by agent
//   node scripts/factory-todos.mjs --priority p1         # filter by priority
//   node scripts/factory-todos.mjs --reason script.crash # filter by failure reason
//   node scripts/factory-todos.mjs --json                # raw JSON-per-line
//   node scripts/factory-todos.mjs --counts              # summary counts only

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const TODOS_PATH = resolve(
  process.env.FACTORY_TODOS_PATH || "frames/factory-todos.jsonl"
);

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1] ?? fallback;
}
function has(name) { return process.argv.includes(name); }

const INCLUDE_COMPLETED = has("--all");
const FILTER_AGENT = arg("--agent");
const FILTER_PRIORITY = arg("--priority");
const FILTER_REASON = arg("--reason");
const AS_JSON = has("--json");
const COUNTS_ONLY = has("--counts");

if (!existsSync(TODOS_PATH)) {
  console.error(`todos file not found: ${TODOS_PATH}`);
  console.error("(phoenix-todo-keeper hasn't started yet, or no todos created)");
  process.exit(0);
}

const rows = [];
for (const line of readFileSync(TODOS_PATH, "utf8").split(/\r?\n/)) {
  if (!line.trim()) continue;
  try { rows.push(JSON.parse(line)); } catch {}
}

let filtered = rows;
if (!INCLUDE_COMPLETED) filtered = filtered.filter((r) => !r.completed_at);
if (FILTER_AGENT) filtered = filtered.filter((r) => r.recommended_agent === FILTER_AGENT);
if (FILTER_PRIORITY) filtered = filtered.filter((r) => r.priority === FILTER_PRIORITY);
if (FILTER_REASON) filtered = filtered.filter((r) => r.failure_reason === FILTER_REASON);

if (COUNTS_ONLY) {
  const open = rows.filter((r) => !r.completed_at);
  const completed = rows.filter((r) => r.completed_at);
  const by_agent = {};
  const by_priority = { p0: 0, p1: 0, p2: 0 };
  const by_reason = {};
  for (const r of open) {
    by_agent[r.recommended_agent] = (by_agent[r.recommended_agent] || 0) + 1;
    if (r.priority) by_priority[r.priority] = (by_priority[r.priority] || 0) + 1;
    if (r.failure_reason)
      by_reason[r.failure_reason] = (by_reason[r.failure_reason] || 0) + 1;
  }
  console.log(JSON.stringify({
    total: rows.length,
    open: open.length,
    completed: completed.length,
    by_agent,
    by_priority,
    by_reason,
  }, null, 2));
  process.exit(0);
}

if (AS_JSON) {
  for (const r of filtered) console.log(JSON.stringify(r));
  process.exit(0);
}

if (filtered.length === 0) {
  console.log("(no todos match)");
  process.exit(0);
}

// Sort: open first (priority desc), then completed
filtered.sort((a, b) => {
  if (!!a.completed_at !== !!b.completed_at) return a.completed_at ? 1 : -1;
  const p = { p0: 0, p1: 1, p2: 2 };
  const pa = p[a.priority] ?? 9;
  const pb = p[b.priority] ?? 9;
  if (pa !== pb) return pa - pb;
  return (b.occurrences || 1) - (a.occurrences || 1);
});

console.log(
  ["pri", "agent", "occ", "reason", "title", "status"].join("\t")
);
for (const r of filtered) {
  const status = r.completed_at ? "✓ done" : "open";
  const title = (r.title || "").slice(0, 90);
  console.log(
    [
      r.priority || "?",
      r.recommended_agent || "?",
      r.occurrences || 1,
      r.failure_reason || "?",
      title,
      status,
    ].join("\t")
  );
}
