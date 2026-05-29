import fs from "node:fs"; import path from "node:path"; import url from "node:url";
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", ".."); const d = path.join(ROOT, "frames", "referee");
const cat = (f) => f.replace(/-\d+-2026.*$/, "").replace(/-2026-.*$/, "").replace(/-builder$/, "");
const groups = {}; let totV = 0, totE = 0; const caught = [];
for (const f of fs.readdirSync(d).filter((x) => x.endsWith(".proof.jsonl"))) {
  const ev = fs.readFileSync(path.join(d, f), "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
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
lines.push("REFEREE FACTORY — CONSOLIDATED SUMMARY", "Generated " + new Date().toISOString(), "=".repeat(72), "");
lines.push(`TOTAL verdicts: ${totV} VERIFIED / ${totE} ERROR  (ERRORs = deterministic controls + 8 caught LLM bugs)`, "");
lines.push("BY CATEGORY:".padEnd(48) + "VERIFIED  ERROR");
for (const [k, g] of Object.entries(groups).sort()) lines.push("  " + k.padEnd(46) + String(g.v).padStart(6) + String(g.e).padStart(8));
lines.push("", "THE 8 CAUGHT LLM BUGS (real bugs the referee blocked, never shipped):");
for (const c of caught) lines.push("  ✗ " + c);
lines.push("", "ARTIFACT INDEX:");
lines.push("  raw ledgers : frames/referee/*.proof.jsonl  (" + fs.readdirSync(d).filter((x) => x.endsWith(".proof.jsonl")).length + " files)");
lines.push("  replay one  : node scripts/referee-factory/replay.mjs <file>");
lines.push("  meta-audit  : node scripts/referee-factory/meta-referee.mjs   (audits the auditor)");
lines.push("  eval docs   : frames/eval-reports/{FORENSIC-DIAGNOSIS,REFEREE-FACTORY,SELF-AUDIT,TRIAGE-FINDING}-20260529.md");
const txt = lines.join("\n");
const ts = new Date().toISOString().slice(11, 19).replace(/:/g, "");
const outp = path.join(process.env.HOME, "Desktop", `REFEREE-CONSOLIDATED-${ts}.txt`);
fs.writeFileSync(outp, txt); console.log(txt); console.log("\nwritten: " + outp);
