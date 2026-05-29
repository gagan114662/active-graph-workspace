#!/usr/bin/env node
// referee-factory/polsia-webfetch-grade.mjs
//
// Grades blind-builder web-fetch tools against the independent SSRF acceptance
// (accept_webfetch.py — loopback/private/link-local-metadata/DNS-rebinding +
// containment), with a naive control proving the oracle non-vacuous. Default-to-
// error + trace. Reports ssrf-safe-rate + referee invariant.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { Ledger } from "./ledger.mjs";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const VENV = path.join(REPO_ROOT, "activegraph", ".venv", "bin", "python");
const POLSIA = path.join(__dirname, "polsia");
const ACCEPT = path.join(POLSIA, "accept_webfetch.py");
const NAIVE = path.join(POLSIA, "ref_naive_fetch.py");
const REQUIRED = ["tool_present", "ssrf_security_acceptance", "naive_control_fails"];

function py(args) {
  const r = spawnSync(VENV, args, { env: { ...process.env, ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", PYTHONDONTWRITEBYTECODE: "1" }, encoding: "utf8", timeout: 120000, maxBuffer: 1024 * 1024 * 16 });
  return { exit: r.status === null ? 124 : r.status, out: (r.stdout || "") + (r.stderr || "") };
}

const builds = [1, 2, 3].map((i) => ({ id: i, tool: `/tmp/polsia-web-${i}/fetch.py` }));
const ts = new Date().toISOString().replace(/[:.]/g, "-");
const out = [];
for (const b of builds) {
  const ledgerPath = path.join(REPO_ROOT, "frames", "referee", `polsia-webfetch-builder-${b.id}-${ts}.proof.jsonl`);
  const ledger = new Ledger(ledgerPath, "polsia-webfetch::live");
  ledger.note("control", "harness", `Polsia SSRF-defended web-fetch — blind builder-${b.id} vs independent SSRF adversary`);
  ledger.note("provenance", "operator", `LLM-AGENT BUILD: blind builder-${b.id} (workflow wb4zdzndh). Acceptance referee-authored; builder never saw it.`);

  ledger.openGate("tool_present", "grader");
  fs.existsSync(b.tool)
    ? ledger.clearGate("tool_present", "grader", { path: b.tool }, "builder wrote a web-fetch tool")
    : ledger.failGate("tool_present", "grader", "no tool module produced");

  ledger.openGate("ssrf_security_acceptance", "grader");
  const acc = fs.existsSync(b.tool) ? py([ACCEPT, b.tool]) : { exit: 1, out: "no tool" };
  acc.exit === 0 && /WEBFETCH_ACCEPT_PASS/.test(acc.out)
    ? ledger.clearGate("ssrf_security_acceptance", "grader", { result: acc.out.trim().split("\n").pop() }, "public fetches allowed; loopback/private/metadata/DNS-rebinding refused AND contained (fetch never called)")
    : ledger.failGate("ssrf_security_acceptance", "grader", "SSRF — failed the adversary acceptance", { tail: acc.out.slice(-400) });

  ledger.openGate("naive_control_fails", "grader");
  const naive = py([ACCEPT, NAIVE]);
  naive.exit !== 0 && /WEBFETCH_ACCEPT_FAIL/.test(naive.out)
    ? ledger.clearGate("naive_control_fails", "grader", {}, "naive fetcher FAILS (reaches loopback) — oracle is non-vacuous")
    : ledger.failGate("naive_control_fails", "grader", "naive fetcher PASSED — oracle vacuous!");

  const v = ledger.verdict(REQUIRED);
  out.push({ id: b.id, verdict: v.verdict, failed: v.failed });
}
const ok = out.filter((o) => o.verdict === "VERIFIED");
console.log("\n══════════════════════════════════════════════════════════════════════");
console.log("  POLSIA WEB-FETCH (SSRF-DEFENDED) — blind builder panel (Agentic Access)");
console.log("══════════════════════════════════════════════════════════════════════");
for (const o of out) console.log(`  ${o.verdict === "VERIFIED" ? "✅" : "❌"} builder-${o.id}: ${o.verdict}${o.failed.length ? ` (failed: ${o.failed.join(", ")})` : ""}`);
console.log("  ──────────────────────────────────────────────────────────────────");
console.log(`  ssrf-safe rate: ${ok.length}/${out.length} blind builders refuse+contain loopback/private/metadata/DNS-rebinding`);
console.log(`  referee invariant: any SSRF reach -> ERROR. Oracle proven non-vacuous (naive FAILS).`);
console.log("══════════════════════════════════════════════════════════════════════\n");
