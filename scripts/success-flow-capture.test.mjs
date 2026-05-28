import test from "node:test";
import assert from "node:assert/strict";
import { captureFlows, lookupSuccessFlows } from "./success-flow-capture.mjs";

const b64 = (s) => Buffer.from(s, "utf8").toString("base64");

const EV = [
  { id: "e1", type: "todo.created", payload: { todo_event_id: "t1", failure_reason: "agent.missing_docstring" } },
  { id: "e2", type: "flywheel.diff.proposed", payload: { todo_event_id: "t1", diff_b64: b64("--- a\n+++ b/activegraph/llm/recorded.py\n+docstring"), rationale: "add docstring to complete()" } },
  { id: "e3", type: "llm.responded", payload: { todo_event_id: "t1", cost_usd: "0.32" } },
  { id: "e4", type: "flywheel.commit.landed", created_at: "2026-05-28T10:00:00Z", payload: { todo_event_id: "t1", sha: "abc123def456", branch: "flywheel-fixes-x" } },
];

test("captureFlows derives a flow from a landed commit + its diff + cost", () => {
  const flows = captureFlows(EV);
  assert.equal(flows.length, 1);
  const f = flows[0];
  assert.equal(f.task_class, "agent");
  assert.deepEqual(f.target_files, ["activegraph/llm/recorded.py"]);
  assert.equal(f.sha, "abc123def456");
  assert.equal(f.cost_usd, 0.32);
  assert.ok(f.approach.includes("docstring"));
});

test("synthetic landed commits are skipped", () => {
  const flows = captureFlows([{ id: "s", type: "flywheel.commit.landed", payload: { todo_event_id: "t9", synthetic: true, sha: "z" } }]);
  assert.equal(flows.length, 0);
});

test("lookupSuccessFlows matches on target file", () => {
  const store = captureFlows(EV);
  const hits = lookupSuccessFlows({ targetFile: "activegraph/llm/recorded.py" }, store);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].sha, "abc123def456");
});

test("lookupSuccessFlows matches on task class and returns nothing for an unrelated target", () => {
  const store = captureFlows(EV);
  assert.equal(lookupSuccessFlows({ taskClass: "agent" }, store).length, 1);
  assert.equal(lookupSuccessFlows({ targetFile: "totally/unrelated.py" }, store).length, 0);
});
