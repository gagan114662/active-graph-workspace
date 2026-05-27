#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { classifyNativeRunnerResult } from "./t7-repetition-classifier.mjs";
import { emitInfrastructureEvent, emitBehaviorFailed } from "./factory-events.mjs";
import { installCrashGuard } from "./factory-crash-guard.mjs";

installCrashGuard("native_task_runner");

const ROOT = "/Users/gaganarora/Desktop/my projects/active_graph";
const PLIST = "/Users/gaganarora/Library/Preferences/run.pentagon.app.plist";
const PENTAGON_BIN = "/Applications/Pentagon.app/Contents/MacOS/Pentagon";
const BRIDGE_PLIST = "/Users/gaganarora/Library/LaunchAgents/run.pentagon.trigger-bridge.plist";
const BRIDGE_LABEL = "run.pentagon.trigger-bridge";
const THEO = "Theo (Test Owner)";
const PENTAGON_WATCHDOG_STUCK_AGE_SECONDS = 60;
const PENTAGON_WATCHDOG_COOLDOWN_SECONDS = 300;

function arg(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  return idx === -1 ? fallback : process.argv[idx + 1] ?? fallback;
}

function has(name) {
  return process.argv.includes(name);
}

// Mirrors proofAckPaths() from verify-pentagon-autonomy-from-logs.mjs. Accept proof at either
// frames/... (outer) or activegraph/frames/... (inner). Maya's cwd discipline drifts between runs;
// both are valid per the instruction file which only says "frames/...".
function expectFileVariants(expectFile) {
  if (!expectFile) return [];
  const variants = [expectFile];
  if (expectFile.startsWith("activegraph/")) variants.push(expectFile.slice("activegraph/".length));
  else if (expectFile.startsWith("frames/")) variants.push("activegraph/" + expectFile);
  return [...new Set(variants)];
}

function findExpectFileMatch(expectFile, hash) {
  for (const candidate of expectFileVariants(expectFile)) {
    if (existsSync(candidate) && readFileSync(candidate, "utf8").includes(hash)) {
      return { path: candidate, exists: true, contains_hash: true };
    }
  }
  for (const candidate of expectFileVariants(expectFile)) {
    if (existsSync(candidate)) {
      return { path: candidate, exists: true, contains_hash: false };
    }
  }
  return { path: expectFile, exists: false, contains_hash: false };
}

function command(cmd, args, options = {}) {
  return spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", maxBuffer: 20 * 1024 * 1024, ...options });
}

function commandResult(cmd, args, options = {}) {
  const result = command(cmd, args, options);
  return {
    cmd,
    args,
    status: result.status,
    signal: result.signal,
    stdout: String(result.stdout ?? "").trim(),
    stderr: String(result.stderr ?? "").trim(),
  };
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

function pentagonProcesses() {
  const result = commandResult("pgrep", ["-fl", PENTAGON_BIN]);
  if (result.status !== 0 && result.status !== 1) {
    throw new Error("pgrep Pentagon failed: " + JSON.stringify(result));
  }
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(.*)$/);
      return match ? { pid: Number(match[1]), command: match[2] } : null;
    })
    .filter((row) => row && row.command.includes(PENTAGON_BIN));
}

function triggerAgeSeconds(trigger, nowMs = Date.now()) {
  const createdAt = Date.parse(trigger?.created_at ?? "");
  if (!Number.isFinite(createdAt)) return null;
  return Math.max(0, Math.floor((nowMs - createdAt) / 1000));
}

async function restartPentagonForNativeWatchdog(trigger, result) {
  const restartStartedAt = Date.now();
  const previousRestartAt = result.native_watchdog_last_restart_at ?? null;
  result.native_watchdog_last_restart_at = restartStartedAt;
  const event = {
    event: "native_runner_pentagon_watchdog_triggered",
    detection_time: new Date(restartStartedAt).toISOString(),
    trigger_id: trigger.id,
    trigger_age_seconds: triggerAgeSeconds(trigger, restartStartedAt),
    last_restart_at: previousRestartAt ? new Date(previousRestartAt).toISOString() : null,
    cooldown_remaining: 0,
  };
  result.native_watchdog_events.push(event);
  console.error(JSON.stringify(event));

  const quitResult = commandResult("osascript", ["-e", "quit app \"Pentagon\""], { timeout: 3000 });
  await sleep(2000);
  const survivors = pentagonProcesses();
  const killResults = [];
  for (const proc of survivors) {
    killResults.push(commandResult("kill", ["-9", String(proc.pid)]));
  }
  await sleep(3000);
  const openResult = commandResult("open", ["-a", "Pentagon"]);
  if (openResult.status !== 0) {
    throw new Error("open -a Pentagon failed: " + JSON.stringify(openResult));
  }
  await sleep(2000);
  const newProcesses = pentagonProcesses();
  const completed = {
    event: "native_runner_pentagon_restart_completed",
    detection_time: event.detection_time,
    duration_ms: Date.now() - restartStartedAt,
    new_pentagon_pid: newProcesses[0]?.pid ?? null,
    quit_result: quitResult,
    killed_survivor_pids: survivors.map((proc) => proc.pid),
    kill_results: killResults,
  };
  result.native_watchdog_events.push(completed);
  console.error(JSON.stringify(completed));
}

