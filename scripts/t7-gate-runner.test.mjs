import { test } from "node:test";
import assert from "node:assert/strict";
import { TIERS, ledgerPassCount, nextTier } from "./t7-gate-runner.mjs";

test("TIERS ladder is medium->hard->extra-hard with correct gates", () => {
  assert.deepEqual(TIERS.map((t) => t.name), ["medium", "hard", "extra-hard"]);
  assert.deepEqual(TIERS.map((t) => t.gate), [22, 19, 18]);
  assert.ok(TIERS.every((t) => t.target === 25));
});

test("nextTier: returns first enabled tier not at gate", () => {
  const enabled = new Set(["medium", "hard"]);
  const gateMet = (t) => t.name === "medium"; // medium done, hard not
  assert.equal(nextTier(TIERS, enabled, gateMet).name, "hard");
});

test("nextTier: skips disabled tiers entirely", () => {
  const enabled = new Set(["medium"]); // hard/extra-hard disabled
  const gateMet = (t) => t.name === "medium";
  assert.equal(nextTier(TIERS, enabled, gateMet), null); // medium done, others disabled
});

test("nextTier: null when all enabled tiers at gate", () => {
  const enabled = new Set(["medium", "hard", "extra-hard"]);
  assert.equal(nextTier(TIERS, enabled, () => true), null);
});

test("nextTier: respects ladder order (hard before extra-hard)", () => {
  const enabled = new Set(["medium", "hard", "extra-hard"]);
  const gateMet = (t) => t.name === "medium"; // only medium done
  assert.equal(nextTier(TIERS, enabled, gateMet).name, "hard");
});

test("ledgerPassCount: counts uniform passes, dedupes run_idx keeping latest", () => {
  const fakeLedger = [
    JSON.stringify({ run_idx: 1, proof_file: "p1" }),
    JSON.stringify({ run_idx: 2, proof_file: "p2" }),
    JSON.stringify({ run_idx: 2, proof_file: "p2b" }), // retry of idx 2 -> latest wins
    JSON.stringify({ run_idx: 3, proof_file: "p3" }),
  ].join("\n");
  const exists = () => true;
  const readFile = () => fakeLedger;
  // p2b (latest idx-2) fails regrade; p1, p3 pass
  const regrade = (pp) => pp === "p1" || pp === "p3";
  assert.equal(ledgerPassCount("x", regrade, readFile, exists), 2);
});

test("ledgerPassCount: 0 for missing ledger", () => {
  assert.equal(ledgerPassCount("nope", () => true, () => "", () => false), 0);
});

test("ledgerPassCount: tolerates malformed lines", () => {
  const ledger = ['{"run_idx":1,"proof_file":"p1"}', "not json", ""].join("\n");
  assert.equal(ledgerPassCount("x", () => true, () => ledger, () => true), 1);
});
