#!/usr/bin/env node
// meta-referee.mjs — the referee FOR the referee.
// For every oracle: its POSITIVE control must PASS and its NEGATIVE control must
// FAIL. An oracle that can't fail honestly (negative passes) is REJECTED before it
// is ever trusted to grade an LLM. This automates the non-vacuity check that was
// previously hand-verified (audit section D). The meta-referee has its OWN negative
// control (a vacuous oracle it must reject) so it is itself non-vacuous.
import { spawnSync } from "node:child_process";
import path from "node:path"; import url from "node:url";
import { Ledger } from "./ledger.mjs";
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", ".."); const VENV = path.join(ROOT, "activegraph", ".venv", "bin", "python");
const P = path.join(__dirname, "polsia"), SH = path.join(P, "selfheal");
const py = (a) => { const r = spawnSync(VENV, a, { env: { ...process.env, ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", PYTHONDONTWRITEBYTECODE: "1" }, encoding: "utf8", timeout: 180000, maxBuffer: 1 << 24 }); return { exit: r.status === null ? 124 : r.status, out: (r.stdout || "") + (r.stderr || "") }; };
const node = (a) => { const r = spawnSync("node", a, { cwd: ROOT, encoding: "utf8", timeout: 300000, maxBuffer: 1 << 24 }); return { exit: r.status === null ? 124 : r.status, out: (r.stdout || "") + (r.stderr || "") }; };

// oracle registry: accept script + positive control + negative control
const O = [
  ["safewrite", "accept_safewrite.py", "ref_safe_write.py", "ref_naive_write.py"],
  ["billing_gate", "accept_billing.py", "ref_gate.py", "noop_gate.py"],
  ["billing_policy", "accept_billing_policy.py", "ref_policy.py", "noop_policy.py"],
  ["webfetch_ssrf", "accept_webfetch.py", "ref_safe_fetch.py", "ref_naive_fetch.py"],
  ["webfetch_pinned", "accept_webfetch_pinned.py", "ref_pinned_fetch.py", "ref_unpinned_fetch.py"],
  ["queue", "accept_queue.py", "ref_consumer.py", "noop_consumer.py"],
  ["comms", "accept_comms.py", "ref_safe_comms.py", "ref_naive_comms.py"],
  ["daemon", "accept_daemon.py", "ref_daemon_logic.py", "noop_daemon.py"],
  ["selfheal", "accept_selfheal.py", "ref_selfheal_logic.py", "noop_selfheal.py"],
].map(([n, a, p, ng]) => ({ n, accept: path.join(P, a), pos: path.join(P, p), neg: path.join(P, ng) }));
O.push({ n: "selfheal_post", accept: path.join(SH, "accept_post.py"), pos: path.join(SH, "ref_fixed_post.py"), neg: path.join(SH, "flaky_post.py") });
O.push({ n: "frontend", accept: path.join(P, "frontend", "accept_frontend.py"), pos: path.join(P, "frontend", "ref_landing.html"), neg: path.join(P, "frontend", "bad_landing.html") });
// the meta-referee's OWN negative control: a vacuous oracle (must be REJECTED)
O.push({ n: "__VACUOUS_CONTROL__", accept: path.join(P, "_vacuous_accept.py"), pos: path.join(P, "ref_gate.py"), neg: path.join(P, "noop_gate.py"), expectBroken: true });

const ts = new Date().toISOString().replace(/[:.]/g, "-");
const ledgerPath = path.join(ROOT, "frames", "referee", `meta-referee-${ts}.proof.jsonl`);
const L = new Ledger(ledgerPath, "meta-referee::audit-the-auditor");
L.note("control", "meta-referee", "auditing every oracle for non-vacuity: positive must PASS, negative must FAIL");

const results = [];
for (const o of O) {
  const posR = py([o.accept, o.pos]);
  const negR = py([o.accept, o.neg]);
  const posPass = posR.exit === 0;
  const negFail = negR.exit !== 0;
  const valid = posPass && negFail;
  L.openGate(`oracle:${o.n}`, "meta-referee");
  // for the vacuous control, "valid" SHOULD be false (it's broken) — the meta-referee must catch it
  const correct = o.expectBroken ? !valid : valid;
  if (correct) {
    L.clearGate(`oracle:${o.n}`, "meta-referee", { posPass, negFail }, o.expectBroken
      ? "vacuous oracle correctly REJECTED (its negative control wrongly passed) — meta-referee is non-vacuous"
      : "oracle non-vacuous: positive clears, negative fails");
  } else {
    L.failGate(`oracle:${o.n}`, "meta-referee", o.expectBroken
      ? "meta-referee FAILED to reject a vacuous oracle!"
      : `oracle BROKEN: positive ${posPass ? "passed" : "FAILED"}, negative ${negFail ? "failed (good)" : "PASSED (vacuous!)"}`, { posPass, negFail });
  }
  results.push({ n: o.n, posPass, negFail, valid, correct, expectBroken: !!o.expectBroken });
}
// also re-validate the serde planted-bug control suite (4 strategies)
L.openGate("oracle:serde_control_suite", "meta-referee");
const serde = node(["scripts/referee-factory/run.mjs", "serde-swallow-corruption"]);
serde.exit === 0
  ? L.clearGate("oracle:serde_control_suite", "meta-referee", {}, "serde control suite: none/deleteTest/overfit ERROR, real VERIFIED (4/4 correct)")
  : L.failGate("oracle:serde_control_suite", "meta-referee", "serde control suite did not pass 4/4");
results.push({ n: "serde_control_suite", correct: serde.exit === 0, valid: serde.exit === 0 });

// ---- META-CHECK 3: provenance present on every build ledger ----
import fsx from "node:fs";
L.openGate("meta:provenance_present", "meta-referee");
const led = fsx.readdirSync(path.join(ROOT, "frames", "referee")).filter((x) => x.endsWith(".proof.jsonl"));
let provViolations = [];
for (const f of led) {
  const ev = fsx.readFileSync(path.join(ROOT, "frames", "referee", f), "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const hasBuild = ev.some((e) => e.stage === "build");
  const hasProv = ev.some((e) => e.stage === "provenance");
  // provenance is valid as an explicit event OR as a self-identifying task_id
  // (deterministic control strategies / operator tasks encode it in the id).
  const tids = [...new Set(ev.map((e) => e.task_id))];
  const selfProvenanced = tids.length > 0 && tids.every((t) => /::(none|deleteTest|overfit|real|snapshot-fix)$/.test(t));
  if (hasBuild && !hasProv && !selfProvenanced) provViolations.push(f.slice(0, 40));
}
provViolations.length === 0
  ? L.clearGate("meta:provenance_present", "meta-referee", { ledgers: led.length }, "every ledger with a build step carries a provenance stamp")
  : L.failGate("meta:provenance_present", "meta-referee", `${provViolations.length} build ledgers missing provenance`, { provViolations });
results.push({ n: "provenance_present", correct: provViolations.length === 0, valid: provViolations.length === 0 });

// ---- META-CHECK 4: report cannot contradict the ledgers ----
L.openGate("meta:report_consistent", "meta-referee");
// independent recount of LLM verified/error straight from the ledgers
let v = 0, e = 0;
for (const f of led) {
  const ev = fsx.readFileSync(path.join(ROOT, "frames", "referee", f), "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  if (!ev.find((x) => x.stage === "provenance" && /LLM-AGENT/.test(x.detail || ""))) continue;
  const verd = [...ev].reverse().find((x) => x.stage === "verdict");
  if (!verd) continue;
  verd.status === "VERIFIED" ? v++ : e++;
}
const rep = node(["scripts/referee-factory/report.mjs", "/tmp/_meta_report_check.txt"]);
const repTxt = fsx.existsSync("/tmp/_meta_report_check.txt") ? fsx.readFileSync("/tmp/_meta_report_check.txt", "utf8") : "";
const m = repTxt.match(/VERIFIED:\s*(\d+)\s*\|\s*caught-and-blocked.*?:\s*(\d+)/);
const repV = m ? parseInt(m[1], 10) : -1, repE = m ? parseInt(m[2], 10) : -1;
(repV === v && repE === e)
  ? L.clearGate("meta:report_consistent", "meta-referee", { ledger: { v, e }, report: { v: repV, e: repE } }, "report's headline numbers match an independent recount from the ledgers")
  : L.failGate("meta:report_consistent", "meta-referee", "report contradicts the ledgers", { ledger: { v, e }, report: { v: repV, e: repE } });
results.push({ n: "report_consistent", correct: repV === v && repE === e, valid: repV === v && repE === e });

const verdict = L.verdict(O.map((o) => `oracle:${o.n}`).concat("oracle:serde_control_suite", "meta:provenance_present", "meta:report_consistent"));
console.log("\n══════════════════════════════════════════════════════════════════════");
console.log("  META-REFEREE — auditing the auditor (every oracle must fail honestly)");
console.log("══════════════════════════════════════════════════════════════════════");
for (const r of results) {
  const tag = r.expectBroken ? "(self-control: must be rejected)" : "";
  console.log(`  ${r.correct ? "✅" : "❌"} ${r.n.padEnd(24)} ${r.expectBroken ? "REJECTED-as-vacuous" : (r.valid ? "non-vacuous (pos PASS / neg FAIL)" : "BROKEN")} ${tag}`);
}
console.log("  ──────────────────────────────────────────────────────────────────");
console.log(`  META-VERDICT: ${verdict.verdict} — ${verdict.verified ? "every oracle proven non-vacuous; the auditor is itself audited" : "an oracle is vacuous/broken — do NOT trust its grades"}`);
console.log(`  ledger: ${path.relative(ROOT, ledgerPath)}`);
console.log("══════════════════════════════════════════════════════════════════════\n");
process.exit(verdict.verified ? 0 : 1);
