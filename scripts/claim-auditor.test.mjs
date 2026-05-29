import { test } from "node:test";
import assert from "node:assert/strict";
import { auditMergeClaim, classifyAudit } from "./claim-auditor.mjs";

const ghMerged = () => ({ state: "MERGED", mergedAt: "2026-05-29T14:07:10Z" });
const ghOpen = () => ({ state: "OPEN", mergedAt: null });
const ghNone = () => null;

test("real merge: GitHub MERGED + sha on main => real", () => {
  const r = auditMergeClaim({ todo_event_id: "t1", pr_url: "https://x/pull/1", sha: "abc" }, ghMerged, () => true);
  assert.equal(r.real, true);
  assert.equal(r.verdict, "real");
});

test("FALSE VICTORY: claimed merged but PR is still OPEN", () => {
  const r = auditMergeClaim({ todo_event_id: "t2", pr_url: "https://x/pull/2", sha: "abc" }, ghOpen, () => false);
  assert.equal(r.real, false);
  assert.equal(r.verdict, "claimed_not_merged");
});

test("FALSE VICTORY: no PR exists for the claim", () => {
  const r = auditMergeClaim({ todo_event_id: "t3", pr_url: "https://x/pull/3", sha: "abc" }, ghNone, () => false);
  assert.equal(r.real, false);
  assert.equal(r.verdict, "claimed_not_merged");
});

test("FALSE VICTORY: GitHub says MERGED but the sha is NOT on main", () => {
  const r = auditMergeClaim({ todo_event_id: "t4", pr_url: "https://x/pull/4", sha: "ghost" }, ghMerged, () => false);
  assert.equal(r.real, false);
  assert.equal(r.verdict, "merged_but_sha_absent");
});

test("merge claim with no sha: trusts PR MERGED state", () => {
  const r = auditMergeClaim({ todo_event_id: "t5", pr_url: "https://x/pull/5" }, ghMerged, () => false);
  assert.equal(r.real, true);
});

test("classifyAudit summarizes false victories", () => {
  const results = [
    auditMergeClaim({ todo_event_id: "a", pr_url: "/pull/1", sha: "x" }, ghMerged, () => true),  // real
    auditMergeClaim({ todo_event_id: "b", pr_url: "/pull/2", sha: "x" }, ghOpen, () => false),    // false
    auditMergeClaim({ todo_event_id: "c", pr_url: "/pull/3", sha: "x" }, ghNone, () => false),    // false
  ];
  const s = classifyAudit(results);
  assert.equal(s.total, 3);
  assert.equal(s.real, 1);
  assert.equal(s.false_victories, 2);
  assert.deepEqual(s.offenders.map((o) => o.todo).sort(), ["b", "c"]);
});
