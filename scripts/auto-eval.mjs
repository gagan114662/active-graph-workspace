#!/usr/bin/env node
// pt.19 — AUTO-EVAL. The automated evaluation pack + grader. Automates Lucas Meyer's
// "make the agent produce an evaluation pack so review is fast and it can't cheat,
// then review it as HTML." Here the FACTORY does the reviewing:
//   1. runs the REAL verifier on the proof — the uncheatable grade (worktree ground
//      truth: a test that must fail-then-pass cannot be faked).
//   2. assembles the evaluation pack (target, commits, test counts, every check).
//   3. runs the friction analyzer ("what would have helped reach the goal faster").
//   4. emits eval.completed (verdict + friction score) — a first-class event.
//   5. writes a single self-contained HTML eval report (Lucas's form factor).
// No human in the evaluation loop — the verdict, the pack, and the learning are all
// produced by the factory.
//
// Usage: node scripts/auto-eval.mjs --proof-file <path> --tier <medium|hard|...> [--hash H]

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { installCrashGuard } from "./factory-crash-guard.mjs";
import { analyzeFriction, eventsForHash } from "./friction-analyzer.mjs";

installCrashGuard("auto-eval");

const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };

function parseProof(proofPath) {
  if (!existsSync(proofPath)) return {};
  const src = readFileSync(proofPath, "utf8");
  const get = (k) => (src.match(new RegExp(`^${k}=(.+)$`, "m")) || [])[1];
  return {
    hash: get("hash"), target: get("uncovered_symbol") || get("bug_source"),
    test_file: get("test_file"), agent_commit_sha: get("agent_commit_sha"),
    failing_test_commit: get("failing_test_commit"), fix_commit: get("fix_commit"),
    new_test_count: get("new_test_count"), pytest_before: get("pytest_before"), pytest_after: get("pytest_after"),
    verdict: get("verdict"),
  };
}

// Run the real verifier — the uncheatable grade.
function runVerifier(proofPath, tier) {
  const r = spawnSync("node", [
    "scripts/verify-pentagon-autonomy-from-logs.mjs", "--t6", `--tier=${tier}`,
    "--proof-file", proofPath, "--no-db",
  ], { encoding: "utf8", timeout: 300_000, maxBuffer: 16 * 1024 * 1024 });
  const out = String(r.stdout || "");
  const checks = out.split(/\n/).filter((l) => l.startsWith("PASS ") || l.startsWith("FAIL "))
    .map((l) => ({ ok: l.startsWith("PASS "), name: l.slice(5).split(" :: ")[0], detail: (l.split(" :: ")[1] || "").slice(0, 200) }));
  const summary = (out.match(/^summary: .+$/m) || ["no summary"])[0];
  return { exit: r.status, pass: r.status === 0, summary, checks };
}

const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

