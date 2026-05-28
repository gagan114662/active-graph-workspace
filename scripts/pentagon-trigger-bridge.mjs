#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  emitBehaviorFailed,
  emitInfrastructureEvent,
  emitBehaviorCompleted,
  emitLlmRequested,
  emitLlmResponded,
  emitTodoCompleted,
  emitFactoryEvent,
} from "./factory-events.mjs";
import { judgePinnedModel } from "./judge-rubric.mjs";
import { generateResearchPacket } from "./research-packet.mjs";
import { resolveContext } from "./resolve-context.mjs";

// Detect the closed-loop flywheel envelope in trigger content. Phoenix
// dispatches todos as messages that start with "FLYWHEEL_TODO <todo_id>";
// when the bridge sees one and the agent responds, we emit todo.completed
// so Phoenix's keeper closes the loop automatically.
function extractFlywheelTodoId(triggerContent) {
  const m = String(triggerContent ?? "").match(/^FLYWHEEL_TODO\s+(\S+)/);
  return m ? m[1] : null;
}

function flywheelReceiptPresent(agentReply, todoId) {
  if (!todoId) return false;
  return String(agentReply ?? "").includes(`FLYWHEEL_TODO_${todoId}_RECEIVED`);
}

// Reviewer ACK parsers. When a reviewer (Rowan/Theo/Grace) is dispatched
// for a flywheel review, their reply lands as a regular agent message and
// flows through this bridge. We detect their ack format here + emit a
// flywheel.review.completed event that Phoenix subscribes to.
// Strip markdown decoration (backticks, bold/italic asterisks) before matching a
// judge ack. Real proof, 2026-05-28: Rowan returned the CORRECT verdict but
// wrapped it as **`ROWAN_REVIEW_PASS pending findings=6`** in its result text,
// and the strict parser rejected a valid PASS as malformed. Rejecting a correct
// verdict is itself a false signal — so the parser must tolerate the way a
// well-behaved LLM naturally formats. The LOAD-BEARING fields (verdict + count)
// stay REQUIRED; only the descriptive trailing field (top_finding / reasoning /
// dirty_files) is optional, because agents sometimes put it on a separate line.
function stripAckMarkdown(s) {
  return String(s ?? "").replace(/[`*]/g, " ");
}
function parseRowanReviewAck(agentReply, todoId) {
  if (!todoId) return null;
  const text = stripAckMarkdown(agentReply);
  const m = text.match(/ROWAN_REVIEW_(PASS|FAIL)\s+(\S+)\s+findings=(\d+)(?:\s+top_finding=([^\n]+))?/);
  if (!m) return null;
  return {
    judge: "rowan",
    verdict: m[1],
    sha: m[2],
    findings: Number(m[3]),
    top_finding: (m[4] || "").trim() || "(not provided)",
  };
}
function parseTheoTestReviewAck(agentReply, todoId) {
  if (!todoId) return null;
  const text = stripAckMarkdown(agentReply);
  const m = text.match(/THEO_TEST_REVIEW_(PASS|FAIL)\s+(\S+)\s+tests=(\d+)(?:\s+reasoning=([^\n]+))?/);
  if (!m) return null;
  return {
    judge: "theo",
    verdict: m[1],
    hash: m[2],
    tests: Number(m[3]),
    reasoning: (m[4] || "").trim() || "(not provided)",
  };
}
function parseGraceGateAck(agentReply, todoId) {
  if (!todoId) return null;
  const text = stripAckMarkdown(agentReply);
  const m = text.match(/GRACE_GATE_(OPEN|BLOCKED)\s+(\S+)(?:\s+dirty_files=([^\n]+))?/);
  if (!m) return null;
  return {
    judge: "grace",
    verdict: m[1],
    tier: m[2],
    dirty_files: (m[3] || "").trim() || "(not provided)",
  };
}

function extractFlywheelReviewId(triggerContent) {
  const m = String(triggerContent ?? "").match(/^FLYWHEEL_REVIEW\s+(\S+)/);
  return m ? m[1] : null;
}

// Action-layer parser (task #15 / pt.7). When the agent's reply contains
// FLYWHEEL_TODO_<id>_PROPOSE_DIFF followed by a ```diff fenced block, parse
// out the unified diff so Phoenix can apply it to a worktree and gate on
// tests. Returns { kind: "diff", diff: string, rationale: string } or
// { kind: "blocked", reason: string } or null.
function parseFlywheelAction(agentReply, todoId) {
  if (!todoId) return null;
  const text = String(agentReply ?? "");
  const blockedRe = new RegExp(`FLYWHEEL_TODO_${todoId}_BLOCKED\\s+([^\\n]+)`);
  const blocked = text.match(blockedRe);
  if (blocked) return { kind: "blocked", reason: blocked[1].trim() };

  const proposeRe = new RegExp(`FLYWHEEL_TODO_${todoId}_PROPOSE_DIFF`);
  if (!proposeRe.test(text)) return null;

  // Pull the first ```diff ... ``` block AFTER the PROPOSE marker.
  const proposeIdx = text.search(proposeRe);
  const afterPropose = text.slice(proposeIdx);
  const fenceMatch = afterPropose.match(/```(?:diff|patch)?\s*\n([\s\S]*?)\n```/);
  if (!fenceMatch) {
    return { kind: "proposed_no_diff", reason: "PROPOSE_DIFF marker present but no fenced diff block found" };
  }
  const diff = fenceMatch[1];
  // Rationale = anything after the closing fence (trimmed).
  const afterFence = afterPropose.slice(fenceMatch.index + fenceMatch[0].length).trim();
  return { kind: "diff", diff, rationale: afterFence.slice(0, 1000) };
}
import { installCrashGuard } from "./factory-crash-guard.mjs";
import { readSession, readAnonKey, isExpiredJwtResponse } from "./pentagon-auth.mjs";

installCrashGuard("bridge");

const WORKSPACE = "/Users/gaganarora/Desktop/my projects/active_graph";
// PENTAGON_BIN is still referenced by the Pentagon watchdog (pgrep checks
// + existsSync gate). The JWT-/anon-key plumbing migrated to pentagon-auth.mjs
// in Task #23; this constant remains here for the watchdog path only.
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

// Pure-function helpers (decodeJwtPayload, readSession, readAnonKey,
// isExpiredJwtResponse) moved to pentagon-auth.mjs so this file + pentagon-rest.mjs
// share one source of truth. Task #23 (refactor pass).

function refreshSession() {
  const currentAnonKey = state?.anonKey ?? readAnonKey();
  state = { ...readSession(), anonKey: currentAnonKey };
  return state;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

// Count active participants in a conversation. Used by the cascade guard:
// a >2-participant conversation fans one dispatch out to N triggers. Mirrors
// the participant query in pentagon-rest.mjs::findOrCreateConversation. On any
// query error returns 0 (fail-open to NOT block dispatch on a transient read
// failure — the guard only suppresses on a confident >2 count).
async function conversationParticipantCount(conversationId) {
  try {
    const rows = await request(
      `/rest/v1/conversation_participants?conversation_id=eq.${conversationId}` +
        `&left_at=is.null&deleted_at=is.null&select=user_id&limit=500`
    );
    return Array.isArray(rows) ? rows.length : 0;
  } catch {
    return 0;
  }
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

// Brandon-A 6× lever: pre-supply context (recent commits in the target area,
// recent similar failures, relevant CLAUDE.md section) so the agent doesn't
// crawl the whole repo before acting — the cache_creation_input_tokens cost
// driver that made one T6-easy task cost $4. Extracts a target symbol/file from
// the trigger content. Best-effort: any failure yields no packet (never blocks
// dispatch). This was previously wired only into Phoenix's flywheel dispatch
// (pentagon-rest.mjs::dispatchTodo), NOT the high-volume gauntlet path.
function researchPacketFor(trigger) {
  try {
    const content = String(trigger.content || "");
    // Dotted symbol like activegraph.core.graph.Graph.all_objects (preferred).
    const symbolMatch = /\b((?:activegraph|scripts)[\w]*(?:\.[A-Za-z_]\w*){2,})/.exec(content);
    const fileMatch = /(\b[\w][\w/.\-]*\.(?:py|mjs|js|ts|sql))\b/.exec(content);
    if (!symbolMatch && !fileMatch) return "";
    const packet = generateResearchPacket({
      targetSymbol: symbolMatch ? symbolMatch[1] : undefined,
      targetFile: fileMatch ? fileMatch[1] : undefined,
      compact: true,
      limit: 3,
    });
    // RESOLVER (where info lives): route the target file to its context docs so
    // the agent loads exactly those instead of guessing the repo structure.
    let routed = "";
    try {
      if (fileMatch) {
        const r = resolveContext(fileMatch[1]);
        if (r.matched && r.docs.length) {
          routed = "\n\nROUTED CONTEXT (per RESOLVER.md — read these for this file):\n" +
            r.docs.map((d) => `- ${d}`).join("\n") + "\n";
        }
      }
    } catch {}
    if ((!packet || packet.startsWith("(no research-packet")) && !routed) return "";
    const pkt = (packet && !packet.startsWith("(no research-packet"))
      ? "\n\nPRE-FLIGHT RESEARCH PACKET (use this instead of crawling the repo):\n" + packet + "\n"
      : "";
    return pkt + routed;
  } catch {
    return "";
  }
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
    researchPacketFor(trigger),
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

// Direct claude-CLI invocation (legacy path). Used as fallback if the
// Python dispatcher is unavailable. #28 routes Maya/Quinn dispatch through
// scripts/bridge_dispatch.py so activegraph + bridge share one provider
// implementation; this function stays for graceful degradation when the
// dispatcher script is missing.
function runClaudeLegacyDirect(trigger, token, agent = null) {
  const claude = process.env.PENTAGON_CLAUDE || "/Users/gaganarora/.local/bin/claude";
  // #29: prefer the agent's per-Puter-user sandbox CWD when the map has
  // an entry; fall back to the workspace root otherwise so dispatch
  // works even before Puter is provisioned.
  const cwd = puterHomeFor(agent) || WORKSPACE;
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
    cwd,
    env,
    timeout: Number(arg("--claude-timeout-ms", arg("--codex-timeout-ms", "180000"))),
    maxBuffer: 10 * 1024 * 1024,
  });
}

// #28: route through scripts/bridge_dispatch.py so activegraph and the
// bridge share ONE Claude-CLI dispatch implementation (the v1
// ClaudeCodeCliProvider from activegraph.llm). Falls back to the legacy
// direct spawn if the Python dispatcher script is missing or refuses to
// import activegraph. The dispatcher emits its own llm.* + behavior.*
// factory events so we keep the unified event log.
function runClaudeViaPythonDispatcher(trigger, token, agent) {
  const dispatcher = process.env.PENTAGON_DISPATCHER || (WORKSPACE + "/scripts/bridge_dispatch.py");
  if (!existsSync(dispatcher)) {
    // Legacy path is the only option.
    return null;
  }
  const python = process.env.PENTAGON_PYTHON || "python3";
  const payload = {
    trigger_id: trigger.id,
    agent_id: trigger.agent_id,
    agent_name: agent?.name ?? null,
    conversation_id: trigger.conversation_id,
    message_id: trigger.message_id,
    token,
    mcp_url: MCP_URL,
    prompt: claudePrompt(trigger),
    model: agent?.model || "claude-opus-4-8",
    timeout_seconds: Number(arg("--claude-timeout-ms", arg("--codex-timeout-ms", "180000"))) / 1000,
    harness: agent?.harness_id || "claude-code",
    puter_home: puterHomeFor(agent),  // #29: per-agent sandbox path
  };
  const env = { ...process.env };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  delete env.CLAUDE_CODE_EXECPATH;
  delete env.AI_AGENT;
  // Suppress the Python provider's + dispatcher's llm.responded emit.
  // The outermost Node bridge layer re-emits with full Pentagon context
  // (trigger_id, agent_id, conversation_id). Without this guard the same
  // dispatch surfaces three llm.responded rows at three behavior labels —
  // Blake's caps fire at 3× sensitivity and cost dashboards over-report 3×.
  env.FACTORY_SUPPRESS_LLM_RESPONDED_EMIT = "1";
  const result = spawnSync(python, [dispatcher], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    cwd: WORKSPACE,
    env,
    timeout: Number(arg("--claude-timeout-ms", arg("--codex-timeout-ms", "180000"))) + 30000,
    maxBuffer: 10 * 1024 * 1024,
  });
  return result;
}

// Translate the Python dispatcher's stdout JSON back into the shape
// the bridge's downstream code expects (claude_failed/completed path).
function translateDispatcherResult(spawnResult) {
  if (!spawnResult) return null;
  let parsed = null;
  try { parsed = JSON.parse(String(spawnResult.stdout || "").trim()); } catch {}
  if (!parsed) return null;
  const usage = parsed.ok ? {
    model: parsed.model,
    input_tokens: parsed.input_tokens,
    output_tokens: parsed.output_tokens,
    total_cost_usd: parsed.cost_usd ? Number(parsed.cost_usd) : null,
    duration_ms: parsed.duration_ms,
    duration_api_ms: parsed.duration_api_ms,
    cache_read_input_tokens: parsed.cache_read_input_tokens || 0,
    cache_creation_input_tokens: parsed.cache_creation_input_tokens || 0,
    session_id: parsed.session_id,
    stop_reason: parsed.finish_reason,
    terminal_reason: "completed",
  } : null;
  const errorRow = parsed.ok ? null : {
    text: parsed.error_message || "(no error message)",
    isError: true,
    apiErrorStatus: parsed.api_error_status ?? null,
    reason: parsed.error_reason,
  };
  return {
    status: parsed.ok ? 0 : 1,
    signal: null,
    stdout: spawnResult.stdout,
    stderr: spawnResult.stderr,
    parsed,
    finalText: parsed.ok ? parsed.text : null,
    usage,
    error: errorRow,
  };
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

// #29 wiring: each agent has a Puter user with a dedicated home dir.
// When the bridge dispatches to that agent, we set CWD to that dir so
// the claude subprocess (and any tool calls underneath) read/write
// inside the agent's sandbox, not the operator's global workspace.
// Map lives at agent-os/puter-agent-map.json; missing entries fall
// back to the workspace root so dispatch never blocks on the map being
// incomplete.
let _puterMap = null;
function puterHomeFor(agent) {
  if (_puterMap === null) {
    try {
      const raw = readFileSync(WORKSPACE + "/agent-os/puter-agent-map.json", "utf8");
      const parsed = JSON.parse(raw);
      _puterMap = new Map((parsed.agents || []).map((row) => [row.agent_name, row.home_dir]));
    } catch {
      _puterMap = new Map();
    }
  }
  return _puterMap.get(agent?.name) || null;
}

// #28: prefer Python dispatcher (scripts/bridge_dispatch.py) which uses
// activegraph's ClaudeCodeCliProvider under the hood. Falls back to the
// legacy direct claude-CLI spawn if the dispatcher is unavailable or
// produces no parsable result. The dispatcher route emits richer
// activegraph-shaped events; the legacy route still emits via the
// bridge's own event hooks.
function runClaude(trigger, token, agent) {
  const useLegacy = process.env.PENTAGON_BRIDGE_LEGACY_CLAUDE === "1";
  if (!useLegacy) {
    const dispatcherSpawn = runClaudeViaPythonDispatcher(trigger, token, agent);
    const translated = translateDispatcherResult(dispatcherSpawn);
    if (translated) {
      return {
        status: translated.status,
        signal: translated.signal,
        stdout: translated.stdout,
        stderr: translated.stderr,
        _viaDispatcher: true,
        _translated: translated,
      };
    }
  }
  return runClaudeLegacyDirect(trigger, token, agent);
}

function runByHarness(agent, trigger, token) {
  const harness = agent?.harness_id || "codex";
  if (harness === "claude-code") {
    return { harness, run: runClaude(trigger, token, agent) };
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

// Sender-only agents: identities the daemons use ONLY to originate dispatches,
// never to respond. Priya (Goal Reaper) is the SENDER_AGENT_KEY in
// pentagon-rest.mjs (chosen because the Pentagon MCP context can seed
// {Priya, reviewer} 2-party convs that the RLS-blocked daemon INSERT can't —
// see frames/codex-goals/rls-unblock-kit-20260528.md). Pentagon auto-creates a
// trigger for the NON-sender on every message, so when a reviewer replies into
// {Priya, reviewer} Pentagon makes a trigger for Priya. Dispatching her would
// run claude on an agent with no responder role and risk a 2-party ping-pong.
// We complete such triggers WITHOUT dispatch. Env override:
//   FACTORY_SENDER_ONLY_AGENT_IDS=<uuid,uuid>
const SENDER_ONLY_AGENT_IDS = new Set(
  (process.env.FACTORY_SENDER_ONLY_AGENT_IDS ||
    "642755a2-a869-440b-b4f7-e5a718e0fb8b") // Priya (Goal Reaper)
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
);

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

    // C1: wrap the entire per-candidate body so an unhandled rejection in any
    // awaited call (claimTrigger / mintAgentToken / agentById /
    // persistAgentMessage / completeTrigger) cannot crash the candidate loop
    // and leave the trigger orphaned (claimed_at set, completed_at null) with
    // NO factory event. The catch (loop end) emits + releases the claim.
    let claimed = null;
    try {
    // Sender-only guard (anti-ping-pong): complete Priya's echo triggers without
    // dispatch. Runs BEFORE the cascade guard because a {Priya, reviewer} conv is
    // a legitimate 2-party conv that the cascade guard would (correctly) let
    // through — the issue isn't fan-out here, it's that Priya must never respond.
    if (candidate.agent_id && SENDER_ONLY_AGENT_IDS.has(String(candidate.agent_id).toLowerCase())) {
      const claimedSender = candidate.claimed_at ? candidate : await claimTrigger(candidate.id);
      if (claimedSender) await completeTrigger(claimedSender.id);
      try {
        emitInfrastructureEvent({
          subtype: "sender_only_trigger_completed",
          message: `completed trigger for sender-only agent ${candidate.agent_id} without dispatch (anti-ping-pong)`,
          extras: {
            trigger_id: candidate.id,
            conversation_id: candidate.conversation_id ?? null,
            agent_id: candidate.agent_id,
          },
        });
      } catch {}
      results.push({ status: "sender_only_completed", trigger: summarizeTrigger(candidate) });
      continue;
    }

    // Cascade guard: Pentagon creates one agent_trigger per non-sender
    // participant when a message lands, and the bridge re-posts each agent's
    // reply back into the conversation. In a >2-participant conversation that
    // fans a single dispatch out to N triggers and self-perpetuates (the
    // documented Maya↔Theo cascade that burned real $). Phoenix's dispatch
    // path enforces exactly-2 participants, but the bridge claim path did not —
    // so a reply into a polluted conv still cascaded. Skip + record it here,
    // BEFORE claiming, so we never feed the fan-out.
    if (candidate.conversation_id) {
      const pcount = await conversationParticipantCount(candidate.conversation_id);
      if (pcount > 2) {
        try {
          emitInfrastructureEvent({
            subtype: "cascade_suppressed",
            message: `skipped trigger in ${pcount}-participant conversation to prevent fan-out cascade`,
            extras: {
              trigger_id: candidate.id,
              conversation_id: candidate.conversation_id,
              participant_count: pcount,
              agent_id: candidate.agent_id ?? null,
            },
          });
        } catch {}
        results.push({ status: "cascade_suppressed", trigger: summarizeTrigger(candidate), participant_count: pcount });
        continue;
      }
    }

    claimed = candidate.claimed_at ? candidate : await claimTrigger(candidate.id);
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
      // #28: when the dispatcher route succeeded, the run object carries a
      // pre-translated payload; skip stream-json reparsing.
      if (run?._viaDispatcher && run._translated) {
        finalText = run._translated.finalText;
        claudeUsage = run._translated.usage;
        if (run._translated.error) {
          claudeError = {
            text: run._translated.error.text,
            isError: true,
            apiErrorStatus: run._translated.error.apiErrorStatus,
            reason: run._translated.error.reason,
          };
        }
      } else {
        const parsed = finalClaudeMessage(run.stdout);
        finalText = parsed.text;
        claudeUsage = parsed.usage;
        if (parsed.isError) claudeError = parsed;
      }
    } else {
      finalText = finalAgentMessage(run.stdout);
    }

    // H11: a claude dispatch that exits 0 but yields no parseable final message
    // is a SILENT DROP — persistAgentMessage(null) no-ops and the run is
    // recorded as completed with no output and no error. Treat it as a failure.
    if (harness === "claude-code" && run.status === 0 && !claudeError &&
        (finalText === null || finalText === undefined)) {
      claudeError = {
        text: "subprocess exited 0 but produced no parseable final message",
        isError: true,
        apiErrorStatus: null,
        reason: "llm.stream_parse_error",
      };
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
        // Detect either FLYWHEEL_TODO (proposal) or FLYWHEEL_REVIEW (review)
        // envelopes in the trigger content. They route differently downstream.
        const flywheelTodoId = extractFlywheelTodoId(claimed.content);
        const flywheelReviewId = extractFlywheelReviewId(claimed.content);

        if (flywheelReviewId) {
          // Reviewer dispatch — try each judge's ack parser.
          const ack = parseRowanReviewAck(finalText, flywheelReviewId) ||
                      parseTheoTestReviewAck(finalText, flywheelReviewId) ||
                      parseGraceGateAck(finalText, flywheelReviewId);
          if (ack) {
            // C5/H3: pin the judge's model + pin-date onto the verdict so
            // replay can tell "rowan@opus-4-7 was wrong" from
            // "rowan@opus-4-8 was wrong", and judge-replay has the fields it
            // reads. Falls back to the dispatched agent's model if no rubric.
            const pinned = judgePinnedModel(ack.judge);
            emitFactoryEvent({
              type: "flywheel.review.completed",
              behavior: "factory-flywheel",
              extras: {
                todo_event_id: flywheelReviewId,
                judge: ack.judge,
                verdict: ack.verdict,
                ack: ack,
                judge_model: pinned.judge_model ?? agent?.model ?? null,
                judge_model_pinned_at: pinned.judge_model_pinned_at ?? null,
                reviewer_agent_id: claimed.agent_id,
                reviewer_agent_name: agent?.name ?? null,
                trigger_id: claimed.id,
                conversation_id: claimed.conversation_id,
                reply_chars: String(finalText ?? "").length,
              },
            });
          } else {
            // Reviewer didn't follow the ack contract. Surface as a soft
            // event so the eval-the-eval layer can flag judge protocol drift.
            emitFactoryEvent({
              type: "flywheel.review.malformed",
              behavior: "factory-flywheel",
              reason: "judge.protocol_drift",
              extras: {
                todo_event_id: flywheelReviewId,
                reviewer_agent_id: claimed.agent_id,
                reviewer_agent_name: agent?.name ?? null,
                trigger_id: claimed.id,
                reply_first_200: String(finalText ?? "").slice(0, 200),
              },
            });
          }
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
            todo_id: flywheelTodoId,  // null for non-flywheel dispatches
          },
        });
        // Closed-loop flywheel: if this dispatch was Phoenix-originated,
        // emit either flywheel.diff.proposed (action-layer task #15) or
        // todo.completed for the chat-only path. Phoenix's keeper closes
        // the loop in either case.
        if (flywheelTodoId) {
          const action = parseFlywheelAction(finalText, flywheelTodoId);
          if (action?.kind === "diff") {
            // Emit the diff for Phoenix to apply + test. Do NOT close
            // the todo yet — Phoenix closes it after test gate runs.
            emitFactoryEvent({
              type: "flywheel.diff.proposed",
              behavior: "factory-flywheel",
              extras: {
                todo_event_id: flywheelTodoId,
                agent_id: claimed.agent_id,
                agent_name: agent?.name ?? null,
                trigger_id: claimed.id,
                conversation_id: claimed.conversation_id,
                diff_chars: action.diff.length,
                diff_b64: Buffer.from(action.diff, "utf8").toString("base64"),
                rationale: action.rationale,
                receipt_string_present: flywheelReceiptPresent(finalText, flywheelTodoId),
              },
            });
          } else {
            // Chat-only, blocked, or no-diff path — close the todo now.
            const blockedReason =
              action?.kind === "blocked" ? action.reason :
              action?.kind === "proposed_no_diff" ? action.reason :
              null;
            emitTodoCompleted({
              todo_event_id: flywheelTodoId,
              dedup_key: flywheelTodoId,  // Phoenix reverse-lookups by todo_id
              completion_evidence: blockedReason
                ? `blocked: ${blockedReason}`
                : persistedMessage?.id
                  ? `agent_reply_message_id=${persistedMessage.id}`
                  : "subprocess succeeded; no message persisted",
              extras: {
                agent_id: claimed.agent_id,
                agent_name: agent?.name ?? null,
                trigger_id: claimed.id,
                conversation_id: claimed.conversation_id,
                receipt_string_present: flywheelReceiptPresent(finalText, flywheelTodoId),
                reply_chars: String(finalText ?? "").length,
                outcome: action?.kind || "chat_only",
              },
            });
          }
        }
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
      // Honor an explicit reason from the dispatcher/parse layer first (H11
      // stream_parse_error, dispatcher-translated reasons), then distinguish a
      // SIGTERM timeout kill from a real network error (H10), else fall back.
      const failureReason = claudeError?.reason
        ? claudeError.reason
        : harness === "claude-code"
          ? (claudeError?.apiErrorStatus === 429 ? "llm.rate_limited"
             : run.signal === "SIGTERM" ? "llm.timeout"
             : "llm.network_error")
          : (run.signal === "SIGTERM" ? "llm.timeout" : "llm.provider_error");
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
    } catch (candidateErr) {
      // C1: an unhandled rejection anywhere in the per-candidate body above
      // would otherwise crash processCandidates and leave the trigger orphaned
      // with no event. Emit a structured failure and release the claim so it
      // can be retried.
      try {
        emitInfrastructureEvent({
          subtype: "candidate_processing_error",
          message: `unhandled error processing trigger ${candidate.id}: ${String(candidateErr?.message ?? candidateErr)}`,
          extras: {
            trigger_id: candidate.id,
            agent_id: candidate.agent_id ?? null,
            conversation_id: candidate.conversation_id ?? null,
            was_claimed: Boolean(claimed),
            error: String(candidateErr?.message ?? candidateErr),
            stack_tail: String(candidateErr?.stack ?? "").split(/\r?\n/).slice(-4).join("\n"),
          },
        });
      } catch {}
      if (claimed) {
        try { await completeTrigger(claimed.id); }
        catch (relErr) {
          try {
            emitInfrastructureEvent({
              subtype: "trigger_release_failed",
              message: `completeTrigger failed in candidate catch: ${String(relErr?.message ?? relErr)}`,
              extras: { trigger_id: claimed.id, underlying_error: String(relErr?.message ?? relErr) },
            });
          } catch {}
        }
      }
      results.push({
        status: "candidate_error",
        trigger: summarizeTrigger(candidate),
        was_claimed: Boolean(claimed),
        error: String(candidateErr?.message ?? candidateErr),
      });
      continue;
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
