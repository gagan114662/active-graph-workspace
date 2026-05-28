// factory-memory.mjs — F4: unified factory memory (one query surface every
// agent/operator consults before acting).
//
// The factory accumulated knowledge in silos this session: success flows (what
// worked), harvested eval cases (what failed), call grades (quality), the
// treasury (cost), the RESOLVER (where docs live), the event log. F4 unifies
// them into ONE query: "what does the factory KNOW about <target / task class>?"
// — the YC-talk "learning" substrate + the generalized SQLite-self-audit pattern
// from T6-extra-hard.
//
// Thin aggregator over already-shipped, already-tested blocks (no new data
// store — the event log + JSONL stores ARE the memory; this is the read API).
//
// Usage:
//   node scripts/factory-memory.mjs --target-file activegraph/core/graph.py
//   node scripts/factory-memory.mjs --target-symbol activegraph.core.graph.Graph.all_objects --json
//   node scripts/factory-memory.mjs --task-class agent

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { lookupSuccessFlows } from "./success-flow-capture.mjs";
import { resolveContext } from "./resolve-context.mjs";
import { costPerFeature, readCostEvents, budgetStatus } from "./factory-treasury.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const has = (n) => process.argv.includes(n);
function arg(name, fb = null) { const i = process.argv.indexOf(name); return i === -1 ? fb : process.argv[i + 1] ?? fb; }
const EVENTS_PATH = resolve(process.env.FACTORY_EVENTS_PATH || resolve(REPO, "frames/factory-events.jsonl"));
const JUDGES_DIR = resolve(REPO, "agent-os/judges");

function readJsonl(path) {
  if (!existsSync(path)) return [];
  const out = [];
  for (const l of readFileSync(path, "utf8").split(/\r?\n/)) { if (l.trim()) try { out.push(JSON.parse(l)); } catch {} }
  return out;
}

function matchesTarget(text, opts) {
  const t = String(text || "").toLowerCase();
  if (opts.targetFile && t.includes(opts.targetFile.toLowerCase())) return true;
  if (opts.targetSymbol && t.includes(opts.targetSymbol.toLowerCase())) return true;
  if (opts.targetSymbol && t.includes(opts.targetSymbol.split(".").slice(-1)[0].toLowerCase())) return true;
  return false;
}

/** The unified query: everything the factory knows about a target/task class. */
export function recall(opts = {}) {
  const events = readJsonl(EVENTS_PATH);

  // 1. What WORKED (success flows).
  const flows = lookupSuccessFlows(opts, undefined);

  // 2. What FAILED here (recent behavior.failed + harvested eval cases).
  const failures = events.filter((e) =>
    (e.type === "behavior.failed" || e.type === "flywheel.attempt.rejected") &&
    matchesTarget(JSON.stringify(e.payload || {}), opts)
  ).slice(-5).map((e) => ({ type: e.type, reason: e.payload?.reason, message: (e.payload?.message || "").slice(0, 120), at: e.created_at }));
  let evalCases = 0;
  for (const j of ["rowan", "theo", "grace"]) {
    for (const f of [`${JUDGES_DIR}/${j}/harvested-candidates.jsonl`, `${JUDGES_DIR}/${j}/ground-truth.jsonl`]) {
      for (const c of readJsonl(f)) if (matchesTarget(JSON.stringify(c.input || {}), opts)) evalCases++;
    }
  }

  // 3. Call grades touching this target (call.graded events).
  const grades = events.filter((e) => e.type === "call.graded").map((e) => e.payload)
    .filter((p) => p && p.score != null).slice(-5)
    .map((p) => ({ todo: p.todo_event_id, score: p.score, passed_axes: p.passed_axes, any_fail: p.any_fail }));

  // 4. Where the docs live (RESOLVER routing).
  const routed = opts.targetFile ? resolveContext(opts.targetFile) : { matched: false, docs: [] };

  // 5. Cost context (treasury).
  const treasury = { cost_per_feature: costPerFeature(EVENTS_PATH).cost_per_feature,
    budget: budgetStatus(readCostEvents(EVENTS_PATH)) };

  return {
    query: { target_file: opts.targetFile || null, target_symbol: opts.targetSymbol || null, task_class: opts.taskClass || null },
    what_worked: flows.map((f) => ({ sha: f.sha, task_class: f.task_class, approach: f.approach, files: f.target_files })),
    what_failed: failures,
    eval_cases_for_target: evalCases,
    recent_call_grades: grades,
    where_docs_live: routed.matched ? routed.docs : [],
    economics: { cost_per_feature: treasury.cost_per_feature, day_spend: treasury.budget.day.spent, day_cap: treasury.budget.day.cap, over_cap: treasury.budget.day.over },
    summary: `${flows.length} proven flow(s), ${failures.length} recent failure(s), ${evalCases} eval case(s), ${grades.length} graded call(s) for this target.`,
  };
}

// CLI
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const opts = { targetFile: arg("--target-file"), targetSymbol: arg("--target-symbol"), taskClass: arg("--task-class"), limit: 3 };
  if (!opts.targetFile && !opts.targetSymbol && !opts.taskClass) {
    console.error("usage: node scripts/factory-memory.mjs --target-file <f> | --target-symbol <s> | --task-class <c> [--json]");
    process.exit(2);
  }
  const r = recall(opts);
  if (has("--json")) console.log(JSON.stringify(r, null, 2));
  else {
    console.log(`FACTORY MEMORY — ${r.summary}`);
    console.log("\nWHAT WORKED (proven flows):");
    r.what_worked.length ? r.what_worked.forEach((f) => console.log(`  [${f.task_class}] ${f.sha}: ${f.approach?.slice(0, 100)}`)) : console.log("  (none yet)");
    console.log("\nWHAT FAILED (recent):");
    r.what_failed.length ? r.what_failed.forEach((f) => console.log(`  ${f.reason}: ${f.message}`)) : console.log("  (none)");
    console.log(`\nEVAL CASES for target: ${r.eval_cases_for_target}`);
    console.log("RECENT CALL GRADES:", r.recent_call_grades.map((g) => g.score).join(", ") || "(none)");
    console.log("WHERE DOCS LIVE:", r.where_docs_live.join(", ") || "(no resolver match)");
    console.log(`ECONOMICS: cost/feature=${r.economics.cost_per_feature ?? "n/a"}, day=$${r.economics.day_spend}/$${r.economics.day_cap}${r.economics.over_cap ? " ⚠OVER" : ""}`);
  }
}
