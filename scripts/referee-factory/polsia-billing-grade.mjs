#!/usr/bin/env node
// referee-factory/polsia-billing-grade.mjs
//
// Grades blind-builder billing gates against the independent free/active fork
// acceptance (accept_billing.py), with a no-gate control proving non-vacuity.
// Default-to-error + trace. Reports billing-correct-rate + referee invariant.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { Ledger } from "./ledger.mjs";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const VENV = path.join(REPO_ROOT, "activegraph", ".venv", "bin", "python");
const POLSIA = path.join(__dirname, "polsia");
const ACCEPT = path.join(POLSIA, "accept_billing.py");
const NOGATE = path.join(POLSIA, "noop_gate.py");
const REQUIRED = ["gate_present", "billing_invariant", "noop_control_fails"];

function py(args) {
  const r = spawnSync(VENV, args, { env: { ...process.env, ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", PYTHONDONTWRITEBYTECODE: "1" }, encoding: "utf8", timeout: 120000, maxBuffer: 1024 * 1024 * 16 });
  return { exit: r.status === null ? 124 : r.status, out: (r.stdout || "") + (r.stderr || "") };
}

const builds = [1, 2, 3].map((i) => ({ id: i, gate: `/tmp/polsia-bill-${i}/gate.py` }));
const ts = new Date().toISOString().replace(/[:.]/g, "-");
const out = [];
for (const b of builds) {
  const ledgerPath = path.join(REPO_ROOT, "frames", "referee", `polsia-billing-builder-${b.id}-${ts}.proof.jsonl`);
  const ledger = new Ledger(ledgerPath, "polsia-billing::live");
  ledger.note("control", "harness", `Polsia billing gate — blind builder-${b.id} vs independent free/active fork acceptance`);
  ledger.note("provenance", "operator", `LLM-AGENT BUILD: blind builder-${b.id} (workflow wtlpbwmnt). Acceptance referee-authored; builder never saw it.`);

  ledger.openGate("gate_present", "grader");
  fs.existsSync(b.gate)
    ? ledger.clearGate("gate_present", "grader", { path: b.gate }, "builder wrote a billing gate module")
    : ledger.failGate("gate_present", "grader", "no gate module produced");

  ledger.openGate("billing_invariant", "grader");
  const acc = fs.existsSync(b.gate) ? py([ACCEPT, b.gate]) : { exit: 1, out: "no gate" };
  acc.exit === 0 && /BILLING_ACCEPT_PASS/.test(acc.out)
    ? ledger.clearGate("billing_invariant", "grader", { result: acc.out.trim().split("\n").pop() }, "free tier executes 0 tools, active tier executes — billing invariant holds across forked scenarios")
    : ledger.failGate("billing_invariant", "grader", "billing invariant BREACHED", { tail: acc.out.slice(-400) });

  ledger.openGate("noop_control_fails", "grader");
  const nog = py([ACCEPT, NOGATE]);
  nog.exit !== 0 && /BILLING_ACCEPT_FAIL/.test(nog.out)
    ? ledger.clearGate("noop_control_fails", "grader", {}, "no-gate impl FAILS (free tier breaches) — oracle is non-vacuous")
    : ledger.failGate("noop_control_fails", "grader", "no-gate impl PASSED — oracle vacuous!");

  const v = ledger.verdict(REQUIRED);
  out.push({ id: b.id, verdict: v.verdict, failed: v.failed });
}
const ok = out.filter((o) => o.verdict === "VERIFIED");
console.log("\n══════════════════════════════════════════════════════════════════════");
console.log("  POLSIA BILLING GATE — blind builder panel (token-arbitrage protection)");
console.log("══════════════════════════════════════════════════════════════════════");
for (const o of out) console.log(`  ${o.verdict === "VERIFIED" ? "✅" : "❌"} builder-${o.id}: ${o.verdict}${o.failed.length ? ` (failed: ${o.failed.join(", ")})` : ""}`);
console.log("  ──────────────────────────────────────────────────────────────────");
console.log(`  billing-correct-rate: ${ok.length}/${out.length} blind builders enforce the invariant`);
console.log(`  referee invariant: any free-tier breach -> ERROR. Oracle proven non-vacuous (no-gate FAILS).`);
console.log("══════════════════════════════════════════════════════════════════════\n");
