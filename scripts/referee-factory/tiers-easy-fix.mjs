#!/usr/bin/env node
// referee-factory/tiers-easy-fix.mjs
//
// Refereed fix of the EASY tier's one RED: the stale quickstart fixture snapshot.
//
// Root cause (confirmed by read-only bisect, recon 2026-05-29): commit 6b2804a
// minimized the document_researcher prompt (emit only `required` schema props),
// so count_tokens drops 1520->1490. The committed snapshot was never regenerated.
// This is a STALE snapshot, not a behavior regression — byte-determinism is intact.
//
// The disciplined fix is the framework's OWN sanctioned mechanism: regenerate the
// snapshot from clean source via UPDATE_SNAPSHOTS=1. The referee guarantees this
// cannot be gamed:
//   - test_bodies_untampered: the .py oracle test files are hash-pinned to HEAD;
//     ONLY the snapshot .txt may change. You cannot weaken/skip the test.
//   - oracle_green: the framework's own test re-derives run_fixture_mode() output
//     and byte-compares it to the snapshot. It passes ONLY if the snapshot equals
//     real clean-source output — a hand-faked snapshot value would FAIL it. So
//     "green" is itself the genuineness proof.
//   - byte_determinism: `activegraph quickstart` run twice (API keys unset) must
//     be byte-identical — the framework's headline guarantee, asserted directly.
//
// Usage: node scripts/referee-factory/tiers-easy-fix.mjs [--apply]
//   (default: prove in an isolated sandbox; --apply also regenerates the REAL
//    inner-repo snapshot so the easy tier is green in the repo, for operator review.)

import { spawnSync } from "node:child_process";
import path from "node:path";
import url from "node:url";
import { Grader } from "./grader.mjs";
import { Ledger } from "./ledger.mjs";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const INNER = path.join(REPO_ROOT, "activegraph");
const VENV = path.join(INNER, ".venv", "bin", "python");
const SANDBOX_ROOT = "/tmp/referee-factory";

const ORACLES = ["tests/test_diligence_pack.py", "tests/test_quickstart.py", "tests/test_quickstart_snapshot.py", "tests/test_tutorial_snippets.py"];
const SNAPSHOT_TEST = "tests/test_quickstart.py::test_fixture_mode_snapshot";
const SNAPSHOT_FILE = "tests/snapshots/quickstart_fixture.txt";

const apply = process.argv.includes("--apply");
const REQUIRED = ["task_is_real", "test_bodies_untampered", "byte_determinism", "oracle_green"];

function pytest(cwd, args, extraEnv = {}) {
  const r = spawnSync(VENV, ["-m", "pytest", ...args, "-p", "no:cacheprovider", "-q", "--no-header"], {
    cwd, env: { ...process.env, PYTHONPATH: cwd, PYTHONDONTWRITEBYTECODE: "1", ...extraEnv }, encoding: "utf8", timeout: 300000, maxBuffer: 1024 * 1024 * 32,
  });
  const out = (r.stdout || "") + (r.stderr || "");
  return { exit: r.status === null ? 124 : r.status, out, summary: out.trim().split("\n").filter(Boolean).pop() || "" };
}

function quickstart(cwd) {
  // run the bundled diligence demo in fixture mode (no network/keys)
  const r = spawnSync(VENV, ["-m", "activegraph", "quickstart"], {
    cwd, env: { ...process.env, PYTHONPATH: cwd, PYTHONDONTWRITEBYTECODE: "1", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "" }, encoding: "utf8", timeout: 120000, maxBuffer: 1024 * 1024 * 32,
  });
  return { exit: r.status === null ? 124 : r.status, out: (r.stdout || "") };
}

const grader = new Grader({ repoRoot: REPO_ROOT, innerRepo: INNER, venvPython: VENV, sandboxRoot: SANDBOX_ROOT });
const ts = new Date().toISOString().replace(/[:.]/g, "-");
const ledgerPath = path.join(REPO_ROOT, "frames", "referee", `tier-easy-fix-${ts}.proof.jsonl`);
const ledger = new Ledger(ledgerPath, "tier-easy::snapshot-fix");
ledger.note("provenance", "operator", "OPERATOR-TASK: snapshot regeneration (UPDATE_SNAPSHOTS), not an LLM build");
  ledger.note("control", "harness", "EASY tier refereed fix — regenerate stale quickstart snapshot under discipline");

