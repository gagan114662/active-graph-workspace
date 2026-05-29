// Pentagon REST helpers — extracted so Phoenix and other consumers can dispatch
// triggers without each copy-pasting the auth + JWT-refresh + insert plumbing.
//
// Used by:
//   * scripts/phoenix-todo-keeper.mjs (the closed-loop flywheel — dispatches
//     todos as Pentagon messages so Pentagon auto-creates the agent_triggers row)
//
// Not yet used by (refactor pass): pentagon-trigger-bridge.mjs +
// run-native-pentagon-task.mjs both have their own copies of these helpers
// inline; consolidating them is left as a follow-up to avoid scope creep here.
//
// Auth model: Pentagon's macOS app stores its Supabase session in
//   ~/Library/Preferences/run.pentagon.app.plist
// under :supabase.auth.sb-auth-auth-token. The embedded anon key lives in
// the Pentagon binary itself (extracted via `strings | rg '^eyJ' | head -1`).
// JWTs expire periodically; request() retries once on PGRST303 / "jwt expired".

import { generateResearchPacket } from "./research-packet.mjs";
import {
  readSession,
  readAnonKey,
  isExpiredJwtResponse,
  refreshAccessToken,
  isAccessTokenExpired,
} from "./pentagon-auth.mjs";

let _state = null;
function ensureState() {
  if (_state) return _state;
  _state = { ...readSession(), anonKey: readAnonKey() };
  return _state;
}

// Refresh the Supabase access token. Previously this only re-read the plist —
// which silently fails when the plist's accessToken was rotated/invalidated
// server-side despite a future `exp` (the 401 that bit Phoenix/pentagon-rest on
// 2026-05-28). Now: (1) re-read the plist first — free, and if Pentagon.app
// refreshed it we avoid refresh-token rotation churn; (2) if the re-read token
// is unchanged or expired, do a real grant_type=refresh_token. In-memory only;
// Pentagon.app owns the plist file.
async function refreshSession() {
  const anonKey = _state?.anonKey ?? readAnonKey();
  const prevToken = _state?.accessToken;
  const reread = readSession();
  if (reread.accessToken && reread.accessToken !== prevToken && !isAccessTokenExpired(reread.accessToken)) {
    _state = { ...reread, anonKey };
    return _state;
  }
  // Plist didn't help — authoritative grant.
  const refreshed = await refreshAccessToken({
    refreshToken: reread.refreshToken,
    supabaseOrigin: reread.supabaseOrigin,
    anonKey,
  });
  _state = { ...reread, accessToken: refreshed.access_token, anonKey };
  return _state;
}

