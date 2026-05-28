// eval-harvest-from-failures.mjs — CS153 production-eval-loop step 2:
// "convert failures to eval cases."
//
// Scans the factory event log and turns real production signals into candidate
// judge eval cases (ground truth derived from OUTCOMES, not hand-labeling):
//
//   1. flywheel.review.completed (a judge verdict on a diff) cross-referenced
//      with judge.error → if the verdict was later proven wrong, the correct
//      label is the FLIPPED verdict; otherwise the recorded verdict stands.
//   2. flywheel.attempt.rejected (a diff the action layer rejected for a REAL
//      reason — apply_failed / tests_failed / commit_failed, not synthetic) →
//      a known-bad diff a code-review judge SHOULD fail. Labeled FAIL.
//
// Output is written to a STAGING file per judge (not straight into ground
// truth) — "founders build the evals": the operator reviews + promotes via
// scripts/grade-judge-example.mjs. This is the inbox/ disambiguation pattern:
// auto-derived labels are candidates, not truth, until a human confirms.
//
// Deterministic, zero model cost. Run on cadence (or after each flywheel cycle).
//
// Usage:
//   node scripts/eval-harvest-from-failures.mjs                 # harvest → staging
//   node scripts/eval-harvest-from-failures.mjs --json          # machine output
//   node scripts/eval-harvest-from-failures.mjs --events <path> # custom log

import { readFileSync, existsSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function arg(name, fb = null) { const i = process.argv.indexOf(name); return i === -1 ? fb : process.argv[i + 1] ?? fb; }
const has = (n) => process.argv.includes(n);
const EVENTS_PATH = resolve(arg("--events", process.env.FACTORY_EVENTS_PATH || resolve(REPO, "frames/factory-events.jsonl")));
const JUDGES_DIR = resolve(REPO, "agent-os/judges");

function readEvents(path) {
  if (!existsSync(path)) return [];
  const out = [];
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch {}
  }
  return out;
}

const isSynthetic = (e) => e?.payload?.synthetic === true;
const caseId = (judge, input) =>
  `${judge}-harvested-${createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 10)}`;

export function harvestCandidates(events) {
  const byTodo = { diff: new Map(), review: new Map() };
  const judgeErrorsByVerdict = new Map();
  const rejects = [];
  for (const e of events) {
    if (isSynthetic(e)) continue;
    const p = e.payload || {};
    if (e.type === "flywheel.diff.proposed" && p.todo_event_id) byTodo.diff.set(p.todo_event_id, e);
    else if (e.type === "flywheel.review.completed" && p.todo_event_id) byTodo.review.set(p.todo_event_id, e);
    else if (e.type === "judge.error" && p.original_verdict_event_id) judgeErrorsByVerdict.set(p.original_verdict_event_id, e);
    else if (e.type === "flywheel.attempt.rejected") rejects.push(e);
  }

  const candidates = [];

  // Source 1: judge verdicts, labeled by whether they were later proven wrong.
  for (const [todoId, review] of byTodo.review) {
    const rp = review.payload || {};
    const judge = (rp.judge || rp.reviewer_agent_key || "rowan").toLowerCase();
    const recorded = rp.verdict;
    if (!recorded) continue;
    const diffEv = byTodo.diff.get(todoId);
    const diff = diffEv ? safeDecode(diffEv.payload?.diff_b64) : null;
    if (!diff) continue;
    const je = judgeErrorsByVerdict.get(review.id);
    // If a judge.error proved the verdict wrong → correct label is the flip.
    const wrong = je && /false_pass|false_fail/.test(String(je.payload?.error_kind || ""));
    const expected = wrong ? flip(recorded) : recorded;
    const input = { diff, rationale: diffEv.payload?.rationale || null };
    candidates.push({
      id: caseId(judge, input), judge, input, expected_verdict: expected,
      derived_from: wrong ? `judge.error(${je.payload?.error_kind})` : "verdict_stood_no_error",
      confidence: wrong ? "high" : "low", evidence_event_id: review.id, needs_review: true,
    });
  }

  // Source 2: real (non-synthetic) rejected diffs = known-bad → a FAIL case for
  // a code-review judge (Rowan). The action layer already proved it's bad.
  for (const rj of rejects) {
    const p = rj.payload || {};
    const cat = p.rejection_category || p.reason?.replace(/^flywheel\./, "") || "other";
    if (["empty_diff", "other"].includes(cat)) continue;  // not gradeable signal
    const diffEv = byTodo.diff.get(p.todo_event_id);
    const diff = diffEv ? safeDecode(diffEv.payload?.diff_b64) : null;
    if (!diff) continue;
    // Skeptic-review (P6) found the harvested candidates were all synthetic test
    // fixtures or degenerate. Close the filter gap: skip diffs that are obviously
    // synthetic test scaffolding (the `flywheel-test-<ts>` marker) or non-diffs.
    if (isSyntheticOrDegenerateDiff(diff)) continue;
    const input = { diff, rationale: diffEv.payload?.rationale || null, rejection_category: cat };
    candidates.push({
      id: caseId("rowan", input), judge: "rowan", input, expected_verdict: "FAIL",
      derived_from: `attempt_rejected(${cat})`, confidence: "high",
      evidence_event_id: rj.id, needs_review: true,
    });
  }
  return candidates;
}

