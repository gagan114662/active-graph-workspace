#!/usr/bin/env node
// judge-accuracy.mjs — eval-the-eval CLI (task #16b).
//
// Computes per-judge accuracy from the factory event log:
//   verdicts = count of flywheel.review.completed events per judge
//   errors   = count of judge.error events referencing those verdicts
//   accuracy = 1 - (errors / verdicts)
//
// Per Phil Hetzel (BrainTrust 2026-05-28): "you should eval the eval."
// Judges are themselves events; their track record is itself a statistic
// that can drive a deterministic promotion gate (task #25): a new judge
// model version cannot replace the current one unless its accuracy on a
// frozen ground-truth dataset matches at ≥95%.
//
// Usage:
//   node scripts/judge-accuracy.mjs                 # table
//   node scripts/judge-accuracy.mjs --judge rowan   # one judge in detail
//   node scripts/judge-accuracy.mjs --json          # machine-readable
//   node scripts/judge-accuracy.mjs --since 7d      # time window

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const EVENTS_PATH = resolve(
  process.env.FACTORY_EVENTS_PATH || "frames/factory-events.jsonl"
);

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1] ?? fallback;
}
function has(name) { return process.argv.includes(name); }

const SINCE_SPEC = arg("--since", "30d");
const JUDGE_FILTER = arg("--judge");
const AS_JSON = has("--json");

function parseSince(spec) {
  const m = String(spec).match(/^(\d+)([smhd])$/);
  if (!m) return 30 * 86400_000;
  const n = Number(m[1]);
  return n * ({ s: 1000, m: 60_000, h: 3600_000, d: 86_400_000 }[m[2]]);
}
const SINCE_CUTOFF = Date.now() - parseSince(SINCE_SPEC);

if (!existsSync(EVENTS_PATH)) {
  console.error(`no events log at ${EVENTS_PATH}`);
  process.exit(1);
}

const events = [];
for (const line of readFileSync(EVENTS_PATH, "utf8").split(/\r?\n/)) {
  if (!line.trim()) continue;
  try {
    const ev = JSON.parse(line);
    if (Date.parse(ev.created_at) < SINCE_CUTOFF) continue;
    events.push(ev);
  } catch {}
}

// Index verdicts by judge.
const verdictsByJudge = {};
const verdictsById = new Map();
for (const ev of events) {
  if (ev.type !== "flywheel.review.completed") continue;
  const judge = ev.payload?.judge || "(unknown)";
  if (JUDGE_FILTER && judge !== JUDGE_FILTER) continue;
  if (!verdictsByJudge[judge]) verdictsByJudge[judge] = { pass: 0, fail: 0, total: 0, ids: [] };
  const verdict = ev.payload?.verdict;
  if (verdict === "PASS") verdictsByJudge[judge].pass++;
  else if (verdict === "FAIL") verdictsByJudge[judge].fail++;
  verdictsByJudge[judge].total++;
  verdictsByJudge[judge].ids.push(ev.id);
  verdictsById.set(ev.id, { judge, verdict, event: ev });
}

// Index judge errors by judge + original verdict.
const errorsByJudge = {};
const errorsByKind = {};
for (const ev of events) {
  if (ev.type !== "judge.error") continue;
  const judge = ev.payload?.judge || "(unknown)";
  if (JUDGE_FILTER && judge !== JUDGE_FILTER) continue;
  if (!errorsByJudge[judge]) errorsByJudge[judge] = { false_pass: 0, false_fail: 0, protocol_drift: 0, skipped_when_needed: 0, total: 0, ids: [] };
  const kind = ev.payload?.error_kind || "unknown";
  errorsByJudge[judge][kind] = (errorsByJudge[judge][kind] || 0) + 1;
  errorsByJudge[judge].total++;
  errorsByJudge[judge].ids.push(ev.id);
  errorsByKind[kind] = (errorsByKind[kind] || 0) + 1;
}

// Build report.
const report = { window: SINCE_SPEC, judges: {} };
const allJudges = new Set([...Object.keys(verdictsByJudge), ...Object.keys(errorsByJudge)]);
for (const judge of allJudges) {
  const v = verdictsByJudge[judge] || { pass: 0, fail: 0, total: 0, ids: [] };
  const e = errorsByJudge[judge] || { false_pass: 0, false_fail: 0, protocol_drift: 0, skipped_when_needed: 0, total: 0, ids: [] };
  const accuracy = v.total === 0 ? null : 1 - (e.total / v.total);
  report.judges[judge] = {
    verdicts: { pass: v.pass, fail: v.fail, total: v.total },
    errors: { false_pass: e.false_pass, false_fail: e.false_fail, protocol_drift: e.protocol_drift, skipped_when_needed: e.skipped_when_needed, total: e.total },
    accuracy: accuracy === null ? null : Number(accuracy.toFixed(3)),
  };
}

if (AS_JSON) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

// Pretty render.
console.log(`JUDGE ACCURACY — window=${SINCE_SPEC}, ${events.length} events scanned`);
console.log("");
if (Object.keys(report.judges).length === 0) {
  console.log("(no judge verdicts in window)");
  process.exit(0);
}

console.log("judge      verdicts (P/F)   errors  fp/ff/drift/skip   accuracy");
console.log("-".repeat(75));
for (const [judge, stats] of Object.entries(report.judges).sort((a, b) => b[1].verdicts.total - a[1].verdicts.total)) {
  const v = stats.verdicts;
  const e = stats.errors;
  const acc = stats.accuracy === null ? "  n/a" : (stats.accuracy * 100).toFixed(1).padStart(5) + "%";
  console.log(
    judge.padEnd(10) +
    ` ${String(v.total).padStart(3)} (${String(v.pass).padStart(2)}/${String(v.fail).padStart(2)})   ` +
    `${String(e.total).padStart(3)}    ` +
    `${e.false_pass}/${e.false_fail}/${e.protocol_drift}/${e.skipped_when_needed}`.padEnd(20) +
    ` ${acc}`
  );
}

console.log("");
console.log("legend:");
console.log("  fp = false_pass   (judge PASSED but downstream proved wrong)");
console.log("  ff = false_fail   (judge FAILED but downstream proved would-have-been-fine)");
console.log("  drift = protocol_drift  (judge didn't follow reply contract)");
console.log("  skip = skipped_when_needed  (judge bypassed for a verdict that should have been gated)");

const overallTotal = Object.values(report.judges).reduce((s, j) => s + j.verdicts.total, 0);
const overallErrors = Object.values(report.judges).reduce((s, j) => s + j.errors.total, 0);
if (overallTotal > 0) {
  console.log("");
  const acc = (1 - overallErrors / overallTotal) * 100;
  console.log(`OVERALL: ${overallTotal} verdicts, ${overallErrors} errors, ${acc.toFixed(1)}% accuracy`);
}
