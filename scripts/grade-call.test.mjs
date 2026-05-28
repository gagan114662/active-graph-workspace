import test from "node:test";
import assert from "node:assert/strict";
import { indexCalls, gradeCall } from "./grade-call.mjs";

const b64 = (s) => Buffer.from(s, "utf8").toString("base64");

test("a fully-signalled clean call scores 1.0 across all 5 axes", () => {
  const ev = [
    { id: "e1", type: "todo.created", created_at: "2026-05-28T10:00:00Z", payload: { todo_event_id: "t1", dedup_key: "k1" } },
    { id: "e2", type: "flywheel.diff.proposed", payload: { todo_event_id: "t1", diff_b64: b64("+++ b/activegraph/x.py\n+ok") } },
    { id: "e3", type: "flywheel.review.completed", payload: { todo_event_id: "t1", judge: "theo", verdict: "PASS" } },
    { id: "e4", type: "flywheel.review.completed", payload: { todo_event_id: "t1", judge: "grace", verdict: "OPEN" } },
    { id: "e5", type: "safety.allowed", payload: { todo_event_id: "t1" } },
    { id: "e6", type: "flywheel.commit.landed", payload: { todo_event_id: "t1" } },
    { id: "e7", type: "todo.completed", created_at: "2026-05-28T10:05:00Z", payload: { todo_event_id: "t1", dedup_key: "k1" } },
  ];
  const g = gradeCall(indexCalls(ev).get("t1"));
  assert.equal(g.graded_axes, 5);
  assert.equal(g.score, 1);
  assert.equal(g.any_fail, false);
});

test("a harmful + rejected call fails the right axes", () => {
  const ev = [
    { id: "e1", type: "flywheel.diff.proposed", payload: { todo_event_id: "t2", diff_b64: b64("+++ b/.github/workflows/ci.yml\n+evil") } },
    { id: "e2", type: "flywheel.review.completed", payload: { todo_event_id: "t2", judge: "theo", verdict: "FAIL" } },
    { id: "e3", type: "safety.blocked", payload: { todo_event_id: "t2" } },
    { id: "e4", type: "flywheel.attempt.rejected", payload: { todo_event_id: "t2", rejection_category: "tests_failed" } },
  ];
  const g = gradeCall(indexCalls(ev).get("t2"));
  assert.equal(g.axes.followed_instructions.score, 0);   // theo FAIL
  assert.equal(g.axes.correct.score, 0);                 // rejected
  assert.equal(g.axes.preserved_trust.score, 0);         // sentinel blocked
  assert.equal(g.axes.domain_compliant.score, 0);        // touches .github/workflows
  assert.equal(g.any_fail, true);
  assert.equal(g.score, 0);
});

test("unknown is distinct from fail (no signal → null, not 0)", () => {
  const ev = [
    { id: "e1", type: "todo.created", created_at: "2026-05-28T10:00:00Z", payload: { todo_event_id: "t3", dedup_key: "k3" } },
    { id: "e2", type: "todo.completed", created_at: "2026-05-28T10:05:00Z", payload: { todo_event_id: "t3", dedup_key: "k3" } },
  ];
  const g = gradeCall(indexCalls(ev).get("t3"));
  assert.equal(g.axes.correct.score, null);              // no outcome → unknown
  assert.equal(g.axes.preserved_trust.score, null);      // no sentinel → unknown
  assert.equal(g.axes.hit_goal.score, 1);                // closed, no recurrence
  assert.equal(g.graded_axes, 1);                        // only 1 axis had a signal
});

test("hit_goal fails when the same failure recurs after close", () => {
  const ev = [
    { id: "e1", type: "todo.created", created_at: "2026-05-28T10:00:00Z", payload: { todo_event_id: "t4", dedup_key: "k4" } },
    { id: "e2", type: "todo.completed", created_at: "2026-05-28T10:05:00Z", payload: { todo_event_id: "t4", dedup_key: "k4" } },
    { id: "e3", type: "behavior.failed", created_at: "2026-05-28T11:00:00Z", payload: { todo_event_id: "t4", dedup_key: "k4" } },
  ];
  const g = gradeCall(indexCalls(ev).get("t4"));
  assert.equal(g.axes.hit_goal.score, 0);
});
