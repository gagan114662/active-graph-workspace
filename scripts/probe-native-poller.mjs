#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";

const ROOT = "/Users/gaganarora/Desktop/my projects/active_graph";
const PLIST = "/Users/gaganarora/Library/Preferences/run.pentagon.app.plist";
const PENTAGON_BIN = "/Applications/Pentagon.app/Contents/MacOS/Pentagon";
const BRIDGE_PLIST = "/Users/gaganarora/Library/LaunchAgents/run.pentagon.trigger-bridge.plist";
const BRIDGE_LABEL = "run.pentagon.trigger-bridge";

function arg(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  return idx === -1 ? fallback : process.argv[idx + 1] ?? fallback;
}

function has(name) {
  return process.argv.includes(name);
}

function command(cmd, args) {
  return spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
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
  const claims = decodeJwtPayload(accessToken);
  const supabaseOrigin = new URL(claims.iss).origin;
  return { accessToken, supabaseOrigin };
}

function readAnonKey() {
  return execFileSync("zsh", [
    "-lc",
    "strings " + JSON.stringify(PENTAGON_BIN) + " | rg '^eyJ' | head -1",
  ], { encoding: "utf8" }).trim();
}

let state = { ...readSession(), anonKey: readAnonKey() };

function refreshSession() {
  state = { ...readSession(), anonKey: state.anonKey };
}

function isExpiredJwtResponse(status, parsed) {
  return status === 401 && (
    parsed?.code === "PGRST303" ||
    /jwt expired/i.test(String(parsed?.message ?? parsed ?? ""))
  );
}

async function request(path, { method = "GET", body, prefer, retryOnExpiredJwt = true } = {}) {
  const res = await fetch(state.supabaseOrigin + path, {
    method,
    headers: {
      apikey: state.anonKey,
      Authorization: "Bearer " + state.accessToken,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = text;
  try { parsed = JSON.parse(text); } catch {}
  if (!res.ok && retryOnExpiredJwt && isExpiredJwtResponse(res.status, parsed)) {
    refreshSession();
    return request(path, { method, body, prefer, retryOnExpiredJwt: false });
  }
  if (!res.ok) {
    throw new Error(method + " " + path + " failed " + res.status + ": " + JSON.stringify(parsed));
  }
  return parsed;
}

async function findAgent(name) {
  const rows = await request(
    "/rest/v1/agents?directory=eq." + encodeURIComponent(ROOT) + "&name=eq." + encodeURIComponent(name) + "&deleted_at=is.null&select=id,name,directory,provider,model,execution_mode&limit=1"
  );
  if (!rows.length) throw new Error("agent not found: " + name);
  return rows[0];
}

async function findSharedConversation(agentA, agentB) {
  const rows = await request(
    "/rest/v1/conversation_participants?user_id=in.(" + agentA.id + "," + agentB.id + ")&left_at=is.null&deleted_at=is.null&select=conversation_id,user_id,created_at&limit=500"
  );
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.conversation_id)) grouped.set(row.conversation_id, new Set());
    grouped.get(row.conversation_id).add(row.user_id);
  }
  const candidates = [...grouped.entries()]
    .filter(([, ids]) => ids.has(agentA.id) && ids.has(agentB.id))
    .map(([conversationId]) => conversationId);
  const preferred = arg("--conversation-id");
  if (preferred) {
    if (!candidates.includes(preferred)) throw new Error("preferred conversation does not include both agents: " + preferred);
    return preferred;
  }
  const known = "0d996a94-45a6-4ef6-b8bd-45bc3f84d7e1";
  if (candidates.includes(known)) return known;
  if (!candidates.length) throw new Error("no shared conversation found for " + agentA.name + " and " + agentB.name);
  return candidates[0];
}

function bridgeState() {
  const res = command("launchctl", ["print", "gui/" + process.getuid() + "/" + BRIDGE_LABEL]);
  return { ok: res.status === 0, stdout: res.stdout, stderr: res.stderr };
}

