import { spawnSync } from "node:child_process";
import fs from "node:fs"; import path from "node:path"; import url from "node:url";
import { Ledger } from "./ledger.mjs";
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", ".."); const VENV = path.join(ROOT, "activegraph", ".venv", "bin", "python");
const P = path.join(__dirname, "polsia"); const ACC = path.join(P, "accept_comms.py"); const NAIVE = path.join(P, "ref_naive_comms.py");
const REQ = ["comms_present", "comms_security_acceptance", "naive_control_fails"];
const py = (a) => { const r = spawnSync(VENV, a, { env: { ...process.env, ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", PYTHONDONTWRITEBYTECODE: "1" }, encoding: "utf8", timeout: 120000, maxBuffer: 1 << 24 }); return { exit: r.status === null ? 124 : r.status, out: (r.stdout || "") + (r.stderr || "") }; };
const ts = new Date().toISOString().replace(/[:.]/g, "-"); const out = [];
for (const id of [1, 2, 3]) {
  const sol = `/tmp/polsia-c-${id}/comms.py`;
  const lp = path.join(ROOT, "frames", "referee", `polsia-comms-builder-${id}-${ts}.proof.jsonl`);
  const L = new Ledger(lp, "polsia-comms::live");
  L.note("control", "harness", `Polsia email+twitter tools (Agentic Access) — blind builder-${id}`);
  L.note("provenance", "operator", `LLM-AGENT BUILD: blind builder-${id} (workflow w2mt00rrk). Acceptance referee-authored.`);
  L.openGate("comms_present", "grader"); fs.existsSync(sol) ? L.clearGate("comms_present", "grader", {}, "comms module written") : L.failGate("comms_present", "grader", "no module");
  L.openGate("comms_security_acceptance", "grader");
  const a = fs.existsSync(sol) ? py([ACC, sol]) : { exit: 1, out: "no module" };
  a.exit === 0 && /COMMS_ACCEPT_PASS/.test(a.out) ? L.clearGate("comms_security_acceptance", "grader", { r: a.out.trim().split("\n").pop() }, "email only to trusted recipient; injection + secret-leak refused+contained") : L.failGate("comms_security_acceptance", "grader", "comms security breached", { tail: a.out.slice(-300) });
  L.openGate("naive_control_fails", "grader");
  const n = py([ACC, NAIVE]); n.exit !== 0 && /COMMS_ACCEPT_FAIL/.test(n.out) ? L.clearGate("naive_control_fails", "grader", {}, "naive comms FAILS — oracle non-vacuous") : L.failGate("naive_control_fails", "grader", "naive PASSED — vacuous!");
  const v = L.verdict(REQ); out.push({ id, verdict: v.verdict, failed: v.failed });
}
const ok = out.filter((o) => o.verdict === "VERIFIED");
console.log("\n  POLSIA EMAIL+TWITTER (Agentic Access) — blind builder panel");
for (const o of out) console.log(`  ${o.verdict === "VERIFIED" ? "✅" : "❌"} builder-${o.id}: ${o.verdict}${o.failed.length ? ` (${o.failed.join(",")})` : ""}`);
console.log(`  injection-safe rate: ${ok.length}/${out.length} (email allow-list-of-one, secret-leak refused). oracle non-vacuous.\n`);
