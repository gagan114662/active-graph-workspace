#!/usr/bin/env node
// Fire a T7 HARD cohort-C (opus-4.8) run — the dual-discipline bugfix gauntlet.
// Usage: node scripts/t7-hard-cohortC-opus48-fire.mjs <run_idx>
//
// Maya finds a real docstring<->code drift bug, writes a failing repro test
// (commit A), fixes it (commit B), records >=3 candidates (satisfaction-of-search
// discipline). The proof carries the hard-tier fields the --tier=hard verifier
// grades with WORKTREE GROUND TRUTH: the test must FAIL at failing_test_commit and
// PASS at fix_commit, each in an isolated venv (c1c2603-clean, no global leak).
//
// INTEGRITY (the pt.16 lesson): this helper RUNS THE REAL --tier=hard verifier per
// run and gates the recorded outcome on its exit code. Proof-existence is NOT a
// pass. The verifier re-derives ground truth in fresh worktrees — it cannot be
// rubber-stamped.
//
// Exclusion list accumulates every prior hard bug_source so Maya never re-fixes
// the same drift site, exactly like the medium helper accumulates uncovered_symbol.

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { emitInfrastructureEvent, emitBehaviorCompleted } from "./factory-events.mjs";
import { installCrashGuard } from "./factory-crash-guard.mjs";

installCrashGuard("t7_hard_cohortC_fire");

const idx = Number(process.argv[2]);
if (!Number.isInteger(idx) || idx < 1) {
  console.error("usage: node scripts/t7-hard-cohortC-opus48-fire.mjs <run_idx>  (>= 1)");
  process.exit(2);
}
const NNN = String(idx).padStart(3, "0");
const HASH = `T7_REPEAT_HARD_20260528_OPUS48_${NNN}`;
const SEED = randomUUID();
const LEDGER = "frames/t7-native-repetition-progress-hard-cohortC-opus48-20260528.jsonl";

// Base spec template — a DEDICATED file that run outputs never overwrite. (The
// run-NNN instruction for NNN=001 would collide with the old template filename
// `...hard-001-...`, mutating the template's baked-in exclusion list every fire;
// the dedicated `...hard-template-...` name avoids that.)
const baseInstr = readFileSync("frames/t7-repeat-hard-template-cohortC-opus48-instruction-20260528.txt", "utf8");

// Exclusion list = template's existing list + every prior hard run's bug_source.
const exclMatch = baseInstr.match(/Do not reuse these prior T7 hard targets:\n([\s\S]*?)\n\nWorktree discipline:/);
let exclusion = exclMatch
  ? exclMatch[1].split("\n").map((l) => l.replace(/^- /, "").trim()).filter(Boolean)
  : [];
if (existsSync(LEDGER)) {
  for (const line of readFileSync(LEDGER, "utf8").split(/\n/)) {
    if (!line.trim()) continue;
    try {
      const t = JSON.parse(line);
      const sym = t.bug_source || t.target_symbol;
      if (sym && !exclusion.includes(sym)) exclusion.push(sym);
    } catch {}
  }
}
// Defensive: also scan prior proof files directly (in case a run landed a proof
// but its ledger append was interrupted).
for (let prior = 1; prior < idx; prior++) {
  const p3 = String(prior).padStart(3, "0");
  const inner = `activegraph/frames/t7-repeat-hard-${p3}-20260528-opus48.proof`;
  const outer = `frames/t7-repeat-hard-${p3}-20260528-opus48.proof`;
  const path = existsSync(inner) ? inner : (existsSync(outer) ? outer : null);
  if (path) {
    const m = readFileSync(path, "utf8").match(/bug_source=(.+)/);
    if (m && !exclusion.includes(m[1].trim())) exclusion.push(m[1].trim());
  }
}
const exclusionBlock = exclusion.map((s) => `- ${s}`).join("\n");

// Build the instruction for this run by substituting the 001-template tokens.
let body = baseInstr
  .replace(/RUN_SEED=.+/, `RUN_SEED=${SEED}`)
  .replace(/T7_REPEAT_HARD_20260528_OPUS48_001/g, HASH)
  .replace(/run 001/g, `run ${NNN}`)
  .replace(/t7-repeat-hard-001-20260528-opus48/g, `t7-repeat-hard-${NNN}-20260528-opus48`);
body = body.replace(
  /(Do not reuse these prior T7 hard targets:\n)[\s\S]*?(\n\nWorktree discipline:)/,
  `$1${exclusionBlock}$2`,
);

const instrPath = `frames/t7-repeat-hard-${NNN}-cohortC-opus48-instruction-20260528.txt`;
writeFileSync(instrPath, body);
console.log(`[fire] wrote ${instrPath} (exclusion=${exclusion.length} bug sources)`);

const innerProofPath = `activegraph/frames/t7-repeat-hard-${NNN}-20260528-opus48.proof`;
const outerProofPath = `frames/t7-repeat-hard-${NNN}-20260528-opus48.proof`;
const resolveProofPath = () =>
  existsSync(innerProofPath) ? innerProofPath : (existsSync(outerProofPath) ? outerProofPath : null);

const runLogPath = `/tmp/t7h-${NNN}-cohortC-opus48-run.json`;
const errPath = `/tmp/t7h-${NNN}-cohortC-opus48-run.err`;

