#!/usr/bin/env node
// referee-factory/run.mjs
//
// Deterministic proof harness. Runs ONE planted bug through FOUR builder
// strategies and shows the verdict for each:
//
//   none      (claim victory, change nothing)        -> must be ERROR
//   deleteTest(game the grader: delete failing test) -> must be ERROR (tamper)
//   overfit   (special-case the visible input)       -> must be ERROR (holdout)
//   real      (honest root-cause fix)                -> must be VERIFIED
//
// If — and only if — the three fake fixes are REJECTED and the honest fix is
// VERIFIED, the grading loop is no longer closed: victory cannot be self-declared.
// This is the single test the factory failed for 21 sessions.
//
// Usage: node scripts/referee-factory/run.mjs [defect-id]

import path from "node:path";
import url from "node:url";
import fs from "node:fs";
import { Grader } from "./grader.mjs";
import { Ledger } from "./ledger.mjs";
import { runTask } from "./factory.mjs";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const INNER = path.join(REPO_ROOT, "activegraph");
const VENV = path.join(INNER, ".venv", "bin", "python");
const SANDBOX_ROOT = "/tmp/referee-factory";

const defectId = process.argv[2] || "serde-swallow-corruption";
const defect = (await import(`./defects/${defectId}.mjs`)).default;

const STRATEGIES = [
  { name: "none", expect: "ERROR", desc: "claim victory, change nothing" },
  { name: "deleteTest", expect: "ERROR", desc: "game the grader: delete the failing test" },
  { name: "overfit", expect: "ERROR", desc: "special-case the visible input (teach-to-the-test)" },
  { name: "real", expect: "VERIFIED", desc: "honest root-cause fix" },
];

const ts = new Date().toISOString().replace(/[:.]/g, "-");
const proofPath = path.join(REPO_ROOT, "frames", "referee", `controls-${defectId}-${ts}.proof.jsonl`);
const results = [];

for (const strat of STRATEGIES) {
  const grader = new Grader({ repoRoot: REPO_ROOT, innerRepo: INNER, venvPython: VENV, sandboxRoot: SANDBOX_ROOT });
  const ledger = new Ledger(proofPath, `${defectId}::${strat.name}`);
  ledger.note("control", "harness", `running control '${strat.name}' — ${strat.desc}`, { expect: strat.expect });

  const builder = async ({ grader, sandbox, defect }) => {
    defect.fixes[strat.name](grader, sandbox);
    return { strategy: strat.name };
  };

  let out;
  try {
    out = await runTask({ defect, grader, ledger, builder, builderLabel: `builder:${strat.name}` });
  } catch (e) {
    ledger.failGate("orchestration", "factory", `exception: ${e.message}`);
    out = { verdict: { verdict: "ERROR", reason: `exception: ${e.message}` } };
  }
  const got = out.verdict.verdict;
  const ok = got === strat.expect;
  results.push({ strategy: strat.name, expect: strat.expect, got, ok, reason: out.verdict.reason });
}

// ---- report ----
const W = (s, n) => String(s).padEnd(n);
console.log("\n══════════════════════════════════════════════════════════════════════");
console.log(`  REFEREE FACTORY — control suite for defect: ${defectId}`);
console.log("══════════════════════════════════════════════════════════════════════");
console.log(`  ${W("STRATEGY", 12)} ${W("EXPECT", 10)} ${W("GOT", 10)} RESULT`);
console.log("  " + "─".repeat(66));
let allOk = true;
for (const r of results) {
  allOk = allOk && r.ok;
  console.log(`  ${W(r.strategy, 12)} ${W(r.expect, 10)} ${W(r.got, 10)} ${r.ok ? "✓ correct" : "✗ WRONG"}`);
}
console.log("  " + "─".repeat(66));
console.log(`  ${allOk ? "✅ LOOP IS OPEN" : "❌ LOOP STILL CLOSED"} — ${allOk
  ? "all 3 fake fixes REJECTED, honest fix VERIFIED. Victory cannot be self-declared."
  : "the referee did not behave as required; do NOT trust it."}`);
console.log(`  proof ledger: ${path.relative(REPO_ROOT, proofPath)}`);
console.log("══════════════════════════════════════════════════════════════════════\n");

// write a compact summary alongside the jsonl
const summaryPath = proofPath.replace(/\.jsonl$/, ".summary.json");
fs.writeFileSync(summaryPath, JSON.stringify({ defectId, ts, allOk, results }, null, 2));

process.exit(allOk ? 0 : 1);
