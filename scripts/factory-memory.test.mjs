import test from "node:test";
import assert from "node:assert/strict";
import { recall } from "./factory-memory.mjs";

// Integration-flavored: recall() aggregates real repo state, so assert
// STRUCTURAL invariants (shape + types), not churning values.
test("recall returns the unified memory shape for a target", () => {
  const r = recall({ targetFile: "scripts/pentagon-trigger-bridge.mjs", limit: 3 });
  for (const k of ["query", "what_worked", "what_failed", "eval_cases_for_target", "recent_call_grades", "where_docs_live", "economics", "summary"]) {
    assert.ok(k in r, `missing key ${k}`);
  }
  assert.ok(Array.isArray(r.what_worked));
  assert.ok(Array.isArray(r.what_failed));
  assert.ok(Array.isArray(r.where_docs_live));
  assert.equal(typeof r.summary, "string");
});

test("recall routes a known file to its resolver docs (where info lives)", () => {
  const r = recall({ targetFile: "scripts/pentagon-trigger-bridge.mjs" });
  // The RESOLVER maps the bridge to the cascade/defects context.
  assert.ok(r.where_docs_live.some((d) => /cascade|defect/i.test(d)));
});

test("recall does not throw on an unmapped target", () => {
  const r = recall({ targetFile: "totally/unmapped/path.xyz" });
  assert.equal(r.where_docs_live.length, 0);
  assert.equal(typeof r.summary, "string");
});
