import test from "node:test";
import assert from "node:assert/strict";
import { formatEventForSlack, selectNotable } from "./factory-slack.mjs";

test("regression event renders with red marker", () => {
  const m = formatEventForSlack({ type: "gauntlet.regression", payload: { check: "node_test_suite" } });
  assert.ok(m); assert.match(m.text, /🔴/); assert.match(m.text, /node_test_suite/);
  assert.equal(m.approval, undefined); // regressions aren't approval-gated
});

test("safety.blocked renders with stop marker", () => {
  const m = formatEventForSlack({ type: "safety.blocked", payload: { reason: "rm -rf" } });
  assert.ok(m); assert.match(m.text, /🛑/); assert.match(m.text, /rm -rf/);
});

test("review FAIL gets ❌, PASS gets ✅", () => {
  const fail = formatEventForSlack({ type: "flywheel.review.completed", payload: { judge: "rowan", verdict: "FAIL", todo_event_id: "t123" } });
  const pass = formatEventForSlack({ type: "flywheel.review.completed", payload: { judge: "rowan", verdict: "PASS", todo_event_id: "t123" } });
  assert.match(fail.text, /❌/); assert.match(pass.text, /✅/);
});

test("approval-gated events carry an approval hint", () => {
  const m = formatEventForSlack({ type: "todo.dispatched", id: "evt_9", payload: { target_agent: "maya", dedup_key: "k1", title: "fix x" } });
  assert.ok(m.approval); assert.equal(m.approval.event_id, "evt_9"); assert.equal(m.approval.dedup_key, "k1");
});

test("non-notable events return null", () => {
  assert.equal(formatEventForSlack({ type: "daemon.heartbeat", payload: {} }), null);
  assert.equal(formatEventForSlack({ type: "llm.responded", payload: {} }), null);
  assert.equal(formatEventForSlack(null), null);
});

test("selectNotable filters a mixed stream", () => {
  const events = [
    { type: "daemon.heartbeat" },
    { type: "gauntlet.regression", payload: { check: "x" } },
    { type: "llm.responded" },
    { type: "safety.blocked", payload: { reason: "secret" } },
  ];
  const picked = selectNotable(events);
  assert.equal(picked.length, 2);
});
