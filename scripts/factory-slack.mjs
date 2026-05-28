#!/usr/bin/env node
// factory-slack.mjs — P16: Slack-native surface for the factory ledger
// (Pancake gap #22 "agents operate within Slack channels" + spend gates #23).
//
// This is the OUTBOUND half: it turns notable factory events into Slack
// messages so an operator watching a channel sees regressions, harm blocks,
// cost-cap breaches, dispatches, and FAIL verdicts as they happen. The INBOUND
// half (one-tap approve/reject buttons) needs a hosted endpoint to receive
// Slack's interactive callbacks — see "Approval extension" at the bottom; the
// event shapes here already carry an `approval` hint so that endpoint can be
// added without changing producers.
//
// Activation is a single env var (no secrets in the repo):
//   FACTORY_SLACK_WEBHOOK=https://hooks.slack.com/services/...
// Without it, the notifier runs in DRY-RUN (logs the payload it WOULD post), so
// it's fully testable offline. factory-alert.mjs already posts alerts to its own
// webhook; this is the general ledger surface (a superset of event types).
//
// Usage:
//   node scripts/factory-slack.mjs --once            # scan recent events, post notable
//   node scripts/factory-slack.mjs --once --since 6h
//   node scripts/factory-slack.mjs --dry-run --once  # force dry-run even with webhook
//   node scripts/factory-slack.mjs                   # subscribe (honker) + post live

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EVENTS = resolve(REPO, "frames/factory-events.jsonl");
const has = (n) => process.argv.includes(n);
function arg(name, fb = null) { const i = process.argv.indexOf(name); return i === -1 ? fb : process.argv[i + 1] ?? fb; }

// Which event types are worth a human's attention in a Slack channel, and how
// to render each. Anything not listed is ignored (the ledger is high-volume).
const NOTABLE = {
  "gauntlet.regression":        { emoji: "🔴", title: (p) => `Regression: ${p.check} started failing`, approval: false },
  "safety.blocked":             { emoji: "🛑", title: (p) => `Sentinel BLOCKED a diff: ${p.reason ?? p.rule ?? "harmful"}`, approval: false },
  "infrastructure.factory_alert": { emoji: "🚨", title: (p) => `Factory alert: ${p.alert ?? p.code ?? p.message ?? "see dashboard"}`, approval: false },
  "blake.budget_cap_breached":  { emoji: "💸", title: (p) => `Budget cap breached: ${p.window ?? ""} $${p.spent ?? "?"} > $${p.cap ?? "?"}`, approval: true },
  "flywheel.review.completed":  { emoji: (p) => (String(p.verdict).toUpperCase().includes("FAIL") || String(p.verdict).toUpperCase().includes("BLOCK")) ? "❌" : "✅",
                                  title: (p) => `${p.judge ?? "judge"} review ${p.verdict} (todo ${short(p.todo_event_id)})`,
                                  only: (p) => true, approval: false },
  "todo.dispatched":            { emoji: "📨", title: (p) => `Dispatched ${p.target_agent ?? p.recommended_agent ?? "agent"} for: ${p.title ?? p.dedup_key ?? "todo"}`, approval: true },
};

function short(s) { return String(s ?? "").slice(0, 12); }

/**
 * Pure: turn a factory event into a Slack message object, or null if the event
 * isn't notable. Testable without any network.
 */
export function formatEventForSlack(event) {
  const spec = NOTABLE[event?.type];
  if (!spec) return null;
  const p = event.payload || event.extras || {};
  if (spec.only && !spec.only(p)) return null;
  const emoji = typeof spec.emoji === "function" ? spec.emoji(p) : spec.emoji;
  const title = spec.title(p);
  const text = `${emoji} *${title}*`;
  const msg = {
    text,
    blocks: [{ type: "section", text: { type: "mrkdwn", text } }],
  };
  if (spec.approval) {
    // Hint for the inbound approval endpoint (factory-slack-approve.mjs).
    const eventId = event.id ?? null;
    msg.approval = { event_type: event.type, event_id: eventId, dedup_key: p.dedup_key ?? null };
    // Real Block Kit buttons — the `value` convention (approve:/reject:<id>) is
    // exactly what factory-slack-approve.mjs::parseApprovalPayload reads back.
    msg.blocks.push({
      type: "actions",
      elements: [
        { type: "button", text: { type: "plain_text", text: "Approve" }, style: "primary", action_id: "approve", value: `approve:${eventId}` },
        { type: "button", text: { type: "plain_text", text: "Reject" }, style: "danger", action_id: "reject", value: `reject:${eventId}` },
      ],
    });
  }
  return msg;
}

export function selectNotable(events) {
  return events.map((e) => ({ event: e, msg: formatEventForSlack(e) })).filter((x) => x.msg);
}

async function postToSlack(msg, { webhook, dryRun }) {
  if (dryRun || !webhook) { console.log("[dry-run] would post:", JSON.stringify(msg.text)); return { posted: false }; }
  const res = await fetch(webhook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(msg) });
  return { posted: res.ok, status: res.status };
}

function readEvents() {
  if (!existsSync(EVENTS)) return [];
  const out = [];
  for (const line of readFileSync(EVENTS, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch {}
  }
  return out;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const webhook = process.env.FACTORY_SLACK_WEBHOOK || null;
  const dryRun = has("--dry-run") || !webhook;
  const tail = Number(arg("--tail", "200"));
  const notable = selectNotable(readEvents().slice(-tail));
  console.log(`factory-slack: ${notable.length} notable event(s) in last ${tail}; webhook=${webhook ? "set" : "none (dry-run)"}`);
  for (const { msg } of notable) await postToSlack(msg, { webhook, dryRun });
  if (!has("--once")) {
    console.log("(subscribe mode not enabled in this MVP — use --once on a cron, or honker-subscribe in a follow-up)");
  }
}

// Approval extension (inbound, needs a hosted endpoint — documented, not built):
//   Create a Slack app with interactive components → a small HTTPS endpoint
//   receives the button payload (approve/reject) → it calls the existing
//   Pentagon RPC / phoenix complete/cancel path keyed by msg.approval.event_id.
//   The outbound messages above already carry msg.approval so the endpoint has
//   the correlation id. Until that endpoint exists, approvals stay in the
//   operator's existing channels (factory-health / PANIC file / Blake caps).
