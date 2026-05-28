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
import { decideRoute } from "./factory-routing.mjs";

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

// --- routing decision (SHARED with sasha-skeptic.mjs via factory-routing.mjs) ---
// The producer (Sasha) and the replayer (this file) MUST use the identical
// decideRoute() or replay is not faithful to production. This adapter just maps
// decideRoute()'s {decision:"route"|"skip"} shape onto the replay vocabulary
// ("skip_todo") and surfaces the config version the decision was made against.
const REPLAY_FAILURE_TYPES = new Set([
  "behavior.failed",
  "script.crash",
  "verifier.check_failed",
]);

function routeReplay(event, config) {
  const d = decideRoute(event, config);
  if (d.decision === "skip") {
    return { decision: "skip_todo", rule: d.matched_rule, config_version: d.config_version };
  }
  return { decision: "route", agent: d.agent, priority: d.priority, rule: d.matched_rule, config_version: d.config_version };
}

// --- replay modes ---

function routingDeterminismReplay() {
  if (!existsSync(ROUTING_CONFIG_PATH)) {
    return { error: `routing config not found at ${ROUTING_CONFIG_PATH}` };
  }
  const config = JSON.parse(readFileSync(ROUTING_CONFIG_PATH, "utf8"));
  const currentVersion = config.version ?? null;

  // Index the RECORDED decisions by failure_event_id. Route decisions are
  // recorded as todo.created; skip decisions as routing.skipped. Each carries
  // the config version it was decided under (the determinism pin).
  const todoByFailure = new Map();
  const skipByFailure = new Map();
  for (const ev of events) {
    const failId = ev.payload?.failure_event_id;
    if (!failId) continue;
    if (ev.type === "todo.created") todoByFailure.set(failId, ev);
    else if (ev.type === "routing.skipped") skipByFailure.set(failId, ev);
  }

  const results = {
    mode: "routing-determinism",
    window: SINCE_SPEC,
    current_config_version: currentVersion,
    events_scanned: events.length,
    failures_seen: 0,
    actual_routed: 0,
    actual_skipped: 0,
    actual_unknown: 0,        // pre-fix events with no recorded decision
    replay_routed: 0,
    replay_skipped: 0,
    // A divergence is only a BUG when the recorded decision used the SAME config
    // version as the current one. Different version => the rules legitimately
    // changed (expected). No recorded version => legacy pre-pin event.
    real_nondeterminism: [],
    expected_config_evolution: [],
    legacy_unstamped: [],
  };

  for (const ev of events) {
    if (!REPLAY_FAILURE_TYPES.has(ev.type)) continue;
    results.failures_seen++;

    const todo = todoByFailure.get(ev.id);
    const skip = skipByFailure.get(ev.id);
    let actualDecision, actualAgent = null, actualPriority = null, recordedVersion = null;
    if (todo) {
      actualDecision = "route";
      actualAgent = todo.payload?.recommended_agent || null;
      actualPriority = todo.payload?.priority || null;
      recordedVersion = todo.payload?.routing_config_version ?? null;
      results.actual_routed++;
    } else if (skip) {
      actualDecision = "skip_todo";
      recordedVersion = skip.payload?.routing_config_version ?? null;
      results.actual_skipped++;
    } else {
      // No recorded decision at all (pre-fix: skip was inferred by absence).
      actualDecision = "skip_todo";
      recordedVersion = null;
      results.actual_unknown++;
    }

    const replay = routeReplay(ev, config);
    if (replay.decision === "route") results.replay_routed++;
    else results.replay_skipped++;

    const reasons = [];
    if (replay.decision !== actualDecision) reasons.push(`decision: actual=${actualDecision} replay=${replay.decision}`);
    if (replay.decision === "route" && actualDecision === "route") {
      if (replay.agent !== actualAgent) reasons.push(`agent: actual=${actualAgent} replay=${replay.agent}`);
      if (replay.priority !== actualPriority) reasons.push(`priority: actual=${actualPriority} replay=${replay.priority}`);
    }
    if (reasons.length === 0) continue;  // deterministic — no divergence

    const entry = {
      failure_event_id: ev.id,
      reason_code: ev.payload?.reason || null,
      behavior: ev.payload?.behavior || null,
      recorded_config_version: recordedVersion,
      current_config_version: currentVersion,
      actual: { decision: actualDecision, agent: actualAgent, priority: actualPriority },
      replay: { decision: replay.decision, agent: replay.agent ?? null, priority: replay.priority ?? null, rule: replay.rule },
      reasons,
    };

    if (recordedVersion === null) results.legacy_unstamped.push(entry);
    else if (recordedVersion !== currentVersion) results.expected_config_evolution.push(entry);
    else results.real_nondeterminism.push(entry);
  }

  results.real_nondeterminism_count = results.real_nondeterminism.length;
  results.expected_config_evolution_count = results.expected_config_evolution.length;
  results.legacy_unstamped_count = results.legacy_unstamped.length;
  // The determinism guarantee: zero divergences under an UNCHANGED config.
  results.deterministic = results.real_nondeterminism_count === 0;
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

// Exit non-zero when a real determinism violation is found, so this doubles as
// a CI gate. Only routing-determinism has a hard pass/fail today.
function determinismExitCode() {
  if (MODE === "routing-determinism" && !report.error) {
    return report.real_nondeterminism_count > 0 ? 1 : 0;
  }
  return 0;
}

if (AS_JSON) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(determinismExitCode());
}

console.log(`FACTORY REPLAY — mode=${MODE}, window=${SINCE_SPEC}`);
console.log("");
if (MODE === "routing-determinism") {
  if (report.error) { console.error(report.error); process.exit(2); }
  console.log(`Config version: ${report.current_config_version}`);
  console.log(`Failures scanned: ${report.failures_seen}`);
  console.log(`  Actual routed:    ${report.actual_routed}`);
  console.log(`  Actual skipped:   ${report.actual_skipped}`);
  console.log(`  Actual unknown:   ${report.actual_unknown}  (pre-pin legacy events)`);
  console.log(`  Replay routed:    ${report.replay_routed}`);
  console.log(`  Replay skipped:   ${report.replay_skipped}`);
  console.log("");
  console.log(`REAL non-determinism (same config version, different decision): ${report.real_nondeterminism_count}`);
  console.log(`Expected config evolution (version changed):                   ${report.expected_config_evolution_count}`);
  console.log(`Legacy unstamped (no recorded config version):                 ${report.legacy_unstamped_count}`);
  if (report.real_nondeterminism_count > 0) {
    console.log("");
    console.log("⚠ REAL NON-DETERMINISM (these are bugs in the decision function):");
    for (const d of report.real_nondeterminism.slice(0, 10)) {
      console.log(`  ${d.failure_event_id} reason=${d.reason_code} behavior=${d.behavior} (cfg v${d.recorded_config_version})`);
      for (const r of d.reasons) console.log(`    - ${r}`);
    }
  } else {
    console.log("");
    console.log("DETERMINISTIC ✓ — every decision made under the current config version replays identically.");
    if (report.expected_config_evolution_count > 0) {
      console.log(`  (${report.expected_config_evolution_count} divergences are explained by config version changes — not bugs.)`);
    }
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

process.exit(determinismExitCode());
