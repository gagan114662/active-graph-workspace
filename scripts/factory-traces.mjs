#!/usr/bin/env node
// pt.20 — FACTORY TRACES: a self-hosted, neatlogs-style observability dashboard
// over OUR OWN event log. No API key, no SDK, no cloud. The factory already
// captures the exact trace data neatlogs would (every llm.requested/responded with
// model+cost+tokens+latency, tool uses, dispatches, the full flywheel chain). This
// groups those events into traces and renders span timelines + cost/token/latency
// rollups + filter as a single self-contained HTML page.
//
// Usage: node scripts/factory-traces.mjs [--since-hours 48] [--max-traces 80] [--out frames/factory-traces.html]
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { installCrashGuard } from "./factory-crash-guard.mjs";
import { pathToFileURL } from "node:url";

installCrashGuard("factory-traces");

const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const LOG = arg("--log", "frames/factory-events.jsonl");
const SINCE_H = Number(arg("--since-hours", "48"));
const MAX_TRACES = Number(arg("--max-traces", "80"));
const OUT = arg("--out", "frames/factory-traces.html");

// Events that are noise for a trace view (no work unit).
const NOISE = new Set(["infrastructure.honker_healthcheck", "daemon.heartbeat", "script.started", "script.shutdown"]);

function load() {
  if (!existsSync(LOG)) return [];
  const cutoff = Date.now() - SINCE_H * 3600 * 1000;
  const rows = [];
  for (const line of readFileSync(LOG, "utf8").split(/\n/)) {
    if (!line.trim()) continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    const t = Date.parse(e.created_at || "");
    if (!Number.isFinite(t) || t < cutoff) continue;
    if (NOISE.has(e.type)) continue;
    rows.push(e);
  }
  return rows;
}

// A trace = one work unit. Group by the most specific id present.
function traceKey(e) {
  const p = e.payload || {};
  return p.todo_event_id || p.trigger_id || p.hash || p.session_id || null;
}

function buildTraces(events) {
  const map = new Map();
  for (const e of events) {
    const k = traceKey(e);
    if (!k) continue; // untraced (alerts/config events) — skip from the trace view
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(e);
  }
  const traces = [];
  for (const [key, spans] of map) {
    spans.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    const t0 = Date.parse(spans[0].created_at);
    const t1 = Date.parse(spans[spans.length - 1].created_at);
    // cost: only the deduped outer emit (pt.6) to avoid triple-counting.
    let cost = 0, inTok = 0, outTok = 0;
    const agents = new Set(); let model = null;
    let status = "running";
    for (const e of spans) {
      const p = e.payload || {};
      if (e.type === "llm.responded" && p.behavior === "bridge.runClaude") {
        cost += Number(p.cost_usd || p.cost || 0);
      }
      if (p.input_tokens) inTok += Number(p.input_tokens) || 0;
      if (p.output_tokens) outTok += Number(p.output_tokens) || 0;
      if (p.agent_name) agents.add(String(p.agent_name).split(" ")[0]);
      if (p.model) model = p.model;
      if (e.type === "flywheel.pr.merged") status = "merged";
      else if (e.type === "flywheel.merge.failed" || e.type === "flywheel.attempt.rejected") status = "rejected";
      else if (/^behavior\.failed|verifier_rejected|proof_missing/.test(e.type + (p.subtype || "")) && status === "running") status = "failed";
      else if (e.type === "behavior.completed" && status === "running") status = "completed";
      else if (e.type === "eval.completed") status = p.pass ? "verified" : "rejected";
    }
    traces.push({
      key, label: spans[0].payload?.behavior || spans[0].type,
      start: spans[0].created_at, durMs: t1 - t0,
      cost, inTok, outTok, agents: [...agents], model, status,
      spans: spans.slice(0, 40).map((e) => ({
        t: e.created_at, off: Math.round((Date.parse(e.created_at) - t0) / 100) / 10,
        type: e.type, reason: (e.payload || {}).reason || (e.payload || {}).verdict || (e.payload || {}).subtype || "",
        cost: e.type === "llm.responded" && (e.payload || {}).behavior === "bridge.runClaude" ? Number((e.payload || {}).cost_usd || 0) : 0,
        msg: String((e.payload || {}).message || "").slice(0, 120),
      })),
    });
  }
  traces.sort((a, b) => Date.parse(b.start) - Date.parse(a.start));
  return traces.slice(0, MAX_TRACES);
}

