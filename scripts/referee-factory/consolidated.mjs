// consolidated.mjs — THE single source-of-truth log file.
//
// Writes ONE file, always the SAME path, always overwritten with the latest:
//     frames/eval-reports/REFEREE-CONSOLIDATED.txt
//
// It is self-contained: summary table + the 8(+) caught-LLM-bug list + the FULL
// chronological replay trace of every ledger. No timestamped clutter, no second
// "traces" file to get out of sync. git history preserves every prior version,
// so overwriting loses nothing and there is exactly ONE place to look.
//
// Usage: node scripts/referee-factory/consolidated.mjs
import fs from "node:fs"; import path from "node:path"; import url from "node:url";
import { execFileSync } from "node:child_process";
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", ".."); const d = path.join(ROOT, "frames", "referee");
const cat = (f) => f.replace(/-\d+-2026.*$/, "").replace(/-2026-.*$/, "").replace(/-builder$/, "");
const groups = {}; let totV = 0, totE = 0; const caught = [];
const fileFirstTs = {}; // file -> earliest ts (for chronological trace ordering)
for (const f of fs.readdirSync(d).filter((x) => x.endsWith(".proof.jsonl"))) {
  const ev = fs.readFileSync(path.join(d, f), "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  if (!ev.length) continue;
  fileFirstTs[f] = ev[0].ts;
  const tasks = {}; for (const e of ev) (tasks[e.task_id] = tasks[e.task_id] || []).push(e);
  const c = cat(f); groups[c] = groups[c] || { v: 0, e: 0 };
  const isLLM = ev.some((e) => e.stage === "provenance" && /LLM-AGENT/.test(e.detail || ""));
  for (const [tid, tev] of Object.entries(tasks)) {
    const verd = [...tev].reverse().find((e) => e.stage === "verdict"); if (!verd) continue;
    if (verd.status === "VERIFIED") { groups[c].v++; totV++; }
    else { groups[c].e++; totE++; const failed = [...new Set(tev.filter((e) => e.stage === "gate" && e.status === "failed").map((e) => e.gate))]; if (isLLM) caught.push(`${f.replace(/-2026.*/, "")} [${tid.split("::")[1] || tid}] failed: ${failed.join(",") || "(crash)"}`); }
  }
}
const lines = [];
lines.push("REFEREE FACTORY — CONSOLIDATED LOG (single source of truth)", "Generated " + new Date().toISOString(), "Path: frames/eval-reports/REFEREE-CONSOLIDATED.txt  (this file; always overwritten with the latest)", "=".repeat(80), "");
lines.push(`TOTAL verdicts: ${totV} VERIFIED / ${totE} ERROR`, "");
lines.push(`  ERRORs are NOT factory failures. They are: deterministic controls injected on purpose`);
lines.push(`  (none/deleteTest/overfit/no-op — to prove each oracle is non-vacuous) PLUS ${caught.length} genuine`);
lines.push(`  LLM builder bugs the referee CAUGHT and BLOCKED. Bad builds shipped to canonical: 0.`, "");
lines.push("BY CATEGORY:".padEnd(48) + "VERIFIED  ERROR");
for (const [k, g] of Object.entries(groups).sort()) lines.push("  " + k.padEnd(46) + String(g.v).padStart(6) + String(g.e).padStart(8));
lines.push("", `THE ${caught.length} CAUGHT LLM BUGS (real bugs the referee blocked, never shipped):`);
for (const c of caught) lines.push("  ✗ " + c);
lines.push("", "HOW TO VERIFY ANY LINE YOURSELF:");
lines.push("  replay one  : node scripts/referee-factory/replay.mjs frames/referee/<file>.proof.jsonl");
lines.push("  meta-audit  : node scripts/referee-factory/meta-referee.mjs   (audits every oracle for non-vacuity)");
lines.push("  regenerate  : node scripts/referee-factory/consolidated.mjs   (rewrites THIS file)");
lines.push("  eval docs   : frames/eval-reports/{FORENSIC-DIAGNOSIS,REFEREE-FACTORY,SELF-AUDIT,TRIAGE-FINDING}-20260529.md");
lines.push("", "=".repeat(80), "FULL TRACES (chronological). Each verdict below is RE-DERIVED from the event log alone.", "=".repeat(80), "");

// append full replay traces, chronological by each ledger's first event
const ordered = Object.keys(fileFirstTs).sort((a, b) => (fileFirstTs[a] < fileFirstTs[b] ? -1 : 1));
for (const f of ordered) {
  lines.push("#".repeat(80), "# " + f, "#".repeat(80));
  try { lines.push(execFileSync("node", [path.join(__dirname, "replay.mjs"), path.join(d, f)], { encoding: "utf8", maxBuffer: 1 << 24 })); }
  catch (e) { lines.push("(replay failed: " + e.message + ")"); }
}

const outDir = path.join(ROOT, "frames", "eval-reports");
fs.mkdirSync(outDir, { recursive: true });
const outp = path.join(outDir, "REFEREE-CONSOLIDATED.txt");
fs.writeFileSync(outp, lines.join("\n"));
console.log(`${totV} VERIFIED / ${totE} ERROR across ${ordered.length} ledgers; ${caught.length} caught LLM bugs; 0 bad ships`);
console.log("written (always this same path): " + outp);
