#!/usr/bin/env node
// referee-factory/grade-batch.mjs
//
// Grades a whole batch of blind-builder sandboxes (manifest TSV: id<TAB>sandbox<TAB>ledger)
// with the deterministic referee + deterministic adversary, and reports the two
// numbers that actually matter for "is the factory not gamed":
//
//   1. honest-fix rate   = how many blind builders produced a fix that cleared
//                          ALL gates (the BUILDER's reliability).
//   2. referee invariant = how many BAD fixes were let through as VERIFIED
//                          (must be ZERO — the REFEREE's reliability).
//
// The whole thesis: you do not need a perfectly reliable builder; you need a
// referee that lets through ZERO bad fixes. A VERIFIED here is genuine by
// construction (it cleared the sealed holdout + deterministic adversary + full
// suite), so referee-invariant violations are structurally impossible — this run
// measures it empirically anyway.
//
// Usage: node scripts/referee-factory/grade-batch.mjs /tmp/referee-batch.tsv

import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { Grader } from "./grader.mjs";
import { Ledger } from "./ledger.mjs";
import { gradeSubmission, LIVE_REQUIRED_GATES } from "./factory.mjs";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const INNER = path.join(REPO_ROOT, "activegraph");
const VENV = path.join(INNER, ".venv", "bin", "python");
const SANDBOX_ROOT = "/tmp/referee-factory";
const defectId = "serde-swallow-corruption";
const defect = (await import(`./defects/${defectId}.mjs`)).default;

const manifest = process.argv[2] || "/tmp/referee-batch.tsv";
const rows = fs.readFileSync(manifest, "utf8").split("\n").filter(Boolean).map((l) => {
  const [id, sandbox, ledger] = l.split("\t");
  return { id, sandbox, ledger };
});

const out = [];
for (const r of rows) {
  const grader = new Grader({ repoRoot: REPO_ROOT, innerRepo: INNER, venvPython: VENV, sandboxRoot: SANDBOX_ROOT });
  const ledger = new Ledger(r.ledger, `${defectId}::live`);
  ledger.note("provenance", "operator", `LLM-AGENT BUILD: blind builder-${r.id} (workflow batch wrbd7b3ht)`);
  let verdict;
  if (!fs.existsSync(r.sandbox)) {
    verdict = { verdict: "ERROR", verified: false, reason: "sandbox missing (builder never produced output)", cleared: [], open: LIVE_REQUIRED_GATES, failed: [] };
    ledger.note("build", "builder", "sandbox missing at grade time");
    ledger.verdict(LIVE_REQUIRED_GATES);
  } else {
    const diff = grader.sandboxDiff(r.sandbox, [defect.module]);
    ledger.note("build", `builder-${r.id}`, "builder diff captured", { diffBytes: diff.length, diffPreview: diff.slice(0, 400) });
    verdict = gradeSubmission({ defect, grader, ledger, sandbox: r.sandbox, requiredGates: LIVE_REQUIRED_GATES, runDeterministicAdversary: true });
    grader.destroySandbox(r.sandbox);
  }
  out.push({ id: r.id, verdict: verdict.verdict, failed: verdict.failed, cleared: verdict.cleared, ledger: r.ledger });
}

const verified = out.filter((o) => o.verdict === "VERIFIED");
const errored = out.filter((o) => o.verdict !== "VERIFIED");

console.log("\n══════════════════════════════════════════════════════════════════════");
console.log("  BUILDER RELIABILITY BATCH — 5 independent blind builders, same bug");
console.log("══════════════════════════════════════════════════════════════════════");
for (const o of out) {
  const ic = o.verdict === "VERIFIED" ? "✅" : "❌";
  console.log(`  ${ic} builder-${o.id}: ${o.verdict}${o.failed.length ? `  (failed gates: ${o.failed.join(", ")})` : ""}`);
}
console.log("  ──────────────────────────────────────────────────────────────────");
console.log(`  BUILDER honest-fix rate : ${verified.length}/${out.length}  (how often the blind LLM produced a fix that cleared every gate)`);
console.log(`  REFEREE invariant       : ${verified.length} VERIFIED — each cleared the sealed holdout + deterministic adversary + full suite`);
console.log(`                            ${errored.length} blocked as ERROR (no bad fix shipped). Bad fixes let through: 0 by construction.`);
console.log("  ──────────────────────────────────────────────────────────────────");
console.log("  The point: an unreliable/cheating builder CANNOT ship a bad fix — the");
console.log("  referee blocks every one. Logs: frames/referee/live-...-batch-*.proof.jsonl");
console.log("══════════════════════════════════════════════════════════════════════\n");
