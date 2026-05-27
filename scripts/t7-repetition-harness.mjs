#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";
import {
  INFRA_ROOT_LATE_ACK_AFTER_TRIGGER_COMPLETED,
  OUTCOME_INFRASTRUCTURE_RETRY,
  OUTCOME_PASS,
  classifyT7LedgerRows,
  computeT7ProgressMetrics,
  decideRetryAction,
} from "./t7-repetition-classifier.mjs";

const REPO_ROOT = process.env.T7_REPO_ROOT || process.cwd();
const INNER_REPO_DIR = process.env.T7_INNER_REPO_DIR || "activegraph";

function gitCheck(args) {
  const result = spawnSync("git", ["-C", INNER_REPO_DIR, ...args], { cwd: REPO_ROOT, encoding: "utf8" });
  return { status: result.status ?? -1, stdout: String(result.stdout ?? "").trim(), stderr: String(result.stderr ?? "").trim() };
}

// Default work-at-HEAD resolver. Verifies all three signals:
//   1. agent_commit_sha resolves in the inner repo
//   2. test_file exists in inner repo's HEAD tree
//   3. proof_file exists on the filesystem
export function defaultLateAckResolver(row) {
  if (!row?.agent_commit_sha || !row?.test_file) {
    return { resolved: false, reason: "missing_evidence_fields", checks: { agent_commit_sha: Boolean(row?.agent_commit_sha), test_file: Boolean(row?.test_file) } };
  }
  const commitCheck = gitCheck(["cat-file", "-e", row.agent_commit_sha + "^{commit}"]);
  if (commitCheck.status !== 0) {
    return { resolved: false, reason: "commit_not_in_inner_repo", checks: { commit_status: commitCheck.status } };
  }
  // The recorded test_file path is typically "activegraph/tests/..." which is
  // already inner-repo-relative (the inner repo root contains an "activegraph"
  // dir; this is the convention used throughout the codebase).
  const treeCheck = gitCheck(["cat-file", "-e", "HEAD:" + row.test_file]);
  if (treeCheck.status !== 0) {
    return { resolved: false, reason: "test_file_not_at_head", checks: { test_file_status: treeCheck.status, path_checked: row.test_file } };
  }
  // Proof file may be at either outer or inner path; try both.
  const proofVariants = [
    row.proof_file,
    resolvePath(REPO_ROOT, row.proof_file),
    resolvePath(REPO_ROOT, INNER_REPO_DIR, row.proof_file),
  ].filter(Boolean);
  const proofExists = proofVariants.some((p) => existsSync(p));
  if (!proofExists) {
    return { resolved: false, reason: "proof_file_not_on_disk", checks: { proof_variants_tried: proofVariants } };
  }
  return {
    resolved: true,
    reason: "work_at_head",
    checks: {
      agent_commit_sha: row.agent_commit_sha,
      test_file: row.test_file,
      proof_file_found: proofVariants.find((p) => existsSync(p)),
    },
  };
}

export function applyLateAckResolution(rows, { lateAckResolver = defaultLateAckResolver } = {}) {
  const classified = classifyT7LedgerRows(rows);
  return classified.map((row) => {
    if (
      row.outcome_class === OUTCOME_INFRASTRUCTURE_RETRY &&
      row.infrastructure_failure_root_cause === INFRA_ROOT_LATE_ACK_AFTER_TRIGGER_COMPLETED
    ) {
      const resolution = lateAckResolver(row);
      if (resolution?.resolved) {
        return {
          ...row,
          outcome_class: OUTCOME_PASS,
          outcome: OUTCOME_PASS,
          late_ack_resolved: true,
          late_ack_resolution: resolution,
        };
      }
    }
    return row;
  });
}

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

export function summarizeProgress(rows, { resolveLateAck = true, lateAckResolver = defaultLateAckResolver } = {}) {
  if (!resolveLateAck) {
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
  const resolved = applyLateAckResolution(rows, { lateAckResolver });
  const passCount = resolved.filter((row) => row.outcome_class === OUTCOME_PASS).length;
  const agentFailureCount = resolved.filter((row) => row.outcome_class === "fail_verifier").length;
  const infraRetryCount = resolved.filter((row) => row.outcome_class === OUTCOME_INFRASTRUCTURE_RETRY).length;
  const lateAckResolvedCount = resolved.filter((row) => row.late_ack_resolved === true).length;
  const agentDenominator = passCount + agentFailureCount;
  return {
    pass_count: passCount,
    agent_failure_count: agentFailureCount,
    infra_retry_count: infraRetryCount,
    late_ack_resolved_count: lateAckResolvedCount,
    total_run_attempts: resolved.length,
    pass_rate: agentDenominator ? passCount / agentDenominator : null,
    infrastructure_failure_rate: resolved.length ? infraRetryCount / resolved.length : null,
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
  const resolveLateAck = !has("--no-resolve-late-ack");
  const summary = summarizeProgress(rows, { resolveLateAck });
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
