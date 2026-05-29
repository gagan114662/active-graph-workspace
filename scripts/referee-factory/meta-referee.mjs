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

const verdict = L.verdict(O.map((o) => `oracle:${o.n}`).concat("oracle:serde_control_suite"));
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
