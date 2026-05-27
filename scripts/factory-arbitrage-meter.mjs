#!/usr/bin/env node
// Per-token arbitrage meter — rolls up llm.responded events into cost
// breakdowns the operator needs before scaling AFK agents.
//
// From CLAUDE.md backlog (IndyDevDan's 5-pillar framework): "Buy a token
// for a dollar, run it through your business, sell the output for two —
// then scale it to the moon. Only AFTER you nail that arbitrage do you
// turn agents on 24/7." Until cost-per-shipped-feature is positive,
// scaling agents just compounds burn.
//
// What this reports:
//   * Total cost (USD) — across all dispatches in the event log
//   * Cost per behavior (bridge.runClaude, bridge.runCodex, t7_medium_gauntlet)
//   * Cost per agent (Maya, Theo, etc.)
//   * Cost per cohort (gpt-5.5-codex-2026-05-22 vs opus-4.7-claude-code-2026-05-27)
//   * Cost per successful T7 medium run (and per added test, per pytest delta)
//   * Failure cost — money burned on dispatches that didn't produce output
//   * Token efficiency — input/output tokens per dollar
//
// Usage:
//   node scripts/factory-arbitrage-meter.mjs                       # full report
//   node scripts/factory-arbitrage-meter.mjs --since 2026-05-27T18:00:00Z
//   node scripts/factory-arbitrage-meter.mjs --json                # raw numbers

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const PATH = resolve(
  process.env.FACTORY_EVENTS_PATH || "frames/factory-events.jsonl"
);
const T7_LEDGER = resolve(
  "frames/t7-native-repetition-progress-medium-cohortB-20260527.jsonl"
);

function arg(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  return idx === -1 ? fallback : process.argv[idx + 1] ?? fallback;
}
function has(name) {
  return process.argv.includes(name);
}

if (!existsSync(PATH)) {
  console.error("No factory events log at " + PATH);
  process.exit(1);
}

const since = arg("--since");
const sinceMs = since ? Date.parse(since) : 0;

const events = readFileSync(PATH, "utf8")
  .trim()
  .split(/\r?\n/)
  .filter(Boolean)
  .map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  })
  .filter((e) => e && Date.parse(e.created_at) >= sinceMs);

const t7Rows = existsSync(T7_LEDGER)
  ? readFileSync(T7_LEDGER, "utf8").trim().split(/\r?\n/).filter(Boolean).map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean)
  : [];

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

const responded = events.filter((e) => e.type === "llm.responded");
const completed = events.filter((e) => e.type === "behavior.completed");
const failed = events.filter((e) => e.type === "behavior.failed");

const totalCost = responded.reduce((acc, e) => acc + num(e.payload.cost_usd), 0);
const totalInputTokens = responded.reduce((acc, e) => acc + num(e.payload.input_tokens), 0);
const totalOutputTokens = responded.reduce((acc, e) => acc + num(e.payload.output_tokens), 0);
const totalCacheRead = responded.reduce((acc, e) => acc + num(e.payload.cache_read_input_tokens), 0);
const totalCacheCreate = responded.reduce((acc, e) => acc + num(e.payload.cache_creation_input_tokens), 0);

function groupBy(arr, keyFn) {
  const out = {};
  for (const x of arr) {
    const k = keyFn(x) || "(unknown)";
    (out[k] ||= []).push(x);
  }
  return out;
}

function costOf(arr) {
  return arr.reduce((acc, e) => acc + num(e.payload.cost_usd), 0);
}

const costByBehavior = Object.fromEntries(
  Object.entries(groupBy(responded, (e) => e.payload.behavior)).map(([k, v]) => [k, { count: v.length, cost_usd: costOf(v) }])
);
const costByAgent = Object.fromEntries(
  Object.entries(groupBy(responded, (e) => e.payload.agent_name)).map(([k, v]) => [k, { count: v.length, cost_usd: costOf(v) }])
);
const costByModel = Object.fromEntries(
  Object.entries(groupBy(responded, (e) => e.payload.model)).map(([k, v]) => [k, { count: v.length, cost_usd: costOf(v) }])
);

const t7Passes = completed.filter((e) => e.payload.behavior === "t7_medium_gauntlet");
const totalTestsAdded = t7Rows.reduce((acc, r) => acc + num(r.new_test_count), 0);
const totalPytestDelta = t7Rows.reduce((acc, r) => acc + (num(r.pytest_after) - num(r.pytest_before)), 0);
// T7 medium runs each take ~2 LLM calls (Maya + Theo auto-ack). Use the
// llm.responded events that come from bridge.runClaude as the cost basis.
const claudeBridgeResponded = responded.filter((e) => e.payload.behavior === "bridge.runClaude");
const claudeBridgeCost = costOf(claudeBridgeResponded);