// A diff is synthetic test scaffolding or degenerate if it carries the flywheel
// test marker, only touches the version line of __init__.py with a test comment,
// or isn't a real unified diff. Such rows must NOT become judge ground truth.
export function isSyntheticOrDegenerateDiff(diff) {
  const d = String(diff || "");
  if (!/^(?:---|\+\+\+|diff --git)/m.test(d)) return true;        // not a real diff
  if (/flywheel/i.test(d) && /\btest\b|marker|canonical/i.test(d)) return true; // flywheel test scaffolding
  // No-op synthetic: every ADDED line is blank or a comment (a real fix adds code,
  // not just a comment appended to __init__.py).
  const added = d.split(/\r?\n/).filter((l) => l.startsWith("+") && !l.startsWith("+++"));
  if (added.length && added.every((l) => { const t = l.slice(1).trim(); return t === "" || t.startsWith("#"); })) return true;
  return false;
}

function flip(v) {
  const m = { PASS: "FAIL", FAIL: "PASS", OPEN: "BLOCKED", BLOCKED: "OPEN" };
  return m[v] || v;
}
function safeDecode(b64) { try { return b64 ? Buffer.from(b64, "base64").toString("utf8") : null; } catch { return null; } }

function loadExistingIds(judge) {
  const ids = new Set();
  for (const f of [`${JUDGES_DIR}/${judge}/ground-truth.jsonl`, `${JUDGES_DIR}/${judge}/harvested-candidates.jsonl`]) {
    if (!existsSync(f)) continue;
    for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      try { ids.add(JSON.parse(line).id); } catch {}
    }
  }
  return ids;
}

function writeStaging(candidates) {
  const byJudge = {};
  for (const c of candidates) (byJudge[c.judge] ||= []).push(c);
  const summary = {};
  for (const [judge, cands] of Object.entries(byJudge)) {
    const existing = loadExistingIds(judge);
    const fresh = cands.filter((c) => !existing.has(c.id));
    const dir = `${JUDGES_DIR}/${judge}`;
    mkdirSync(dir, { recursive: true });
    const file = `${dir}/harvested-candidates.jsonl`;
    for (const c of fresh) appendFileSync(file, JSON.stringify(c) + "\n");
    summary[judge] = { found: cands.length, new: fresh.length, file };
  }
  return summary;
}

// CLI
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const events = readEvents(EVENTS_PATH);
  const candidates = harvestCandidates(events);
  const summary = writeStaging(candidates);
  const out = { events_scanned: events.length, candidates: candidates.length, by_judge: summary,
    next: "Operator reviews agent-os/judges/<judge>/harvested-candidates.jsonl, then promotes good ones into ground-truth.jsonl (founders build the evals)." };
  console.log(has("--json") ? JSON.stringify(out, null, 2) :
    `harvested ${candidates.length} candidate eval case(s) from ${events.length} events\n` +
    Object.entries(summary).map(([j, s]) => `  ${j}: ${s.new} new / ${s.found} found → ${s.file}`).join("\n") +
    `\n→ review + promote into ground-truth (founders build the evals)`);
}