function html({ proof, tier, ver, friction }) {
  const sev = { high: "#c0392b", medium: "#e67e22", low: "#7f8c8d" };
  const checkRows = ver.checks.map((c) =>
    `<tr class="${c.ok ? "ok" : "bad"}"><td>${c.ok ? "✅" : "❌"}</td><td>${esc(c.name)}</td><td class="d">${esc(c.detail)}</td></tr>`).join("");
  const frictionCards = friction.frictions.length
    ? friction.frictions.map((f) => `
      <div class="fc" style="border-left:5px solid ${sev[f.severity] || "#999"}">
        <div class="ft">${esc(f.type)} <span class="sev">${f.severity}${f.repo_actionable ? " · repo-actionable" : ""}</span></div>
        <div class="fe">${esc(f.evidence)}</div>
        <div class="fp"><b>What would have helped:</b> ${esc(f.proposal)}</div>
      </div>`).join("")
    : `<div class="smooth">🟢 Smooth run — no friction detected (the marble rolled clean).</div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Eval — ${esc(proof.hash)}</title>
<style>
 body{font:14px/1.5 -apple-system,Segoe UI,sans-serif;margin:0;background:#f4f6f8;color:#222}
 .wrap{max-width:980px;margin:0 auto;padding:28px}
 h1{font-size:20px;margin:0 0 4px} .sub{color:#777;margin:0 0 20px}
 .verdict{display:inline-block;padding:8px 18px;border-radius:8px;font-weight:700;font-size:18px;color:#fff;background:${ver.pass ? "#27ae60" : "#c0392b"}}
 .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:18px 0}
 .card{background:#fff;border-radius:8px;padding:12px 14px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
 .k{color:#888;font-size:12px} .v{font-weight:600;word-break:break-all}
 table{width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08)}
 td{padding:6px 10px;border-bottom:1px solid #eee;vertical-align:top} .d{color:#888;font-size:12px}
 tr.bad td{background:#fdecea} h2{font-size:15px;margin:24px 0 8px}
 .fc{background:#fff;border-radius:8px;padding:12px 14px;margin:8px 0;box-shadow:0 1px 3px rgba(0,0,0,.08)}
 .ft{font-weight:700} .sev{color:#999;font-weight:400;font-size:12px} .fe{color:#555;margin:4px 0;font-size:13px}
 .fp{font-size:13px} .smooth{background:#eafaf1;padding:14px;border-radius:8px;font-weight:600}
 .score{font-size:13px;color:#777}
</style></head><body><div class="wrap">
 <h1>Automated Eval — ${esc(proof.hash)}</h1>
 <p class="sub">tier=${esc(tier)} · target <code>${esc(proof.target)}</code> · ${new Date().toISOString()}</p>
 <div class="verdict">${ver.pass ? "VERIFIED PASS" : "REJECTED"}</div>
 <span class="score"> &nbsp; ${esc(ver.summary)} · friction score ${friction.score}</span>
 <h2>Evaluation pack</h2>
 <div class="grid">
  <div class="card"><div class="k">test file</div><div class="v">${esc(proof.test_file)}</div></div>
  <div class="card"><div class="k">agent commit</div><div class="v">${esc(proof.agent_commit_sha || proof.fix_commit)}</div></div>
  <div class="card"><div class="k">new tests</div><div class="v">${esc(proof.new_test_count || "—")}</div></div>
  <div class="card"><div class="k">pytest before → after</div><div class="v">${esc(proof.pytest_before || "?")} → ${esc(proof.pytest_after || "?")}</div></div>
 </div>
 <h2>Verifier checks (uncheatable ground truth)</h2>
 <table>${checkRows || "<tr><td>no checks</td></tr>"}</table>
 <h2>Friction — what would have helped reach the goal faster</h2>
 ${frictionCards}
</div></body></html>`;
}

async function main() {
  const proofPath = arg("--proof-file");
  const tier = arg("--tier", "medium");
  if (!proofPath) { console.error("usage: auto-eval.mjs --proof-file <path> --tier <tier> [--hash H]"); process.exit(2); }

  const proof = parseProof(proofPath);
  const hash = arg("--hash", proof.hash);
  // --no-verify: cheap per-run mode for automatic post-run eval. The verifier ALREADY
  // ran in the fire helper (and re-running hard's worktree ground truth is expensive),
  // so reuse the known verdict/summary and just produce the friction + HTML + event.
  let ver;
  if (process.argv.includes("--no-verify")) {
    const pass = arg("--verdict", "pass") === "pass";
    ver = { exit: pass ? 0 : 4, pass, summary: arg("--summary", "(verdict reused from fire helper)"), checks: [] };
  } else {
    ver = runVerifier(proofPath, tier);
  }
  const friction = analyzeFriction(eventsForHash(hash), { hash, tier });

  const dir = "frames/eval-reports";
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const reportPath = `${dir}/${(hash || "run").replace(/[^A-Za-z0-9_.-]/g, "_")}.html`;
  writeFileSync(reportPath, html({ proof, tier, ver, friction }));

  const { emitFactoryEvent } = await import("./factory-events.mjs");
  emitFactoryEvent({
    type: "eval.completed", behavior: "auto-eval",
    reason: ver.pass ? "eval.pass" : "eval.fail",
    message: `auto-eval ${tier} ${hash}: ${ver.pass ? "PASS" : "REJECT"} (${ver.summary}), friction=${friction.score}`,
    extras: { hash, tier, pass: ver.pass, verifier_summary: ver.summary, friction_score: friction.score,
      friction_types: friction.frictions.map((f) => f.type), report: reportPath },
  });

  console.log(`[auto-eval] ${ver.pass ? "PASS" : "REJECT"} ${hash} :: ${ver.summary} · friction=${friction.score}`);
  console.log(`[auto-eval] HTML report: ${reportPath}`);
  if (friction.frictions.length) console.log(`[auto-eval] frictions: ${friction.frictions.map((f) => f.type).join(", ")}`);
  process.exit(ver.pass ? 0 : 4);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error("[auto-eval] fatal", e); process.exit(70); });
}