export async function request(
  path,
  { method = "GET", body, prefer, retryOnExpiredJwt = true } = {}
) {
  const state = ensureState();
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
    await refreshSession();
    return request(path, { method, body, prefer, retryOnExpiredJwt: false });
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} failed ${res.status}: ${JSON.stringify(parsed).slice(0, 500)}`);
  }
  return parsed;
}

/** Operator's user_id (sub claim from the Pentagon session JWT). */
export function operatorId() {
  return ensureState().operatorId;
}

/**
 * Live snapshot of active_graph Pentagon agents (name → UUID). Captured
 * 2026-05-27 after the opus-4.7/claude-code cohort migration. If new agents
 * are spawned or renamed, this table will go stale — refresh via:
 *   curl ".../rest/v1/agents?select=id,name&order=name.asc"
 */
export const AGENT_MAP = {
  avery: "8965cbc1-eed8-4c87-a04f-9f0b8b5febcb",   // Frame Architect
  blake: "3170d32c-8ff8-46e7-811f-2fb2622ab3c5",   // Budget Marshal
  carmen: "9ce67d98-bc38-404b-a979-8db00379fbda",  // Contract Owner
  casey: "b4ae9fe0-e35d-4c19-ade0-3a3ff11b73c7",   // Compatibility Auditor
  finn: "3401eaa3-6bde-4373-b418-a09e78f6bad4",    // Fork Debugger
  grace: "e72c4e0f-7df1-4b7f-910b-d6f19b14542b",   // Gate Sentinel
  maya: "7b8c44b7-ddeb-4a35-87e4-2ae502fe9001",    // Code Owner
  parker: "9df8d807-6fb0-4a4d-85f8-b58115f06399",  // Performance Sentinel
  priya: "642755a2-a869-440b-b4f7-e5a718e0fb8b",   // Goal Reaper
  quinn: "102631e7-87d1-432e-a31c-678d18467f58",   // Test Adversary
  ravi: "2f800625-2b22-442f-87c2-dd02d1b7838f",    // Replay Validator
  riley: "1a8b10b9-916e-41c9-aa23-0122e929f20e",   // Evidence Lead
  rowan: "774d5f17-62e9-4d43-9c71-e86ccb12a177",   // Code Reviewer
  sam: "04579801-e0a0-4474-a6e9-bedfcd7eebe9",     // Docs Owner
  sasha: "d4b24e43-0163-4bf0-882b-49f0ece2cb2d",   // Spec Skeptic
  simone: "c5b29408-bee3-4e8e-9f69-ef6099d8dbba",  // Security Auditor
  sofia: "ab752676-b8e9-4bf0-8f0f-6101933177a3",   // Spec Owner
  t5d: "9dfa236a-e370-418a-be1c-32bb3026d1af",     // Activation Engineer
  taylor: "3e41ab27-a151-449b-abe4-13a567159adf",  // Trace Archivist
  theo: "1343cc84-5a06-44b7-88f7-f2c3e82d7e1c",    // Test Owner
};

// SENDER_AGENT_KEY: which Pentagon agent posts on behalf of the daemons
// (Phoenix, runner, bridge). Switched from "theo" → "priya" 2026-05-28
// after Gap-A repro: conversations INSERT via the daemon JWT is blocked
// by RLS (code 42501). The MCP context the operator's claude-code session
// runs in (Priya, Goal Reaper) CAN create 2-party conversations through
// the find_conversation MCP tool, which satisfies the workspace/org
// membership RLS check that the daemon JWT doesn't. So we pre-seed
// Priya↔Rowan + Priya↔Grace via MCP once, then findOrCreateConversation
// short-circuits on its SELECT path forever after.
//
// Future: if a SECURITY DEFINER `dispatch_to_agent` RPC ever exists (see
// frames/codex-goals/pentagon-rls-investigation-20260528.md Option B), we
// can switch back to theo without UX seeding.
export const SENDER_AGENT_KEY = "priya";

/**
 * Read a rubric YAML file from agent-os/rubrics/<name>.yaml and return its
 * raw text for inlining into a reviewer dispatch prompt.
 */
import { readFileSync as _readFileSyncRest, existsSync as _existsSyncRest } from "node:fs";
function readRubric(judgeAgent) {
  const path = `/Users/gaganarora/Desktop/my projects/active_graph/agent-os/rubrics/${judgeAgent}-code-review.yaml`;
  const altPath = `/Users/gaganarora/Desktop/my projects/active_graph/agent-os/rubrics/${judgeAgent}-test-review.yaml`;
  const gatePath = `/Users/gaganarora/Desktop/my projects/active_graph/agent-os/rubrics/${judgeAgent}-gate.yaml`;
  for (const p of [path, altPath, gatePath]) {
    if (_existsSyncRest(p)) return _readFileSyncRest(p, "utf8");
  }
  return null;
}

/**
 * Dispatch a reviewer agent (e.g. Rowan) to grade a flywheel-proposed diff.
 * The reviewer reads the rubric, applies it, and replies with the ack format
 * the rubric specifies. The bridge parses the ack and emits
 * flywheel.review.completed for Phoenix to resume the commit gate.
 */
// pt.21: pre-seeded Priya<->reviewer conversation ids (RLS unblock). Reading these
// lets dispatchReviewer insert the review message directly, skipping the
// findOrCreateConversation participant query that times out (57014) under RLS and
// then 403s on CREATE. Env FACTORY_REVIEWER_CONV_<KEY> overrides the file.
function reviewerConvId(reviewerAgentKey) {
  const envOverride = process.env[`FACTORY_REVIEWER_CONV_${reviewerAgentKey.toUpperCase()}`];
  if (envOverride) return envOverride;
  try {
    const url = new URL("../agent-os/reviewer-conversations.json", import.meta.url);
    const map = JSON.parse(_readFileSyncRest(url, "utf8"));
    return map[reviewerAgentKey] || null;
  } catch { return null; }
}

export async function dispatchReviewer({
  reviewerAgentKey,
  todo,
  diff,
  rationale,
  testSummary,
  failureContext,
}) {
  const reviewerId = AGENT_MAP[reviewerAgentKey];
  if (!reviewerId) throw new Error(`unknown reviewer agent "${reviewerAgentKey}"`);
  const senderId = AGENT_MAP[SENDER_AGENT_KEY];

  const rubric = readRubric(reviewerAgentKey);

  const content = [
    `FLYWHEEL_REVIEW ${todo.id}`,
    "",
    `You are ${reviewerAgentKey} reviewing a flywheel-proposed diff that has already passed the test suite.`,
    "",
    `Failure context (the original todo): ${todo.title}`,
    `Failure reason: ${todo.failure_reason}`,
    `Tests result: ${testSummary || "(pass — exit 0)"}`,
    "",
    "## Diff to review",
    "```diff",
    diff.slice(0, 8000),  // cap to keep prompt under model limit
    "```",
    "",
    "## Rationale from the proposing agent",
    rationale || "(no rationale provided)",
    "",
    "## Your rubric",
    rubric ? "```yaml\n" + rubric + "\n```" : "(rubric not found on disk — use your judgment)",
    "",
    "## Reply contract (REQUIRED — parsed mechanically by the bridge)",
    "",
    `Reply EXACTLY one line in this format:`,
    `  ROWAN_REVIEW_PASS <sha> findings=<N> top_finding=<one_line>`,
    `  ROWAN_REVIEW_FAIL <sha> findings=<N> top_finding=<one_line>`,
    "",
    "Where:",
    "  - <sha> is the commit-not-yet-landed (use 'pending' since the commit happens AFTER your review)",
    "  - <N> is the number of distinct findings you considered (≥0)",
    "  - <one_line> summarizes the most important finding in ≤80 chars (newlines forbidden)",
    "",
    "If you have concerns but PASS overall, list them in subsequent lines as `- <concern>`.",
    "If you FAIL, the top_finding must explain the rubric criterion that drove the fail.",
    "",
    "Do not commit, do not push, do not edit files. Your reply is the entire intervention.",
  ].join("\n");

  // RLS unblock (Gap A / Option B). Try the SECURITY DEFINER RPC first — one
  // call does find-or-create-conv + insert-message, bypassing the
  // conversations-INSERT 403 that blocks reviewer dispatch. If the RPC doesn't
  // exist yet (operator hasn't created it), fall back to the REST path, which
  // works once the 2-party Theo↔reviewer convs are UX-seeded (Option 0).
  let convId, message, dispatchPath;
  // pt.21 PRIMARY: the reviewer 2-party convs are pre-seeded + stable. Insert the
  // message directly into the cached conv — this skips findOrCreateConversation's
  // participant query (which times out 57014 under RLS) AND the CREATE that 403s.
  const cachedConv = reviewerConvId(reviewerAgentKey);
  if (cachedConv) {
    convId = cachedConv;
    message = await insertMessage(convId, senderId, content);
    dispatchPath = "cached_conv";
  } else {
    const rpc = await rpcDispatchToAgent(senderId, reviewerId, content);
    if (rpc) {
      convId = rpc.conversation_id;
      message = { id: rpc.message_id ?? null };
      dispatchPath = "rpc_security_definer";
    } else {
      convId = await findOrCreateConversation(senderId, reviewerId);
      message = await insertMessage(convId, senderId, content);
      dispatchPath = "rest_fallback";
    }
  }
  return {
    conversation_id: convId,
    message_id: message?.id ?? null,
    reviewer_agent_id: reviewerId,
    reviewer_agent_key: reviewerAgentKey,
    dispatch_path: dispatchPath,
  };
}

