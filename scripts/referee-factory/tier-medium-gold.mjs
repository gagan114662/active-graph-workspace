#!/usr/bin/env node
// referee-factory/tier-medium-gold.mjs
//
// MEDIUM tier at the GOLD standard (same bar as serde): the LLM-built capability
// is graded by an INDEPENDENT sealed acceptance the builder did not author, AND a
// no-op control proves the acceptance is non-vacuous (an empty run fails it).
// This closes the "self-asserted invariant" gap of tier-capability.mjs.
//
// Default-to-error + trace.

import { spawnSync } from "node:child_process";
import path from "node:path";
import url from "node:url";
import { Ledger } from "./ledger.mjs";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const INNER = path.join(REPO_ROOT, "activegraph");
const VENV = path.join(INNER, ".venv", "bin", "python");
const TIERS = path.join(__dirname, "tiers");
const REQUIRED = ["build_runs", "independent_acceptance", "noop_control_fails"];

function run(args) {
  const r = spawnSync(VENV, args, { cwd: INNER, env: { ...process.env, ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", PYTHONDONTWRITEBYTECODE: "1" }, encoding: "utf8", timeout: 180000, maxBuffer: 1024 * 1024 * 32 });
  return { exit: r.status === null ? 124 : r.status, out: (r.stdout || "") + (r.stderr || "") };
}
const grabUrl = (s, name) => (s.match(new RegExp("sqlite:////[^\\s\"']*" + name)) || [])[0];

const ts = new Date().toISOString().replace(/[:.]/g, "-");
const ledgerPath = path.join(REPO_ROOT, "frames", "referee", `tier-medium-gold-${ts}.proof.jsonl`);
const ledger = new Ledger(ledgerPath, "tier-medium::gold");
ledger.note("control", "harness", "MEDIUM tier at GOLD standard — independent sealed acceptance + no-op control (same bar as serde)");
ledger.note("provenance", "operator", "BUILD: LLM reference impl /tmp/ref_medium.py. ACCEPTANCE: referee-authored tiers/accept_medium.py (builder never saw it).");

// GATE: the build runs and produces an event store
ledger.openGate("build_runs", "builder");
const build = run(["/tmp/ref_medium.py"]);
const dbUrl = grabUrl(build.out, "ontology.db");
build.exit === 0 && dbUrl
  ? ledger.clearGate("build_runs", "builder", { store: dbUrl }, "LLM-built medium capability ran and persisted an event store")
  : ledger.failGate("build_runs", "builder", "build did not run / no store", { exit: build.exit, tail: build.out.slice(-300) });

// GATE: independent acceptance passes on the real build
ledger.openGate("independent_acceptance", "grader");
const acc = dbUrl ? run([path.join(TIERS, "accept_medium.py"), dbUrl]) : { exit: 1, out: "no store" };
acc.exit === 0 && /INDEP_ACCEPT_PASS/.test(acc.out)
  ? ledger.clearGate("independent_acceptance", "grader", { result: acc.out.trim().split("\n").pop() }, "referee-authored acceptance confirms the capability from the event log alone")
  : ledger.failGate("independent_acceptance", "grader", "independent acceptance did not pass", { tail: acc.out.slice(-300) });

// GATE: no-op control FAILS the same acceptance (proves the oracle is non-vacuous)
ledger.openGate("noop_control_fails", "grader");
const noop = run([path.join(TIERS, "noop_medium.py")]);
const noopUrl = grabUrl(noop.out, "noop.db");
const noopAcc = noopUrl ? run([path.join(TIERS, "accept_medium.py"), noopUrl]) : { exit: 1, out: "no noop store" };
noopAcc.exit !== 0 && /INDEP_ACCEPT_FAIL/.test(noopAcc.out)
  ? ledger.clearGate("noop_control_fails", "grader", { result: "no-op correctly REJECTED" }, "empty run fails the acceptance — the oracle is non-vacuous, the VERIFIED is meaningful")
  : ledger.failGate("noop_control_fails", "grader", "no-op control PASSED the acceptance — oracle is vacuous!", { tail: noopAcc.out.slice(-200) });

const verdict = ledger.verdict(REQUIRED);
console.log(`\nMEDIUM TIER (GOLD) — VERDICT: ${verdict.verdict}`);
console.log(`cleared: [${verdict.cleared.join(", ")}]`);
if (verdict.failed.length) console.log(`failed: [${verdict.failed.join(", ")}]`);
console.log(`ledger: ${path.relative(REPO_ROOT, ledgerPath)}`);
process.exit(verdict.verified ? 0 : 1);
