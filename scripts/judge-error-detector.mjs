#!/usr/bin/env node
// judge-error-detector.mjs — Gap E from the audit + part of task #16b.
//
// Watches the event log + inner repo git history for signals that a
// judge's verdict was wrong:
//
//   1. Rowan PASSED a flywheel commit, but the commit was later reverted
//      by a human reviewer (git log finds "Revert ... <sha>") → emit
//      judge.error error_kind=false_pass.
//
//   2. Rowan PASSED a flywheel commit, but a behavior.failed event with
//      the same dedup_key as the original failure lands within 24h →
//      emit judge.error error_kind=false_pass ("fix didn't actually fix").
//
//   3. Rowan FAILED a flywheel diff, the operator looked at it and merged
//      anyway via manual cherry-pick → operator can manually emit
//      judge.error error_kind=false_fail. (Not auto-detected v1.)
//
// Idempotent: tracks already-emitted judge.error events by
// original_verdict_event_id so re-running this scanner doesn't double-emit.
//
// Usage:
//   node scripts/judge-error-detector.mjs            # one-shot scan + report + emit
//   node scripts/judge-error-detector.mjs --dry-run  # report only
//   node scripts/judge-error-detector.mjs --since 7d # window

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const REPO_ROOT = process.env.FACTORY_REPO || "/Users/gaganarora/Desktop/my projects/active_graph";
const INNER_REPO = `${REPO_ROOT}/activegraph`;
const EVENTS_PATH = resolve(
  process.env.FACTORY_EVENTS_PATH || `${REPO_ROOT}/frames/factory-events.jsonl`
);

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1] ?? fallback;
}
function has(name) { return process.argv.includes(name); }

const DRY_RUN = has("--dry-run");
const SINCE_SPEC = arg("--since", "30d");
function parseSince(spec) {
  const m = String(spec).match(/^(\d+)([smhd])$/);
  if (!m) return 30 * 86400_000;
  return Number(m[1]) * ({ s: 1000, m: 60_000, h: 3600_000, d: 86_400_000 }[m[2]]);
}
const SINCE_CUTOFF = Date.now() - parseSince(SINCE_SPEC);

if (!existsSync(EVENTS_PATH)) {
  console.error(`no events at ${EVENTS_PATH}`);
  process.exit(1);
}

const events = readFileSync(EVENTS_PATH, "utf8")
  .split(/\r?\n/)
  .filter(Boolean)
  .map((l) => { try { return JSON.parse(l); } catch { return null; } })
  .filter(Boolean);

// Index: for each Rowan PASS verdict, what todo was it for and what commit did
// the todo produce?
const verdictById = new Map();
for (const ev of events) {
  if (ev.type !== "flywheel.review.completed") continue;
  if (Date.parse(ev.created_at) < SINCE_CUTOFF) continue;
  if (ev.payload?.verdict !== "PASS") continue;
  verdictById.set(ev.id, ev);
}

const todoToCommit = new Map();
const todoToDedupKey = new Map();
for (const ev of events) {
  if (ev.type !== "flywheel.commit.landed" && ev.type !== "flywheel.commit.local_only") continue;
  const todoId = ev.payload?.todo_event_id;
  const sha = ev.payload?.sha;
  if (todoId && sha) {
    todoToCommit.set(todoId, sha);
  }
}
for (const ev of events) {
  if (ev.type !== "todo.created") continue;
  const todoRowId = `todo_${ev.id}`;
  todoToDedupKey.set(todoRowId, ev.payload?.dedup_key || null);
}

// Index: already-emitted judge.error events so we're idempotent.
const alreadyErrored = new Set();
for (const ev of events) {
  if (ev.type !== "judge.error") continue;
  if (ev.payload?.original_verdict_event_id) {
    alreadyErrored.add(ev.payload.original_verdict_event_id);
  }
}

