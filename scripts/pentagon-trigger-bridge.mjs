#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  emitBehaviorFailed,
  emitInfrastructureEvent,
  emitBehaviorCompleted,
  emitLlmRequested,
  emitLlmResponded,
} from "./factory-events.mjs";
import { installCrashGuard } from "./factory-crash-guard.mjs";

installCrashGuard("bridge");

const WORKSPACE = "/Users/gaganarora/Desktop/my projects/active_graph";
const PLIST = "/Users/gaganarora/Library/Preferences/run.pentagon.app.plist";
const PENTAGON_BIN = "/Applications/Pentagon.app/Contents/MacOS/Pentagon";
const MCP_URL = "https://auth.pentagon.run/functions/v1/mcp";
const PENTAGON_WATCHDOG_STUCK_AGE_SECONDS = 60;
const PENTAGON_WATCHDOG_COOLDOWN_SECONDS = 300;
const PENTAGON_WATCHDOG_AGENT_CACHE_MS = 60_000;
const PENTAGON_WATCHDOG_NATIVE_CONTENT_FILTER = "or=(content.ilike.NATIVE*,content.ilike.RUN_SEED*,content.ilike.PIPELINE_SMOKE_TEST*)";

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

function claudePrompt(trigger) {
  return codexPrompt(trigger);
}

function runClaude(trigger, token) {
  const claude = process.env.PENTAGON_CLAUDE || "/Users/gaganarora/.local/bin/claude";
  const mcpConfig = JSON.stringify({
    mcpServers: {
      pentagon: {
        type: "http",
        url: MCP_URL,
        headers: { Authorization: `Bearer ${token}` },
      },
    },
  });
  const args = [
    "-p",
    "--output-format", "stream-json",
    "--verbose",
    "--dangerously-skip-permissions",
    "--strict-mcp-config",
    "--mcp-config", mcpConfig,
    "--add-dir", WORKSPACE,
  ];
  const env = { ...process.env };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  delete env.CLAUDE_CODE_EXECPATH;
  delete env.AI_AGENT;
  return spawnSync(claude, args, {
    input: claudePrompt(trigger),
    encoding: "utf8",
    cwd: WORKSPACE,
    env,
    timeout: Number(arg("--claude-timeout-ms", arg("--codex-timeout-ms", "180000"))),
    maxBuffer: 10 * 1024 * 1024,
  });
}

function finalClaudeMessage(stdout) {
  let resultText = null;
  let isError = false;
  let apiErrorStatus = null;
  let assistantTail = null;
  let resultEvent = null;
  for (const line of String(stdout ?? "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event.type === "result") {
        resultText = event.result ?? null;
        isError = !!event.is_error;
        apiErrorStatus = event.api_error_status ?? null;
        resultEvent = event;
      } else if (event.type === "assistant" && event.message?.content) {
        for (const block of event.message.content) {
          if (block?.type === "text" && typeof block.text === "string") {
            assistantTail = block.text;
          }
        }
      }
    } catch {}
  }
  // Pull usage/cost/model details out of the result event when present.
  // Shape comes from claude's --output-format=stream-json.
  let usage = null;
  if (resultEvent) {
    const u = resultEvent.usage || {};
    const modelKeys = Object.keys(resultEvent.modelUsage || {});
    const primaryModel = modelKeys[0] || null;
    usage = {
      model: primaryModel,
      input_tokens: Number(u.input_tokens || 0),
      output_tokens: Number(u.output_tokens || 0),
      cache_creation_input_tokens: Number(u.cache_creation_input_tokens || 0),
      cache_read_input_tokens: Number(u.cache_read_input_tokens || 0),
      total_cost_usd: resultEvent.total_cost_usd ?? null,
      duration_ms: resultEvent.duration_ms ?? null,
      duration_api_ms: resultEvent.duration_api_ms ?? null,
      num_turns: resultEvent.num_turns ?? null,
      session_id: resultEvent.session_id ?? null,
      stop_reason: resultEvent.stop_reason ?? null,
      terminal_reason: resultEvent.terminal_reason ?? null,
    };
  }
  return {
    text: resultText ?? assistantTail,
    isError,
    apiErrorStatus,
    usage,
  };
}

function runByHarness(agent, trigger, token) {
  const harness = agent?.harness_id || "codex";
  if (harness === "claude-code") {
    return { harness, run: runClaude(trigger, token) };
  }
  return { harness, run: runCodex(trigger, token) };
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

function commandResult(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 1024 * 1024, ...options });
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