let sandbox;
let verdict;
try {
  sandbox = grader.createSandbox("tier-easy");
  ledger.note("setup", "factory", `sandbox at ${sandbox}`);

  // GATE 1: task_is_real — the snapshot test is RED at HEAD
  ledger.openGate("task_is_real", "grader");
  const before = pytest(sandbox, ORACLES);
  const beforeFailed = /(\d+) failed/.test(before.out);
  if (beforeFailed) ledger.clearGate("task_is_real", "grader", { summary: before.summary }, "easy oracle is RED at HEAD — real task");
  else ledger.failGate("task_is_real", "grader", "easy oracle already green — nothing to fix", { summary: before.summary });

  // BUILDER (disciplined fix): regenerate snapshot from clean sandbox source.
  ledger.note("build", "builder", "regenerating snapshot via framework-sanctioned UPDATE_SNAPSHOTS=1");
  const regen = pytest(sandbox, [SNAPSHOT_TEST], { UPDATE_SNAPSHOTS: "1" });
  ledger.note("build", "builder", `UPDATE_SNAPSHOTS run: ${regen.summary}`);

  // GATE 2: test_bodies_untampered — only the snapshot .txt may change; .py pinned to HEAD
  ledger.openGate("test_bodies_untampered", "grader");
  const tampered = [];
  for (const rel of ORACLES) {
    const now = grader.hashFiles(sandbox, [rel])[rel];
    const head = grader.fileAtHead(rel);
    if (head && now !== head) tampered.push(rel);
  }
  if (tampered.length) ledger.failGate("test_bodies_untampered", "grader", `test body files changed (only the snapshot .txt may change): ${tampered.join(",")}`, { tampered });
  else ledger.clearGate("test_bodies_untampered", "grader", {}, "all .py oracle test bodies byte-identical to HEAD; only snapshot data regenerated");

  // GATE 3: byte_determinism — quickstart twice, byte-identical
  ledger.openGate("byte_determinism", "grader");
  const q1 = quickstart(sandbox), q2 = quickstart(sandbox);
  const det = q1.exit === 0 && q2.exit === 0 && q1.out.length > 0 && q1.out === q2.out;
  if (det) ledger.clearGate("byte_determinism", "grader", { bytes: q1.out.length }, "quickstart byte-identical across two runs (no network/keys)");
  else ledger.failGate("byte_determinism", "grader", "quickstart not byte-deterministic", { exit1: q1.exit, exit2: q2.exit, len1: q1.out.length, len2: q2.out.length });

  // GATE 4: oracle_green — framework's own tests pass (re-derives output & compares => genuineness)
  ledger.openGate("oracle_green", "grader");
  const after = pytest(sandbox, ORACLES);
  if (after.exit === 0 && !/(\d+) failed/.test(after.out)) ledger.clearGate("oracle_green", "grader", { summary: after.summary }, "framework's own easy-tier acceptance tests all pass (snapshot matches live run_fixture_mode output => genuine)");
  else ledger.failGate("oracle_green", "grader", "easy oracle still not green after fix", { summary: after.summary });

  verdict = ledger.verdict(REQUIRED);

  console.log("\n══════════ EASY TIER — REFEREED FIX ══════════");
  console.log(`VERDICT: ${verdict.verdict} — ${verdict.reason}`);
  console.log(`cleared: [${verdict.cleared.join(", ")}]`);
  if (verdict.open.length) console.log(`open:    [${verdict.open.join(", ")}]`);
  if (verdict.failed.length) console.log(`failed:  [${verdict.failed.join(", ")}]`);

  // --apply: regenerate the REAL inner-repo snapshot (operator reviews/commits)
  if (apply && verdict.verified) {
    const realRegen = pytest(INNER, [SNAPSHOT_TEST], { UPDATE_SNAPSHOTS: "1" });
    const realAfter = pytest(INNER, ORACLES);
    console.log(`\n[--apply] regenerated REAL ${SNAPSHOT_FILE}: ${realRegen.summary}`);
    console.log(`[--apply] real-repo easy oracle now: ${realAfter.summary}`);
    console.log("[--apply] working-tree change left for operator review (GitButler handles commits).");
    ledger.note("apply", "factory", `applied snapshot regen to real repo: ${realAfter.summary}`);
  } else if (apply) {
    console.log("\n[--apply] SKIPPED — sandbox verdict was not VERIFIED; refusing to touch the real repo.");
  }
  console.log("═══════════════════════════════════════════════\n");
} finally {
  if (sandbox) grader.destroySandbox(sandbox);
}
process.exit(verdict && verdict.verified ? 0 : 1);
