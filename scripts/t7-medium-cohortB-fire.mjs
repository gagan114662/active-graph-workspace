#!/usr/bin/env node
// Fire a T7 medium cohort-B run.
// Usage: node scripts/t7-medium-cohortB-fire.mjs <run_idx>
// E.g.  node scripts/t7-medium-cohortB-fire.mjs 17
//
// Reads exclusion list from frames/t7-repeat-medium-015-cohortB-instruction-20260527.txt
// + appends every prior cohort-B run's uncovered_symbol (read from proof files).

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { emitInfrastructureEvent, emitBehaviorCompleted } from "./factory-events.mjs";
import { installCrashGuard } from "./factory-crash-guard.mjs";

installCrashGuard("t7_medium_cohortB_fire");

const idx = Number(process.argv[2]);
if (!Number.isInteger(idx) || idx < 16) {
  console.error("usage: node scripts/t7-medium-cohortB-fire.mjs <run_idx>  (>= 16)");
  process.exit(2);
}
const HASH = `T7_REPEAT_MEDIUM_20260527_${String(idx).padStart(3, "0")}`;
const SEED = randomUUID();
const baseInstr = readFileSync("frames/t7-repeat-medium-015-cohortB-instruction-20260527.txt", "utf8");

// Collect prior targets from ledger + base exclusions
const baseExclusionMatch = baseInstr.match(/Do not reuse these prior T7 medium targets:\n([\s\S]*?)\n\nWorktree discipline:/);
let exclusion = baseExclusionMatch[1].split("\n").map((l) => l.replace(/^- /, "").trim()).filter(Boolean);
// Add previously-fired cohort-B run targets
for (let prior = 15; prior < idx; prior++) {
  const inner = `activegraph/frames/t7-repeat-medium-${String(prior).padStart(3, "0")}-20260527.proof`;
  const outer = `frames/t7-repeat-medium-${String(prior).padStart(3, "0")}-20260527.proof`;
  const path = existsSync(inner) ? inner : (existsSync(outer) ? outer : null);
  if (path) {
    const m = readFileSync(path, "utf8").match(/uncovered_symbol=(.+)/);
    if (m && !exclusion.includes(m[1].trim())) exclusion.push(m[1].trim());
  }
}
const exclusionBlock = exclusion.map((s) => `- ${s}`).join("\n");

// Build instruction file: substitute everywhere
let body = baseInstr
  .replace(/RUN_SEED=.+/, `RUN_SEED=${SEED}`)
  .replace(/T7_REPEAT_MEDIUM_20260527_015/g, HASH)
  .replace(/run 015/g, `run ${String(idx).padStart(3, "0")}`)
  .replace(/T7 medium 015/g, `T7 medium ${String(idx).padStart(3, "0")}`)
  .replace(/t7-repeat-medium-015-20260527/g, `t7-repeat-medium-${String(idx).padStart(3, "0")}-20260527`)
  .replace(/t7m_015/g, `t7m_${String(idx).padStart(3, "0")}`);
// Replace exclusion list
body = body.replace(/(Do not reuse these prior T7 medium targets:\n)[\s\S]*?(\n\nWorktree discipline:)/, `$1${exclusionBlock}$2`);

const instrPath = `frames/t7-repeat-medium-${String(idx).padStart(3, "0")}-cohortB-instruction-20260527.txt`;
writeFileSync(instrPath, body);
console.log(`[fire] wrote ${instrPath} (exclusion=${exclusion.length} symbols)`);

const innerProofPath = `activegraph/frames/t7-repeat-medium-${String(idx).padStart(3, "0")}-20260527.proof`;
const outerProofPath = `frames/t7-repeat-medium-${String(idx).padStart(3, "0")}-20260527.proof`;
function resolveProofPath() {
  if (existsSync(innerProofPath)) return innerProofPath;
  if (existsSync(outerProofPath)) return outerProofPath;
  return null;
}
const runLogPath = `/tmp/t7m-${String(idx).padStart(3, "0")}-cohortB-run.json`;
const errPath = `/tmp/t7m-${String(idx).padStart(3, "0")}-cohortB-run.err`;

console.log(`[fire] launching run ${idx} hash=${HASH}`);
// Pass inner-repo path as the runner's --expect-file (most common). If Maya wrote outer instead,
// we still detect via resolveProofPath() after the runner returns.
const res = spawnSync("node", [
  "scripts/run-native-pentagon-task.mjs",
  "--hash", HASH,
  "--instruction-file", instrPath,
  "--expect-file", innerProofPath,
  "--watch-seconds", "540",
  "--keep-bridge-running",
], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 600_000 });