function render(traces) {
  const totalCost = traces.reduce((s, t) => s + t.cost, 0);
  const byStatus = {};
  for (const t of traces) byStatus[t.status] = (byStatus[t.status] || 0) + 1;
  const data = JSON.stringify(traces);
  const statusChips = Object.entries(byStatus).map(([k, v]) => `<span class="chip ${k}">${k}: ${v}</span>`).join(" ");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Factory Traces</title>
<style>
 :root{--bg:#0d1117;--pan:#161b22;--pan2:#1c2330;--line:#2b3340;--tx:#e6edf3;--mut:#8b949e;--grn:#3fb950;--amb:#d29922;--red:#f85149;--blu:#58a6ff;--pur:#bc8cff}
 *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tx);font:13px/1.55 -apple-system,Segoe UI,sans-serif}
 header{padding:16px 24px;border-bottom:1px solid var(--line)}h1{font-size:16px;margin:0 0 6px}
 .chip{display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;border:1px solid var(--line);margin-right:4px}
 .chip.merged,.chip.verified{color:var(--grn);border-color:#1f5130}.chip.completed{color:var(--blu)}
 .chip.failed,.chip.rejected{color:var(--red);border-color:#50201f}.chip.running{color:var(--amb)}
 .wrap{display:grid;grid-template-columns:380px 1fr;height:calc(100vh - 70px)}
 .list{border-right:1px solid var(--line);overflow:auto}
 .tr{padding:10px 16px;border-bottom:1px solid var(--line);cursor:pointer}.tr:hover{background:var(--pan)}.tr.sel{background:var(--pan2)}
 .tr .top{display:flex;justify-content:space-between;gap:8px}.tr .lab{font-weight:600;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
 .tr .meta{color:var(--mut);font-size:11px;margin-top:2px}
 .dot{width:8px;height:8px;border-radius:50%;display:inline-block;margin-right:5px}
 .merged .dot,.verified .dot{background:var(--grn)}.completed .dot{background:var(--blu)}.failed .dot,.rejected .dot{background:var(--red)}.running .dot{background:var(--amb)}
 .detail{overflow:auto;padding:18px 24px}.detail h2{font-size:14px;margin:0 0 10px}
 .span{display:grid;grid-template-columns:60px 200px 1fr 70px;gap:8px;padding:5px 8px;border-bottom:1px solid var(--line);font-size:12px;align-items:baseline}
 .span .ty{color:var(--pur)}.span .off{color:var(--mut)}.span .rs{color:var(--amb)}.span .ms{color:var(--mut);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.span .cs{color:var(--grn);text-align:right}
 .empty{color:var(--mut);padding:40px;text-align:center}
 input{background:var(--pan2);border:1px solid var(--line);color:var(--tx);padding:5px 8px;border-radius:6px;width:200px}
 .k{color:var(--mut)}
</style></head><body>
<header>
 <h1>🔭 Factory Traces <span class="k" style="font-weight:400">— self-hosted observability over frames/factory-events.jsonl · no API key</span></h1>
 <span class="k">${traces.length} traces · last ${SINCE_H}h · total cost $${totalCost.toFixed(2)}</span> &nbsp; ${statusChips}
 &nbsp; <input id="q" placeholder="filter (agent, status, type)…" oninput="rnd()">
</header>
<div class="wrap">
 <div class="list" id="list"></div>
 <div class="detail" id="detail"><div class="empty">Select a trace to see its span timeline.</div></div>
</div>
<script>
const T=${data};let sel=null;
function fmtDur(ms){return ms>60000?(ms/60000).toFixed(1)+'m':(ms/1000).toFixed(1)+'s'}
function rnd(){
 const q=(document.getElementById('q').value||'').toLowerCase();
 const list=document.getElementById('list');list.innerHTML='';
 T.filter(t=>!q||JSON.stringify(t).toLowerCase().includes(q)).forEach(t=>{
  const d=document.createElement('div');d.className='tr '+t.status+(sel===t.key?' sel':'');
  d.innerHTML='<div class="top"><span class="lab"><span class="dot"></span>'+t.label+'</span><span class="cs k">$'+t.cost.toFixed(2)+'</span></div>'+
   '<div class="meta">'+(t.agents.join(',')||'—')+' · '+t.status+' · '+fmtDur(t.durMs)+' · '+t.spans.length+' spans · '+new Date(t.start).toLocaleTimeString()+'</div>';
  d.onclick=()=>{sel=t.key;rnd();detail(t)};list.appendChild(d);
 });
}
function detail(t){
 const el=document.getElementById('detail');
 let h='<h2>'+t.label+' <span class="k">'+t.key.slice(0,28)+'</span></h2>';
 h+='<div class="k" style="margin-bottom:10px">'+t.status+' · '+(t.model||'')+' · $'+t.cost.toFixed(2)+' · '+(t.inTok+t.outTok)+' tok · '+fmtDur(t.durMs)+'</div>';
 t.spans.forEach(s=>{h+='<div class="span"><span class="off">+'+s.off+'s</span><span class="ty">'+s.type+'</span><span class="ms" title="'+(s.msg||'').replace(/"/g,'')+'">'+(s.rs?'<span class=rs>'+s.rs+'</span> ':'')+(s.msg||'')+'</span><span class="cs">'+(s.cost?'$'+s.cost.toFixed(2):'')+'</span></div>'});
 el.innerHTML=h;
}
rnd();
</script></body></html>`;
}

function main() {
  const traces = buildTraces(load());
  writeFileSync(OUT, render(traces));
  console.log(`[factory-traces] wrote ${OUT} — ${traces.length} traces, last ${SINCE_H}h`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
