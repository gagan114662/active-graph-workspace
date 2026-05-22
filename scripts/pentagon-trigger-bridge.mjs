#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const WORKSPACE = "/Users/gaganarora/Desktop/my projects/active_graph";
const PLIST = "/Users/gaganarora/Library/Preferences/run.pentagon.app.plist";
const PENTAGON_BIN = "/Applications/Pentagon.app/Contents/MacOS/Pentagon";
const MCP_URL = "https://auth.pentagon.run/functions/v1/mcp";

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

async function request(path, { method = "GET", body, prefer } = {}) {
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
  if (!res.ok) {
    throw new Error(`${method} ${path} failed ${res.status}: ${JSON.stringify(parsed)}`);
  }
  return parsed;
}

async function mintAgentToken(agentId) {
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
  return /_(ACK|BLOCKED)$/.test(firstToken);
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

const state = {
  ...readSession(),
  anonKey: readAnonKey(),
};

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
    const result = await runOnce();
    if (result.processed) {
      console.log(JSON.stringify({ checked_at: new Date().toISOString(), ...result }, null, 2));
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
