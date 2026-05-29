import { spawnSync } from "node:child_process";
import fs from "node:fs"; import path from "node:path"; import url from "node:url";
import { Ledger } from "./ledger.mjs";
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", ".."); const VENV = path.join(ROOT, "activegraph", ".venv", "bin", "python");
const P = path.join(__dirname, "polsia"); const ACC = path.join(P, "accept_daemon.py"); const NOOP = path.join(P, "noop_daemon.py");
const REQ = ["daemon_present", "orchestration_invariant", "no_gate_control_fails"];
const py = (a) => { const r = spawnSync(VENV, a, { env: { ...process.env, ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", PYTHONDONTWRITEBYTECODE: "1" }, encoding: "utf8", timeout: 120000, maxBuffer: 1 << 24 }); return { exit: r.status === null ? 124 : r.status, out: (r.stdout || "") + (r.stderr || "") }; };
const ts = new Date().toISOString().replace(/[:.]/g, "-"); const out = [];
for (const id of [1, 2, 3]) {
  const sol = `/tmp/polsia-d-${id}/daemon.py`;
  const lp = path.join(ROOT, "frames", "referee", `polsia-daemon-builder-${id}-${ts}.proof.jsonl`);
  const L = new Ledger(lp, "polsia-daemon::live");
  L.note("control", "harness", `Polsia always-on daemon orchestration (paid+unblocked, dep-ordered) — blind builder-${id}`);
  L.note("provenance", "operator", `LLM-AGENT BUILD: blind builder-${id} (workflow ww4vacmuo). Acceptance referee-authored.`);
  L.openGate("daemon_present", "grader"); fs.existsSync(sol) ? L.clearGate("daemon_present", "grader", {}, "daemon written") : L.failGate("daemon_present", "grader", "no module");
  L.openGate("orchestration_invariant", "grader");
  const a = fs.existsSync(sol) ? py([ACC, sol]) : { exit: 1, out: "no module" };
  a.exit === 0 && /DAEMON_ACCEPT_PASS/.test(a.out) ? L.clearGate("orchestration_invariant", "grader", { r: a.out.trim().split("\n").pop() }, "paid+unblocked tasks executed in dep order; free-tier never executed") : L.failGate("orchestration_invariant", "grader", "orchestration breach (billing or dependency)", { tail: a.out.slice(-300) });
  L.openGate("no_gate_control_fails", "grader");
  const n = py([ACC, NOOP]); n.exit !== 0 && /DAEMON_ACCEPT_FAIL/.test(n.out) ? L.clearGate("no_gate_control_fails", "grader", {}, "no-gate daemon FAILS (free task runs) — oracle non-vacuous") : L.failGate("no_gate_control_fails", "grader", "no-gate PASSED — vacuous!");
  const v = L.verdict(REQ); out.push({ id, verdict: v.verdict, failed: v.failed });
}
const ok = out.filter((o) => o.verdict === "VERIFIED");
console.log("\n  POLSIA ALWAYS-ON DAEMON (AFK orchestration) — blind builder panel");
for (const o of out) console.log(`  ${o.verdict === "VERIFIED" ? "✅" : "❌"} builder-${o.id}: ${o.verdict}${o.failed.length ? ` (${o.failed.join(",")})` : ""}`);
console.log(`  orchestration-correct rate: ${ok.length}/${out.length} (paid+unblocked, dep-ordered, free never runs). oracle non-vacuous.\n`);
