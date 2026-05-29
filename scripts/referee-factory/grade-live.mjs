#!/usr/bin/env node
// referee-factory/grade-live.mjs
//
// PHASE B for the live flow. Grades whatever the builder left in `sandbox` using
// the SAME ungameable gates as the deterministic controls (tamper, visible,
// sealed-holdout, full-suite) plus an `adversary_clear` gate folded in from an
// independent adversary agent. The verdict is DEFAULT-ERROR: it is VERIFIED only
// if every live-required gate is cleared.
//
// Usage:
//   node scripts/referee-factory/grade-live.mjs <sandbox> <ledger> [defect-id] \
//        [--adversary-cleared true|false] [--adversary-detail "..."] [--keep] [--json]
//
// The adversary flags let the workflow report whether an independent skeptic
// found a real flaw. If omitted, adversary_clear stays OPEN => ERROR (default).

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

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith("--"));
const sandbox = positional[0];
const ledgerPath = positional[1];
const defectId = positional[2] || "serde-swallow-corruption";
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (name) => args.includes(`--${name}`);

if (!sandbox || !ledgerPath) {
  console.error("usage: grade-live.mjs <sandbox> <ledger> [defect-id] [--adversary-cleared true|false] [--adversary-detail ...] [--keep] [--json]");
  process.exit(2);
}

const defect = (await import(`./defects/${defectId}.mjs`)).default;
const grader = new Grader({ repoRoot: REPO_ROOT, innerRepo: INNER, venvPython: VENV, sandboxRoot: SANDBOX_ROOT });
const ledger = new Ledger(ledgerPath, `${defectId}::live`);

// Capture the builder's diff into the trace before grading (evidence).
const diff = grader.sandboxDiff(sandbox, [defect.module]);
ledger.note("build", "builder", "builder diff captured", { diffPreview: diff.slice(0, 1500), diffBytes: diff.length });

const advFlag = flag("adversary-cleared");
const extraGates = [];
if (advFlag !== undefined) {
  extraGates.push({
    gate: "adversary_clear",
    role: "adversary",
    cleared: advFlag === "true",
    detail: flag("adversary-detail") || (advFlag === "true" ? "adversary tried to break the fix and could not" : "adversary found a real flaw"),
  });
}

const verdict = gradeSubmission({
  defect, grader, ledger, sandbox,
  requiredGates: LIVE_REQUIRED_GATES,
  extraGates,
  runDeterministicAdversary: has("auto-adversary"),
});

if (!has("keep")) grader.destroySandbox(sandbox);

if (has("json")) {
  process.stdout.write(JSON.stringify({ defectId, verdict, ledger: ledgerPath }) + "\n");
} else {
  console.log(`VERDICT: ${verdict.verdict} — ${verdict.reason}`);
  console.log(`cleared: [${verdict.cleared.join(", ")}]`);
  console.log(`open:    [${verdict.open.join(", ")}]`);
  console.log(`failed:  [${verdict.failed.join(", ")}]`);
}
process.exit(verdict.verified ? 0 : 1);
