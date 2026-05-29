#!/usr/bin/env node
// referee-factory/tier-capability.mjs
//
// Referees a NET-NEW capability build for medium/hard/extra-hard. The build is an
// LLM-authored reference implementation (/tmp/ref_<tier>.py) that exercises the
// framework's real primitives and asserts a STRONG event-log invariant inline:
// exit 0 is only possible if every assert holds (the trace is the proof).
//
// The referee runs it against the SANDBOX's clean-HEAD framework (PYTHONPATH
// shadowing — so it tests the committed framework, not a polluted tree), and also
// requires the framework's own oracle tests for that tier to be green (no
// framework breakage). Default-to-error + trace.
//
// HONEST SCOPE: this proves the factory (an LLM) can BUILD each tier's capability
// and that the build is invariant-verified. It is one notch below the serde
// proof (blind builder vs an INDEPENDENT sealed acceptance + no-op control); that
// stronger loop is demonstrated separately for the medium tier. Labeled as such.
//
// Usage: node scripts/referee-factory/tier-capability.mjs <medium|hard|extra-hard>

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

const tier = process.argv[2];
if (!["medium", "hard", "extra-hard"].includes(tier)) { console.error("tier must be medium|hard|extra-hard"); process.exit(2); }

// framework oracle tests per tier (from recon) — a no-breakage check
const ORACLE = {
  medium: ["tests/test_runtime.py", "tests/test_llm_behavior.py", "tests/test_pattern_subscriptions.py"],
  hard: ["tests/test_fork.py", "tests/test_diff.py", "tests/test_llm_replay.py", "tests/test_pattern_subscriptions.py"],
  "extra-hard": ["tests/test_pack_scaffold.py", "tests/test_store_conformance.py", "tests/test_packs.py"],
}[tier];
const REQUIRED = ["reference_impl_runs", "invariant_strong", "framework_suite_green"];

function run(cmd, args, cwd, extraEnv = {}) {
  const r = spawnSync(cmd, args, { cwd, env: { ...process.env, PYTHONPATH: cwd, PYTHONDONTWRITEBYTECODE: "1", ...extraEnv }, encoding: "utf8", timeout: 240000, maxBuffer: 1024 * 1024 * 32 });
  return { exit: r.status === null ? 124 : r.status, out: (r.stdout || "") + (r.stderr || "") };
}

const grader = new Grader({ repoRoot: REPO_ROOT, innerRepo: INNER, venvPython: VENV, sandboxRoot: SANDBOX_ROOT });
const ts = new Date().toISOString().replace(/[:.]/g, "-");
const ledgerPath = path.join(REPO_ROOT, "frames", "referee", `tier-${tier}-capability-${ts}.proof.jsonl`);
const ledger = new Ledger(ledgerPath, `tier-${tier}::capability`);
ledger.note("control", "harness", `${tier.toUpperCase()} tier — LLM-built capability, invariant-verified against clean-HEAD framework`);
ledger.note("provenance", "operator", `BUILD: LLM reference impl /tmp/ref_${tier}.py (recon workflow whs6yb1ho). Invariant asserts inline; exit 0 requires them to hold.`);

let sandbox, verdict;
try {
  sandbox = grader.createSandbox(`tier-${tier}`);
  ledger.note("setup", "factory", `sandbox ${sandbox} (clean HEAD)`);
  const noKeys = { ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "" };

  // GATE: the LLM-built impl runs green against the sandbox's clean-HEAD framework
  ledger.openGate("reference_impl_runs", "builder");
  const impl = run(VENV, [`/tmp/ref_${tier}.py`], sandbox, noKeys);
  const implTail = impl.out.trim().split("\n").filter(Boolean).slice(-2).join(" | ");
  impl.exit === 0
    ? ledger.clearGate("reference_impl_runs", "builder", { tail: implTail }, "LLM-built capability runs green against clean-HEAD framework (no keys/network)")
    : ledger.failGate("reference_impl_runs", "builder", "capability impl did not run green", { exit: impl.exit, tail: impl.out.slice(-500) });

  // GATE: the invariant is STRONG — the impl printed its explicit invariant-holds marker
  ledger.openGate("invariant_strong", "grader");
  const markers = { medium: "INVARIANT HOLDS", hard: "INVARIANTS HELD", "extra-hard": "CAPABILITIES VERIFIED" };
  impl.out.includes(markers[tier]) && impl.exit === 0
    ? ledger.clearGate("invariant_strong", "grader", { marker: markers[tier] }, `event-log invariant asserted and held ("${markers[tier]}")`)
    : ledger.failGate("invariant_strong", "grader", "invariant marker absent — assertions did not all hold", { expected: markers[tier] });

  // GATE: framework's own tier oracle stays green (no framework breakage)
  ledger.openGate("framework_suite_green", "grader");
  const fw = run(VENV, ["-m", "pytest", ...ORACLE, "-p", "no:cacheprovider", "-q", "--no-header"], sandbox, noKeys);
  const fwSum = fw.out.trim().split("\n").filter(Boolean).pop();
  fw.exit === 0 && !/failed/.test(fw.out)
    ? ledger.clearGate("framework_suite_green", "grader", { summary: fwSum }, "framework's own tier oracle tests pass")
    : ledger.failGate("framework_suite_green", "grader", "framework oracle not green", { summary: fwSum });

  verdict = ledger.verdict(REQUIRED);
  console.log(`\n${tier.toUpperCase()} TIER CAPABILITY — VERDICT: ${verdict.verdict}`);
  console.log(`cleared: [${verdict.cleared.join(", ")}]`);
  if (verdict.failed.length) console.log(`failed: [${verdict.failed.join(", ")}]`);
  console.log(`ledger: ${path.relative(REPO_ROOT, ledgerPath)}`);
} finally {
  if (sandbox) grader.destroySandbox(sandbox);
}
process.exit(verdict && verdict.verified ? 0 : 1);
