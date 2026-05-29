#!/usr/bin/env node
// referee-factory/tier-easy-task.mjs
//
// EASY tier (framework-defined): "30-second setup + tutorial".
//   - run the bundled Diligence pack against recorded fixtures (byte-deterministic)
//   - run `activegraph quickstart` (the 10-minute tutorial, fixture mode)
//   - run a basic fork-and-diff workflow
//
// This tier is mostly OPERATE (not build), so the referee gates are deterministic
// framework invariants — no API keys, no network. Default-to-error + trace.

import { spawnSync } from "node:child_process";
import path from "node:path";
import url from "node:url";
import fs from "node:fs";
import { Grader } from "./grader.mjs";
import { Ledger } from "./ledger.mjs";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const INNER = path.join(REPO_ROOT, "activegraph");
const VENV = path.join(INNER, ".venv", "bin", "python");
const SANDBOX_ROOT = "/tmp/referee-factory";
const REQUIRED = ["diligence_pack_green", "quickstart_byte_deterministic", "quickstart_snapshot_green", "fork_and_diff_works"];

function run(cmd, args, cwd, extraEnv = {}) {
  const r = spawnSync(cmd, args, { cwd, env: { ...process.env, PYTHONPATH: cwd, PYTHONDONTWRITEBYTECODE: "1", ...extraEnv }, encoding: "utf8", timeout: 180000, maxBuffer: 1024 * 1024 * 32 });
  return { exit: r.status === null ? 124 : r.status, out: (r.stdout || "") + (r.stderr || "") };
}

const grader = new Grader({ repoRoot: REPO_ROOT, innerRepo: INNER, venvPython: VENV, sandboxRoot: SANDBOX_ROOT });
const ts = new Date().toISOString().replace(/[:.]/g, "-");
const ledgerPath = path.join(REPO_ROOT, "frames", "referee", `tier-easy-task-${ts}.proof.jsonl`);
const ledger = new Ledger(ledgerPath, "tier-easy::operate");
ledger.note("control", "harness", "EASY tier — run Diligence pack + quickstart tutorial + basic fork-and-diff (fixtures, no keys)");

let sandbox, verdict;
try {
  sandbox = grader.createSandbox("tier-easy-task");
  ledger.note("setup", "factory", `sandbox ${sandbox}`);
  const noKeys = { ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "" };

  // GATE: diligence pack runs green against recorded fixtures
  ledger.openGate("diligence_pack_green", "grader");
  const dp = run(VENV, ["-m", "pytest", "tests/test_diligence_pack.py", "-p", "no:cacheprovider", "-q", "--no-header"], sandbox, noKeys);
  const dpSum = dp.out.trim().split("\n").filter(Boolean).pop();
  dp.exit === 0 && !/failed/.test(dp.out)
    ? ledger.clearGate("diligence_pack_green", "grader", { summary: dpSum }, "Diligence pack passes against recorded fixtures (no API keys)")
    : ledger.failGate("diligence_pack_green", "grader", "Diligence pack not green", { summary: dpSum });

  // GATE: quickstart byte-deterministic across two runs (the framework's headline guarantee)
  ledger.openGate("quickstart_byte_deterministic", "grader");
  const q1 = run(VENV, ["-m", "activegraph", "quickstart"], sandbox, noKeys);
  const q2 = run(VENV, ["-m", "activegraph", "quickstart"], sandbox, noKeys);
  const det = q1.exit === 0 && q2.exit === 0 && q1.out.length > 0 && q1.out === q2.out;
  det
    ? ledger.clearGate("quickstart_byte_deterministic", "grader", { bytes: q1.out.length, lines: q1.out.split("\n").length }, "quickstart output byte-identical across two runs, exit 0, no network/keys")
    : ledger.failGate("quickstart_byte_deterministic", "grader", "quickstart not byte-deterministic", { exit1: q1.exit, exit2: q2.exit, len1: q1.out.length, len2: q2.out.length });

  // GATE: quickstart matches the committed snapshot (framework's own acceptance test)
  ledger.openGate("quickstart_snapshot_green", "grader");
  const qs = run(VENV, ["-m", "pytest", "tests/test_quickstart.py", "tests/test_quickstart_snapshot.py", "-p", "no:cacheprovider", "-q", "--no-header"], sandbox, noKeys);
  const qsSum = qs.out.trim().split("\n").filter(Boolean).pop();
  qs.exit === 0 && !/failed/.test(qs.out)
    ? ledger.clearGate("quickstart_snapshot_green", "grader", { summary: qsSum }, "quickstart matches committed byte-snapshot")
    : ledger.failGate("quickstart_snapshot_green", "grader", "quickstart snapshot drift", { summary: qsSum, tail: qs.out.slice(-300) });

  // GATE: basic fork-and-diff works (the tutorial's time-travel step), via the framework's own example + replay tests
  ledger.openGate("fork_and_diff_works", "grader");
  const ff = run(VENV, ["-m", "pytest", "tests/test_fork.py", "tests/test_diff.py", "tests/test_replay.py", "-p", "no:cacheprovider", "-q", "--no-header"], sandbox, noKeys);
  const ffSum = ff.out.trim().split("\n").filter(Boolean).pop();
  ff.exit === 0 && !/failed/.test(ff.out)
    ? ledger.clearGate("fork_and_diff_works", "grader", { summary: ffSum }, "fork / diff / replay primitives pass the framework's own tests")
    : ledger.failGate("fork_and_diff_works", "grader", "fork-and-diff primitives not green", { summary: ffSum });

  verdict = ledger.verdict(REQUIRED);
  console.log(`\nEASY TIER TASK — VERDICT: ${verdict.verdict}`);
  console.log(`cleared: [${verdict.cleared.join(", ")}]`);
  if (verdict.failed.length) console.log(`failed: [${verdict.failed.join(", ")}]`);
  if (verdict.open.length) console.log(`open: [${verdict.open.join(", ")}]`);
  console.log(`ledger: ${path.relative(REPO_ROOT, ledgerPath)}`);
} finally {
  if (sandbox) grader.destroySandbox(sandbox);
}
process.exit(verdict && verdict.verified ? 0 : 1);
