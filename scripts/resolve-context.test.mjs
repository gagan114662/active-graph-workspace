import test from "node:test";
import assert from "node:assert/strict";
import { resolveContext, loadResolverRules } from "./resolve-context.mjs";

test("RESOLVER.md parses into rules", () => {
  const rules = loadResolverRules();
  assert.ok(rules.length >= 8, `expected >=8 rules, got ${rules.length}`);
  for (const r of rules) {
    assert.ok(r.globs.length >= 1);
    assert.ok(r.docs.length >= 1);
  }
});

test("routing config edit resolves to the determinism docs", () => {
  const r = resolveContext("scripts/factory-routing.mjs");
  assert.equal(r.matched, true);
  assert.ok(r.docs.some((d) => d.includes("deterministic-routing-shared-module")));
});

test("rubric edit resolves to the eval suite (the canonical talk example)", () => {
  const r = resolveContext("agent-os/rubrics/rowan-code-review.yaml");
  assert.equal(r.matched, true);
  assert.ok(r.docs.some((d) => d.includes("skillopt-adoption")));
});

test("bridge edit resolves to the cascade/defects context", () => {
  const r = resolveContext("scripts/pentagon-trigger-bridge.mjs");
  assert.equal(r.matched, true);
  assert.ok(r.docs.some((d) => d.includes("cascade") || d.toLowerCase().includes("defect")));
});

test("inner-package edit (** glob) resolves to inner CLAUDE.md", () => {
  const r = resolveContext("activegraph/activegraph/core/graph.py");
  assert.equal(r.matched, true);
  assert.ok(r.docs.some((d) => d.includes("activegraph/CLAUDE.md")));
});

test("absolute repo path is normalized to repo-relative and matches", () => {
  const r = resolveContext("/Users/gaganarora/Desktop/my projects/active_graph/scripts/safety-monitor.mjs");
  assert.equal(r.matched, true);
  assert.ok(r.docs.some((d) => d.includes("safety-monitor")));
});

test("unmatched path returns matched=false (→ inbox/)", () => {
  const r = resolveContext("some/random/unmapped/thing.txt");
  assert.equal(r.matched, false);
  assert.deepEqual(r.docs, []);
});
