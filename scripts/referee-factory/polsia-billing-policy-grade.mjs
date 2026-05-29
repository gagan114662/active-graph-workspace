#!/usr/bin/env node
// referee-factory/polsia-billing-policy-grade.mjs
//
// Grades blind-builder EXTRA-HARD billing policies against the independent
// 5-scenario acceptance (accept_billing_policy.py — free/spoofed_status/
// spoofed_webhook/payment_failed/genuinely_paid), with a naive control that
// trusts stripe_status and must FAIL. Default-to-error + trace.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { Ledger } from "./ledger.mjs";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const VENV = path.join(REPO_ROOT, "activegraph", ".venv", "bin", "python");
const POLSIA = path.join(__dirname, "polsia");
const ACCEPT = path.join(POLSIA, "accept_billing_policy.py");
const NAIVE = path.join(POLSIA, "noop_policy.py");
const REQUIRED = ["policy_present", "billing_policy_invariant", "naive_control_fails"];

function py(args) {
  const r = spawnSync(VENV, args, { env: { ...process.env, ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", PYTHONDONTWRITEBYTECODE: "1" }, encoding: "utf8", timeout: 120000, maxBuffer: 1024 * 1024 * 16 });
  return { exit: r.status === null ? 124 : r.status, out: (r.stdout || "") + (r.stderr || "") };
}

const builds = [1, 2, 3].map((i) => ({ id: i, pol: `/tmp/polsia-pol-${i}/policy.py` }));
const ts = new Date().toISOString().replace(/[:.]/g, "-");
const out = [];
for (const b of builds) {
  const ledgerPath = path.join(REPO_ROOT, "frames", "referee", `polsia-billing-policy-builder-${b.id}-${ts}.proof.jsonl`);
  const ledger = new Ledger(ledgerPath, "polsia-billing-policy::live");
  ledger.note("control", "harness", `Polsia EXTRA-HARD billing policy — blind builder-${b.id} vs spoof-resistant 5-scenario acceptance`);
  ledger.note("provenance", "operator", `LLM-AGENT BUILD: blind builder-${b.id} (workflow w61d5lf72). Acceptance referee-authored; builder never saw it.`);

  ledger.openGate("policy_present", "grader");
  fs.existsSync(b.pol)
    ? ledger.clearGate("policy_present", "grader", { path: b.pol }, "builder wrote a billing policy module")
    : ledger.failGate("policy_present", "grader", "no policy module produced");

  ledger.openGate("billing_policy_invariant", "grader");
  const acc = fs.existsSync(b.pol) ? py([ACCEPT, b.pol]) : { exit: 1, out: "no policy" };
  acc.exit === 0 && /BILLING_POLICY_ACCEPT_PASS/.test(acc.out)
    ? ledger.clearGate("billing_policy_invariant", "grader", { result: acc.out.trim().split("\n").pop() }, "no execution for free/spoofed-status/spoofed-webhook/payment-failed; only verified-paid executes")
    : ledger.failGate("billing_policy_invariant", "grader", "billing policy BREACHED (spoof or revenue leak)", { tail: acc.out.slice(-400) });

  ledger.openGate("naive_control_fails", "grader");
  const naive = py([ACCEPT, NAIVE]);
  naive.exit !== 0 && /BILLING_POLICY_ACCEPT_FAIL/.test(naive.out)
    ? ledger.clearGate("naive_control_fails", "grader", {}, "naive (trusts stripe_status) FAILS on spoofed_status — oracle is non-vacuous")
    : ledger.failGate("naive_control_fails", "grader", "naive policy PASSED — oracle vacuous!");

  const v = ledger.verdict(REQUIRED);
  out.push({ id: b.id, verdict: v.verdict, failed: v.failed });
}
const ok = out.filter((o) => o.verdict === "VERIFIED");
console.log("\n══════════════════════════════════════════════════════════════════════");
console.log("  POLSIA EXTRA-HARD BILLING POLICY — blind builder panel (spoof-resistant)");
console.log("══════════════════════════════════════════════════════════════════════");
for (const o of out) console.log(`  ${o.verdict === "VERIFIED" ? "✅" : "❌"} builder-${o.id}: ${o.verdict}${o.failed.length ? ` (failed: ${o.failed.join(", ")})` : ""}`);
console.log("  ──────────────────────────────────────────────────────────────────");
console.log(`  spoof-resistant rate: ${ok.length}/${out.length} blind builders survive forged-status + spoofed-webhook + payment-failed`);
console.log(`  referee invariant: any free/spoof execution -> ERROR. Oracle proven non-vacuous (naive FAILS on spoofed_status).`);
console.log("══════════════════════════════════════════════════════════════════════\n");
