#!/usr/bin/env node
// factory-replay.mjs — production-trace replay harness (tasks #16c + #21 + #26).
//
// Per Phil Hetzel (BrainTrust 2026-05-28): "treat evals like rerunning
// production, not running tests." factory-events.jsonl IS the production
// trace. This script replays historical events through the CURRENT factory
// configuration (routing rules, judge rubrics, agent map) and compares the
// outcomes that WOULD have been produced against the outcomes that ACTUALLY
// were produced.
//
// Three replay modes:
//
//   --mode routing-determinism
//       For every behavior.failed in the event log, run it through the
//       current routing config. If it would have routed differently than
//       the actual todo.created that followed, that's a routing.replay.divergence.
//       Tells the operator: "if you applied current routing config to historical
//       failures, would N% of dispatches go to different agents?"
//
//   --mode judge-replay (planned, requires new-judge-model invocation)
//       For every flywheel.review.completed in the window, re-invoke the
//       CURRENT judge model on the same input. If the new verdict differs,
//       emit judge.replay.divergence. Drives task #25 promotion gate.
//
//   --mode action-determinism
//       For every flywheel.diff.proposed, simulate the action layer's
//       apply-test logic deterministically (without spawning agents). If
//       the modeled outcome differs from the recorded outcome, that's a
//       determinism bug.
//
// Outputs:
//   --json    structured report
//   default   markdown summary
//
// Usage:
//   node scripts/factory-replay.mjs --mode routing-determinism --since 24h
//   node scripts/factory-replay.mjs --mode routing-determinism --json

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

const MODE = arg("--mode", "routing-determinism");
const SINCE_SPEC = arg("--since", "24h");
const AS_JSON = has("--json");

function parseSince(spec) {
  const m = String(spec).match(/^(\d+)([smhd])$/);
  if (!m) return 24 * 3600_000;
  const n = Number(m[1]);
  return n * ({ s: 1000, m: 60_000, h: 3600_000, d: 86_400_000 }[m[2]]);
}
const SINCE_CUTOFF = Date.now() - parseSince(SINCE_SPEC);

if (!existsSync(EVENTS_PATH)) {
  console.error(`no events log at ${EVENTS_PATH}`);
  process.exit(1);
}

const events = [];
for (const line of readFileSync(EVENTS_PATH, "utf8").split(/\r?\n/)) {
  if (!line.trim()) continue;
  try {
    const ev = JSON.parse(line);
    if (Date.parse(ev.created_at) < SINCE_CUTOFF) continue;
    events.push(ev);
  } catch {}
}

// --- routing predicate (mirrored from sasha-skeptic.mjs::matchPredicate) ---
// Kept in sync intentionally; future refactor: extract to shared module.

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

function routeReplay(event, config) {
  for (const rule of config.rules || []) {
    if (!matchPredicate(rule.when, event)) continue;
    if (rule.skip_todo) return { decision: "skip_todo", rule: rule.name };
    if (rule.route) return { decision: "route", agent: rule.route.agent, priority: rule.route.priority, rule: rule.name };
  }
  return { decision: "fallthrough", rule: null };
}

// --- replay modes ---

function routingDeterminismReplay() {
  if (!existsSync(ROUTING_CONFIG_PATH)) {
    return { error: `routing config not found at ${ROUTING_CONFIG_PATH}` };
  }
  const config = JSON.parse(readFileSync(ROUTING_CONFIG_PATH, "utf8"));
  // Index todo.created events by failure_event_id so we can find what
  // ACTUALLY happened for each historical failure.
  const todoByFailure = new Map();
  for (const ev of events) {
    if (ev.type !== "todo.created") continue;
    const failId = ev.payload?.failure_event_id;
    if (failId) todoByFailure.set(failId, ev);
  }

  const results = {
    mode: "routing-determinism",
    window: SINCE_SPEC,
    events_scanned: events.length,
    failures_seen: 0,
    actual_routed: 0,
    actual_skipped: 0,
    replay_routed: 0,
    replay_skipped: 0,
    divergences: [],
  };
  for (const ev of events) {
    if (ev.type !== "behavior.failed") continue;
    results.failures_seen++;
    const actualTodo = todoByFailure.get(ev.id);
    const actualAgent = actualTodo?.payload?.recommended_agent || null;
    const actualPriority = actualTodo?.payload?.priority || null;
    const actualDecision = actualTodo ? "route" : "skip_todo";
    if (actualDecision === "route") results.actual_routed++;
    else results.actual_skipped++;

    const replay = routeReplay(ev, config);
    if (replay.decision === "route") results.replay_routed++;
    else results.replay_skipped++;

    // Divergence: actual vs replayed differ in any way.
    let divergent = false;
    let reason_strings = [];
    if (replay.decision !== actualDecision) {
      divergent = true;
      reason_strings.push(`decision: actual=${actualDecision} replay=${replay.decision}`);
    }
    if (replay.decision === "route" && actualDecision === "route") {
      if (replay.agent !== actualAgent) {
        divergent = true;
        reason_strings.push(`agent: actual=${actualAgent} replay=${replay.agent}`);
      }
      if (replay.priority !== actualPriority) {
        divergent = true;
        reason_strings.push(`priority: actual=${actualPriority} replay=${replay.priority}`);
      }
    }
    if (divergent) {
      results.divergences.push({
        failure_event_id: ev.id,
        reason_code: ev.payload?.reason || null,
        behavior: ev.payload?.behavior || null,
        actual: { decision: actualDecision, agent: actualAgent, priority: actualPriority },
        replay: replay,
        reasons: reason_strings,
      });
    }
  }
  results.divergence_count = results.divergences.length;
  results.divergence_rate = results.failures_seen
    ? Number((results.divergence_count / results.failures_seen).toFixed(3))
    : 0;
  return results;
}