const failureCost = failed.reduce((acc, e) => {
  // Failed dispatches still burned tokens up to the failure point. Cost
  // sometimes recorded in extras.partial_cost_usd (backfilled events) or
  // in the bridge's per-call cost (not currently captured on failure).
  return acc + num(e.payload.partial_cost_usd);
}, 0);

const report = {
  window: {
    since: since || "all-time",
    total_events: events.length,
    responded_events: responded.length,
    completed_events: completed.length,
    failed_events: failed.length,
  },
  cost: {
    total_usd: Number(totalCost.toFixed(4)),
    bridge_runclaude_usd: Number(claudeBridgeCost.toFixed(4)),
    by_behavior: costByBehavior,
    by_agent: costByAgent,
    by_model: costByModel,
    failure_loss_usd: Number(failureCost.toFixed(4)),
  },
  tokens: {
    input_total: totalInputTokens,
    output_total: totalOutputTokens,
    cache_read_total: totalCacheRead,
    cache_create_total: totalCacheCreate,
    output_per_dollar: totalCost > 0 ? Math.round(totalOutputTokens / totalCost) : null,
    input_per_dollar: totalCost > 0 ? Math.round(totalInputTokens / totalCost) : null,
  },
  t7_medium_gauntlet: t7Rows.length ? {
    runs: t7Rows.length,
    passes: t7Rows.filter((r) => r.outcome === "pass").length,
    new_tests_added: totalTestsAdded,
    pytest_delta_total: totalPytestDelta,
    bridge_runclaude_cost_usd: Number(claudeBridgeCost.toFixed(4)),
    cost_per_run_usd: t7Rows.length ? Number((claudeBridgeCost / t7Rows.length).toFixed(4)) : null,
    cost_per_test_added_usd: totalTestsAdded ? Number((claudeBridgeCost / totalTestsAdded).toFixed(4)) : null,
    cost_per_pytest_increment_usd: totalPytestDelta ? Number((claudeBridgeCost / totalPytestDelta).toFixed(4)) : null,
    note: (
      "Cost per gauntlet run is the dark factory's most concrete arbitrage signal. " +
      "To turn arbitrage positive, output must have monetizable value > this number. " +
      "T7 medium runs add new test coverage but produce no shipped-customer-value yet — " +
      "until activegraph customer features ship via this pipeline (issue #23 backlog), " +
      "every run is pure burn."
    ),
  } : null,
};

if (has("--json")) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

console.log("=== Factory arbitrage meter ===");
console.log("Window:", report.window);
console.log();
console.log("Total cost: $" + report.cost.total_usd.toFixed(4));
console.log("  Output tokens per dollar: " + (report.tokens.output_per_dollar ?? "n/a"));
console.log("  Input tokens per dollar:  " + (report.tokens.input_per_dollar ?? "n/a"));
console.log("  Cache read tokens:        " + report.tokens.cache_read_total);
console.log("  Cache create tokens:      " + report.tokens.cache_create_total);
console.log();
console.log("By behavior:");
for (const [k, v] of Object.entries(report.cost.by_behavior).sort((a, b) => b[1].cost_usd - a[1].cost_usd)) {
  console.log(`  ${k.padEnd(28)} ${String(v.count).padStart(4)} dispatches  $${v.cost_usd.toFixed(4)}`);
}
console.log();
console.log("By agent:");
for (const [k, v] of Object.entries(report.cost.by_agent).sort((a, b) => b[1].cost_usd - a[1].cost_usd)) {
  console.log(`  ${(k || "(unknown)").padEnd(28)} ${String(v.count).padStart(4)} dispatches  $${v.cost_usd.toFixed(4)}`);
}
console.log();
if (report.t7_medium_gauntlet) {
  console.log("=== T7 medium gauntlet arbitrage ===");
  const g = report.t7_medium_gauntlet;
  console.log(`  Runs:                  ${g.runs}  (${g.passes} PASS)`);
  console.log(`  New tests added:       ${g.new_tests_added}`);
  console.log(`  Pytest delta total:    +${g.pytest_delta_total}`);
  console.log(`  Bridge cost total:     $${g.bridge_runclaude_cost_usd}`);
  console.log(`  Cost per run:          $${g.cost_per_run_usd}`);
  console.log(`  Cost per test added:   $${g.cost_per_test_added_usd}`);
  console.log(`  Cost per pytest +1:    $${g.cost_per_pytest_increment_usd}`);
  console.log();
  console.log("  Arbitrage signal: this number is the dark factory's burn rate per");
  console.log("  unit of shipped output. For per-token-arbitrage to be positive,");
  console.log("  the monetizable value of one new test must exceed this cost.");
  console.log("  T7 medium tests today produce coverage, not customer revenue —");
  console.log("  arbitrage is currently NEGATIVE until activegraph customer features");
  console.log("  ship through this pipeline (backlog: 'Ship activegraph issue #23').");
}