async function activeGraphAgents() {
  const now = Date.now();
  if (agentIdCache.rows && now - agentIdCache.loadedAt < PENTAGON_WATCHDOG_AGENT_CACHE_MS) {
    return agentIdCache.rows;
  }
  const rows = await request(
    "/rest/v1/agents?directory=eq." + encodeURIComponent(WORKSPACE) +
      "&deleted_at=is.null&select=id,name,provider,model,harness_id&limit=200"
  );
  agentIdCache = {
    rows,
    ids: rows.map((row) => row.id),
    byId: new Map(rows.map((row) => [row.id, row])),
    loadedAt: now,
  };
  return rows;
}

async function activeGraphAgentIds() {
  const rows = await activeGraphAgents();
  return rows.map((row) => row.id);
}

async function agentById(id) {
  if (!agentIdCache.byId || Date.now() - agentIdCache.loadedAt >= PENTAGON_WATCHDOG_AGENT_CACHE_MS) {
    await activeGraphAgents();
  }
  return agentIdCache.byId?.get(id) ?? null;
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
  return rows.filter((row) => {
    const content = String(row.content ?? "");
    return /^(NATIVE|PIPELINE_SMOKE_TEST)/.test(content) || /^RUN_SEED=[^\n]+\nNATIVE/.test(content);
  });
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
let agentIdCache = { rows: null, ids: null, byId: null, loadedAt: 0 };
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
    const agent = await agentById(claimed.agent_id);
    const harnessLabel = agent?.harness_id || "codex";
    const behaviorName = `bridge.${harnessLabel === "claude-code" ? "runClaude" : "runCodex"}`;
    // Emit llm.requested BEFORE the subprocess so even a hard crash is
    // bracketed by a pending request event in the log.
    try {
      emitLlmRequested({
        behavior: behaviorName,
        model: agent?.model ?? null,
        prompt_chars: String(claimed.content ?? "").length,
        extras: {
          agent_id: claimed.agent_id,
          agent_name: agent?.name ?? null,
          trigger_id: claimed.id,
          conversation_id: claimed.conversation_id,
          message_id: claimed.message_id,
          harness: harnessLabel,
        },
      });
    } catch (emitErr) {
      console.error(JSON.stringify({ event: "factory_event_emit_failed", phase: "llm_requested", error: String(emitErr?.message ?? emitErr) }));
    }
    const startedAt = new Date().toISOString();
    const startedMs = Date.now();
    const { harness, run } = runByHarness(agent, claimed, token);
    const finishedAt = new Date().toISOString();
    const latencySeconds = (Date.now() - startedMs) / 1000;

    let finalText = null;
    let claudeError = null;
    let claudeUsage = null;
    if (harness === "claude-code") {
      const parsed = finalClaudeMessage(run.stdout);
      finalText = parsed.text;
      claudeUsage = parsed.usage;
      if (parsed.isError) claudeError = parsed;
    } else {
      finalText = finalAgentMessage(run.stdout);
    }

    const subprocessOk = run.status === 0 && !claudeError;
    if (subprocessOk) {
      const persistedMessage = await persistAgentMessage(claimed, finalText);
      const completed = await completeTrigger(claimed.id);
      // Emit success events: llm.responded with real tokens/cost (claude
      // only, since codex doesn't surface them in the same stream), then
      // behavior.completed for the dispatch. The factory event log now
      // carries the full success chain alongside the failure chain.
      try {
        if (claudeUsage) {
          emitLlmResponded({
            behavior: behaviorName,
            model: claudeUsage.model ?? agent?.model ?? null,
            input_tokens: claudeUsage.input_tokens,
            output_tokens: claudeUsage.output_tokens,
            cost_usd: claudeUsage.total_cost_usd,
            latency_seconds: latencySeconds,
            finish_reason: claudeUsage.stop_reason ?? claudeUsage.terminal_reason ?? null,
            cache_read_input_tokens: claudeUsage.cache_read_input_tokens,
            cache_creation_input_tokens: claudeUsage.cache_creation_input_tokens,
            extras: {
              agent_id: claimed.agent_id,
              agent_name: agent?.name ?? null,
              trigger_id: claimed.id,
              conversation_id: claimed.conversation_id,
              session_id: claudeUsage.session_id,
              duration_ms: claudeUsage.duration_ms,
              duration_api_ms: claudeUsage.duration_api_ms,
              num_turns: claudeUsage.num_turns,
            },
          });
        }
        emitBehaviorCompleted({
          behavior: behaviorName,
          message: persistedMessage ? "agent response persisted" : "subprocess succeeded; no new message persisted",
          extras: {
            agent_id: claimed.agent_id,
            agent_name: agent?.name ?? null,
            trigger_id: claimed.id,
            conversation_id: claimed.conversation_id,
            message_id: claimed.message_id,
            persisted_message_id: persistedMessage?.id ?? null,
            harness: harnessLabel,
            latency_seconds: latencySeconds,
            started_at: startedAt,
            finished_at: finishedAt,
          },
        });
      } catch (emitErr) {
        console.error(JSON.stringify({ event: "factory_event_emit_failed", phase: "success", error: String(emitErr?.message ?? emitErr) }));
      }
      results.push({
        status: "completed",
        harness,
        trigger: summarizeTrigger(claimed),
        started_at: startedAt,
        finished_at: finishedAt,
        latency_seconds: latencySeconds,
        persisted_message: persistedMessage,
        completed_at: completed?.completed_at ?? null,
        claude_usage: claudeUsage,
        stdout_tail: String(run.stdout ?? "").slice(-2000),
        stderr_tail: String(run.stderr ?? "").slice(-2000),
      });
    } else {
      // Release the trigger claim so it isn't orphaned (claimed_at=set,
      // completed_at=null forever). The completion records failure
      // alongside the bridge's emit so any future query joining
      // agent_triggers with factory-events.jsonl sees the same story.
      // Defensive: complete_agent_trigger may have invariants — if it
      // rejects (e.g. 4xx), emit an infra event but keep moving.
      let failureCompletion = null;
      try {
        failureCompletion = await completeTrigger(claimed.id);
      } catch (completeErr) {
        try {
          emitInfrastructureEvent({
            subtype: "trigger_release_failed",
            message: `complete_agent_trigger RPC failed on bridge dispatch failure path: ${String(completeErr?.message ?? completeErr)}`,
            extras: {
              trigger_id: claimed.id,
              harness,
              underlying_error: String(completeErr?.message ?? completeErr),
            },
          });
        } catch {}
      }
      // Emit a structured factory event for the failure so it lives in the
      // activegraph-shaped event log alongside successful runs, not just
      // in the bridge's stdout JSON. Reason codes match what
      // ClaudeCodeCliProvider raises so both dispatch paths look uniform.
      const failureReason = harness === "claude-code"
        ? (claudeError?.apiErrorStatus === 429 ? "llm.rate_limited" : "llm.network_error")
        : "llm.provider_error";
      try {
        emitBehaviorFailed({
          behavior: `bridge.${harness === "claude-code" ? "runClaude" : "runCodex"}`,
          reason: failureReason,
          message: String(claudeError?.text || `${harness} subprocess exited ${run.status}`),
          extras: {
            agent_id: claimed.agent_id,
            agent_name: agent?.name ?? null,
            trigger_id: claimed.id,
            conversation_id: claimed.conversation_id,
            message_id: claimed.message_id,
            harness,
            exit_status: run.status,
            signal: run.signal,
            api_error_status: claudeError?.apiErrorStatus ?? null,
            started_at: startedAt,
            finished_at: finishedAt,
            stderr_tail: String(run.stderr ?? "").slice(-500),
          },
        });
      } catch (emitErr) {
        // Don't let event-logging errors crash the bridge.
        console.error(JSON.stringify({
          event: "factory_event_emit_failed",
          error: String(emitErr?.message ?? emitErr),
        }));
      }
      results.push({
        status: harness === "claude-code" ? "claude_failed" : "codex_failed",
        harness,
        trigger: summarizeTrigger(claimed),
        started_at: startedAt,
        finished_at: finishedAt,
        exit_status: run.status,
        signal: run.signal,
        claude_error: claudeError,
        factory_event_reason: failureReason,
        completed_at: failureCompletion?.completed_at ?? null,
        completed_with_failure: Boolean(failureCompletion),
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
      try {
        emitInfrastructureEvent({
          subtype: "pentagon_watchdog_error",
          message: String(error?.message || error),
          extras: { error: serializeError(error) },
        });
      } catch {}
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
      // Mirror to factory event log so any Supabase API failure (4xx, 5xx,
      // network) becomes queryable. JWT-expired is recovered immediately
      // by the refreshSession() block below; both are recorded.
      const isJwtExpired = /jwt expired/i.test(String(error?.message ?? ""));
      try {
        emitInfrastructureEvent({
          subtype: isJwtExpired ? "supabase_jwt_expired" : "supabase_api_error",
          message: String(error?.message || error),
          extras: {
            error: serializeError(error),
            recoverable: isJwtExpired,
          },
        });
      } catch {}
      if (isJwtExpired) {
        try {
          refreshSession();
          console.error(JSON.stringify({
            checked_at: new Date().toISOString(),
            status: "session_refreshed_after_loop_error",
          }));
          try {
            emitInfrastructureEvent({
              subtype: "supabase_session_refreshed",
              message: "JWT expired and refreshed automatically",
            });
          } catch {}
        } catch (refreshError) {
          console.error(JSON.stringify({
            checked_at: new Date().toISOString(),
            status: "session_refresh_failed_after_loop_error",
            error: serializeError(refreshError),
          }));
          try {
            emitInfrastructureEvent({
              subtype: "supabase_session_refresh_failed",
              message: String(refreshError?.message || refreshError),
              extras: { error: serializeError(refreshError) },
            });
          } catch {}
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
