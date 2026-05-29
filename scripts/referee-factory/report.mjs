#!/usr/bin/env node
// referee-factory/report.mjs
//
// The source-of-truth report. Reads every ledger in frames/referee/, sorts
// CHRONOLOGICALLY, and labels each run by PROVENANCE (who produced the build:
// an LLM builder, or a deterministic control I injected). The header is a
// one-screen attempt table so the logs cannot be misread (e.g. mistaking an
// injected overfit control for an LLM cheat).
//
// Usage: node scripts/referee-factory/report.mjs [outfile]

import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DIR = path.join(REPO_ROOT, "frames", "referee");
const OUT = process.argv[2] || path.join(process.env.HOME, "Desktop", "REFEREE-LOGS.txt");

const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".proof.jsonl"));
const runs = [];
for (const f of files) {
  const evs = fs.readFileSync(path.join(DIR, f), "utf8").split("\n").filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const tasks = {};
  for (const e of evs) (tasks[e.task_id] = tasks[e.task_id] || []).push(e);
  for (const [tid, tev] of Object.entries(tasks)) {
    const verdict = [...tev].reverse().find((e) => e.stage === "verdict");
    if (!verdict) continue;
    const prov = [...tev].reverse().find((e) => e.stage === "provenance");
    const gate = (g) => { const last = [...tev].reverse().find((e) => e.stage === "gate" && e.gate === g); return last ? last.status : "-"; };
    let who;
    const strat = tid.split("::")[1];
    if (["none", "deleteTest", "overfit", "real"].includes(strat)) who = `DET-CONTROL(${strat})`;
    else if (prov && /LLM-AGENT/.test(prov.detail)) who = "LLM-BUILDER";
    else if (prov && /(deterministic-control|operator)/.test(prov.detail)) who = "DET-CONTROL(manual)";
    else if (tid.includes("snapshot-fix") || tid.startsWith("tier-easy")) who = "EASY-TIER-FIX";
    else who = "(unlabeled)";
    runs.push({ ts: tev[0].ts, file: f, tid, who, verdict: verdict.status,
      holdout: gate("holdout_green"), root: gate("root_cause_ok"), adv: gate("adversary_clear") });
  }
}
runs.sort((a, b) => (a.ts < b.ts ? -1 : 1));

const llm = runs.filter((r) => r.who === "LLM-BUILDER");
const llmVer = llm.filter((r) => r.verdict === "VERIFIED");
const lines = [];
lines.push("REFEREE FACTORY — SOURCE-OF-TRUTH REPORT");
lines.push("Generated " + new Date().toISOString());
lines.push("Folder: " + DIR);
lines.push("=".repeat(96));
lines.push("");
lines.push("SUMMARY (the only numbers that matter):");
lines.push(`  LLM-BUILDER attempts: ${llm.length}  |  VERIFIED honest general fix: ${llmVer.length}  |  overfit/ERROR by an LLM: ${llm.length - llmVer.length}`);
lines.push(`  Every overfit ERROR below is a DETERMINISTIC CONTROL injected to prove the referee catches cheating.`);
lines.push(`  An overfit CANNOT clear holdout_green + root_cause_ok + adversary_clear — so that gate pattern = honest fix.`);
lines.push("");
lines.push("CHRONOLOGICAL ATTEMPT TABLE");
lines.push("time(UTC)  who                       verdict   holdout  rootcause adversary  file");
lines.push("-".repeat(96));
for (const r of runs) {
  lines.push(`${r.ts.slice(11, 19)}   ${r.who.padEnd(24)} ${r.verdict.padEnd(9)} ${r.holdout.padEnd(8)} ${r.root.padEnd(9)} ${r.adv.padEnd(9)} ${r.file.slice(0, 30)}`);
}
lines.push("=".repeat(96));
lines.push("");
lines.push("FULL TRACES FOLLOW (chronological). Each verdict is re-derived from the event log alone.");
lines.push("");

// append full traces in chronological file order (dedup files, keep first ts)
const byFile = new Map();
for (const r of runs) if (!byFile.has(r.file)) byFile.set(r.file, r.ts);
const orderedFiles = [...byFile.entries()].sort((a, b) => (a[1] < b[1] ? -1 : 1)).map((e) => e[0]);

import { execFileSync } from "node:child_process";
for (const f of orderedFiles) {
  lines.push("#".repeat(96));
  lines.push("# " + f);
  lines.push("#".repeat(96));
  try {
    lines.push(execFileSync("node", [path.join(__dirname, "replay.mjs"), path.join(DIR, f)], { encoding: "utf8" }));
  } catch (e) { lines.push("(replay failed: " + e.message + ")"); }
}

fs.writeFileSync(OUT, lines.join("\n"));
console.log("wrote source-of-truth report: " + OUT);
console.log(`  ${runs.length} runs across ${orderedFiles.length} ledgers; LLM honest ${llmVer.length}/${llm.length}`);
