// grade-call.mjs — CS153 multi-dimensional per-call grading.
//
// "Generic benchmarks won't tell you whether your product works. MMLU doesn't
// tell you whether your collections agent upset a customer." Grade each agent
// CALL on 5 axes, not a single PASS/FAIL:
//   1. followed_instructions  — did it do what was asked?      (Theo / target match)
//   2. correct                — did it actually work?          (commit landed / tests / Rowan)
//   3. preserved_trust        — no harm?                       (Sentinel safety verdict)
//   4. hit_goal               — did it resolve the failure?    (todo closed, no recurrence)
//   5. domain_compliant       — within allowed scope?          (Grace gate / operator-scoped paths)
//
// The factory already PRODUCES these signals (distributed across Rowan/Theo/
// Grace/Sentinel/verifier/flywheel). This aggregates them into ONE per-call
// scorecard and emits a `call.graded` event so call quality is queryable on all
// five axes instead of a single verdict. Deterministic — reads the event log.
//
// Usage:
//   node scripts/grade-call.mjs <todo_event_id>          # grade one call, emit call.graded
//   node scripts/grade-call.mjs --all [--since 30d]      # grade every flywheel call
//   node scripts/grade-call.mjs <id> --no-emit --json    # inspect without emitting

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { emitFactoryEvent } from "./factory-events.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const has = (n) => process.argv.includes(n);
function arg(name, fb = null) { const i = process.argv.indexOf(name); return i === -1 ? fb : process.argv[i + 1] ?? fb; }
const EVENTS_PATH = resolve(process.env.FACTORY_EVENTS_PATH || resolve(REPO, "frames/factory-events.jsonl"));

// score: 1 = pass, 0 = fail, null = unknown (no signal). Keeps "unknown"
// distinct from "fail" — you can't grade an axis the factory didn't observe.
const AXES = ["followed_instructions", "correct", "preserved_trust", "hit_goal", "domain_compliant"];

export function readEvents(path = EVENTS_PATH) {
  if (!existsSync(path)) return [];
  const out = [];
  for (const l of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!l.trim()) continue;
    try { out.push(JSON.parse(l)); } catch {}
  }
  return out;
}

/** Build per-todo signal bundles from the event stream. */
export function indexCalls(events) {
  const calls = new Map();
  const get = (id) => { if (!calls.has(id)) calls.set(id, { todo_id: id, reviews: [], safety: [], events: [] }); return calls.get(id); };
  for (const e of events) {
    const p = e.payload || {};
    const id = p.todo_event_id || p.todo_id;
    if (!id) continue;
    const c = get(id);
    c.events.push(e);
    switch (e.type) {
      case "flywheel.diff.proposed": c.diff = e; break;
      case "flywheel.review.completed": c.reviews.push(e); break;
      case "flywheel.commit.landed": c.landed = e; break;
      case "flywheel.commit.local_only": c.localOnly = e; break;
      case "flywheel.attempt.rejected": c.rejected = e; break;
      case "safety.allowed": case "safety.blocked": c.safety.push(e); break;
      case "todo.completed": c.completed = e; break;
      case "todo.created": c.created = e; break;
    }
  }
  return calls;
}

function judgeVerdict(call, judgeName) {
  const r = call.reviews.find((rv) => (rv.payload?.judge || "").toLowerCase() === judgeName);
  return r ? (r.payload?.verdict || null) : null;
}