function actionDeterminismReplay() {
  // For each flywheel.diff.proposed, see if the recorded outcome
  // (flywheel.commit.* or flywheel.attempt.rejected) is consistent with
  // the diff contents. v0: just count outcomes by diff_chars buckets.
  const proposals = events.filter((e) => e.type === "flywheel.diff.proposed");
  const outcomesById = {};
  for (const ev of events) {
    if (!["flywheel.commit.landed", "flywheel.commit.local_only", "flywheel.attempt.rejected"].includes(ev.type)) continue;
    const todoId = ev.payload?.todo_event_id;
    if (!todoId) continue;
    outcomesById[todoId] = outcomesById[todoId] || [];
    outcomesById[todoId].push(ev);
  }
  const results = {
    mode: "action-determinism",
    window: SINCE_SPEC,
    proposals_seen: proposals.length,
    resolved: 0,
    unresolved: 0,
    by_outcome: { committed: 0, local_only: 0, rejected: 0 },
    multi_attempts: [],
  };
  for (const p of proposals) {
    const todoId = p.payload?.todo_event_id;
    const out = todoId ? outcomesById[todoId] || [] : [];
    if (out.length === 0) { results.unresolved++; continue; }
    results.resolved++;
    // Use the LAST outcome for that todo (in case of replays).
    const last = out[out.length - 1];
    if (last.type === "flywheel.commit.landed") results.by_outcome.committed++;
    else if (last.type === "flywheel.commit.local_only") results.by_outcome.local_only++;
    else if (last.type === "flywheel.attempt.rejected") results.by_outcome.rejected++;
    if (out.length > 1) {
      results.multi_attempts.push({ todo_id: todoId, attempts: out.length });
    }
  }
  return results;
}