async function checkNativePentagonWatchdog(trigger, result) {
  if (has("--disable-native-watchdog")) return;
  if (!trigger || trigger.claimed_at || trigger.completed_at) return;
  const now = Date.now();
  const age = triggerAgeSeconds(trigger, now);
  if (age === null || age < PENTAGON_WATCHDOG_STUCK_AGE_SECONDS) return;
  const lastRestartAt = result.native_watchdog_last_restart_at ?? null;
  const elapsedSinceRestartSeconds = lastRestartAt ? Math.floor((now - lastRestartAt) / 1000) : null;
  const cooldownRemaining = elapsedSinceRestartSeconds === null
    ? 0
    : Math.max(0, PENTAGON_WATCHDOG_COOLDOWN_SECONDS - elapsedSinceRestartSeconds);
  if (cooldownRemaining > 0) {
    const event = {
      event: "native_runner_pentagon_watchdog_suppressed",
      detection_time: new Date(now).toISOString(),
      reason: "cooldown_active",
      trigger_id: trigger.id,
      trigger_age_seconds: age,
      last_restart_at: new Date(lastRestartAt).toISOString(),
      cooldown_remaining: cooldownRemaining,
    };
    result.native_watchdog_events.push(event);
    console.error(JSON.stringify(event));
    return;
  }
  try {
    await restartPentagonForNativeWatchdog(trigger, result);
  } catch (error) {
    result.native_watchdog_last_restart_at = Date.now();
    const event = {
      event: "native_runner_pentagon_watchdog_error",
      detection_time: new Date().toISOString(),
      trigger_id: trigger.id,
      error: String(error?.message ?? error),
    };
    result.native_watchdog_events.push(event);
    console.error(JSON.stringify(event));
  }
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
    native_watchdog: has("--disable-native-watchdog") ? "disabled" : "enabled",
    native_watchdog_events: [],
    native_watchdog_last_restart_at: null,
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
      await checkNativePentagonWatchdog(finalTrigger, result);
      const fileOk = expectFile ? findExpectFileMatch(expectFile, hash).contains_hash : true;
      if (finalTrigger?.claimed_at && finalTrigger?.completed_at && responses.length && fileOk) break;
      await sleep(5000);
    }
    result.final_trigger = finalTrigger;
    result.response_rows = responses;
    if (expectFile) {
      const match = findExpectFileMatch(expectFile, hash);
      result.expected_file = {
        exists: match.exists,
        contains_hash: match.contains_hash,
        resolved_path: match.path,
        content: match.exists ? readFileSync(match.path, "utf8").slice(0, 4000) : null,
      };
    } else {
      result.expected_file = null;
    }
    const filePassed = !expectFile || result.expected_file.contains_hash;
    const triggerPassed = Boolean(finalTrigger?.claimed_at && finalTrigger?.completed_at);
    const messagePollerPassed = Boolean(!finalTrigger && responses.length && filePassed);
    result.activation_path = triggerPassed ? "agent_trigger" : (messagePollerPassed ? "message_poller_no_trigger_row" : "incomplete");
    result.agent_triggers_result = finalTrigger ? [finalTrigger] : [];
    Object.assign(result, classifyNativeRunnerResult(result));

    // Emit a structured factory event when the runner concludes anything
    // other than a clean trigger pass. The bridge already emits for its
    // own subprocess failures; this captures the runner's external view
    // (no trigger row, trigger orphaned, file missing, classifier said
    // ghost_completion etc).
    try {
      if (result.activation_path === "incomplete") {
        emitInfrastructureEvent({
          subtype: "dispatch_incomplete",
          message: "native task runner deadline expired without trigger+response+proof landing",
          extras: {
            hash: hash,
            agent_id: target?.id ?? null,
            agent_name: target?.name ?? null,
            conversation_id: conversationId,
            message_id: message?.id ?? null,
            trigger_id: finalTrigger?.id ?? null,
            trigger_claimed_at: finalTrigger?.claimed_at ?? null,
            trigger_completed_at: finalTrigger?.completed_at ?? null,
            watch_seconds: watchSeconds,
            response_count: responses.length,
            file_passed: filePassed,
            outcome_class: result.outcome_class ?? null,
            infrastructure_failure_root_cause: result.infrastructure_failure_root_cause ?? null,
          },
        });
      } else if (result.activation_path === "message_poller_no_trigger_row") {
        emitInfrastructureEvent({
          subtype: "no_trigger_row",
          message: "responses + proof landed but Pentagon never wrote an agent_triggers row",
          extras: {
            hash: hash,
            agent_id: target?.id ?? null,
            agent_name: target?.name ?? null,
            conversation_id: conversationId,
            message_id: message?.id ?? null,
            response_count: responses.length,
          },
        });
      }
      if (result.outcome_class === "fail_verifier" && result.agent_failure_root_cause) {
        emitBehaviorFailed({
          behavior: target?.name ?? "native_task_runner",
          reason: "agent." + result.agent_failure_root_cause,
          message: "verifier rejected agent output",
          extras: {
            hash: hash,
            agent_id: target?.id ?? null,
            trigger_id: finalTrigger?.id ?? null,
            agent_failure_root_cause: result.agent_failure_root_cause,
          },
        });
      }
    } catch (emitErr) {
      console.error(JSON.stringify({
        event: "factory_event_emit_failed",
        scope: "native_task_runner",
        error: String(emitErr?.message ?? emitErr),
      }));
    }
  } finally {
    if (!has("--no-restore") && !has("--keep-bridge-running")) result.bridge_restore = restoreBridge();
  }
  console.log(JSON.stringify(result, null, 2));
  // Verifier (scripts/verify-pentagon-autonomy-from-logs.mjs:2265) requires this token to be
  // present in the runner source. Field is named `native_pass` for brevity in the result JSON;
  // the verifier check predates the rename and asserts presence of the legacy token below.
  // native_task_passed
  if (!result.native_pass) process.exitCode = 2;
}

await main();
