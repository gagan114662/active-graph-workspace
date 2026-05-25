#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const WORKSPACE = "/Users/gaganarora/Desktop/my projects/active_graph";
const PLIST = "/Users/gaganarora/Library/Preferences/run.pentagon.app.plist";
const PENTAGON_BIN = "/Applications/Pentagon.app/Contents/MacOS/Pentagon";
const MCP_URL = "https://auth.pentagon.run/functions/v1/mcp";
const PENTAGON_WATCHDOG_STUCK_AGE_SECONDS = 60;
const PENTAGON_WATCHDOG_COOLDOWN_SECONDS = 300;
const PENTAGON_WATCHDOG_AGENT_CACHE_MS = 60_000;
const PENTAGON_WATCHDOG_NATIVE_CONTENT_FILTER = "or=(content.ilike.NATIVE*,content.ilike.PIPELINE_SMOKE_TEST*)";

function arg(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  return idx === -1 ? fallback : process.argv[idx + 1] ?? fallback;
}

function has(name) {
  return process.argv.includes(name);
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
  const out = execFileSync("zsh", [
    "-lc",
    `strings "${PENTAGON_BIN}" | rg '^eyJ' | head -1`,
  ], { encoding: "utf8" }).trim();
  if (!out) throw new Error("Could not find embedded Supabase anon key in Pentagon binary.");
  return out;
}

function refreshSession() {
  const currentAnonKey = state?.anonKey ?? readAnonKey();
  state = { ...readSession(), anonKey: currentAnonKey };
  return state;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
      Authorization: `Bearer ${state.accessToken}`,
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
    throw new Error(`${method} ${path} failed ${res.status}: ${JSON.stringify(parsed)}`);
  }
  return parsed;
}

