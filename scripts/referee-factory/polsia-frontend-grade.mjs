import { spawnSync } from "node:child_process";
import fs from "node:fs"; import path from "node:path"; import url from "node:url";
import { Ledger } from "./ledger.mjs";
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", ".."); const VENV = path.join(ROOT, "activegraph", ".venv", "bin", "python");
const F = path.join(__dirname, "polsia", "frontend"); const ACC = path.join(F, "accept_frontend.py"); const NEG = path.join(F, "bad_landing.html");
const REQ = ["page_present", "frontend_acceptance", "negative_control_fails"];
const py = (a) => { const r = spawnSync(VENV, a, { encoding: "utf8", timeout: 60000, maxBuffer: 1 << 24 }); return { exit: r.status === null ? 124 : r.status, out: (r.stdout || "") + (r.stderr || "") }; };
const ts = new Date().toISOString().replace(/[:.]/g, "-"); const out = [];
for (const id of [1, 2, 3, 4, 5]) {
  const f = `/tmp/polsia-fe-${id}/index.html`;
  const lp = path.join(ROOT, "frames", "referee", `polsia-frontend-builder-${id}-${ts}.proof.jsonl`);
  const L = new Ledger(lp, "polsia-frontend::live");
  L.note("control", "harness", `Open Polsia landing page — blind builder-${id}`);
  L.note("provenance", "operator", `LLM-AGENT BUILD: blind frontend builder-${id} (workflow wza3sghru)`);
  L.openGate("page_present", "grader"); fs.existsSync(f) ? L.clearGate("page_present", "grader", {}, "landing page written") : L.failGate("page_present", "grader", "no page");
  L.openGate("frontend_acceptance", "grader");
  const a = fs.existsSync(f) ? py([ACC, f]) : { exit: 1, out: "no page" };
  a.exit === 0 && /FRONTEND_ACCEPT_PASS/.test(a.out) ? L.clearGate("frontend_acceptance", "grader", { r: a.out.trim().split("\n").pop() }, "valid signup page, posts to trusted endpoint, no secrets, no dangerous sinks") : L.failGate("frontend_acceptance", "grader", "front-end acceptance failed", { tail: a.out.slice(-300) });
  L.openGate("negative_control_fails", "grader");
  const n = py([ACC, NEG]); n.exit !== 0 && /FRONTEND_ACCEPT_FAIL/.test(n.out) ? L.clearGate("negative_control_fails", "grader", {}, "attacker/secret/eval page FAILS — oracle non-vacuous") : L.failGate("negative_control_fails", "grader", "negative control PASSED — vacuous!");
  const v = L.verdict(REQ); out.push({ id, verdict: v.verdict, failed: v.failed });
}
const ok = out.filter((o) => o.verdict === "VERIFIED");
console.log("\n  OPEN POLSIA LANDING PAGE — blind builder fleet");
for (const o of out) console.log(`  ${o.verdict === "VERIFIED" ? "✅" : "❌"} frontend-${o.id}: ${o.verdict}${o.failed.length ? ` (${o.failed.join(",")})` : ""}`);
console.log(`  front-end-safe rate: ${ok.length}/${out.length} (valid signup, trusted endpoint, no secrets/sinks). oracle non-vacuous.\n`);
