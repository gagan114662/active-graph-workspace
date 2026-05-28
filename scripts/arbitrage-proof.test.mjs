import test from "node:test";
import assert from "node:assert/strict";
import { arbitrageProof } from "./arbitrage-proof.mjs";

// units overridden so the ratio is deterministic regardless of repo state.
test("ratio = sell_price / (total_cost / units)", () => {
  const r = arbitrageProof({ unit: "test", sellPrice: 5, unitsOverride: 50 });
  assert.equal(r.units_shipped, 50);
  const expected = 5 / (r.total_cost_usd / 50);
  assert.ok(Math.abs(r.arbitrage_ratio - expected) < 0.01);
});

test("positive verdict when sell price exceeds cost-per-unit", () => {
  // huge unit count → tiny cost-per-unit → ratio >> 1 → positive
  const r = arbitrageProof({ unit: "test", sellPrice: 100, unitsOverride: 100000 });
  assert.equal(r.positive, true);
  assert.match(r.verdict, /POSITIVE/);
});

test("negative verdict when cost-per-unit exceeds sell price", () => {
  // 1 unit → cost-per-unit = total cost (large) → ratio < 1 (sell $0.01) → negative
  const r = arbitrageProof({ unit: "test", sellPrice: 0.01, unitsOverride: 1 });
  assert.equal(r.positive, false);
  assert.match(r.verdict, /NEGATIVE/);
});

test("insufficient-data verdict when nothing shipped", () => {
  const r = arbitrageProof({ unit: "test", sellPrice: 5, unitsOverride: 0 });
  assert.equal(r.arbitrage_ratio, null);
  assert.match(r.verdict, /INSUFFICIENT/);
});
