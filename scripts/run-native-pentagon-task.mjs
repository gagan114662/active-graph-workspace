#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { classifyNativeRunnerResult } from "./t7-repetition-classifier.mjs";

const ROOT = "/Users/gaganarora/Desktop/my projects/active_graph";
const PLIST = "/Users/gaganarora/Library/Preferences/run.pentagon.app.plist";
const PENTAGON_BIN = "/Applications/Pentagon.app/Contents/MacOS/Pentagon";
const BRIDGE_PLIST = "/Users/gaganarora/Library/LaunchAgents/run.pentagon.trigger-bridge.plist";
const BRIDGE_LABEL = "run.pentagon.trigger-bridge";
const THEO = "Theo (Test Owner)";

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
  const raw = execFileSync("/usr/libexec/PlistBuddy", ["-c", "Print :supabase.auth.sb-auth-auth-token", PLIST], { encoding: "utf8" });
  const session = JSON.parse(raw);
  const accessToken = session.accessToken;
  return { accessToken, supabaseOrigin: new URL(decodeJwtPayload(accessToken).iss).origin };
}

function readAnonKey() {
  return execFileSync("zsh", ["-lc", "strings " + JSON.stringify(PENTAGON_BIN) + " | rg '^eyJ' | head -1"], { encoding: "utf8" }).trim();
}

let state = { ...readSession(), anonKey: readAnonKey() };

function refreshSession() {
  state = { ...readSession(), anonKey: state.anonKey };
}

function isExpiredJwtResponse(status, parsed) {
  return status === 401 && (parsed?.code === "PGRST303" || /jwt expired/i.test(String(parsed?.message ?? parsed ?? "")));
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
  if (!res.ok) throw new Error(method + " " + path + " failed " + res.status + ": " + JSON.stringify(parsed));
  return parsed;
}

async function findAgent(name) {
  const rows = await request(
    "/rest/v1/agents?directory=eq." + encodeURIComponent(ROOT) + "&name=eq." + encodeURIComponent(name) + "&deleted_at=is.null&select=id,name,directory,provider,model,harness_id,execution_mode&limit=1"
  );
  if (!rows.length) throw new Error("agent not found: " + name);
  return rows[0];
}

async function findSharedConversation(agentA, agentB) {
  const preferred = arg("--conversation-id");
  if (preferred) return preferred;
  const rows = await request(
    "/rest/v1/conversation_participants?user_id=in.(" + agentA.id + "," + agentB.id + ")&left_at=is.null&deleted_at=is.null&select=conversation_id,user_id&limit=500"
  );
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.conversation_id)) grouped.set(row.conversation_id, new Set());
    grouped.get(row.conversation_id).add(row.user_id);
  }
  const known = "0d996a94-45a6-4ef6-b8bd-45bc3f84d7e1";
  const candidates = [...grouped.entries()].filter(([, ids]) => ids.has(agentA.id) && ids.has(agentB.id)).map(([id]) => id);
  if (candidates.includes(known)) return known;
  if (!candidates.length) throw new Error("no shared conversation found");
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

async function insertMessage(conversationId, senderId, content) {
  const rows = await request("/rest/v1/messages?select=id,conversation_id,sender_id,content,created_at", {
    method: "POST",
    prefer: "return=representation",
    body: { conversation_id: conversationId, sender_id: senderId, content },
  });
  return rows[0];
}

async function triggerForMessage(messageId) {
  const rows = await request(
    "/rest/v1/agent_triggers?message_id=eq." + messageId + "&select=id,conversation_id,agent_id,sender_id,message_id,content,created_at,claimed_at,completed_at&limit=10"
  );
  return rows[0] ?? null;
}

async function responseRows(conversationId, agent, hash, since) {
  const rows = await request(
    "/rest/v1/messages?conversation_id=eq." + conversationId + "&sender_id=eq." + agent.id + "&created_at=gte." + encodeURIComponent(since) + "&select=id,content,created_at&order=created_at.asc&limit=50"
  );
  return rows.filter((row) => String(row.content ?? "").includes(hash));
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const hash = arg("--hash");
  const level = arg("--level", "task");
  const targetName = arg("--target", "Maya (Code Owner)");
  const instructionFile = arg("--instruction-file");
  const expectFile = arg("--expect-file");
  const watchSeconds = Number(arg("--watch-seconds", "180"));
  if (!hash || !instructionFile) throw new Error("usage: --hash <hash> --instruction-file <path> [--expect-file <path>]");
  const instruction = readFileSync(instructionFile, "utf8");
  const target = await findAgent(targetName);
  const theo = await findAgent(THEO);
  const conversationId = await findSharedConversation(theo, target);
  const result = {
    hash,
    level,
    target,
    sender: theo,
    conversation_id: conversationId,
    instruction_file: instructionFile,
    expect_file: expectFile,
    bridge_before: { ok: bridgeState().ok },
  };
  try {
    if (!has("--keep-bridge-running")) {
      result.bridge_stop = stopBridge();
      await sleep(1500);
      result.bridge_after_stop = bridgeState();
    }
    const message = await insertMessage(conversationId, theo.id, instruction);
    result.message = message;
    let trigger = null;
    for (let i = 0; i < 15; i += 1) {
      trigger = await triggerForMessage(message.id);
      if (trigger) break;
      await sleep(1000);
    }
    result.initial_trigger = trigger;
    const deadline = Date.now() + watchSeconds * 1000;
    let finalTrigger = trigger;
    let responses = [];
    while (Date.now() < deadline) {
      finalTrigger = await triggerForMessage(message.id);
      responses = await responseRows(conversationId, target, hash, message.created_at);
      const fileOk = expectFile ? existsSync(expectFile) && readFileSync(expectFile, "utf8").includes(hash) : true;
      if (finalTrigger?.claimed_at && finalTrigger?.completed_at && responses.length && fileOk) break;
      await sleep(5000);
    }
    result.final_trigger = finalTrigger;
    result.response_rows = responses;
    result.expected_file = expectFile ? {
      exists: existsSync(expectFile),
      contains_hash: existsSync(expectFile) ? readFileSync(expectFile, "utf8").includes(hash) : false,
      content: existsSync(expectFile) ? readFileSync(expectFile, "utf8").slice(0, 4000) : null,
    } : null;
    const filePassed = !expectFile || result.expected_file.contains_hash;
    const triggerPassed = Boolean(finalTrigger?.claimed_at && finalTrigger?.completed_at);
    const messagePollerPassed = Boolean(!finalTrigger && responses.length && filePassed);
    result.activation_path = triggerPassed ? "agent_trigger" : (messagePollerPassed ? "message_poller_no_trigger_row" : "incomplete");
    result.agent_triggers_result = finalTrigger ? [finalTrigger] : [];
    Object.assign(result, classifyNativeRunnerResult(result));
  } finally {
    if (!has("--no-restore") && !has("--keep-bridge-running")) result.bridge_restore = restoreBridge();
  }
  console.log(JSON.stringify(result, null, 2));
  if (!result.native_pass) process.exitCode = 2;
}

await main();
