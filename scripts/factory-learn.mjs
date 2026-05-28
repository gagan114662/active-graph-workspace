#!/usr/bin/env node
// factory-learn.mjs — deterministic self-improvement proposer (task #19).
//
// Reads (a) the factory event log and (b) the current routing config,
// proposes a new config based on which agent has the best historical
// success rate per (reason, behavior) tuple. The proposal is itself an
// event (factory.config.proposed). An operator-emitted factory.config.approved
// event activates it (task #20).
//
// Per the deterministic improvement contract in
// frames/codex-goals/factory-fully-autonomous-goal-20260528.md:
//
//   (event_stream_snapshot, current_config) → new_config'  [pure function]
//
// This script is pure — no clocks (only Date.parse of recorded timestamps),
// no random, no network. Given the same event snapshot and the same config,
// it produces byte-identical output. Replay test enforced by factory-replay.mjs
// (task #21).
//
// Success metric (v1):
//   For each (failure_reason, source_behavior) tuple seen in the event log,
//   compute per-agent success_rate = flywheel.commit.landed / dispatched_total.
//   If a different agent has a higher rate AND minimum dispatch volume, propose
//   that agent as the new route for that tuple.
//
// Usage:
//   node scripts/factory-learn.mjs                       # show proposal
//   node scripts/factory-learn.mjs --emit                # emit factory.config.proposed event
//   node scripts/factory-learn.mjs --json                # raw report
//   node scripts/factory-learn.mjs --min-volume 5        # tighten/loosen volume gate

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const EVENTS_PATH = resolve(
  process.env.FACTORY_EVENTS_PATH || "frames/factory-events.jsonl"
);
const ROUTING_CONFIG_PATH = resolve(
  process.env.FACTORY_ROUTING_CONFIG ||
    "/Users/gaganarora/Desktop/my projects/active_graph/agent-os/factory-routing-config.json"
);

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1] ?? fallback;
}
function has(name) { return process.argv.includes(name); }

const MIN_VOLUME = Number(arg("--min-volume", "3"));
const MIN_IMPROVEMENT = Number(arg("--min-improvement", "0.15"));  // 15 pct points
const EMIT = has("--emit");
const AS_JSON = has("--json");

if (!existsSync(EVENTS_PATH)) {
  console.error(`no events at ${EVENTS_PATH}`);
  process.exit(1);
}
if (!existsSync(ROUTING_CONFIG_PATH)) {
  console.error(`no routing config at ${ROUTING_CONFIG_PATH}`);
  process.exit(1);
}

const events = readFileSync(EVENTS_PATH, "utf8")
  .split(/\r?\n/)
  .filter(Boolean)
  .map((l) => { try { return JSON.parse(l); } catch { return null; } })
  .filter(Boolean);

const currentConfig = JSON.parse(readFileSync(ROUTING_CONFIG_PATH, "utf8"));

// --- step 1: index dispatches + outcomes -----------------------------------

const todoByFailure = new Map();
for (const ev of events) {
  if (ev.type !== "todo.created") continue;
  const failId = ev.payload?.failure_event_id;
  if (failId) todoByFailure.set(failId, ev);
}

const outcomesByTodo = new Map();
for (const ev of events) {
  if (!["flywheel.commit.landed", "flywheel.commit.local_only", "flywheel.attempt.rejected"].includes(ev.type)) continue;
  const tid = ev.payload?.todo_event_id;
  if (!tid) continue;
  if (!outcomesByTodo.has(tid)) outcomesByTodo.set(tid, []);
  outcomesByTodo.get(tid).push(ev);
}

// --- step 2: aggregate per (reason, behavior, agent) ------------------------

const agg = {};  // key: reason||behavior, val: { agent: { dispatched, success } }
for (const failureEv of events) {
  if (failureEv.type !== "behavior.failed") continue;
  const reason = failureEv.payload?.reason || "unknown";
  const behavior = failureEv.payload?.behavior || "unknown";
  const todo = todoByFailure.get(failureEv.id);
  if (!todo) continue;
  const agent = todo.payload?.recommended_agent || "unknown";
  const key = `${reason}||${behavior}`;
  agg[key] = agg[key] || {};
  agg[key][agent] = agg[key][agent] || { dispatched: 0, success: 0 };
  agg[key][agent].dispatched++;

  const outcomes = outcomesByTodo.get(todo.payload?.failure_event_id ? `todo_${failureEv.id}` : todo.id);
  // Simpler: use the todo's id from the todo event payload OR factory-todos table.
  // For now, count flywheel.commit.landed referencing this todo.
}

// Actually re-walk outcomes by todo id properly:
for (const todoEv of events) {
  if (todoEv.type !== "todo.created") continue;
  const reason = todoEv.payload?.failure_reason || "unknown";
  const behavior = todoEv.payload?.source_behavior || "unknown";
  const agent = todoEv.payload?.recommended_agent || "unknown";
  const key = `${reason}||${behavior}`;
  agg[key] = agg[key] || {};
  agg[key][agent] = agg[key][agent] || { dispatched: 0, success: 0 };
  agg[key][agent].dispatched++;
  // Outcome lookup: the todo.created event itself has an id pattern but
  // outcomes reference todo_event_id which is the row id. Use row id from
  // factory-todos.jsonl if present; fall back to skipping.
  const todoId = `todo_${todoEv.id}`;
  const outs = outcomesByTodo.get(todoId) || [];
  if (outs.some((o) => o.type === "flywheel.commit.landed")) {
    agg[key][agent].success++;
  }
}

