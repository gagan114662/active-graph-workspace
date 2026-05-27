#!/usr/bin/env node
// Read all active_graph Pentagon agents.
// Reuses the bridge's auth helpers: PlistBuddy session token + binary-embedded anon key.
// Usage: node scripts/read-active-graph-agents.mjs [--out path/to/file.json]

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const WORKSPACE = "/Users/gaganarora/Desktop/my projects/active_graph";
const PLIST = "/Users/gaganarora/Library/Preferences/run.pentagon.app.plist";
const PENTAGON_BIN = "/Applications/Pentagon.app/Contents/MacOS/Pentagon";

function arg(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  return idx === -1 ? fallback : process.argv[idx + 1] ?? fallback;
}

function decodeJwtPayload(jwt) {
  const part = jwt.split(".")[1];
  const padded = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
  return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
}

function readSession() {
  const raw = execFileSync("/usr/libexec/PlistBuddy", [
    "-c", "Print :supabase.auth.sb-auth-auth-token", PLIST,
  ], { encoding: "utf8" });
  const session = JSON.parse(raw);
  const accessToken = session.accessToken;
  const claims = decodeJwtPayload(accessToken);
  const supabaseOrigin = new URL(claims.iss).origin;
  return { accessToken, supabaseOrigin };
}

function readAnonKey() {
  const out = execFileSync("zsh", [
    "-lc", `strings "${PENTAGON_BIN}" | rg '^eyJ' | head -1`,
  ], { encoding: "utf8" }).trim();
  if (!out) throw new Error("Could not find embedded Supabase anon key in Pentagon binary.");
  return out;
}

async function main() {
  const { accessToken, supabaseOrigin } = readSession();
  const anonKey = readAnonKey();
  const path = "/rest/v1/agents?directory=eq." + encodeURIComponent(WORKSPACE) +
    "&deleted_at=is.null" +
    "&select=id,name,provider,model,harness_id,execution_mode,directory,base_directory,base_branch,device_id,last_seen_at,warm_window_seconds,provider_endpoint_mode" +
    "&order=name.asc&limit=50";
  const res = await fetch(supabaseOrigin + path, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GET ${path} failed ${res.status}: ${text}`);
  }
  const rows = await res.json();
  const summary = {
    fetched_at: new Date().toISOString(),
    workspace: WORKSPACE,
    count: rows.length,
    distinct_provider_model_harness: [...new Set(rows.map(r => [r.provider, r.model, r.harness_id].join("|")))],
    agents: rows,
  };
  const outPath = arg("--out");
  if (outPath) {
    writeFileSync(outPath, JSON.stringify(summary, null, 2));
    console.log(`Wrote ${rows.length} agents to ${outPath}`);
  } else {
    console.log(JSON.stringify(summary, null, 2));
  }
}

main().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
