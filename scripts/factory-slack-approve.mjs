#!/usr/bin/env node
// factory-slack-approve.mjs — P16 inbound half: the one-tap approve/reject
// endpoint (Pancake gap #22 "one-tap human approval", spend gates #23).
//
// factory-slack.mjs posts approval-gated events to Slack with an `approval` hint
// {event_type, event_id, dedup_key}. When the operator taps Approve/Reject on
// that Slack message, Slack POSTs an interactive payload here. This handler
// parses it and emits `approval.granted` / `approval.denied` factory events keyed
// by the event_id, which Phoenix (or any consumer) gates the action on. Closing
// the loop this way needs NO Pentagon RPC wiring — it's just another event.
//
// Dependency-free (node:http). Local by default; ACTIVATION needs the endpoint
// exposed publicly (a tunnel/host) + the Slack app's signing secret in
// SLACK_SIGNING_SECRET (verified when set). Until exposed, approvals stay in the
// operator's existing surfaces (factory-health / PANIC / Blake caps).
//
// Usage:
//   node scripts/factory-slack-approve.mjs --port 8787      # run the listener
//   (POST /slack/interactive  with Slack payload=<urlencoded json>, OR
//    POST /approve  with JSON {decision:"approve"|"reject", event_id, dedup_key})

import { createServer } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const has = (n) => process.argv.includes(n);
function arg(name, fb = null) { const i = process.argv.indexOf(name); return i === -1 ? fb : process.argv[i + 1] ?? fb; }

/**
 * Pure: turn a raw request body (either Slack's `payload=<urlencoded>` form or a
 * plain JSON approve/reject) into a normalized decision, or null if unparseable.
 * Returns { decision: "approve"|"reject", event_id, dedup_key, source }.
 */
export function parseApprovalPayload(rawBody, contentType = "") {
  if (!rawBody) return null;
  // 1) Slack interactive: application/x-www-form-urlencoded with payload=<json>
  if (/x-www-form-urlencoded/.test(contentType) || rawBody.startsWith("payload=")) {
    try {
      const params = new URLSearchParams(rawBody);
      const payload = JSON.parse(params.get("payload") || "{}");
      const action = (payload.actions && payload.actions[0]) || {};
      const value = action.value || action.action_id || "";
      const decision = /reject|deny|block/i.test(value) ? "reject" : /approve|allow|grant/i.test(value) ? "approve" : null;
      if (!decision) return null;
      // value convention: "approve:<event_id>" / "reject:<event_id>"
      const event_id = (value.split(":")[1] || payload.event_id || null);
      return { decision, event_id, dedup_key: payload.dedup_key ?? null, source: "slack_interactive" };
    } catch { return null; }
  }
  // 2) Plain JSON
  try {
    const j = JSON.parse(rawBody);
    const decision = /reject|deny|block/i.test(j.decision || "") ? "reject" : /approve|allow|grant/i.test(j.decision || "") ? "approve" : null;
    if (!decision) return null;
    return { decision, event_id: j.event_id ?? null, dedup_key: j.dedup_key ?? null, source: "json" };
  } catch { return null; }
}

/** Pure: verify a Slack request signature (v0 scheme). No secret set → skip (true). */
export function verifySlackSignature({ signingSecret, timestamp, body, signature }) {
  if (!signingSecret) return true; // not configured — caller decides
  if (!timestamp || !signature) return false;
  // Reject stale (>5 min) to prevent replay.
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return false;
  const base = `v0:${timestamp}:${body}`;
  const mine = "v0=" + createHmac("sha256", signingSecret).update(base).digest("hex");
  try {
    const a = Buffer.from(mine), b = Buffer.from(signature);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch { return false; }
}

async function emitDecision(decision, info) {
  const { emitFactoryEvent } = await import("./factory-events.mjs");
  emitFactoryEvent({
    type: decision === "approve" ? "approval.granted" : "approval.denied",
    behavior: "factory-approval",
    reason: decision === "approve" ? "approval.granted" : "approval.denied",
    extras: { event_id: info.event_id, dedup_key: info.dedup_key, source: info.source },
  });
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const port = Number(arg("--port", "8787"));
  const signingSecret = process.env.SLACK_SIGNING_SECRET || null;
  const server = createServer((req, res) => {
    if (req.method !== "POST") { res.writeHead(405); return res.end("POST only"); }
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on("end", async () => {
      const ok = verifySlackSignature({
        signingSecret, timestamp: req.headers["x-slack-request-timestamp"],
        body, signature: req.headers["x-slack-signature"],
      });
      if (!ok) { res.writeHead(401); return res.end("bad signature"); }
      const info = parseApprovalPayload(body, req.headers["content-type"] || "");
      if (!info) { res.writeHead(400); return res.end("unparseable approval"); }
      try { await emitDecision(info.decision, info); } catch (e) { /* still ack Slack */ }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, decision: info.decision, event_id: info.event_id }));
      console.log(`[approve] ${info.decision} event_id=${info.event_id} src=${info.source}`);
    });
  });
  server.listen(port, () => console.log(`factory-slack-approve listening on :${port} (signing ${signingSecret ? "verified" : "OFF — set SLACK_SIGNING_SECRET"})`));
}
