#!/usr/bin/env node
// Probe all recent agent_triggers across active_graph agents.
// Tells us: is the activation bottleneck system-wide or Carmen-specific?

import { execFileSync } from "node:child_process";

const PLIST = "/Users/gaganarora/Library/Preferences/run.pentagon.app.plist";
const PENTAGON_BIN = "/Applications/Pentagon.app/Contents/MacOS/Pentagon";
const SINCE = process.argv[2] || "2026-05-27T15:30:00Z";

function decodeJwtPayload(jwt) {
  const part = jwt.split(".")[1];
  const padded = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
  return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
}
function readSession() {
  const raw = execFileSync("/usr/libexec/PlistBuddy", ["-c", "Print :supabase.auth.sb-auth-auth-token", PLIST], { encoding: "utf8" });
  const session = JSON.parse(raw);
  return { accessToken: session.accessToken, supabaseOrigin: new URL(decodeJwtPayload(session.accessToken).iss).origin };
}
function readAnonKey() {
  return execFileSync("zsh", ["-lc", `strings "${PENTAGON_BIN}" | rg '^eyJ' | head -1`], { encoding: "utf8" }).trim();
}

async function main() {
  const { accessToken, supabaseOrigin } = readSession();
  const anonKey = readAnonKey();

  // First load active_graph agents to map agent_id -> name
  const agentsRes = await fetch(supabaseOrigin + "/rest/v1/agents?directory=eq." + encodeURIComponent("/Users/gaganarora/Desktop/my projects/active_graph") + "&deleted_at=is.null&select=id,name,provider,model,harness_id&limit=50", {
    headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  const agents = await agentsRes.json();
  const byId = new Map(agents.map(a => [a.id, a]));

  const path = "/rest/v1/agent_triggers" +
    "?created_at=gte." + encodeURIComponent(SINCE) +
    "&agent_id=in.(" + agents.map(a => a.id).join(",") + ")" +
    "&select=id,agent_id,created_at,claimed_at,completed_at" +
    "&order=created_at.desc&limit=50";
  const res = await fetch(supabaseOrigin + path, {
    headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  const rows = await res.json();
  console.log(`Found ${rows.length} agent_trigger(s) across active_graph agents since ${SINCE}`);
  const counts = { unclaimed: 0, claimed_only: 0, completed: 0 };
  for (const r of rows) {
    const a = byId.get(r.agent_id);
    const state = r.completed_at ? "COMPLETED" : r.claimed_at ? "CLAIMED " : "UNCLAIM ";
    if (r.completed_at) counts.completed++;
    else if (r.claimed_at) counts.claimed_only++;
    else counts.unclaimed++;
    console.log(`  ${state} ${(a?.name || "???").padEnd(28)} ${a?.harness_id || "?"} created=${r.created_at}`);
  }
  console.log(`\nSummary: unclaimed=${counts.unclaimed} claimed_only=${counts.claimed_only} completed=${counts.completed}`);
}
main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