async function mintAgentToken(agentId, retryOnExpiredJwt = true) {
  const res = await fetch(state.supabaseOrigin + "/functions/v1/mint-agent-token", {
    method: "POST",
    headers: {
      apikey: state.anonKey,
      Authorization: `Bearer ${state.accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ agent_id: agentId }),
  });
  const text = await res.text();
  let parsed = text;
  try { parsed = JSON.parse(text); } catch {}
  if ((!res.ok || !parsed.token) && retryOnExpiredJwt && isExpiredJwtResponse(res.status, parsed)) {
    refreshSession();
    return mintAgentToken(agentId, false);
  }
  if (!res.ok || !parsed.token) {
    throw new Error(`mint-agent-token failed ${res.status}: ${JSON.stringify(parsed)}`);
  }
  return parsed.token;
}

async function pendingTriggers(limit) {
  const maxAgeSeconds = Number(arg("--max-age-seconds", "0"));
  const ageFilter = maxAgeSeconds
    ? `&created_at=gte.${encodeURIComponent(new Date(Date.now() - maxAgeSeconds * 1000).toISOString())}`
    : "";
  const rows = await request(
    `/rest/v1/agent_triggers?claimed_at=is.null&completed_at=is.null${ageFilter}&select=id,conversation_id,agent_id,sender_id,message_id,content,created_at&order=created_at.asc&limit=${limit}`
  );
  return rows;
}

async function claimTrigger(triggerId) {
  const rows = await request("/rest/v1/rpc/claim_agent_trigger", {
    method: "POST",
    body: { p_trigger_id: triggerId },
  });
  return rows?.[0] ?? null;
}

async function completeTrigger(triggerId) {
  const rows = await request("/rest/v1/rpc/complete_agent_trigger", {
    method: "POST",
    body: { p_trigger_id: triggerId },
  });
  return rows?.[0] ?? null;
}

async function persistAgentMessage(trigger, content) {
  const trimmed = String(content ?? "").trim();
  if (!trimmed || trimmed === "[no-response]") return null;
  const since = encodeURIComponent(trigger.created_at);
  const existing = await request(
    `/rest/v1/messages?conversation_id=eq.${trigger.conversation_id}&sender_id=eq.${trigger.agent_id}&created_at=gte.${since}&select=id,conversation_id,sender_id,content,created_at&order=created_at.desc&limit=20`
  );
  const alreadySent = existing.find((message) => String(message.content ?? "").trim() === trimmed);
  if (alreadySent) return alreadySent;
  const rows = await request("/rest/v1/messages?select=id,conversation_id,sender_id,content,created_at", {
    method: "POST",
    prefer: "return=representation",
    body: {
      conversation_id: trigger.conversation_id,
      sender_id: trigger.agent_id,
      content: trimmed,
    },
  });
  return rows?.[0] ?? null;
}

function codexPrompt(trigger) {
  return [
    "You are the Pentagon target agent for this claimed trigger.",
    "Use the configured Pentagon MCP tools to inspect the conversation if needed and respond in the same conversation.",
    "Keep the response short and specific. If the message asks for an exact ACK or BLOCKED format, follow it exactly.",
    "Do not claim completion silently; produce a visible message unless the trigger is clearly obsolete.",
    "",
    `trigger_id: ${trigger.id}`,
    `conversation_id: ${trigger.conversation_id}`,
    `agent_id: ${trigger.agent_id}`,
    `sender_id: ${trigger.sender_id}`,
    `message_id: ${trigger.message_id}`,
    `message_created_at: ${trigger.created_at}`,
    "",
    "Message:",
    trigger.content,
  ].join("\n");
}

function runCodex(trigger, token) {
  const codex = process.env.PENTAGON_CODEX || "/opt/homebrew/bin/codex";
  const args = [
    "exec",
    "--json",
    "--dangerously-bypass-approvals-and-sandbox",
    "--skip-git-repo-check",
    "--ignore-user-config",
    "-C",
    WORKSPACE,
    "--model",
    arg("--model", "gpt-5.5"),
    "-c",
    `mcp_servers.pentagon.url="${MCP_URL}"`,
    "-c",
    `mcp_servers.pentagon.http_headers.Authorization="Bearer ${token}"`,
    "-",
  ];
  return spawnSync(codex, args, {
    input: codexPrompt(trigger),
    encoding: "utf8",
    timeout: Number(arg("--codex-timeout-ms", "180000")),
    maxBuffer: 10 * 1024 * 1024,
  });
}

function finalAgentMessage(stdout) {
  let latest = null;
  for (const line of String(stdout ?? "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event.type === "item.completed" && event.item?.type === "agent_message") {
        latest = event.item.text;
      }
    } catch {}
  }
  return latest;
}

function isTerminalMessage(content) {
  const firstLine = String(content ?? "").trim().split(/\r?\n/, 1)[0] ?? "";
  const firstToken = firstLine.split(/\s+/, 1)[0] ?? "";
  const normalizedFirstToken = firstToken.replace(/[,:;.]+$/, "");
  return (
    /_(ACK|BLOCKED)$/.test(normalizedFirstToken) ||
    /^(ACK|BLOCKED)$/i.test(normalizedFirstToken) ||
    /^(Accepted|Acknowledged|Confirmed)\b/.test(firstLine) ||
    /^Posted the Pentagon response\b/.test(firstLine) ||
    /^Report update:/i.test(firstLine) ||
    /^status_report:/i.test(firstLine)
  );
}

function summarizeTrigger(trigger) {
  return {
    id: trigger.id,
    conversation_id: trigger.conversation_id,
    agent_id: trigger.agent_id,
    sender_id: trigger.sender_id,
    message_id: trigger.message_id,
    created_at: trigger.created_at,
    content_preview: String(trigger.content ?? "").slice(0, 180),
  };
}

function commandResult(cmd, args) {
  const result = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 1024 * 1024 });
  return {
    cmd,
    args,
    status: result.status,
    signal: result.signal,
    stdout: String(result.stdout ?? "").trim(),
    stderr: String(result.stderr ?? "").trim(),
  };
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

async function activeGraphAgentIds() {
  const now = Date.now();
  if (agentIdCache.ids && now - agentIdCache.loadedAt < PENTAGON_WATCHDOG_AGENT_CACHE_MS) {
    return agentIdCache.ids;
  }
  const rows = await request(
    "/rest/v1/agents?directory=eq." + encodeURIComponent(WORKSPACE) +
      "&deleted_at=is.null&select=id&limit=200"
  );
  agentIdCache = { ids: rows.map((row) => row.id), loadedAt: now };
  return agentIdCache.ids;
}

function triggerAgeSeconds(trigger, nowMs = Date.now()) {
  const createdAt = Date.parse(trigger.created_at ?? "");
  if (!Number.isFinite(createdAt)) return null;
  return Math.max(0, Math.floor((nowMs - createdAt) / 1000));
}

async function stuckNativeTriggers() {
  const agentIds = await activeGraphAgentIds();
  if (!agentIds.length) return [];
  const cutoff = new Date(Date.now() - PENTAGON_WATCHDOG_STUCK_AGE_SECONDS * 1000).toISOString();
  const rows = await request(
    "/rest/v1/agent_triggers?claimed_at=is.null&completed_at=is.null" +
      "&created_at=lt." + encodeURIComponent(cutoff) +
      "&agent_id=in.(" + agentIds.join(",") + ")" +
      "&" + PENTAGON_WATCHDOG_NATIVE_CONTENT_FILTER +
      "&select=id,conversation_id,agent_id,sender_id,message_id,content,created_at&order=created_at.asc&limit=50"
  );
  return rows.filter((row) => /^(NATIVE|PIPELINE_SMOKE_TEST)/.test(String(row.content ?? "")));
}

async function restartPentagonForWatchdog(stuckTriggers, detectionTime, cooldownRemaining) {
  const restartStartedAt = Date.now();
  const previousRestartAt = lastPentagonWatchdogRestartAt;
  lastPentagonWatchdogRestartAt = restartStartedAt;
  const ages = stuckTriggers.map((trigger) => triggerAgeSeconds(trigger, restartStartedAt));
  console.error(JSON.stringify({
    event: "pentagon_watchdog_triggered",
    detection_time: detectionTime,
    num_stuck_triggers: stuckTriggers.length,
    ages,
    oldest_trigger_id: stuckTriggers[0]?.id ?? null,
    last_restart_at: previousRestartAt ? new Date(previousRestartAt).toISOString() : null,
    cooldown_remaining: cooldownRemaining,
  }));

  const quitResult = commandResult("osascript", ["-e", "quit app \"Pentagon\""]);
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
  console.error(JSON.stringify({
    event: "pentagon_restart_completed",
    detection_time: detectionTime,
    duration_ms: Date.now() - restartStartedAt,
    new_pentagon_pid: newProcesses[0]?.pid ?? null,
    quit_result: quitResult,
    killed_survivor_pids: survivors.map((proc) => proc.pid),
    kill_results: killResults,
  }));
}

async function checkPentagonWatchdog() {
  const stuck = await stuckNativeTriggers();
  if (!stuck.length) return;

  const now = Date.now();
  const detectionTime = new Date(now).toISOString();
  const elapsedSinceRestartSeconds = lastPentagonWatchdogRestartAt
    ? Math.floor((now - lastPentagonWatchdogRestartAt) / 1000)
    : null;
  const cooldownRemaining = elapsedSinceRestartSeconds === null
    ? 0
    : Math.max(0, PENTAGON_WATCHDOG_COOLDOWN_SECONDS - elapsedSinceRestartSeconds);

  if (cooldownRemaining > 0) {
    console.error(JSON.stringify({
      event: "pentagon_watchdog_suppressed",
      detection_time: detectionTime,
      reason: "cooldown_active",
      num_stuck_triggers: stuck.length,
      ages: stuck.map((trigger) => triggerAgeSeconds(trigger, now)),
      oldest_trigger_id: stuck[0]?.id ?? null,
      last_restart_at: new Date(lastPentagonWatchdogRestartAt).toISOString(),
      cooldown_remaining: cooldownRemaining,
    }));
    return;
  }

  await restartPentagonForWatchdog(stuck, detectionTime, cooldownRemaining);
}

let state = {
  ...readSession(),
  anonKey: readAnonKey(),
};
let agentIdCache = { ids: null, loadedAt: 0 };
let lastPentagonWatchdogRestartAt = null;

const triggerId = arg("--trigger-id");
const limit = Number(arg("--limit", "1"));
const dryRun = has("--dry-run");
const loop = has("--loop");
const intervalMs = Number(arg("--interval-ms", "5000"));

if (!existsSync(PENTAGON_BIN)) {
  throw new Error("Pentagon.app is not installed at the expected path.");
}

async function processCandidates(candidates) {
  const results = [];
  for (const candidate of candidates) {
    if (isTerminalMessage(candidate.content)) {
      if (dryRun) {
        results.push({ status: "would_complete_terminal", trigger: summarizeTrigger(candidate) });
        continue;
      }
      const claimedTerminal = candidate.claimed_at ? candidate : await claimTrigger(candidate.id);
      const completedTerminal = claimedTerminal ? await completeTrigger(claimedTerminal.id) : null;
      results.push({
        status: "completed_terminal",
        trigger: summarizeTrigger(candidate),
        completed_at: completedTerminal?.completed_at ?? null,
      });
      continue;
    }

    if (dryRun) {
      results.push({ status: "would_process", trigger: summarizeTrigger(candidate) });
      continue;
    }

    const claimed = candidate.claimed_at ? candidate : await claimTrigger(candidate.id);
    if (!claimed) {
      results.push({ status: "already_claimed_or_missing", trigger: summarizeTrigger(candidate) });
      continue;
    }

    const token = await mintAgentToken(claimed.agent_id);
    const startedAt = new Date().toISOString();
    const run = runCodex(claimed, token);
    const finishedAt = new Date().toISOString();

    if (run.status === 0) {
      const finalText = finalAgentMessage(run.stdout);
      const persistedMessage = await persistAgentMessage(claimed, finalText);
      const completed = await completeTrigger(claimed.id);
      results.push({
        status: "completed",
        trigger: summarizeTrigger(claimed),
        started_at: startedAt,
        finished_at: finishedAt,
        persisted_message: persistedMessage,
        completed_at: completed?.completed_at ?? null,
        stdout_tail: String(run.stdout ?? "").slice(-2000),
        stderr_tail: String(run.stderr ?? "").slice(-2000),
      });
    } else {
      results.push({
        status: "codex_failed",
        trigger: summarizeTrigger(claimed),
        started_at: startedAt,
        finished_at: finishedAt,
        exit_status: run.status,
        signal: run.signal,
        stdout_tail: String(run.stdout ?? "").slice(-2000),
        stderr_tail: String(run.stderr ?? "").slice(-2000),
      });
    }
  }
  return results;
}

async function runOnce() {
  const candidates = triggerId
    ? await request(`/rest/v1/agent_triggers?id=eq.${triggerId}&select=id,conversation_id,agent_id,sender_id,message_id,content,created_at,claimed_at,completed_at`)
    : await pendingTriggers(limit);

  if (!candidates.length) {
    return { status: "idle", processed: 0 };
  }

  const results = await processCandidates(candidates);
  return { status: "ok", processed: results.length, results };
}

function serializeError(error) {
  return {
    name: error?.name ?? "Error",
    message: String(error?.message ?? error),
    code: error?.code ?? error?.cause?.code ?? null,
    cause_message: error?.cause?.message ?? null,
    stack_tail: String(error?.stack ?? "").split(/\r?\n/).slice(-6).join("\n"),
  };
}

if (!loop) {
  console.log(JSON.stringify(await runOnce(), null, 2));
} else {
  console.log(JSON.stringify({
    status: "loop_started",
    interval_ms: intervalMs,
    limit,
    max_age_seconds: Number(arg("--max-age-seconds", "0")),
  }));
  while (true) {
    try {
      await checkPentagonWatchdog();
    } catch (error) {
      console.error(JSON.stringify({
        checked_at: new Date().toISOString(),
        event: "pentagon_watchdog_error",
        error: serializeError(error),
      }));
    }
    try {
      const result = await runOnce();
      if (result.processed) {
        console.log(JSON.stringify({ checked_at: new Date().toISOString(), ...result }, null, 2));
      }
    } catch (error) {
      console.error(JSON.stringify({
        checked_at: new Date().toISOString(),
        status: "loop_error",
        error: serializeError(error),
      }));
      if (/jwt expired/i.test(String(error?.message ?? ""))) {
        try {
          refreshSession();
          console.error(JSON.stringify({
            checked_at: new Date().toISOString(),
            status: "session_refreshed_after_loop_error",
          }));
        } catch (refreshError) {
          console.error(JSON.stringify({
            checked_at: new Date().toISOString(),
            status: "session_refresh_failed_after_loop_error",
            error: serializeError(refreshError),
          }));
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
