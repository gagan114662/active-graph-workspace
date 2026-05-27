#!/usr/bin/env node
// Migrate one or more active_graph Pentagon agents to a new (provider, model, harness_id).
//
// Usage:
//   # Single agent:
//   node scripts/migrate-agent-cohort.mjs --agent-name "Carmen (Contract Owner)" \
//        --provider claude-code --model claude-opus-4-7 --harness-id claude-code \
//        --log frames/migration-carmen-20260527.jsonl
//
//   # All 20 agents:
//   node scripts/migrate-agent-cohort.mjs --all \
//        --provider claude-code --model claude-opus-4-7 --harness-id claude-code \
//        --log frames/migration-bulk-20260527.jsonl
//
//   # Dry-run (no mutation, just print plan):
//   node scripts/migrate-agent-cohort.mjs --all --dry-run ...
//
// Each row mutated is recorded in the log file (JSONL, one record per row).
// Records before+after so the revert path is trivial.

import { execFileSync } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";

const WORKSPACE = "/Users/gaganarora/Desktop/my projects/active_graph";
const PLIST = "/Users/gaganarora/Library/Preferences/run.pentagon.app.plist";
const PENTAGON_BIN = "/Applications/Pentagon.app/Contents/MacOS/Pentagon";

function arg(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  return idx === -1 ? fallback : process.argv[idx + 1] ?? fallback;
}
function has(name) { return process.argv.includes(name); }

function decodeJwtPayload(jwt) {
  const part = jwt.split(".")[1];
  const padded = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
  return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
}

function readSession() {
  const raw = execFileSync("/usr/libexec/PlistBuddy",
    ["-c", "Print :supabase.auth.sb-auth-auth-token", PLIST], { encoding: "utf8" });
  const session = JSON.parse(raw);
  const accessToken = session.accessToken;
  const claims = decodeJwtPayload(accessToken);
  const supabaseOrigin = new URL(claims.iss).origin;
  return { accessToken, supabaseOrigin };
}

function readAnonKey() {
  const out = execFileSync("zsh",
    ["-lc", `strings "${PENTAGON_BIN}" | rg '^eyJ' | head -1`], { encoding: "utf8" }).trim();
  if (!out) throw new Error("Could not find embedded Supabase anon key in Pentagon binary.");
  return out;
}

async function getAgents(filterByName) {
  const { accessToken, supabaseOrigin } = readSession();
  const anonKey = readAnonKey();
  let path = "/rest/v1/agents?directory=eq." + encodeURIComponent(WORKSPACE) +
    "&deleted_at=is.null" +
    "&select=id,name,provider,model,harness_id,execution_mode" +
    "&order=name.asc&limit=50";
  if (filterByName) {
    path += "&name=eq." + encodeURIComponent(filterByName);
  }
  const res = await fetch(supabaseOrigin + path, {
    headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`GET failed ${res.status}: ${await res.text()}`);
  return { rows: await res.json(), accessToken, supabaseOrigin, anonKey };
}

async function patchAgent({ id, fields, accessToken, supabaseOrigin, anonKey }) {
  const path = "/rest/v1/agents?id=eq." + encodeURIComponent(id);
  const res = await fetch(supabaseOrigin + path, {
    method: "PATCH",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(fields),
  });
  if (!res.ok) throw new Error(`PATCH failed ${res.status}: ${await res.text()}`);
  return res.json();
}

async function main() {
  const provider = arg("--provider");
  const model = arg("--model");
  const harnessId = arg("--harness-id");
  const agentName = arg("--agent-name");
  const all = has("--all");
  const dryRun = has("--dry-run");
  const logPath = arg("--log");

  if (!provider || !model || !harnessId) {
    console.error("Required: --provider X --model Y --harness-id Z");
    process.exit(2);
  }
  if (!agentName && !all) {
    console.error("Required: --agent-name 'Name' OR --all");
    process.exit(2);
  }
  if (!logPath && !dryRun) {
    console.error("Required (unless --dry-run): --log path/to/migration.jsonl");
    process.exit(2);
  }

  const { rows, accessToken, supabaseOrigin, anonKey } = await getAgents(agentName);
  if (rows.length === 0) {
    console.error(`No agents matched ${agentName || "--all"}`);
    process.exit(3);
  }

  const target = { provider, model, harness_id: harnessId };
  const plan = rows.map((r) => ({
    id: r.id,
    name: r.name,
    before: { provider: r.provider, model: r.model, harness_id: r.harness_id },
    after: target,
    no_change: r.provider === provider && r.model === model && r.harness_id === harnessId,
  }));

  console.log(`Plan: mutate ${plan.length} agent(s) -> ${JSON.stringify(target)}`);
  for (const p of plan) {
    const marker = p.no_change ? "  [skip]" : "  [PATCH]";
    console.log(`${marker} ${p.name.padEnd(28)} ${JSON.stringify(p.before)} -> ${JSON.stringify(p.after)}`);
  }
  if (dryRun) {
    console.log("Dry run, no changes applied.");
    return;
  }

  if (logPath) writeFileSync(logPath, "");

  for (const p of plan) {
    if (p.no_change) continue;
    const patched = await patchAgent({ id: p.id, fields: target, accessToken, supabaseOrigin, anonKey });
    const record = {
      ts: new Date().toISOString(),
      agent_id: p.id,
      agent_name: p.name,
      before: p.before,
      after: target,
      after_db: patched?.[0] ? { provider: patched[0].provider, model: patched[0].model, harness_id: patched[0].harness_id } : null,
    };
    if (logPath) appendFileSync(logPath, JSON.stringify(record) + "\n");
    console.log(`  OK: ${p.name} -> ${JSON.stringify(record.after_db)}`);
  }
  console.log(`Done. Migration log: ${logPath}`);
  console.log(`\nTo revert this batch, re-run with reversed --provider/--model/--harness-id values OR run the revert helper.`);
}

main().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
