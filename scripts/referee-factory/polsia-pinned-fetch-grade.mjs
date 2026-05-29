#!/usr/bin/env node
// referee-factory/polsia-pinned-fetch-grade.mjs
//
// Grades blind-builder connect-time-pinned fetchers against the independent
// DNS-rebind acceptance (accept_webfetch_pinned.py), with a non-pinning control
// proving non-vacuity. Default-to-error + trace.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { Ledger } from "./ledger.mjs";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const VENV = path.join(REPO_ROOT, "activegraph", ".venv", "bin", "python");
const POLSIA = path.join(__dirname, "polsia");
const ACCEPT = path.join(POLSIA, "accept_webfetch_pinned.py");
const UNPINNED = path.join(POLSIA, "ref_unpinned_fetch.py");
const REQUIRED = ["pinned_present", "dns_rebind_pinning", "nonpinning_control_fails"];

function py(args) {
  const r = spawnSync(VENV, args, { env: { ...process.env, ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", PYTHONDONTWRITEBYTECODE: "1" }, encoding: "utf8", timeout: 120000, maxBuffer: 1024 * 1024 * 16 });
  return { exit: r.status === null ? 124 : r.status, out: (r.stdout || "") + (r.stderr || "") };
}

const builds = [1, 2, 3].map((i) => ({ id: i, sol: `/tmp/polsia-pin-${i}/pinned_fetch.py` }));
const ts = new Date().toISOString().replace(/[:.]/g, "-");
const out = [];
for (const b of builds) {
  const ledgerPath = path.join(REPO_ROOT, "frames", "referee", `polsia-pinned-fetch-builder-${b.id}-${ts}.proof.jsonl`);
  const ledger = new Ledger(ledgerPath, "polsia-pinned-fetch::live");
  ledger.note("control", "harness", `Polsia connect-time IP pinning (DNS-rebind defense) — blind builder-${b.id}`);
  ledger.note("provenance", "operator", `LLM-AGENT BUILD: blind builder-${b.id} (workflow wbvtuavm1). Acceptance referee-authored; builder never saw it.`);

  ledger.openGate("pinned_present", "grader");
  fs.existsSync(b.sol)
    ? ledger.clearGate("pinned_present", "grader", { path: b.sol }, "builder wrote a pinned fetcher")
    : ledger.failGate("pinned_present", "grader", "no module produced");

  ledger.openGate("dns_rebind_pinning", "grader");
  const acc = fs.existsSync(b.sol) ? py([ACCEPT, b.sol]) : { exit: 1, out: "no module" };
  acc.exit === 0 && /WEBFETCH_PIN_ACCEPT_PASS/.test(acc.out)
    ? ledger.clearGate("dns_rebind_pinning", "grader", { result: acc.out.trim().split("\n").pop() }, "connects to the VETTED ip even when DNS rebinds to loopback at connect-time; SSRF still refused+contained")
    : ledger.failGate("dns_rebind_pinning", "grader", "DNS-rebind hole open (connected to a non-global ip)", { tail: acc.out.slice(-400) });

  ledger.openGate("nonpinning_control_fails", "grader");
  const np = py([ACCEPT, UNPINNED]);
  np.exit !== 0 && /WEBFETCH_PIN_ACCEPT_FAIL/.test(np.out)
    ? ledger.clearGate("nonpinning_control_fails", "grader", {}, "re-resolving (non-pinning) impl FAILS on rebind — oracle is non-vacuous")
    : ledger.failGate("nonpinning_control_fails", "grader", "non-pinning impl PASSED — oracle vacuous!");

  const v = ledger.verdict(REQUIRED);
  out.push({ id: b.id, verdict: v.verdict, failed: v.failed });
}
const ok = out.filter((o) => o.verdict === "VERIFIED");
console.log("\n══════════════════════════════════════════════════════════════════════");
console.log("  POLSIA WEB-FETCH — connect-time IP PINNING (DNS-rebind/TOCTOU defense)");
console.log("══════════════════════════════════════════════════════════════════════");
for (const o of out) console.log(`  ${o.verdict === "VERIFIED" ? "✅" : "❌"} builder-${o.id}: ${o.verdict}${o.failed.length ? ` (failed: ${o.failed.join(", ")})` : ""}`);
console.log("  ──────────────────────────────────────────────────────────────────");
console.log(`  rebind-safe rate: ${ok.length}/${out.length} blind builders pin to the vetted ip (rebind to loopback caught)`);
console.log(`  referee invariant: any connect to a non-global ip -> ERROR. Oracle non-vacuous (re-resolving impl FAILS).`);
console.log("══════════════════════════════════════════════════════════════════════\n");
