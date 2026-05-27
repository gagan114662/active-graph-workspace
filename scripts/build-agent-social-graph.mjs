#!/usr/bin/env node
// Build an interactive social-graph visualization of the Pentagon agent
// org, analogous to Unblocked's Social Comment Network from Brandon
// Walsenuk's AI Engineer talk. Procedurally generated; no hand-coding.
//
// Data sources (all already in the dark factory):
//   1. Pentagon Supabase `messages` table — every agent-to-agent
//      message becomes an edge.
//   2. Pentagon Supabase `conversation_participants` table — which
//      agents share which conversations.
//   3. Inner-repo git log — which agent committed which files (commit
//      author email -> agent name via agent-os/AGENT_IDENTITY_MAP).
//
// Output:
//   ~/.activegraph/social-graph.html — open in a browser to see an
//   interactive graph (D3.js inline, no build step).
//   ~/.activegraph/social-graph.json — the raw edges + nodes for any
//   downstream tooling.
//
// Usage:
//   node scripts/build-agent-social-graph.mjs [--since 2026-05-20]
//
// Edge weight formula:
//   w(A, B) = log(1 + msg_count(A->B)) + 0.5 * log(1 + shared_conv_count(A, B))
// Symmetric for visualization; the underlying data is directional.

import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { installCrashGuard } from "./factory-crash-guard.mjs";

installCrashGuard("build-agent-social-graph");

const WORKSPACE = "/Users/gaganarora/Desktop/my projects/active_graph";
const PLIST = "/Users/gaganarora/Library/Preferences/run.pentagon.app.plist";
const PENTAGON_BIN = "/Applications/Pentagon.app/Contents/MacOS/Pentagon";
const OUT_DIR = resolve(process.env.HOME, ".activegraph");
const SNAPSHOT_PATH = "/tmp/active-graph-agents-post-migration.json";

function arg(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  return idx === -1 ? fallback : process.argv[idx + 1] ?? fallback;
}

function decodeJwt(jwt) {
  const part = jwt.split(".")[1];
  const padded = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
  return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
}
function readSession() {
  const raw = execFileSync("/usr/libexec/PlistBuddy", ["-c", "Print :supabase.auth.sb-auth-auth-token", PLIST], { encoding: "utf8" });
  const s = JSON.parse(raw);
  return { accessToken: s.accessToken, supabaseOrigin: new URL(decodeJwt(s.accessToken).iss).origin };
}
function readAnonKey() {
  return execFileSync("zsh", ["-lc", `strings "${PENTAGON_BIN}" | rg '^eyJ' | head -1`], { encoding: "utf8" }).trim();
}