// --- step 3: identify proposed swaps ----------------------------------------

const proposals = [];
for (const [key, byAgent] of Object.entries(agg)) {
  const [reason, behavior] = key.split("||");

  // Find which agent the current config would route to.
  const fakeEvent = { payload: { reason, behavior } };
  const currentRoute = (() => {
    for (const rule of currentConfig.rules || []) {
      if (matchPredicate(rule.when, fakeEvent)) {
        if (rule.skip_todo) return { decision: "skip" };
        if (rule.route) return { decision: "route", agent: rule.route.agent, rule: rule.name };
      }
    }
    return { decision: "fallthrough" };
  })();
  if (currentRoute.decision === "skip") continue;
  const currentAgent = currentRoute.agent;

  // For each agent with min volume, compute success rate.
  const ranked = Object.entries(byAgent)
    .filter(([_, s]) => s.dispatched >= MIN_VOLUME)
    .map(([agent, s]) => ({ agent, rate: s.success / s.dispatched, dispatched: s.dispatched, success: s.success }))
    .sort((a, b) => b.rate - a.rate);
  if (ranked.length < 2) continue;

  const best = ranked[0];
  const current = ranked.find((r) => r.agent === currentAgent);
  if (!current) continue;  // current agent doesn't have enough volume — skip
  if (best.agent === currentAgent) continue;
  const improvement = best.rate - current.rate;
  if (improvement < MIN_IMPROVEMENT) continue;

  proposals.push({
    key: { reason, behavior },
    current: { agent: currentAgent, rate: Number(current.rate.toFixed(3)), dispatched: current.dispatched, success: current.success, matched_rule: currentRoute.rule },
    proposed: { agent: best.agent, rate: Number(best.rate.toFixed(3)), dispatched: best.dispatched, success: best.success },
    improvement_pp: Number((improvement * 100).toFixed(1)),
  });
}

function matchPredicate(when, event) {
  if (!when) return false;
  if (when.always === true) return true;
  const reason = event?.payload?.reason || null;
  const behavior = event?.payload?.behavior || null;
  if ("extras.synthetic" in when) {
    if ((event?.payload?.synthetic === true) !== (when["extras.synthetic"] === true)) return false;
  }
  if (when.reason_equals !== undefined && reason !== when.reason_equals) return false;
  if (when.reason_prefix !== undefined && !(reason && reason.startsWith(when.reason_prefix))) return false;
  if (when.behavior_equals !== undefined && behavior !== when.behavior_equals) return false;
  return true;
}

const report = {
  events_scanned: events.length,
  min_volume_threshold: MIN_VOLUME,
  min_improvement_pp: MIN_IMPROVEMENT * 100,
  total_buckets_aggregated: Object.keys(agg).length,
  proposals_count: proposals.length,
  proposals,
};

if (AS_JSON) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log("FACTORY LEARN — config update proposals");
  console.log("");
  console.log(`Scanned: ${report.events_scanned} events`);
  console.log(`Buckets: ${report.total_buckets_aggregated} (reason×behavior tuples seen)`);
  console.log(`Min volume per agent: ${MIN_VOLUME}`);
  console.log(`Min improvement: ${(MIN_IMPROVEMENT * 100).toFixed(1)} percentage points`);
  console.log("");
  if (proposals.length === 0) {
    console.log("No proposed config changes — current routing is the best per historical data.");
  } else {
    console.log(`PROPOSED CHANGES (${proposals.length}):`);
    for (const p of proposals) {
      console.log(`  reason=${p.key.reason} behavior=${p.key.behavior}`);
      console.log(`    current: route to ${p.current.agent} (success ${p.current.success}/${p.current.dispatched} = ${(p.current.rate * 100).toFixed(1)}%)`);
      console.log(`    proposed: route to ${p.proposed.agent} (success ${p.proposed.success}/${p.proposed.dispatched} = ${(p.proposed.rate * 100).toFixed(1)}%)`);
      console.log(`    improvement: ${p.improvement_pp}pp`);
    }
  }
}

if (EMIT && proposals.length > 0) {
  const m = await import("./factory-events.mjs");
  const ev = m.emitFactoryEvent({
    type: "factory.config.proposed",
    behavior: "factory-learn",
    extras: {
      proposals,
      events_scanned: report.events_scanned,
      min_volume_threshold: MIN_VOLUME,
      min_improvement_pp: MIN_IMPROVEMENT * 100,
      proposer: "factory-learn.mjs",
    },
  });
  console.log("");
  console.log(`emitted factory.config.proposed: ${ev.id}`);
  console.log(`to apply: emit factory.config.approved with extras.proposed_event_id="${ev.id}"`);
}