/**
 * RLS unblock (Gap A / Option B). Calls the SECURITY DEFINER Postgres function
 * `dispatch_to_agent(p_sender_id, p_target_id, p_content)` which finds-or-creates
 * a 2-party conversation and inserts the message, running as the function owner
 * so it bypasses the conversations-INSERT RLS policy. Returns {conversation_id,
 * message_id} or null if the function doesn't exist yet (404 → REST fallback).
 * Draft SQL to create it: frames/codex-goals/rls-unblock-kit-20260528.md.
 */
export async function rpcDispatchToAgent(senderAgentId, targetAgentId, content) {
  try {
    const rows = await request("/rest/v1/rpc/dispatch_to_agent", {
      method: "POST",
      prefer: "return=representation",
      body: { p_sender_id: senderAgentId, p_target_id: targetAgentId, p_content: content },
    });
    const r = Array.isArray(rows) ? rows[0] : rows;
    if (r && (r.conversation_id || r.message_id)) return r;
    return null;
  } catch {
    return null;  // RPC missing (404) or errored → caller falls back to REST.
  }
}

/**
 * Find or create a conversation containing EXACTLY the two agents.
 *
 * Why exactly-2 matters: Pentagon's server-side trigger logic creates one
 * agent_trigger row per non-sender participant when a message lands. A
 * conversation that has accumulated extra participants (via earlier
 * cascades) will fan out a single Phoenix dispatch into N parallel agent
 * dispatches — billing N× and triggering N more cascades. Pinning Phoenix
 * to exactly-2-party convs caps each dispatch at one agent.
 *
 * Discovered the hard way 2026-05-28: a flywheel test dispatch into a
 * 5-participant Theo↔Maya conv (polluted by prior cascade) auto-spawned
 * 4 simultaneous triggers for Maya/Carmen/Sofia/Sam — Sam's dispatch
 * landed in flight before we could intercept.
 */