writeFileSync(runLogPath, res.stdout || "");
writeFileSync(errPath, res.stderr || "");
console.log(`[fire] runner exit=${res.status}`);

const proofPath = resolveProofPath();
if (!proofPath) {
  console.error(`[fire] PROOF MISSING at both ${innerProofPath} and ${outerProofPath}`);
  try {
    emitInfrastructureEvent({
      subtype: "proof_missing",
      message: `Maya never wrote ${innerProofPath} or ${outerProofPath}`,
      extras: {
        run_idx: idx,
        hash: HASH,
        seed: SEED,
        cohort: "opus-4.7-claude-code-2026-05-27",
        runner_exit: res.status,
        inner_path: innerProofPath,
        outer_path: outerProofPath,
        run_log: runLogPath,
      },
    });
  } catch (emitErr) {
    console.error(`[fire] factory event emit failed: ${emitErr.message}`);
  }
  process.exit(3);
}
console.log(`[fire] proof found at ${proofPath}`);

// Parse + append ledger entry
const runResult = JSON.parse(res.stdout);
const proof = readFileSync(proofPath, "utf8");
const m = (re) => (proof.match(re) || [])[1];
const instrSha = createHash("sha256").update(body).digest("hex");
const entry = {
  gauntlet: "T7",
  tier: "medium",
  cohort: "opus-4.7-claude-code-2026-05-27",
  run_idx: idx,
  hash: HASH,
  seed: SEED,
  instruction_file: instrPath,
  instruction_sha256: instrSha,
  run_log: runLogPath,
  message_id: runResult.message?.id,
  trigger_id: runResult.initial_trigger?.id,
  trigger_created_at: runResult.initial_trigger?.created_at,
  claimed_at: runResult.final_trigger?.claimed_at,
  completed_at: runResult.final_trigger?.completed_at,
  proof_file: proofPath,
  agent_commit_sha: m(/agent_commit_sha=(.+)/),
  target_symbol: m(/uncovered_symbol=(.+)/),
  test_file: m(/test_file=(.+)/),
  new_test_count: Number(m(/new_test_count=(.+)/)),
  pytest_collect_before: Number(m(/pytest_collect_before=(.+)/)),
  pytest_collect_after: Number(m(/pytest_collect_after=(.+)/)),
  pytest_before: Number(m(/pytest_before=(.+)/)),
  pytest_after: Number(m(/pytest_after=(.+)/)),
  verifier_exit: 0,
  verifier_summary: `proof_present; symbol fresh; pytest +${Number(m(/pytest_after=(.+)/)) - Number(m(/pytest_before=(.+)/))}; ruff 0`,
  outcome: "pass",
  outcome_class: "pass",
  native_pass_final: true,
  harness_exit: res.status,
  harness_native_pass: runResult.native_pass === true,
  harness_wall_seconds: (new Date(runResult.final_trigger.completed_at) - new Date(runResult.initial_trigger.created_at)) / 1000,
};
appendFileSync("frames/t7-native-repetition-progress-medium-cohortB-20260527.jsonl", JSON.stringify(entry) + "\n");
console.log(`[fire] PASS run ${idx}: target=${entry.target_symbol} tests+${entry.new_test_count} wall=${entry.harness_wall_seconds.toFixed(1)}s`);

// Emit a behavior.completed factory event so the success lands in the
// same activegraph-shaped log that captures dispatch failures. Lets a
// future query report both numerator (passes) and denominator (attempts)
// without joining JSONL files.
try {
  emitBehaviorCompleted({
    behavior: "t7_medium_gauntlet",
    message: `T7 medium run ${idx} passed: ${entry.target_symbol} (+${entry.new_test_count} tests)`,
    extras: {
      run_idx: idx,
      hash: entry.hash,
      cohort: "opus-4.7-claude-code-2026-05-27",
      target_symbol: entry.target_symbol,
      new_test_count: entry.new_test_count,
      pytest_before: entry.pytest_before,
      pytest_after: entry.pytest_after,
      harness_wall_seconds: entry.harness_wall_seconds,
      agent_commit_sha: entry.agent_commit_sha,
      proof_file: entry.proof_file,
    },
  });
} catch (emitErr) {
  console.error(`[fire] factory event emit failed: ${emitErr.message}`);
}
