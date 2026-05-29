#!/usr/bin/env node
// referee-factory/polsia-safewrite-grade.mjs
//
// Grades blind-builder implementations of the Polsia sandboxed writer against the
// referee-authored, independent path-traversal acceptance (accept_safewrite.py),
// with a no-op control proving the oracle is non-vacuous. Default-to-error + trace.
//
// Reports the two numbers that matter for a security primitive:
//   secure-rate   = how many blind builders produced a jail-safe writer
//   referee block = any insecure writer is REJECTED (no insecure code "ships")

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { Ledger } from "./ledger.mjs";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const VENV = path.join(REPO_ROOT, "activegraph", ".venv", "bin", "python");
const POLSIA = path.join(__dirname, "polsia");
const ACCEPT = path.join(POLSIA, "accept_safewrite.py");
const NAIVE = path.join(POLSIA, "ref_naive_write.py");
const REQUIRED = ["solution_present", "security_acceptance", "noop_control_fails"];

function py(args) {
  const r = spawnSync(VENV, args, { env: { ...process.env, ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", PYTHONDONTWRITEBYTECODE: "1" }, encoding: "utf8", timeout: 120000, maxBuffer: 1024 * 1024 * 16 });
  return { exit: r.status === null ? 124 : r.status, out: (r.stdout || "") + (r.stderr || "") };
}

const builds = [1, 2, 3].map((i) => ({ id: i, sol: `/tmp/polsia-build-${i}/solution_safewrite.py` }));
const ts = new Date().toISOString().replace(/[:.]/g, "-");
const out = [];

for (const b of builds) {
  const ledgerPath = path.join(REPO_ROOT, "frames", "referee", `polsia-safewrite-builder-${b.id}-${ts}.proof.jsonl`);
  const ledger = new Ledger(ledgerPath, "polsia-safewrite::live");
  ledger.note("control", "harness", `Polsia just-bash sandboxed writer — blind builder-${b.id} vs independent path-traversal oracle`);
  ledger.note("provenance", "operator", `LLM-AGENT BUILD: blind builder-${b.id} (workflow w27m67e9l). Acceptance referee-authored; builder never saw it.`);

  ledger.openGate("solution_present", "grader");
  fs.existsSync(b.sol)
    ? ledger.clearGate("solution_present", "grader", { path: b.sol }, "builder wrote a solution module")
    : ledger.failGate("solution_present", "grader", "builder produced no solution file");

  ledger.openGate("security_acceptance", "grader");
  const acc = fs.existsSync(b.sol) ? py([ACCEPT, b.sol]) : { exit: 1, out: "no solution" };
  acc.exit === 0 && /SAFEWRITE_ACCEPT_PASS/.test(acc.out)
    ? ledger.clearGate("security_acceptance", "grader", { result: acc.out.trim().split("\n").pop() }, "jail-safe: all traversal attacks refused/contained, legit writes jailed")
    : ledger.failGate("security_acceptance", "grader", "INSECURE — failed the path-traversal acceptance", { tail: acc.out.slice(-400) });

  ledger.openGate("noop_control_fails", "grader");
  const naive = py([ACCEPT, NAIVE]);
  naive.exit !== 0 && /SAFEWRITE_ACCEPT_FAIL/.test(naive.out)
    ? ledger.clearGate("noop_control_fails", "grader", {}, "naive writer FAILS the same oracle — oracle is non-vacuous")
    : ledger.failGate("noop_control_fails", "grader", "naive writer PASSED — oracle vacuous!");

  const v = ledger.verdict(REQUIRED);
  out.push({ id: b.id, verdict: v.verdict, failed: v.failed, ledger: ledgerPath });
}

const secure = out.filter((o) => o.verdict === "VERIFIED");
console.log("\n══════════════════════════════════════════════════════════════════════");
console.log("  POLSIA just-bash SANDBOXED WRITER — blind builder security panel");
console.log("══════════════════════════════════════════════════════════════════════");
for (const o of out) console.log(`  ${o.verdict === "VERIFIED" ? "✅" : "❌"} builder-${o.id}: ${o.verdict}${o.failed.length ? ` (failed: ${o.failed.join(", ")})` : ""}`);
console.log("  ──────────────────────────────────────────────────────────────────");
console.log(`  secure-rate: ${secure.length}/${out.length} blind builders produced a jail-safe writer`);
console.log(`  referee invariant: any insecure writer -> ERROR (no insecure code passes). Oracle proven non-vacuous (naive FAILS).`);
console.log("══════════════════════════════════════════════════════════════════════\n");