export async function findOrCreateConversation(senderAgentId, targetAgentId) {
  // Find every conversation that contains BOTH agents.
  const rows = await request(
    `/rest/v1/conversation_participants?user_id=in.(${senderAgentId},${targetAgentId})` +
    `&left_at=is.null&deleted_at=is.null&select=conversation_id,user_id&limit=500`
  );
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.conversation_id)) grouped.set(row.conversation_id, new Set());
    grouped.get(row.conversation_id).add(row.user_id);
  }
  const candidateConvIds = [...grouped.entries()]
    .filter(([, ids]) => ids.has(senderAgentId) && ids.has(targetAgentId))
    .map(([id]) => id);

  if (candidateConvIds.length) {
    // For each candidate, check the FULL participant set — the query above
    // only selected rows for sender/target, so a 5-party conv shows up here
    // with 2 entries. We need the conv whose total participant count is 2.
    const allParticipants = await request(
      `/rest/v1/conversation_participants?conversation_id=in.(${candidateConvIds.join(",")})` +
      `&left_at=is.null&deleted_at=is.null&select=conversation_id,user_id&limit=1000`
    );
    const sizes = new Map();
    for (const row of allParticipants) {
      sizes.set(row.conversation_id, (sizes.get(row.conversation_id) || 0) + 1);
    }
    const exactlyTwo = candidateConvIds.find((id) => sizes.get(id) === 2);
    if (exactlyTwo) return exactlyTwo;
    // No 2-party conv found — fall through to create a fresh one. This is
    // the safety property that prevents cascade fan-out.
  }

  const owner = operatorId();
  const title = `flywheel:${senderAgentId.slice(0, 8)}<->${targetAgentId.slice(0, 8)}`;
  const created = await request("/rest/v1/conversations?select=id", {
    method: "POST",
    prefer: "return=representation",
    body: { title },
  });
  const convId = Array.isArray(created) ? created[0]?.id : created?.id;
  if (!convId) throw new Error("conversation create failed: " + JSON.stringify(created));
  await request("/rest/v1/conversation_participants", {
    method: "POST",
    prefer: "return=representation",
    body: [
      { conversation_id: convId, user_id: senderAgentId, owner_id: owner },
      { conversation_id: convId, user_id: targetAgentId, owner_id: owner },
    ],
  });
  return convId;
}

/**
 * Insert a message into a conversation. Pentagon's server-side logic then
 * auto-creates an agent_triggers row that the bridge picks up.
 */
