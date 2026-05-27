#!/usr/bin/env node
// Probe the agent_trigger created for Carmen by the canary message.
// Reads agent_triggers via Pentagon's Supabase REST (same auth as bridge).

import { execFileSync } from "node:child_process";

const PLIST = "/Users/gaganarora/Library/Preferences/run.pentagon.app.plist";
const PENTAGON_BIN = "/Applications/Pentagon.app/Contents/MacOS/Pentagon";
const CARMEN_ID = "9ce67d98-bc38-404b-a979-8db00379fbda";
const SINCE = "2026-05-27T16:16:00Z";

function decodeJwtPayload(jwt) {
  const part = jwt.split(".")[1];
  const padded = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
  return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
}
function readSession() {
  const raw = execFileSync("/usr/libexec/PlistBuddy", ["-c", "Print :supabase.auth.sb-auth-auth-token", PLIST], { encoding: "utf8" });
  const session = JSON.parse(raw);
  const accessToken = session.accessToken;
  const claims = decodeJwtPayload(accessToken);
  return { accessToken, supabaseOrigin: new URL(claims.iss).origin };
}
function readAnonKey() {
  return execFileSync("zsh", ["-lc", `strings "${PENTAGON_BIN}" | rg '^eyJ' | head -1`], { encoding: "utf8" }).trim();
}

async function main() {
  const { accessToken, supabaseOrigin } = readSession();
  const anonKey = readAnonKey();
  const path = "/rest/v1/agent_triggers" +
    "?agent_id=eq." + encodeURIComponent(CARMEN_ID) +
    "&created_at=gte." + encodeURIComponent(SINCE) +
    "&select=id,conversation_id,agent_id,message_id,created_at,claimed_at,completed_at,content" +
    "&order=created_at.desc&limit=5";
  const res = await fetch(supabaseOrigin + path, {
    headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  const rows = await res.json();
  console.log(`Found ${rows.length} agent_trigger(s) for Carmen since ${SINCE}:`);
  for (const r of rows) {
    const lifecycle =
      r.completed_at ? "COMPLETED" :
      r.claimed_at ? "CLAIMED (not completed)" :
      "UNCLAIMED";
    console.log(`  ${lifecycle} id=${r.id} created=${r.created_at} claimed=${r.claimed_at} completed=${r.completed_at}`);
    if (r.content) console.log(`    content_preview: ${String(r.content).slice(0, 140)}`);
  }
}
main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