function judgeReplay() {
  // Production-trace replay for judges (Task #26).
  //
  // For every flywheel.review.completed in the window, we have:
  //   - the input the judge saw (diff, rationale, test_summary)
  //   - the verdict the judge produced (PASS/FAIL + top_finding)
  // Replay re-derives what verdict the CURRENT judge config would produce.
  //
  // Two replay modes:
  //   - structural    : verify the recorded verdict's input shape is still
  //                     consistent with the current rubric's expected inputs
  //                     (criteria match, ack_format matches). Cheap, offline.
  //   - live          : invoke the judge model on each historical input and
  //                     compare verdicts. Requires JUDGE_REPLAY_LIVE=1 +
  //                     network access. Same call surface as judge-promote.mjs.
  //
  // Default is `structural`. Live mode requires --replay-live.
  const live = has("--replay-live");
  const reviewEvents = events.filter((ev) => ev.type === "flywheel.review.completed");
  const judgeErrorEvents = events.filter((ev) => ev.type === "judge.error");
  const judgeErrorByVerdict = new Map();
  for (const je of judgeErrorEvents) {
    const id = je.payload?.original_verdict_event_id;
    if (id) judgeErrorByVerdict.set(id, je);
  }
  // Load current rubric versions per judge.
  const rubricByJudge = {};
  for (const j of ["rowan", "theo", "grace"]) {
    const path = `/Users/gaganarora/Desktop/my projects/active_graph/agent-os/rubrics/${j}-code-review.yaml`;
    const alt = `/Users/gaganarora/Desktop/my projects/active_graph/agent-os/rubrics/${j}-test-review.yaml`;
    const gate = `/Users/gaganarora/Desktop/my projects/active_graph/agent-os/rubrics/${j}-gate.yaml`;
    for (const p of [path, alt, gate]) {
      if (existsSync(p)) {
        const yaml = readFileSync(p, "utf-8");
        const model = (yaml.match(/judge_model:\s*(\S+)/) || [])[1];
        const pinnedAt = (yaml.match(/judge_model_pinned_at:\s*['"]?([^'"\n]+)['"]?/) || [])[1];
        rubricByJudge[j] = { path: p, model, pinned_at: pinnedAt };
        break;
      }
    }
  }
  const results = [];
  let drifted = 0;
  for (const ev of reviewEvents) {
    const judgeName = ev.payload?.judge || ev.payload?.reviewer_agent_key || null;
    const current = rubricByJudge[judgeName];
    const recordedModel = ev.payload?.judge_model || null;
    const recordedPinned = ev.payload?.judge_model_pinned_at || null;
    const drift = current && (
      (recordedModel && current.model && recordedModel !== current.model) ||
      (recordedPinned && current.pinned_at && recordedPinned !== current.pinned_at)
    );
    if (drift) drifted++;
    results.push({
      verdict_event_id: ev.id,
      judge: judgeName,
      recorded_model: recordedModel,
      recorded_pinned_at: recordedPinned,
      current_model: current?.model || null,
      current_pinned_at: current?.pinned_at || null,
      model_drift: drift || false,
      had_judge_error: judgeErrorByVerdict.has(ev.id),
    });
  }
  return {
    mode: "judge-replay",
    submode: live ? "live" : "structural",
    judges_in_use: rubricByJudge,
    review_events_seen: reviewEvents.length,
    judge_errors_seen: judgeErrorEvents.length,
    verdicts_with_judge_error: judgeErrorEvents.length,
    model_drift_verdicts: drifted,
    results: results.slice(0, 50),
    next_step: live ? "live mode requires JUDGE_REPLAY_LIVE=1 + claude CLI auth — not implemented in v1" : "structural replay only checks model version drift. Run with --replay-live to invoke claude on each historical input.",
  };
}

// --- main ---

let report;
switch (MODE) {
  case "routing-determinism": report = routingDeterminismReplay(); break;
  case "action-determinism":  report = actionDeterminismReplay();  break;
  case "judge-replay":        report = judgeReplay();                break;
  default:
    console.error(`unknown --mode ${MODE}; choose one of: routing-determinism, action-determinism, judge-replay`);
    process.exit(2);
}

if (AS_JSON) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

console.log(`FACTORY REPLAY — mode=${MODE}, window=${SINCE_SPEC}`);
console.log("");
if (MODE === "routing-determinism") {
  console.log(`Failures scanned: ${report.failures_seen}`);
  console.log(`  Actual routed:    ${report.actual_routed}`);
  console.log(`  Actual skipped:   ${report.actual_skipped}`);
  console.log(`  Replay routed:    ${report.replay_routed}`);
  console.log(`  Replay skipped:   ${report.replay_skipped}`);
  console.log("");
  console.log(`Divergences: ${report.divergence_count} (${(report.divergence_rate * 100).toFixed(1)}% of failures)`);
  if (report.divergence_count > 0) {
    console.log("");
    console.log("First 10 divergences:");
    for (const d of report.divergences.slice(0, 10)) {
      console.log(`  ${d.failure_event_id} reason=${d.reason_code} behavior=${d.behavior}`);
      for (const r of d.reasons) console.log(`    - ${r}`);
    }
  } else {
    console.log("(current routing config produces same decisions as historical config — DETERMINISTIC ✓)");
  }
} else if (MODE === "action-determinism") {
  console.log(`Diff proposals seen: ${report.proposals_seen}`);
  console.log(`  Resolved:   ${report.resolved}`);
  console.log(`  Unresolved: ${report.unresolved}`);
  console.log("");
  console.log("Outcomes (last per todo):");
  console.log(`  committed:  ${report.by_outcome.committed}`);
  console.log(`  local_only: ${report.by_outcome.local_only}`);
  console.log(`  rejected:   ${report.by_outcome.rejected}`);
  if (report.multi_attempts.length) {
    console.log("");
    console.log(`Multi-attempt todos (>${1} outcome event): ${report.multi_attempts.length}`);
  }
} else {
  console.log(JSON.stringify(report, null, 2));
}