export async function insertMessage(conversationId, senderAgentId, content) {
  const rows = await request(
    "/rest/v1/messages?select=id,conversation_id,sender_id,content,created_at",
    {
      method: "POST",
      prefer: "return=representation",
      body: { conversation_id: conversationId, sender_id: senderAgentId, content },
    }
  );
  return rows[0];
}

/**
 * High-level dispatch: take a Phoenix todo row, pick the recommended agent,
 * find/create the Theo↔agent conversation, insert a message that names the
 * todo + failure context. Pentagon's auto-trigger logic does the rest.
 *
 * Returns { conversation_id, message_id, target_agent_id } on success.
 * Throws on any REST failure — caller decides whether to retry or skip.
 */
export async function dispatchTodo(todo) {
  const agentKey = String(todo.recommended_agent || "").toLowerCase();
  const targetAgentId = AGENT_MAP[agentKey];
  if (!targetAgentId) {
    throw new Error(`unknown recommended_agent "${todo.recommended_agent}" — not in AGENT_MAP`);
  }
  const senderAgentId = AGENT_MAP[SENDER_AGENT_KEY];
  const convId = await findOrCreateConversation(senderAgentId, targetAgentId);

  // Brandon-A research packet: pre-flight context (recent similar failures,
  // recent commits in target area, relevant CLAUDE.md section). Generated
  // best-effort; if anything fails, fall back to no packet.
  let researchPacket = "";
  try {
    // Try to extract a target symbol or file from the title.
    const fileMatch = /(\w[\w/.\-]+\.(?:py|mjs|js|ts|sql))/.exec(todo.title || "");
    researchPacket = "\n" + generateResearchPacket({
      targetFile: fileMatch ? fileMatch[1] : undefined,
      matchReason: todo.failure_reason,
      matchBehavior: todo.source_behavior,
      taskClass: todo.failure_reason?.split(".")?.[0],
      compact: true,
      limit: 3,
    }) + "\n";
  } catch (e) {
    researchPacket = `\n(research packet generation failed: ${String(e?.message || e).slice(0, 120)})\n`;
  }

  const content = [
    `FLYWHEEL_TODO ${todo.id}`,
    "",
    `You are the recommended agent for an automatically-generated todo from the dark factory's closed-loop flywheel.`,
    "",
    `Failure summary: ${todo.title}`,
    `Failure reason code: ${todo.failure_reason}`,
    `Failure event id: ${todo.failure_event_id} (factory-events.jsonl)`,
    `Occurrences seen: ${todo.occurrences}`,
    `Priority: ${todo.priority}`,
    `Recommended agent: ${todo.recommended_agent} (you)`,
    `Dedup key: ${todo.dedup_key}`,
    researchPacket,
    "Task: diagnose the failure and propose a code fix as a unified diff.",
    "",
    "Reply contract (REQUIRED — Phoenix parses your reply mechanically):",
    `  Line 1: FLYWHEEL_TODO_${todo.id}_RECEIVED`,
    "",
    "  Then exactly ONE of:",
    "",
    `  (a) FLYWHEEL_TODO_${todo.id}_PROPOSE_DIFF`,
    "      followed by a fenced \`\`\`diff block containing a unified diff that, when applied to the inner repo (activegraph/), fixes the failure. Paths must be relative to repo root (e.g. activegraph/llm/foo.py). Then a one-paragraph rationale.",
    "",
    `  (b) FLYWHEEL_TODO_${todo.id}_BLOCKED <one_line_reason>`,
    "      if you cannot propose a fix (insufficient info, requires architectural decision, not actually a bug, etc.). State the reason succinctly.",
    "",
    "Phoenix will:",
    "  - apply the diff to a fresh worktree",
    "  - run the test suite in that worktree",
    "  - if tests pass, commit + push to a fix branch",
    "  - if tests fail, discard the diff and record the rejection",
    "",
    "Do NOT commit to the main worktree directly. Do NOT make changes outside the proposed diff. Your reply is the entire intervention — there is no follow-up.",
  ].join("\n");

  const message = await insertMessage(convId, senderAgentId, content);
  return {
    conversation_id: convId,
    message_id: message?.id ?? null,
    target_agent_id: targetAgentId,
  };
}
