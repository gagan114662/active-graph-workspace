import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeFriction } from "./friction-analyzer.mjs";

const ev = (type, payload = {}) => ({ type, payload });

test("smooth run = no friction, score 0", () => {
  const r = analyzeFriction([
    ev("llm.requested", {}),
    ev("behavior.completed", { reason: "eval.pass" }),
  ]);
  assert.equal(r.frictions.length, 0);
  assert.equal(r.score, 0);
});

test("verifier rejection -> repo-actionable friction", () => {
  const r = analyzeFriction([
    ev("infrastructure.verifier_rejected_proof", { reason: "infrastructure.verifier_rejected_proof", verifier_summary: "summary: 15/16 checks passed" }),
  ]);
  const f = r.frictions.find((x) => x.type === "verifier_rejection");
  assert.ok(f, "should detect verifier_rejection");
  assert.equal(f.repo_actionable, true);
  assert.match(f.proposal, /explicit|contract|format/i);
});

test("two rejections -> high severity", () => {
  const r = analyzeFriction([
    ev("infrastructure.verifier_rejected_proof", { verifier_summary: "9/16" }),
    ev("infrastructure.verifier_rejected_proof", { verifier_summary: "15/16" }),
  ]);
  assert.equal(r.frictions.find((x) => x.type === "verifier_rejection").severity, "high");
});

test("timeout -> repo-actionable (split task / bump timeout)", () => {
  const r = analyzeFriction([
    ev("behavior.failed", { reason: "llm.network_error", message: "claude CLI timed out after 540.0s" }),
  ]);
  const f = r.frictions.find((x) => x.type === "timeout");
  assert.ok(f);
  assert.equal(f.repo_actionable, true);
});

test("ghost/proof-missing -> infra friction (not repo-actionable)", () => {
  const r = analyzeFriction([
    ev("infrastructure.proof_missing", { message: "ghost_completion" }),
  ]);
  const f = r.frictions.find((x) => x.type === "infra_ghost");
  assert.ok(f);
  assert.equal(f.repo_actionable, false);
});

test("rate limit -> low severity, not repo-actionable", () => {
  const r = analyzeFriction([ev("behavior.failed", { reason: "llm.rate_limited", message: "session limit" })]);
  const f = r.frictions.find((x) => x.type === "rate_limit");
  assert.ok(f);
  assert.equal(f.severity, "low");
});

test("many attempts (>=3 dispatches) -> friction", () => {
  const r = analyzeFriction([ev("llm.requested"), ev("llm.requested"), ev("llm.requested")]);
  assert.ok(r.frictions.find((x) => x.type === "many_attempts"));
  assert.equal(r.dispatches, 3);
});

test("score is weighted sum (high=3, med=2, low=1)", () => {
  const r = analyzeFriction([
    ev("infrastructure.verifier_rejected_proof", { verifier_summary: "a" }),  // medium (single) = 2
    ev("behavior.failed", { reason: "llm.rate_limited", message: "session limit" }), // low = 1
  ]);
  assert.equal(r.score, 3);
});
