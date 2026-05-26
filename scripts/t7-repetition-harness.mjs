#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  classifyT7LedgerRows,
  computeT7ProgressMetrics,
  decideRetryAction,
} from "./t7-repetition-classifier.mjs";

function arg(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  return idx === -1 ? fallback : process.argv[idx + 1] ?? fallback;
}

function has(name) {
  return process.argv.includes(name);
}

export function readJsonl(path) {
  const text = readFileSync(path, "utf8").trim();
  if (!text) return [];
  return text.split(/\n/).map((line) => JSON.parse(line));
}

export function summarizeProgress(rows) {
  const metrics = computeT7ProgressMetrics(rows);
  return {
    pass_count: metrics.pass_count,
    agent_failure_count: metrics.agent_failure_count,
    infra_retry_count: metrics.infra_retry_count,
    total_run_attempts: metrics.total_run_attempts,
    pass_rate: metrics.pass_rate,
    infrastructure_failure_rate: metrics.infrastructure_failure_rate,
  };
}

export function classifyRowsForLedger(rows) {
  return classifyT7LedgerRows(rows).map((row) => ({
    run_idx: row.run_idx,
    hash: row.hash,
    target_symbol: row.target_symbol,
    outcome: row.outcome,
    outcome_class: row.outcome_class,
    agent_failure_root_cause: row.agent_failure_root_cause ?? null,
    infrastructure_failure_root_cause: row.infrastructure_failure_root_cause ?? null,
  }));
}

function printSummary(rows) {
  const summary = summarizeProgress(rows);
  console.log(JSON.stringify({
    ...summary,
    pass_rate_percent: summary.pass_rate === null ? null : Number((summary.pass_rate * 100).toFixed(1)),
    infrastructure_failure_rate_percent: summary.infrastructure_failure_rate === null
      ? null
      : Number((summary.infrastructure_failure_rate * 100).toFixed(1)),
  }, null, 2));
}

function printRetryDecision(rows) {
  const runIdx = Number(arg("--run-idx", "0"));
  const attempts = runIdx
    ? rows.filter((row) => row.run_idx === runIdx || row.retry_of_run_idx === runIdx)
    : rows;
  console.log(JSON.stringify(decideRetryAction(attempts), null, 2));
}

export function main() {
  const ledger = arg("--ledger", "frames/t7-native-repetition-progress-20260525.jsonl");
  const rows = readJsonl(ledger);
  if (has("--classify")) {
    console.log(JSON.stringify(classifyRowsForLedger(rows), null, 2));
    return;
  }
  if (has("--retry-decision")) {
    printRetryDecision(rows);
    return;
  }
  printSummary(rows);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