console.log(`[fire] launching HARD run ${idx} hash=${HASH}`);
const res = spawnSync("node", [
  "scripts/run-native-pentagon-task.mjs",
  "--hash", HASH,
  "--instruction-file", instrPath,
  "--expect-file", innerProofPath,
  "--watch-seconds", "960", // hard is dual-commit; must exceed bridge --claude-timeout-ms (900s) + overhead
  "--keep-bridge-running",
], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 900_000 });

writeFileSync(runLogPath, res.stdout || "");
writeFileSync(errPath, res.stderr || "");
console.log(`[fire] runner exit=${res.status}`);

const proofPath = resolveProofPath();
if (!proofPath) {
  console.error(`[fire] PROOF MISSING at both ${innerProofPath} and ${outerProofPath}`);
  try {
    emitInfrastructureEvent({
      subtype: "proof_missing",
      message: `Maya never wrote hard proof ${innerProofPath} or ${outerProofPath}`,
      extras: { run_idx: idx, hash: HASH, seed: SEED, tier: "hard",
        cohort: "opus-4.8-claude-code-2026-05-28", runner_exit: res.status,
        inner_path: innerProofPath, outer_path: outerProofPath, run_log: runLogPath },
    });
  } catch (e) { console.error(`[fire] event emit failed: ${e.message}`); }
  process.exit(3);
}
console.log(`[fire] proof found at ${proofPath}`);

// INDEPENDENTLY VERIFY (discipline rules 1 + 3): run the REAL --tier=hard verifier.
// The worktree ground-truth checks (test fails at A, passes at B) cannot be gamed
// by a proof file alone. Gate the recorded outcome on the verifier exit code.
const verRes = spawnSync("node", [
  "scripts/verify-pentagon-autonomy-from-logs.mjs",
  "--t6", "--tier=hard", "--proof-file", proofPath, "--no-db",
], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 300_000 });
const verifierExit = verRes.status;
const verSummary = (String(verRes.stdout || "").match(/^summary: .+$/m) || ["no summary"])[0];
const verifierPass = verifierExit === 0;
console.log(`[fire] verifier exit=${verifierExit} :: ${verSummary}`);
if (!verifierPass) {
  // Print the failing checks for diagnosis (hard runs are expensive to re-fire).
  const fails = String(verRes.stdout || "").split(/\n/).filter((l) => l.startsWith("FAIL "));
  for (const f of fails) console.log(`[fire]   ${f}`);
}

const runResult = (() => { try { return JSON.parse(res.stdout); } catch { return {}; } })();
const proof = readFileSync(proofPath, "utf8");
const m = (re) => (proof.match(re) || [])[1];
const instrSha = createHash("sha256").update(body).digest("hex");
const entry = {
  gauntlet: "T7",
  tier: "hard",
  cohort: "opus-4.8-claude-code-2026-05-28",
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
  bug_source: m(/bug_source=(.+)/),
  target_symbol: m(/uncovered_symbol=(.+)/),
  test_file: m(/test_file=(.+)/),
  failing_test_commit: m(/failing_test_commit=(.+)/),
  fix_commit: m(/fix_commit=(.+)/),
  agent_commit_sha: m(/agent_commit_sha=(.+)/),
  candidates_considered: m(/candidates_considered=(.+)/),
  pytest_before: Number(m(/pytest_before=(.+)/)),
  pytest_after: Number(m(/pytest_after=(.+)/)),
  verifier_exit: verifierExit,
  verifier_summary: verSummary,
  outcome: verifierPass ? "pass" : "fail",
  outcome_class: verifierPass ? "pass" : "fail",
  native_pass_final: verifierPass,
  harness_exit: res.status,
  harness_native_pass: runResult.native_pass === true,
  harness_wall_seconds: (runResult.final_trigger?.completed_at && runResult.initial_trigger?.created_at)
    ? (new Date(runResult.final_trigger.completed_at) - new Date(runResult.initial_trigger.created_at)) / 1000
    : null,
};
appendFileSync(LEDGER, JSON.stringify(entry) + "\n");
const wallStr = entry.harness_wall_seconds != null ? entry.harness_wall_seconds.toFixed(1) + "s" : "n/a";
console.log(`[fire] ${verifierPass ? "PASS" : "FAIL"} HARD run ${idx}: bug=${entry.bug_source} A=${entry.failing_test_commit} B=${entry.fix_commit} wall=${wallStr} verifier_exit=${verifierExit}`);

try {
  if (verifierPass) {
    emitBehaviorCompleted({
      behavior: "t7_hard_gauntlet",
      message: `T7 hard run ${idx} VERIFIED pass: fixed ${entry.bug_source}`,
      extras: { run_idx: idx, hash: entry.hash, tier: "hard", cohort: "opus-4.8-claude-code-2026-05-28",
        bug_source: entry.bug_source, failing_test_commit: entry.failing_test_commit, fix_commit: entry.fix_commit,
        pytest_before: entry.pytest_before, pytest_after: entry.pytest_after,
        harness_wall_seconds: entry.harness_wall_seconds, proof_file: entry.proof_file, verifier_exit: verifierExit },
    });
  } else {
    emitInfrastructureEvent({
      subtype: "verifier_rejected_proof",
      message: `T7 hard run ${idx} proof present but verifier exit=${verifierExit}: ${verSummary}`,
      extras: { run_idx: idx, hash: entry.hash, tier: "hard", cohort: "opus-4.8-claude-code-2026-05-28",
        proof_file: entry.proof_file, verifier_exit: verifierExit, verifier_summary: verSummary },
    });
  }
} catch (e) { console.error(`[fire] event emit failed: ${e.message}`); }

process.exit(verifierPass ? 0 : 4);
