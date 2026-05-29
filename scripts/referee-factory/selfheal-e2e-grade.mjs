// End-to-end self-healing referee: detection -> fix verified -> re-run clean -> diff, + non-vacuous control.
import { spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs"; import path from "node:path"; import url from "node:url";
import { Ledger } from "./ledger.mjs";
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", ".."); const VENV = path.join(ROOT, "activegraph", ".venv", "bin", "python");
const S = path.join(__dirname, "polsia", "selfheal");
const ORIGINAL = path.join(S, "flaky_post.py"), ACCEPT = path.join(S, "accept_post.py"), RUNB = path.join(S, "run_behavior.py");
const REQ = ["failure_detected", "fix_verified", "rerun_clean", "structural_diff", "no_repair_control_fails"];
const py = (a) => { const r = spawnSync(VENV, a, { env: { ...process.env, ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", PYTHONDONTWRITEBYTECODE: "1" }, encoding: "utf8", timeout: 120000, maxBuffer: 1 << 24 }); return { exit: r.status === null ? 124 : r.status, out: (r.stdout || "") + (r.stderr || "") }; };
const failedCount = (mod) => { const r = py([RUNB, mod]); const m = (r.out.match(/(\d+)\s*$/m) || [])[1]; return m ? parseInt(m, 10) : -1; };
const ts = new Date().toISOString().replace(/[:.]/g, "-"); const out = [];
for (const id of [1, 2, 3]) {
  const fork = `/tmp/selfheal-fork-${id}/post.py`;
  const lp = path.join(ROOT, "frames", "referee", `selfheal-e2e-builder-${id}-${ts}.proof.jsonl`);
  const L = new Ledger(lp, "selfheal-e2e::live");
  L.note("control", "harness", `End-to-end self-heal — behavior.failed -> external triage -> blind builder-${id} -> grade -> diff`);
  L.note("provenance", "operator", `LLM-AGENT REPAIR: blind builder-${id} (workflow waah03zdu) patched a drifted module after behavior.failed.`);

  L.openGate("failure_detected", "triage");
  const origFails = failedCount(ORIGINAL);
  origFails >= 1 ? L.clearGate("failure_detected", "triage", { behavior_failed: origFails }, "drifted module produced behavior.failed; external triage detected it in the log")
                 : L.failGate("failure_detected", "triage", "no behavior.failed from the drifted module", { behavior_failed: origFails });

  L.openGate("fix_verified", "grader");
  const acc = fs.existsSync(fork) ? py([ACCEPT, fork]) : { exit: 1, out: "no fork" };
  acc.exit === 0 && /POST_ACCEPT_PASS/.test(acc.out) ? L.clearGate("fix_verified", "grader", { r: acc.out.trim().split("\n").pop() }, "blind builder's patch passes the sealed oracle on held-out inputs")
                                                       : L.failGate("fix_verified", "grader", "patch failed the sealed oracle", { tail: acc.out.slice(-300) });

  L.openGate("rerun_clean", "grader");
  const reFails = fs.existsSync(fork) ? failedCount(fork) : -1;
  reFails === 0 ? L.clearGate("rerun_clean", "grader", { behavior_failed: reFails }, "re-running the behavior with the patched module yields 0 behavior.failed — healed")
                : L.failGate("rerun_clean", "grader", "behavior still fails after patch", { behavior_failed: reFails });

  L.openGate("structural_diff", "grader");
  let diff = ""; try { diff = execFileSync("diff", ["-u", ORIGINAL, fork], { encoding: "utf8" }); } catch (e) { diff = e.stdout || ""; }
  const forkSrc = fs.existsSync(fork) ? fs.readFileSync(fork, "utf8") : "";
  (diff.length > 0 && /def\s+post_tweet/.test(forkSrc)) ? L.clearGate("structural_diff", "grader", { diffBytes: diff.length }, "non-empty structural diff of the verified fix; post_tweet still defined (not deleted)")
                                                          : L.failGate("structural_diff", "grader", "no real diff or function removed", { diffBytes: diff.length });

  L.openGate("no_repair_control_fails", "grader");
  const ctrl = py([ACCEPT, ORIGINAL]);
  ctrl.exit !== 0 && /POST_ACCEPT_FAIL/.test(ctrl.out) ? L.clearGate("no_repair_control_fails", "grader", {}, "the un-repaired (drifted) module FAILS the same oracle — oracle non-vacuous, fix was load-bearing")
                                                        : L.failGate("no_repair_control_fails", "grader", "drifted module PASSED the oracle — vacuous!");

  const v = L.verdict(REQ); out.push({ id, verdict: v.verdict, failed: v.failed });
}
const ok = out.filter((o) => o.verdict === "VERIFIED");
console.log("\n  END-TO-END SELF-HEALING — behavior.failed -> triage -> blind builder -> grade -> diff");
for (const o of out) console.log(`  ${o.verdict === "VERIFIED" ? "✅" : "❌"} self-heal builder-${o.id}: ${o.verdict}${o.failed.length ? ` (${o.failed.join(",")})` : ""}`);
console.log(`  self_healing_invariant: ${ok.length}/${out.length} (detected -> patched by blind LLM -> verified -> re-run 0 failures -> diff). control non-vacuous.\n`);
