import test from "node:test";
import assert from "node:assert/strict";
import { diffRegressions, DEFAULT_CHECKS } from "./f1-gauntlet-scheduler.mjs";

test("diffRegressions: passing->failing is a regression", () => {
  const { regressions, recoveries } = diffRegressions({ a: true, b: true }, [{ name: "a", ok: false }, { name: "b", ok: true }]);
  assert.deepEqual(regressions, ["a"]);
  assert.deepEqual(recoveries, []);
});

test("diffRegressions: failing->passing is a recovery", () => {
  const { regressions, recoveries } = diffRegressions({ a: false }, [{ name: "a", ok: true }]);
  assert.deepEqual(regressions, []);
  assert.deepEqual(recoveries, ["a"]);
});

test("diffRegressions: a brand-new check is neither regression nor recovery", () => {
  const { regressions, recoveries } = diffRegressions({}, [{ name: "new", ok: false }]);
  assert.deepEqual(regressions, []);
  assert.deepEqual(recoveries, []);
});

test("diffRegressions: stable passing is silent", () => {
  const { regressions, recoveries } = diffRegressions({ a: true }, [{ name: "a", ok: true }]);
  assert.equal(regressions.length, 0);
  assert.equal(recoveries.length, 0);
});

test("DEFAULT_CHECKS is a non-empty list of functions", () => {
  assert.ok(DEFAULT_CHECKS.length >= 1);
  assert.ok(DEFAULT_CHECKS.every((f) => typeof f === "function"));
});
