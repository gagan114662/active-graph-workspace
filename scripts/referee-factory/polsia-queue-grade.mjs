import { spawnSync } from "node:child_process";
import fs from "node:fs"; import path from "node:path"; import url from "node:url";
import { Ledger } from "./ledger.mjs";
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", ".."); const VENV = path.join(ROOT, "activegraph", ".venv", "bin", "python");
const P = path.join(__dirname, "polsia"); const ACC = path.join(P, "accept_queue.py"); const NOOP = path.join(P, "noop_consumer.py");
const REQ = ["consumer_present", "queue_drain_invariant", "no_drain_control_fails"];
const py = (a) => { const r = spawnSync(VENV, a, { env: { ...process.env, ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", PYTHONDONTWRITEBYTECODE: "1" }, encoding: "utf8", timeout: 120000, maxBuffer: 1 << 24 }); return { exit: r.status === null ? 124 : r.status, out: (r.stdout || "") + (r.stderr || "") }; };
const ts = new Date().toISOString().replace(/[:.]/g, "-"); const out = [];
for (const id of [1, 2, 3]) {
  const sol = `/tmp/polsia-q-${id}/consumer.py`;
  const lp = path.join(ROOT, "frames", "referee", `polsia-queue-builder-${id}-${ts}.proof.jsonl`);
  const L = new Ledger(lp, "polsia-queue::live");
  L.note("control", "harness", `Polsia parallel task-queue consumer (AFK) — blind builder-${id}`);
  L.note("provenance", "operator", `LLM-AGENT BUILD: blind builder-${id} (workflow wwm517ram). Acceptance referee-authored.`);
  L.openGate("consumer_present", "grader"); fs.existsSync(sol) ? L.clearGate("consumer_present", "grader", {}, "consumer written") : L.failGate("consumer_present", "grader", "no module");
  L.openGate("queue_drain_invariant", "grader");
  const a = fs.existsSync(sol) ? py([ACC, sol]) : { exit: 1, out: "no module" };
  a.exit === 0 && /QUEUE_ACCEPT_PASS/.test(a.out) ? L.clearGate("queue_drain_invariant", "grader", { r: a.out.trim().split("\n").pop() }, "10 tasks drained, exactly-once, 0 patch.rejected") : L.failGate("queue_drain_invariant", "grader", "queue invariant breached", { tail: a.out.slice(-300) });
  L.openGate("no_drain_control_fails", "grader");
  const n = py([ACC, NOOP]); n.exit !== 0 && /QUEUE_ACCEPT_FAIL/.test(n.out) ? L.clearGate("no_drain_control_fails", "grader", {}, "no-drain consumer FAILS — oracle non-vacuous") : L.failGate("no_drain_control_fails", "grader", "no-drain PASSED — vacuous!");
  const v = L.verdict(REQ); out.push({ id, verdict: v.verdict, failed: v.failed });
}
const ok = out.filter((o) => o.verdict === "VERIFIED");
console.log("\n  POLSIA PARALLEL QUEUE (AFK execution) — blind builder panel");
for (const o of out) console.log(`  ${o.verdict === "VERIFIED" ? "✅" : "❌"} builder-${o.id}: ${o.verdict}${o.failed.length ? ` (${o.failed.join(",")})` : ""}`);
console.log(`  drain-safe rate: ${ok.length}/${out.length} (10 tasks drained, exactly-once, no race). oracle non-vacuous.\n`);
