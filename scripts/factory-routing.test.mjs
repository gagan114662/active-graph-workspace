import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { decideRoute, matchPredicate, configHash } from "./factory-routing.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const REAL_CONFIG = JSON.parse(
  readFileSync(resolve(__dir, "../agent-os/factory-routing-config.json"), "utf8")
);

// A small hermetic config used by most tests so they don't depend on the live
// file evolving. Mirrors the production rule ORDER (first match wins).
const CONFIG = {
  version: 99,
  rules: [
    { name: "canary", when: { "extras.synthetic": true, "extras.canary_authorized": true }, route: { agent: "sasha", priority: "p2", canary: true } },
    { name: "synthetic_skip", when: { "extras.synthetic": true }, skip_todo: true },
    { name: "rate_limit_skip", when: { reason_equals: "llm.rate_limited" }, skip_todo: true },
    { name: "agent_fail", when: { reason_prefix: "agent." }, route: { agent: "sasha", priority: "p1" } },
    { name: "verifier_type", when: { type_equals: "verifier.check_failed" }, route: { agent: "maya", priority: "p1" } },
    { name: "crash_type", when: { type_equals: "script.crash" }, route: { agent: "maya", priority: "p1" } },
    { name: "default", when: { always: true }, route: { agent: "sasha", priority: "p2" } },
  ],
};

const ev = (type, payload = {}) => ({ id: "evt_test", type, payload });

test("decideRoute is PURE — same input yields identical output", () => {
  const e = ev("behavior.failed", { reason: "agent.satisfaction_of_search" });
  const a = decideRoute(e, CONFIG);
  const b = decideRoute(e, CONFIG);
  assert.deepEqual(a, b);
});

test("synthetic events skip (cascade-safety short circuit)", () => {
  const d = decideRoute(ev("behavior.failed", { reason: "script.crash", synthetic: true }), CONFIG);
  assert.equal(d.decision, "skip");
  assert.equal(d.matched_rule, "synthetic_skip");
});

test("authorized canary bypasses the synthetic short circuit and routes", () => {
  const d = decideRoute(ev("behavior.failed", { reason: "agent.test", synthetic: true, canary_authorized: true }), CONFIG);
  assert.equal(d.decision, "route");
  assert.equal(d.matched_rule, "canary");
  assert.equal(d.canary, true);
});

test("transient rate limit skips", () => {
  const d = decideRoute(ev("behavior.failed", { reason: "llm.rate_limited" }), CONFIG);
  assert.equal(d.decision, "skip");
});

test("agent.* failures route to sasha p1", () => {
  const d = decideRoute(ev("behavior.failed", { reason: "agent.foo" }), CONFIG);
  assert.deepEqual([d.decision, d.agent, d.priority], ["route", "sasha", "p1"]);
});

test("type=script.crash with reason=script.Error routes to maya (the flywheel-entry bug fix)", () => {
  // This is the regression that left 9 real crashes outside the flywheel: the
  // event TYPE is script.crash but the reason is the exception class.
  const d = decideRoute(ev("script.crash", { reason: "script.Error", behavior: "phoenix-todo-keeper" }), CONFIG);
  assert.deepEqual([d.decision, d.agent, d.priority], ["route", "maya", "p1"]);
  assert.equal(d.matched_rule, "crash_type");
});

test("type=verifier.check_failed routes to maya", () => {
  const d = decideRoute(ev("verifier.check_failed", { reason: "verifier.check_failed" }), CONFIG);
  assert.deepEqual([d.decision, d.agent, d.priority], ["route", "maya", "p1"]);
});

test("unrecognized failure falls to the catch-all (sasha p2)", () => {
  const d = decideRoute(ev("behavior.failed", { reason: "totally.unknown" }), CONFIG);
  assert.deepEqual([d.decision, d.agent, d.priority], ["route", "sasha", "p2"]);
});

test("every decision is stamped with config version + hash", () => {
  const d = decideRoute(ev("behavior.failed", { reason: "agent.x" }), CONFIG);
  assert.equal(d.config_version, 99);
  assert.equal(d.config_hash, configHash(CONFIG));
});

test("configHash is stable and changes when a rule changes", () => {
  const h1 = configHash(CONFIG);
  assert.equal(h1, configHash(structuredClone(CONFIG)));
  const mutated = structuredClone(CONFIG);
  mutated.rules[0].route.agent = "rowan";
  assert.notEqual(h1, configHash(mutated));
});

test("matchPredicate type_prefix matches event type", () => {
  assert.equal(matchPredicate({ type_prefix: "verifier." }, ev("verifier.satisfaction_of_search_risk")), true);
  assert.equal(matchPredicate({ type_prefix: "verifier." }, ev("behavior.failed")), false);
});

test("fallback ladder works when config has no rules (decideRoute never throws)", () => {
  const d = decideRoute(ev("script.crash", { reason: "script.Error" }), { version: null, rules: [] });
  assert.deepEqual([d.decision, d.agent], ["route", "maya"]);
  assert.ok(d.matched_rule.startsWith("fallback:"));
});

test("PRODUCTION config routes type=script.crash to maya (live config, not the hermetic one)", () => {
  const d = decideRoute(ev("script.crash", { reason: "script.ValueError" }), REAL_CONFIG);
  assert.deepEqual([d.decision, d.agent, d.priority], ["route", "maya", "p1"]);
});

test("PRODUCTION config routes type=verifier.check_failed to maya", () => {
  const d = decideRoute(ev("verifier.check_failed", { reason: "verifier.check_failed" }), REAL_CONFIG);
  assert.deepEqual([d.decision, d.agent], ["route", "maya"]);
});

test("PRODUCTION config: synthetic without canary still skips", () => {
  const d = decideRoute(ev("behavior.failed", { reason: "agent.x", synthetic: true }), REAL_CONFIG);
  assert.equal(d.decision, "skip");
});