function stopBridge() {
  const res = command("launchctl", ["bootout", "gui/" + process.getuid(), BRIDGE_PLIST]);
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

function restoreBridge() {
  command("launchctl", ["bootstrap", "gui/" + process.getuid(), BRIDGE_PLIST]);
  const kick = command("launchctl", ["kickstart", "-k", "gui/" + process.getuid() + "/" + BRIDGE_LABEL]);
  return { kick_status: kick.status, kick_stdout: kick.stdout, kick_stderr: kick.stderr, state: bridgeState() };
}

async function insertProbeMessage(conversationId, theo, hash) {
  const content = [
    "NATIVE_POLLER_PROBE " + hash,
    "Maya: if native Pentagon target polling activates this handoff, reply exactly:",
    "MAYA_NATIVE_POLLER_ACK " + hash,
    "If you are blocked, reply exactly:",
    "MAYA_NATIVE_POLLER_BLOCKED " + hash + " <literal reason>",
  ].join("\n");
  const rows = await request("/rest/v1/messages?select=id,conversation_id,sender_id,content,created_at", {
    method: "POST",
    prefer: "return=representation",
    body: { conversation_id: conversationId, sender_id: theo.id, content },
  });
  return rows[0];
}

async function triggerForMessage(messageId) {
  const rows = await request(
    "/rest/v1/agent_triggers?message_id=eq." + messageId + "&select=id,conversation_id,agent_id,sender_id,message_id,content,created_at,claimed_at,completed_at&limit=10"
  );
  return rows[0] ?? null;
}

async function ackRows(conversationId, maya, hash, since) {
  const rows = await request(
    "/rest/v1/messages?conversation_id=eq." + conversationId + "&sender_id=eq." + maya.id + "&created_at=gte." + encodeURIComponent(since) + "&select=id,content,created_at&order=created_at.asc&limit=50"
  );
  return rows.filter((row) => String(row.content ?? "").includes(hash));
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const watchSeconds = Number(arg("--watch-seconds", "90"));
  const restore = !has("--no-restore");
  const stopForProbe = !has("--keep-bridge-running");
  const hash = arg("--hash", "T5I_NATIVE_POLLER_PROBE_" + new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15) + "Z");
  const theo = await findAgent("Theo (Test Owner)");
  const maya = await findAgent("Maya (Code Owner)");
  const conversationId = await findSharedConversation(theo, maya);
  const beforeBridge = bridgeState();
  const result = {
    hash,
    watch_seconds: watchSeconds,
    theo,
    maya,
    conversation_id: conversationId,
    bridge_mode: stopForProbe ? "stopped_for_native_probe" : "kept_running_bridge_assisted_probe",
    bridge_before: { ok: beforeBridge.ok, summary: beforeBridge.ok ? "running" : beforeBridge.stderr.trim() },
  };

  try {
    if (stopForProbe) {
      result.bridge_stop = stopBridge();
      await sleep(1500);
      result.bridge_after_stop = bridgeState();
    }
    const message = await insertProbeMessage(conversationId, theo, hash);
    result.message = message;

    let trigger = null;
    for (let i = 0; i < 10; i += 1) {
      trigger = await triggerForMessage(message.id);
      if (trigger) break;
      await sleep(1000);
    }
    result.initial_trigger = trigger;
    if (!trigger) {
      result.final_trigger = null;
      result.ack_rows = await ackRows(conversationId, maya, hash, message.created_at);
      result.bridge_assisted_pass = false;
      result.native_pass = false;
      result.verdict = "native_poller_no_trigger_created";
    } else {
      const deadline = Date.now() + watchSeconds * 1000;
      let finalTrigger = trigger;
      let finalAcks = [];
      while (Date.now() < deadline) {
        finalTrigger = await triggerForMessage(message.id);
        finalAcks = await ackRows(conversationId, maya, hash, message.created_at);
        if (finalTrigger?.claimed_at && finalTrigger?.completed_at && finalAcks.length) break;
        await sleep(5000);
      }
      result.final_trigger = finalTrigger;
      result.ack_rows = finalAcks;
      const completedWithAck = Boolean(finalTrigger?.claimed_at && finalTrigger?.completed_at && finalAcks.length);
      result.bridge_assisted_pass = !stopForProbe && completedWithAck;
      result.native_pass = stopForProbe && completedWithAck;
      if (result.native_pass) {
        result.verdict = "native_poller_passed";
      } else if (result.bridge_assisted_pass) {
        result.verdict = "bridge_assisted_poller_passed_native_unproven";
      } else {
        result.verdict = "native_poller_still_blocked";
      }
    }
  } finally {
    if (restore && stopForProbe) {
      result.bridge_restore = restoreBridge();
    }
  }

  console.log(JSON.stringify(result, null, 2));
  if (!result.native_pass) process.exitCode = 2;
}

await main();
