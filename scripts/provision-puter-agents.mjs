#!/usr/bin/env node
// Puter agent provisioning — gives each Pentagon agent its own Puter user.
//
// #29 wiring. Per github.com/heyputer/puter analysis, Puter is a
// self-hostable internet computer (filesystem + apps + audit). Vision:
// each active_graph agent (Maya, Quinn, ..., Theo) gets its own Puter
// user with isolated filesystem. The bridge's runClaude() can set CWD
// to each agent's Puter home, so Maya's experiments can't pollute
// Quinn's. Audit improves: every file op lands in Puter's logs.
//
// One-time setup (operator-side):
//   git clone https://github.com/heyputer/puter /Users/gaganarora/puter
//   cd /Users/gaganarora/puter
//   npm install
//   npm start
//   # Open http://puter.localhost:4100, create the admin account
//   # Then run THIS script.
//
// Usage:
//   PUTER_URL=http://puter.localhost:4100 \
//   PUTER_ADMIN_TOKEN=<admin-jwt> \
//   node scripts/provision-puter-agents.mjs
//
// What it does:
//   1. Reads the 20 active_graph agents from Pentagon's Supabase.
//   2. For each agent name, creates a Puter user via the admin API
//      (POST /admin/users/create or /api/users — depends on Puter version).
//   3. Records the (agent_name -> puter_user, puter_home_dir) mapping
//      to agent-os/puter-agent-map.json.
//   4. Emits a factory event per provision (provision.puter_user_created
//      or provision.puter_user_exists).
//
// What it does NOT do:
//   - Modify the bridge's runClaude() to USE the per-agent home dirs.
//     That's the follow-up integration once Puter is running (the bridge
//     would read puter-agent-map.json + set CWD per dispatch).

import { existsSync, writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { installCrashGuard } from "./factory-crash-guard.mjs";
import { emitFactoryEvent } from "./factory-events.mjs";

installCrashGuard("provision-puter-agents");

const PUTER_URL = process.env.PUTER_URL || "http://puter.localhost:4100";
const PUTER_ADMIN_TOKEN = process.env.PUTER_ADMIN_TOKEN;
const MAP_PATH = resolve("agent-os/puter-agent-map.json");
const AGENT_SNAPSHOT = resolve("/tmp/active-graph-agents-post-migration.json");

if (!PUTER_ADMIN_TOKEN) {
  console.error("provision-puter-agents: PUTER_ADMIN_TOKEN env var is required.");
  console.error("Generate one in the Puter web UI under Settings → API Tokens, or");
  console.error("read it from the Puter server's admin user credentials.");
  process.exit(2);
}

// Read the agent snapshot we already produced during the migration.
// If unavailable, fail loudly so the operator knows to run
// scripts/read-active-graph-agents.mjs first.
if (!existsSync(AGENT_SNAPSHOT)) {
  console.error(`No agent snapshot at ${AGENT_SNAPSHOT}. Run:`);
  console.error(`  node scripts/read-active-graph-agents.mjs --out ${AGENT_SNAPSHOT}`);
  process.exit(3);
}

const snapshot = JSON.parse(readFileSync(AGENT_SNAPSHOT, "utf8"));
const agents = snapshot.agents || [];

// Each Pentagon agent name like "Maya (Code Owner)" gets slugified to
// a Puter username: maya_code_owner.
function slugify(name) {
  return name
    .toLowerCase()
    .replace(/\([^)]+\)/g, "")  // drop role labels in parens
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
}

async function puterApi(path, options = {}) {
  const res = await fetch(PUTER_URL + path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${PUTER_ADMIN_TOKEN}`,
      ...(options.headers || {}),
    },
  });
  return { status: res.status, body: await res.text().then((t) => { try { return JSON.parse(t); } catch { return t; } }) };
}

async function provisionAgent(agent) {
  const username = slugify(agent.name);
  // Verified endpoint per Puter v52: POST /signup creates a new user.
  // Admin token is honored but is_temp flag controls whether the user
  // is treated as a persistent member.
  const candidates = [
    { path: "/signup", body: {
        username,
        password: "BridgeAgent-" + username + "-pwd",
        email: username + "@active-graph.local",
        is_temp: false,
        send_confirmation_email: false,
    } },
  ];
  for (const c of candidates) {
    const { status, body } = await puterApi(c.path, { method: "POST", body: JSON.stringify(c.body) });
    // Puter returns 200 with proceed:true on success, 200 with error on duplicate.
    const isSuccess = status === 200 && body && body.proceed === true;
    const isDuplicate = body && typeof body === "object" && /already exists|in use|taken/i.test(JSON.stringify(body));
    if (isSuccess || isDuplicate || status === 201 || status === 409) {
      const exists = isDuplicate || status === 409;
      try {
        emitFactoryEvent({
          type: exists ? "provision.puter_user_exists" : "provision.puter_user_created",
          behavior: "provision-puter-agents",
          extras: {
            agent_id: agent.id,
            agent_name: agent.name,
            puter_username: username,
            puter_api_endpoint: c.path,
            status,
            home_dir: `/users/${username}`,
          },
        });
      } catch {}
      return { agent_id: agent.id, agent_name: agent.name, puter_username: username, home_dir: `/users/${username}`, exists };
    }
  }
  // None worked — log + skip.
  try {
    emitFactoryEvent({
      type: "provision.puter_user_failed",
      behavior: "provision-puter-agents",
      extras: {
        agent_id: agent.id,
        agent_name: agent.name,
        puter_username: username,
        note: "All admin API endpoints rejected the create request",
      },
    });
  } catch {}
  return null;
}

async function main() {
  // First confirm Puter is reachable.
  try {
    const { status } = await puterApi("/api/version", { method: "GET" });
    if (status >= 500) {
      console.error(`Puter at ${PUTER_URL} returned 5xx; is the server running?`);
      process.exit(4);
    }
  } catch (err) {
    console.error(`Puter at ${PUTER_URL} unreachable: ${err.message}`);
    console.error("Start it with `cd ~/puter && npm start` (see top-of-file setup notes).");
    process.exit(4);
  }
  const mapping = [];
  for (const agent of agents) {
    console.log(`provisioning ${agent.name} ...`);
    const result = await provisionAgent(agent);
    if (result) mapping.push(result);
  }
  writeFileSync(MAP_PATH, JSON.stringify({ generated_at: new Date().toISOString(), puter_url: PUTER_URL, agents: mapping }, null, 2));
  console.log(`\nWrote ${mapping.length} of ${agents.length} mappings to ${MAP_PATH}`);
  console.log("Next step: update bridge runClaude() to set CWD to each agent's Puter home dir using this map.");
}

await main();