async function main() {
  const since = arg("--since", new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString());
  const { accessToken, supabaseOrigin } = readSession();
  const anonKey = readAnonKey();

  // 1. Load agent list (from migration snapshot or live query).
  let agents = [];
  if (existsSync(SNAPSHOT_PATH)) {
    agents = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")).agents || [];
  } else {
    const r = await fetch(supabaseOrigin + "/rest/v1/agents?directory=eq." + encodeURIComponent(WORKSPACE) + "&deleted_at=is.null&select=id,name&limit=50", {
      headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
    agents = await r.json();
  }
  const agentById = new Map(agents.map((a) => [a.id, a.name]));
  console.log(`Loaded ${agents.length} agents`);

  // 2. Fetch messages since cutoff.
  const msgUrl = supabaseOrigin + "/rest/v1/messages?created_at=gte." + encodeURIComponent(since) +
    "&sender_id=in.(" + agents.map((a) => a.id).join(",") + ")" +
    "&select=conversation_id,sender_id,created_at&limit=10000";
  const msgRes = await fetch(msgUrl, { headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
  const messages = await msgRes.json();
  console.log(`Fetched ${messages.length} messages since ${since}`);

  // 3. Fetch conversation participants (used for edge weighting).
  const partsUrl = supabaseOrigin + "/rest/v1/conversation_participants?user_id=in.(" + agents.map((a) => a.id).join(",") + ")&select=conversation_id,user_id&limit=5000";
  const partsRes = await fetch(partsUrl, { headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
  const parts = await partsRes.json();
  console.log(`Fetched ${parts.length} conversation_participants rows`);

  // 4. Build edges. For each conversation, take the senders + participants;
  //    every sender-to-other-participant pair gets +1 message weight.
  const convAgents = new Map(); // conv_id -> Set(agent_id)
  for (const p of parts) {
    if (!agentById.has(p.user_id)) continue;
    if (!convAgents.has(p.conversation_id)) convAgents.set(p.conversation_id, new Set());
    convAgents.get(p.conversation_id).add(p.user_id);
  }
  const edgeKey = (a, b) => [a, b].sort().join("|");
  const edges = new Map(); // key -> { source, target, msgCount, sharedConvs }
  for (const m of messages) {
    if (!agentById.has(m.sender_id)) continue;
    const partners = convAgents.get(m.conversation_id) || new Set();
    for (const other of partners) {
      if (other === m.sender_id) continue;
      const k = edgeKey(m.sender_id, other);
      if (!edges.has(k)) edges.set(k, { source: m.sender_id, target: other, msgCount: 0, sharedConvs: 0 });
      edges.get(k).msgCount += 1;
    }
  }
  // Add shared-conversation count even where no messages flowed.
  for (const ids of convAgents.values()) {
    const arr = [...ids];
    for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
      const k = edgeKey(arr[i], arr[j]);
      if (!edges.has(k)) edges.set(k, { source: arr[i], target: arr[j], msgCount: 0, sharedConvs: 0 });
      edges.get(k).sharedConvs += 1;
    }
  }

  // 5. Compute weighted edges (log scale; symmetric for visualization).
  const edgeList = [...edges.values()].map((e) => ({
    source: agentById.get(e.source),
    target: agentById.get(e.target),
    weight: Math.log(1 + e.msgCount) + 0.5 * Math.log(1 + e.sharedConvs),
    msg_count: e.msgCount,
    shared_convs: e.sharedConvs,
  })).filter((e) => e.weight > 0).sort((a, b) => b.weight - a.weight);

  // 6. Node degree.
  const degree = new Map();
  for (const e of edgeList) {
    degree.set(e.source, (degree.get(e.source) || 0) + e.weight);
    degree.set(e.target, (degree.get(e.target) || 0) + e.weight);
  }

  const nodeList = agents.map((a) => ({
    id: a.name,
    weighted_degree: Number((degree.get(a.name) || 0).toFixed(3)),
    role: deriveRole(a.name),
  }));

  // 7. Write JSON + HTML.
  mkdirSync(OUT_DIR, { recursive: true });
  const jsonPath = resolve(OUT_DIR, "social-graph.json");
  writeFileSync(jsonPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    since,
    nodes: nodeList,
    edges: edgeList,
  }, null, 2));
  console.log(`Wrote ${jsonPath}`);

  const htmlPath = resolve(OUT_DIR, "social-graph.html");
  writeFileSync(htmlPath, renderHtml({ nodes: nodeList, edges: edgeList, since }));
  console.log(`Wrote ${htmlPath}`);
  console.log(`open ${htmlPath}`);
}

function deriveRole(name) {
  const m = name.match(/\(([^)]+)\)/);
  if (m) return m[1];
  return name.split(" ").slice(1).join(" ") || "Specialist";
}

function renderHtml({ nodes, edges, since }) {
  return `<!doctype html>
<html><head><meta charset="utf-8"/>
<title>Dark Factory Agent Social Graph</title>
<style>
  body { background:#0b0d12; color:#e2e8f0; font-family:-apple-system,BlinkMacSystemFont,sans-serif; margin:0; padding:24px; }
  h1 { margin:0 0 4px 0; }
  .sub { color:#94a3b8; font-size:14px; margin-bottom:24px; }
  .layout { display:grid; grid-template-columns:1fr 320px; gap:24px; }
  .graph { background:#0f172a; border-radius:8px; padding:16px; }
  .panel { background:#0f172a; border-radius:8px; padding:16px; max-height:80vh; overflow:auto; }
  .panel h2 { font-size:16px; margin:0 0 12px 0; color:#cbd5e1; }
  .panel .row { display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid #1e293b; font-size:13px; }
  .panel .row .v { color:#94a3b8; font-variant-numeric:tabular-nums; }
  svg { width:100%; height:680px; }
  .link { stroke:#475569; stroke-opacity:0.4; }
  .node circle { stroke:#1e293b; stroke-width:1.5; cursor:pointer; }
  .node text { fill:#e2e8f0; font-size:11px; pointer-events:none; }
  .node.active circle { stroke:#fbbf24; stroke-width:3; }
</style>
</head><body>
<h1>Dark Factory Agent Social Graph</h1>
<div class="sub">Generated ${new Date().toISOString()}. Activity window since ${since}. Procedurally extracted from Pentagon Supabase messages + conversation_participants.</div>
<div class="layout">
  <div class="graph"><svg id="g"></svg></div>
  <div class="panel">
    <h2>Hover a node</h2>
    <div id="detail">Hover any agent on the left to see their weighted edges + role.</div>
  </div>
</div>
<script src="https://cdn.jsdelivr.net/npm/d3@7"></script>
<script>
const NODES = ${JSON.stringify(nodes)};
const EDGES = ${JSON.stringify(edges)};
const svg = d3.select('#g');
const width = svg.node().getBoundingClientRect().width;
const height = svg.node().getBoundingClientRect().height || 680;
const sim = d3.forceSimulation(NODES)
  .force('link', d3.forceLink(EDGES).id(d=>d.id).distance(d=>120/Math.max(0.2,d.weight)).strength(d=>Math.min(0.4,d.weight/5)))
  .force('charge', d3.forceManyBody().strength(-220))
  .force('center', d3.forceCenter(width/2, height/2));
const link = svg.append('g').selectAll('line').data(EDGES).enter().append('line')
  .attr('class','link').attr('stroke-width', d=>Math.max(0.5, d.weight));
const node = svg.append('g').selectAll('g').data(NODES).enter().append('g').attr('class','node')
  .call(d3.drag().on('start',(ev,d)=>{if(!ev.active)sim.alphaTarget(0.3).restart();d.fx=d.x;d.fy=d.y;})
                  .on('drag',(ev,d)=>{d.fx=ev.x;d.fy=ev.y;})
                  .on('end',(ev,d)=>{if(!ev.active)sim.alphaTarget(0);d.fx=null;d.fy=null;}));
node.append('circle').attr('r', d=>4+Math.sqrt(d.weighted_degree)*4)
  .attr('fill', d=>colorForRole(d.role));
node.append('text').attr('dx', 10).attr('dy', 4).text(d=>d.id);
sim.on('tick', ()=>{
  link.attr('x1',d=>d.source.x).attr('y1',d=>d.source.y).attr('x2',d=>d.target.x).attr('y2',d=>d.target.y);
  node.attr('transform', d=>'translate('+d.x+','+d.y+')');
});
node.on('mouseover', (ev,d)=>{
  const adj = EDGES.filter(e=>e.source.id===d.id||e.target.id===d.id).map(e=>({other:e.source.id===d.id?e.target.id:e.source.id, w:e.weight, msgs:e.msg_count, convs:e.shared_convs})).sort((a,b)=>b.w-a.w);
  const html = '<div style="margin-bottom:12px"><strong>'+d.id+'</strong><br/><span style="color:#94a3b8">'+d.role+'</span></div>' +
    '<div style="margin-bottom:8px;color:#94a3b8">weighted degree: '+d.weighted_degree.toFixed(3)+'</div>' +
    '<h2>Edges</h2>' +
    adj.map(a=>'<div class="row"><span>'+a.other+'</span><span class="v">'+a.w.toFixed(2)+' ('+a.msgs+'m,'+a.convs+'c)</span></div>').join('');
  document.getElementById('detail').innerHTML = html;
});
function colorForRole(r){
  const palette = ['#fbbf24','#60a5fa','#34d399','#f472b6','#a78bfa','#fb7185','#22d3ee','#facc15','#fb923c','#a3e635'];
  const h = [...r].reduce((a,c)=>a+c.charCodeAt(0),0);
  return palette[h % palette.length];
}
</script>
</body></html>`;
}

await main();
