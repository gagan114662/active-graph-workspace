#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";

const ROOT = "/Users/gaganarora/Desktop/my projects/active_graph";
const PLIST = "/Users/gaganarora/Library/Preferences/run.pentagon.app.plist";
const PENTAGON_BIN = "/Applications/Pentagon.app/Contents/MacOS/Pentagon";
const PENTAGON_INFO_PLIST = "/Applications/Pentagon.app/Contents/Info.plist";
const CONVERSATION_ID = "0d996a94-45a6-4ef6-b8bd-45bc3f84d7e1";

function command(cmd, args, options = {}) {
  const res = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    ...options,
  });
  return {
    status: res.status,
    stdout: String(res.stdout ?? ""),
    stderr: String(res.stderr ?? ""),
  };
}

function decodeJwtPayload(jwt) {
  const part = jwt.split(".")[1];
  const padded = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
  return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
}

function readSession() {
  const raw = execFileSync("/usr/libexec/PlistBuddy", [
    "-c",
    "Print :supabase.auth.sb-auth-auth-token",
    PLIST,
  ], { encoding: "utf8" });
  const session = JSON.parse(raw);
  const accessToken = session.accessToken;
  const supabaseOrigin = new URL(decodeJwtPayload(accessToken).iss).origin;
  const anonKey = execFileSync("zsh", [
    "-lc",
    "strings " + JSON.stringify(PENTAGON_BIN) + " | rg '^eyJ' | head -1",
  ], { encoding: "utf8" }).trim();
  return { accessToken, supabaseOrigin, anonKey };
}

async function supabase(state, path) {
  const res = await fetch(state.supabaseOrigin + path, {
    headers: {
      apikey: state.anonKey,
      Authorization: "Bearer " + state.accessToken,
      Accept: "application/json",
    },
  });
  const text = await res.text();
  let parsed = text;
  try { parsed = JSON.parse(text); } catch {}
  if (!res.ok) throw new Error(path + " failed " + res.status + ": " + JSON.stringify(parsed));
  return parsed;
}

function plistValue(key) {
  const res = command("/usr/libexec/PlistBuddy", ["-c", "Print :" + key, PENTAGON_INFO_PLIST]);
  return res.status === 0 ? res.stdout.trim() : null;
}

function defaultsValue(key) {
  const res = command("defaults", ["read", "run.pentagon.app", key]);
  return res.status === 0 ? res.stdout.trim() : null;
}

function stringsMatches() {
  const res = command("zsh", [
    "-lc",
    "strings " + JSON.stringify(PENTAGON_BIN) + " | rg -i " +
      JSON.stringify("TriggerPoller|cloud.trigger-catchup|handleAgentTrigger|claim_agent_trigger|messaging.claim-trigger|messaging.complete-trigger|triggerAgentResponse|HeartbeatPoller|MessagePoller|agent_id, user_id, doc_type, content, updated_at, device_id"),
  ]);
  const lines = res.stdout.split(/\r?\n/).filter(Boolean);
  const needles = [
    "TriggerPoller",
    "cloud.trigger-catchup",
    "handleAgentTrigger",
    "claim_agent_trigger",
    "messaging.claim-trigger",
    "messaging.complete-trigger",
    "triggerAgentResponse",
    "MessagePoller",
    "HeartbeatPoller",
  ];
  return {
    status: res.status,
    counts: Object.fromEntries(needles.map((needle) => [
      needle,
      lines.filter((line) => line.includes(needle)).length,
    ])),
    excerpts: lines.slice(0, 80),
  };
}

function pentagonProcess() {
  return command("zsh", [
    "-lc",
    "ps -axo pid=,lstart=,etime=,command= | rg '/Applications/Pentagon.app/Contents/MacOS/Pentagon' | rg -v 'rg '",
  ]);
}

function launchdBridge() {
  return command("zsh", [
    "-lc",
    "launchctl print gui/$(id -u)/run.pentagon.trigger-bridge | sed -n '1,80p'",
  ]);
}

async function main() {
  const state = readSession();
  const agents = await supabase(
    state,
    "/rest/v1/agents?select=id,name,provider,model,harness_id,execution_mode,directory,device_id,last_seen_at,warm_window_seconds,provider_endpoint_mode,agent_os_serve_session_id&directory=eq." + encodeURIComponent(ROOT) + "&deleted_at=is.null&order=name.asc&limit=50"
  );
  const counts = {};
  const deviceCounts = {};
  for (const agent of agents) {
    const key = [agent.provider, agent.model, agent.harness_id, agent.execution_mode].join("|");
    counts[key] = (counts[key] ?? 0) + 1;
    const device = agent.device_id ?? "null";
    deviceCounts[device] = (deviceCounts[device] ?? 0) + 1;
  }
  const pendingTriggers = await supabase(
    state,
    "/rest/v1/agent_triggers?conversation_id=eq." + CONVERSATION_ID + "&claimed_at=is.null&completed_at=is.null&select=id,agent_id,sender_id,message_id,created_at,content&order=created_at.asc&limit=50"
  );

  const recentTriggers = await supabase(
    state,
    "/rest/v1/agent_triggers?conversation_id=eq." + CONVERSATION_ID + "&select=id,agent_id,sender_id,message_id,created_at,claimed_at,completed_at,content&order=created_at.desc&limit=8"
  );

  console.log(JSON.stringify({
    app: {
      bundle_short_version: plistValue("CFBundleShortVersionString"),
      bundle_version: plistValue("CFBundleVersion"),
      process: pentagonProcess(),
      defaults: {
        sync_device_id: defaultsValue("pentagon.sync.deviceId"),
        codex_cli_path: defaultsValue("pentagon.codexCliPath"),
        claude_cli_path: defaultsValue("pentagon.claudeCliPath"),
        default_model: defaultsValue("pentagon.defaultModel"),
        last_execution_mode: defaultsValue("pentagon.createAgent.lastExecutionMode"),
        notifications_enabled: defaultsValue("pentagon.notificationsEnabled"),
      },
    },
    binary_surface: stringsMatches(),
    live_agents: {
      count: agents.length,
      provider_model_harness_execution_counts: counts,
      device_counts: deviceCounts,
      theo: agents.find((agent) => agent.name === "Theo (Test Owner)") ?? null,
      maya: agents.find((agent) => agent.name === "Maya (Code Owner)") ?? null,
      agents_without_device: agents.filter((agent) => !agent.device_id).map((agent) => agent.name),
      stale_last_seen_agents: agents
        .filter((agent) => !agent.last_seen_at)
        .map((agent) => agent.name),
    },
    trigger_queue: {
      conversation_id: CONVERSATION_ID,
      pending_count: pendingTriggers.length,
      pending: pendingTriggers.map((trigger) => ({
        id: trigger.id,
        agent_id: trigger.agent_id,
        sender_id: trigger.sender_id,
        message_id: trigger.message_id,
        created_at: trigger.created_at,
        content_preview: String(trigger.content ?? "").slice(0, 120),
      })),
      recent: recentTriggers.map((trigger) => ({
        id: trigger.id,
        agent_id: trigger.agent_id,
        sender_id: trigger.sender_id,
        message_id: trigger.message_id,
        created_at: trigger.created_at,
        claimed_at: trigger.claimed_at,
        completed_at: trigger.completed_at,
        content_preview: String(trigger.content ?? "").slice(0, 120),
      })),
    },
    bridge: {
      launchd: launchdBridge(),
    },
  }, null, 2));
}

await main();