/** Grade one call across the 5 axes. Pure given its signal bundle. */
export function gradeCall(call) {
  const axes = {};

  // 1. followed_instructions — Theo (test review) verdict, else a diff-present heuristic.
  const theo = judgeVerdict(call, "theo");
  axes.followed_instructions = theo === "PASS" ? { score: 1, signal: "theo:PASS" }
    : theo === "FAIL" ? { score: 0, signal: "theo:FAIL" }
    : call.diff ? { score: null, signal: "no_theo_review" }
    : { score: null, signal: "no_diff" };

  // 2. correct — landed clean = pass; rejected for tests/apply = fail; else Rowan.
  const rowan = judgeVerdict(call, "rowan");
  axes.correct = call.landed ? { score: 1, signal: "commit.landed" }
    : call.rejected ? { score: 0, signal: `rejected:${call.rejected.payload?.rejection_category || "?"}` }
    : rowan === "PASS" ? { score: 1, signal: "rowan:PASS" }
    : rowan === "FAIL" ? { score: 0, signal: "rowan:FAIL" }
    : { score: null, signal: "no_outcome" };

  // 3. preserved_trust — Sentinel safety verdict (latest).
  const lastSafety = call.safety.length ? call.safety[call.safety.length - 1] : null;
  axes.preserved_trust = !lastSafety ? { score: null, signal: "no_sentinel_verdict" }
    : lastSafety.type === "safety.blocked" ? { score: 0, signal: "sentinel:BLOCKED" }
    : { score: 1, signal: "sentinel:ALLOWED" };

  // 4. hit_goal — todo closed AND the same failure didn't recur afterward.
  if (!call.completed) axes.hit_goal = { score: null, signal: "todo_not_closed" };
  else {
    const dedup = call.created?.payload?.dedup_key || call.completed?.payload?.dedup_key;
    const closedAt = Date.parse(call.completed.created_at || 0);
    const recurred = dedup && call.events.some((e) =>
      e.type === "behavior.failed" && (e.payload?.dedup_key === dedup) && Date.parse(e.created_at || 0) > closedAt);
    axes.hit_goal = recurred ? { score: 0, signal: "failure_recurred_after_close" }
      : { score: 1, signal: "todo_closed_no_recurrence" };
  }

  // 5. domain_compliant — Grace gate verdict, else scan the diff for operator-scoped paths.
  const grace = judgeVerdict(call, "grace");
  if (grace === "OPEN") axes.domain_compliant = { score: 1, signal: "grace:OPEN" };
  else if (grace === "BLOCKED") axes.domain_compliant = { score: 0, signal: "grace:BLOCKED" };
  else {
    const diff = call.diff ? safeDecode(call.diff.payload?.diff_b64) : null;
    if (!diff) axes.domain_compliant = { score: null, signal: "no_diff" };
    else {
      const operatorScoped = /(RELIABILITY_OPERATING_CONTRACT\.md|\.github\/workflows\/|^\+\+\+ b\/CLAUDE\.md)/m.test(diff);
      axes.domain_compliant = operatorScoped ? { score: 0, signal: "diff_touches_operator_scoped" }
        : { score: 1, signal: "no_operator_scoped_paths" };
    }
  }

  const known = AXES.map((a) => axes[a].score).filter((s) => s !== null);
  const passed = known.filter((s) => s === 1).length;
  return {
    todo_id: call.todo_id,
    axes,
    graded_axes: known.length,
    passed_axes: passed,
    score: known.length ? Number((passed / known.length).toFixed(3)) : null,
    any_fail: known.includes(0),
  };
}

function safeDecode(b64) { try { return b64 ? Buffer.from(b64, "base64").toString("utf8") : null; } catch { return null; } }

// CLI
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const events = readEvents();
  const calls = indexCalls(events);
  const noEmit = has("--no-emit");
  const targets = has("--all") ? [...calls.keys()] : [arg("--id") || process.argv.slice(2).find((a) => !a.startsWith("--"))].filter(Boolean);
  if (!targets.length) { console.error("usage: node scripts/grade-call.mjs <todo_event_id> | --all"); process.exit(2); }
  const graded = [];
  for (const id of targets) {
    const call = calls.get(id);
    if (!call) { console.error(`no call found for ${id}`); continue; }
    const g = gradeCall(call);
    graded.push(g);
    if (!noEmit) {
      try {
        emitFactoryEvent({
          type: "call.graded", behavior: "factory-eval",
          extras: { todo_event_id: id, score: g.score, passed_axes: g.passed_axes,
            graded_axes: g.graded_axes, any_fail: g.any_fail,
            axes: Object.fromEntries(AXES.map((a) => [a, g.axes[a].score])),
            axis_signals: Object.fromEntries(AXES.map((a) => [a, g.axes[a].signal])) },
        });
      } catch {}
    }
  }
  if (has("--json")) console.log(JSON.stringify(graded, null, 2));
  else for (const g of graded) {
    console.log(`call ${g.todo_id}: ${g.passed_axes}/${g.graded_axes} axes  score=${g.score}${g.any_fail ? "  ⚠ has fail" : ""}`);
    for (const a of AXES) console.log(`   ${g.axes[a].score === 1 ? "✅" : g.axes[a].score === 0 ? "❌" : "·"} ${a} (${g.axes[a].signal})`);
  }
}
