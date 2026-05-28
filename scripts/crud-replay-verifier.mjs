#!/usr/bin/env node
// CRUD-replay-safety verifier (Gap I / Task #28).
//
// Scans factory-events.jsonl for state-mutating events and asserts that
// every one has the required CRUD-replay fields:
//   - mutation_kind   (commit, push, file_write, conv_insert, trigger_create, todo_mutation)
//   - state_before_hash  (or null for create-from-nothing)
//   - state_after_hash   (NOT null — the post-state must always be hashable)
//   - target             (file path / sha / conv id / etc.)
//
// Heuristic: event types matching state.* OR types in MUTATION_SHADOW_TYPES
// (existing legacy events that should ALSO carry state hashes once their
// emitters are migrated). Emits a flywheel-style report and exits 0 if all
// state-mutating events conform, 1 otherwise.
//
// Usage:
//   node scripts/crud-replay-verifier.mjs
//   node scripts/crud-replay-verifier.mjs --since 24h
//   node scripts/crud-replay-verifier.mjs --json

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i < 0 ? fallback : process.argv[i + 1] ?? fallback;
}
function flag(name) { return process.argv.includes(name); }

const SINCE_SPEC = arg("--since", "30d");
const AS_JSON = flag("--json");

function parseSinceMs(spec) {
  const m = String(spec).match(/^(\d+)([smhd])$/);
  if (!m) return 30 * 86400_000;
  const mult = { s: 1000, m: 60_000, h: 3600_000, d: 86400_000 }[m[2]];
  return Number(m[1]) * mult;
}
const SINCE_CUTOFF = Date.now() - parseSinceMs(SINCE_SPEC);

const EVENTS_PATH = resolve(process.env.FACTORY_EVENTS_PATH || "frames/factory-events.jsonl");

// Event types that SHOULD carry CRUD-replay fields. state.* are the events
// emitted via emitStateMutation (new path). MUTATION_SHADOW_TYPES are
// existing events that should also be migrated. Until migration is complete
// these only warn; new state.* events fail hard.
const STATE_PREFIX = "state.";
const MUTATION_SHADOW_TYPES = new Set([
  "flywheel.commit.landed",
  "flywheel.commit.local_only",
  "flywheel.commit.proposed",
]);

function loadEvents() {
  if (!existsSync(EVENTS_PATH)) return [];
  const events = [];
  for (const line of readFileSync(EVENTS_PATH, "utf-8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const ev = JSON.parse(line);
      if (Date.parse(ev.created_at) >= SINCE_CUTOFF) events.push(ev);
    } catch {}
  }
  return events;
}

function checkEvent(ev) {
  const extras = ev.payload || {};
  const violations = [];
  if (!extras.mutation_kind) violations.push("missing_mutation_kind");
  if (extras.state_before_hash === undefined) violations.push("missing_state_before_hash");
  if (!extras.state_after_hash) violations.push("missing_state_after_hash");
  if (extras.crud_replay_safe !== true) violations.push("missing_crud_replay_safe_flag");
  return violations;
}

function isStateMutation(ev) {
  return (ev.type && ev.type.startsWith(STATE_PREFIX)) || MUTATION_SHADOW_TYPES.has(ev.type);
}

function main() {
  const events = loadEvents();
  const mutations = events.filter(isStateMutation);
  const hardFailures = [];
  const softFailures = [];
  let conforming = 0;
  for (const ev of mutations) {
    const v = checkEvent(ev);
    if (v.length === 0) { conforming++; continue; }
    const record = {
      event_id: ev.id,
      event_type: ev.type,
      created_at: ev.created_at,
      violations: v,
    };
    if (ev.type.startsWith(STATE_PREFIX)) hardFailures.push(record);
    else softFailures.push(record);
  }
  const summary = {
    window: SINCE_SPEC,
    events_scanned: events.length,
    state_mutations: mutations.length,
    conforming,
    hard_failures: hardFailures.length,
    soft_failures: softFailures.length,
    hard_failure_examples: hardFailures.slice(0, 5),
    soft_failure_examples: softFailures.slice(0, 5),
  };
  if (AS_JSON) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`CRUD-replay-safety verifier: window=${SINCE_SPEC}`);
    console.log(`  events scanned:    ${events.length}`);
    console.log(`  state mutations:   ${mutations.length}`);
    console.log(`  conforming:        ${conforming}`);
    console.log(`  HARD failures:     ${hardFailures.length}  (state.* events missing CRUD fields)`);
    console.log(`  soft failures:     ${softFailures.length}  (legacy shadow types not yet migrated)`);
    if (hardFailures.length) {
      console.log(`\nHARD failures (sample):`);
      for (const h of hardFailures.slice(0, 5)) {
        console.log(`  - ${h.event_id} type=${h.event_type} violations=${h.violations.join(",")}`);
      }
    }
    if (softFailures.length) {
      console.log(`\nSoft failures (sample, not yet emitted via emitStateMutation):`);
      for (const s of softFailures.slice(0, 5)) {
        console.log(`  - ${s.event_id} type=${s.event_type}`);
      }
    }
  }
  process.exit(hardFailures.length > 0 ? 1 : 0);
}

main();