// Signal 1: was the commit reverted by a human?
const gitLog = spawnSync(
  "git",
  ["log", "--oneline", "--all", "--since", new Date(SINCE_CUTOFF).toISOString()],
  { cwd: INNER_REPO, encoding: "utf8" }
);
const revertedShas = new Set();
for (const line of (gitLog.stdout || "").split("\n")) {
  const m = line.match(/Revert\s+["']?([a-f0-9]{7,40})/i) || line.match(/revert\s+commit\s+([a-f0-9]{7,40})/i);
  if (m) revertedShas.add(m[1].slice(0, 12));
}

// Signal 2: a behavior.failed within 24h whose dedup_key matches a Rowan-passed fix.
const failuresByDedupKey = new Map();
for (const ev of events) {
  if (ev.type !== "behavior.failed") continue;
  const dk = ev.payload?.dedup_key || null;  // failures usually don't carry dedup_key
  // Failures typically don't have dedup_key on the failure event itself —
  // it's computed by Sasha. Fall back to constructing the same dedup_key
  // shape: reason::behavior::msg_prefix.
  const reason = ev.payload?.reason;
  const behavior = ev.payload?.behavior;
  const msgPrefix = String(ev.payload?.message || "").slice(0, 32);
  const constructed = `${reason}::${behavior}::${msgPrefix}`;
  if (!failuresByDedupKey.has(constructed)) failuresByDedupKey.set(constructed, []);
  failuresByDedupKey.get(constructed).push(ev);
}

// Cross-reference each Rowan PASS verdict against signals.
const newErrors = [];
for (const [verdictEventId, verdictEvent] of verdictById) {
  if (alreadyErrored.has(verdictEventId)) continue;
  const todoId = verdictEvent.payload?.todo_event_id;
  if (!todoId) continue;
  const sha = todoToCommit.get(todoId);
  if (!sha) continue;

  // Signal 1: revert detection.
  if (revertedShas.has(sha.slice(0, 12))) {
    newErrors.push({
      verdict_event_id: verdictEventId,
      todo_id: todoId,
      sha,
      kind: "false_pass",
      reason: "commit was reverted in git history",
      signal: "revert_detected",
    });
    continue;
  }

  // Signal 2: same-dedup-key behavior.failed within 24h after the verdict.
  const dedupKey = todoToDedupKey.get(todoId);
  if (dedupKey) {
    const verdictTs = Date.parse(verdictEvent.created_at);
    const window = verdictTs + 86_400_000;
    const matches = (failuresByDedupKey.get(dedupKey) || []).filter((f) => {
      const ft = Date.parse(f.created_at);
      return ft > verdictTs && ft < window;
    });
    if (matches.length > 0) {
      newErrors.push({
        verdict_event_id: verdictEventId,
        todo_id: todoId,
        sha,
        kind: "false_pass",
        reason: `behavior.failed re-landed within 24h with matching dedup_key (${matches.length} occurrences)`,
        signal: "regression_detected",
        downstream_event_id: matches[0].id,
      });
    }
  }
}

// Report.
console.log(`JUDGE ERROR DETECTOR — window=${SINCE_SPEC}, scanned ${events.length} events`);
console.log(`  Rowan PASS verdicts in window: ${verdictById.size}`);
console.log(`  Already-errored verdicts:       ${alreadyErrored.size}`);
console.log(`  Reverted shas in git log:       ${revertedShas.size}`);
console.log(`  New errors to emit:             ${newErrors.length}`);
console.log("");
if (newErrors.length === 0) {
  console.log("(no new judge errors to emit — judges' track records remain unchanged)");
  process.exit(0);
}

if (DRY_RUN) {
  console.log("DRY-RUN — would emit:");
  for (const e of newErrors) {
    console.log(`  ${e.kind} for ${e.verdict_event_id} (${e.signal}): ${e.reason}`);
  }
  process.exit(0);
}

const factoryEvents = await import("./factory-events.mjs");
for (const e of newErrors) {
  const ev = factoryEvents.emitJudgeError({
    judge: "rowan",
    original_verdict_event_id: e.verdict_event_id,
    downstream_evidence_event_id: e.downstream_event_id || null,
    error_kind: e.kind,
    message: e.reason,
    extras: {
      todo_event_id: e.todo_id,
      commit_sha: e.sha,
      signal: e.signal,
    },
  });
  console.log(`emitted ${ev.id}: ${e.kind} (${e.signal})`);
}
