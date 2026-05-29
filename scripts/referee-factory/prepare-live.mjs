#!/usr/bin/env node
// referee-factory/prepare-live.mjs
//
// PHASE A for the live (LLM-builder) flow. The saboteur plants a subtle,
// comment-free bug into an isolated sandbox and the grader confirms it is real
// (visible + sealed-holdout tests both go RED). The sandbox is LEFT ON DISK for a
// builder agent to fix. The holdout is HIDDEN (not written to disk).
//
// Prints a single JSON line: { sandbox, brief, ledger, defectId }
// The builder agent gets `brief` and `sandbox` only — never the answer key.
//
// Usage: node scripts/referee-factory/prepare-live.mjs [defect-id]

import path from "node:path";
import url from "node:url";
import { Grader } from "./grader.mjs";
import { Ledger } from "./ledger.mjs";
import { prepareTask } from "./factory.mjs";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const INNER = path.join(REPO_ROOT, "activegraph");
const VENV = path.join(INNER, ".venv", "bin", "python");
const SANDBOX_ROOT = "/tmp/referee-factory";

const defectId = process.argv[2] || "serde-swallow-corruption";
// Optional run tag (provenance + unique filename) — e.g. "batchA-1" or "control-overfit".
const runTag = process.argv[3] || "";
const defect = (await import(`./defects/${defectId}.mjs`)).default;

const ts = new Date().toISOString().replace(/[:.]/g, "-");
const ledgerPath = path.join(REPO_ROOT, "frames", "referee", `live-${defectId}${runTag ? "-" + runTag : ""}-${ts}.proof.jsonl`);

const grader = new Grader({ repoRoot: REPO_ROOT, innerRepo: INNER, venvPython: VENV, sandboxRoot: SANDBOX_ROOT });
const ledger = new Ledger(ledgerPath, `${defectId}::live`);
ledger.note("control", "harness", `task prepared — provenance/run-tag: ${runTag || "UNSPECIFIED (record builder source at grade time)"}`);

// Use the subtle, comment-free saboteur for the live flow.
const { sandbox, brief } = prepareTask({
  defect,
  grader,
  ledger,
  applyBug: defect.applyBugLive.bind(defect),
});

process.stdout.write(
  JSON.stringify({ defectId, sandbox, brief, ledger: ledgerPath }) + "\n"
);
