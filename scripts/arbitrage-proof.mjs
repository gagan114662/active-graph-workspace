// arbitrage-proof.mjs — P5/P12: the output→revenue ratio (the existential number).
//
// IndyDevDan's rule: "Buy a token for a dollar, run it through your business,
// sell the output for two — THEN scale to the moon. Only after you nail that
// arbitrage do you turn agents on 24/7." factory-arbitrage-meter.mjs reports the
// COST side; this adds the SELL side → the ratio + a hard PASS/FAIL verdict the
// operator gates scaling on.
//
// Recommended first pipeline (Sofia/operator decision 2026-05-28): test-coverage
// -as-a-service. The factory already ships "add tests for symbol X" (the T7
// gauntlet); cost-per-test is measured; sell price is set per --sell-price-per-test.
//
// No live $ needed to BUILD this — it instruments whatever the factory has
// already shipped. Run it after a real batch to get the live ratio.
//
// Usage:
//   node scripts/arbitrage-proof.mjs                                  # default $5/test
//   node scripts/arbitrage-proof.mjs --sell-price-per-test 5 --json
//   node scripts/arbitrage-proof.mjs --unit feature --sell-price-per-feature 200

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { emitFactoryEvent } from "./factory-events.mjs";
import { readCostEvents } from "./factory-treasury.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const has = (n) => process.argv.includes(n);
function arg(name, fb = null) { const i = process.argv.indexOf(name); return i === -1 ? fb : process.argv[i + 1] ?? fb; }
const EVENTS_PATH = resolve(process.env.FACTORY_EVENTS_PATH || resolve(REPO, "frames/factory-events.jsonl"));
const T7_LEDGER = resolve(process.env.FACTORY_T7_LEDGER || resolve(REPO, "frames/t7-native-repetition-progress-medium-cohortB-20260527.jsonl"));

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function round(n, d = 4) { const p = 10 ** d; return Math.round(n * p) / p; }
function readJsonl(p) { if (!existsSync(p)) return []; return readFileSync(p, "utf8").split(/\r?\n/).filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); }

/** Compute the arbitrage ratio for a unit (test or feature). Pure-ish (reads logs). */
export function arbitrageProof(opts = {}) {
  const unit = opts.unit || "test";
  const totalCost = readCostEvents(EVENTS_PATH).reduce((a, e) => a + e.cost, 0);

  // Units shipped.
  let unitsShipped, unitsSource;
  if (opts.unitsOverride != null) { unitsShipped = opts.unitsOverride; unitsSource = "override"; }
  else if (unit === "test") {
    const rows = readJsonl(T7_LEDGER);
    unitsShipped = rows.reduce((a, r) => a + num(r.new_test_count), 0);
    unitsSource = `t7 ledger (${rows.length} runs)`;
  } else {
    // feature = landed flywheel commit
    let landed = 0;
    for (const l of (existsSync(EVENTS_PATH) ? readFileSync(EVENTS_PATH, "utf8").split(/\r?\n/) : [])) {
      if (!l.trim()) continue; try { if (JSON.parse(l).type === "flywheel.commit.landed") landed++; } catch {}
    }
    unitsShipped = landed; unitsSource = "flywheel.commit.landed";
  }

  const sellPrice = num(opts.sellPrice ?? (unit === "test" ? 5 : 200));
  const costPerUnit = unitsShipped ? totalCost / unitsShipped : null;
  const ratio = costPerUnit ? sellPrice / costPerUnit : null;
  const positive = ratio != null && ratio >= 1.0;
  // Break-even = the minimum sell price for positive arbitrage (= cost/unit).
  // Margin = profit fraction of revenue at the modeled sell price.
  const breakEven = costPerUnit != null ? round(costPerUnit) : null;
  const marginPct = (ratio != null && sellPrice > 0) ? round(((sellPrice - costPerUnit) / sellPrice) * 100, 1) : null;

  return {
    unit,
    units_shipped: unitsShipped,
    units_source: unitsSource,
    total_cost_usd: round(totalCost, 2),
    cost_per_unit_usd: costPerUnit != null ? round(costPerUnit) : null,
    sell_price_per_unit_usd: sellPrice,
    break_even_price_usd: breakEven,        // floor: price ABOVE this to be positive
    margin_pct: marginPct,                  // profit share of revenue at sell price
    arbitrage_ratio: ratio != null ? round(ratio, 3) : null,
    positive,
    // A modeled ratio is necessary but NOT sufficient — it becomes a real proof
    // only when a customer pays >= sell_price for a shipped unit. Until then this
    // is "defensible to scale at the modeled price", not "revenue-validated".
    proof_status: ratio == null ? "insufficient_data" : "modeled_pending_real_sale",
    verdict: ratio == null ? "INSUFFICIENT DATA — no units shipped yet"
      : positive ? `ARBITRAGE POSITIVE (${round(ratio, 2)}× modeled; break-even $${breakEven}/unit; ${marginPct}% margin @ $${sellPrice}) — needs a real sale to validate`
      : `ARBITRAGE NEGATIVE (${round(ratio, 2)}× — do NOT scale; cut cost-per-${unit} below $${sellPrice} or price above $${breakEven})`,
  };
}

// CLI
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const unit = arg("--unit", "test");
  const sellPrice = unit === "test" ? arg("--sell-price-per-test", "5") : arg("--sell-price-per-feature", "200");
  const r = arbitrageProof({ unit, sellPrice: Number(sellPrice), unitsOverride: arg("--units") != null ? Number(arg("--units")) : undefined });
  if (!has("--no-emit")) {
    try { emitFactoryEvent({ type: "arbitrage.measured", behavior: "factory-economics", extras: r }); } catch {}
  }
  if (has("--json")) console.log(JSON.stringify(r, null, 2));
  else {
    console.log("=== ARBITRAGE PROOF (per " + r.unit + ") ===");
    console.log(`  units shipped:     ${r.units_shipped}  (${r.units_source})`);
    console.log(`  total cost:        $${r.total_cost_usd}`);
    console.log(`  cost per ${r.unit}:      ${r.cost_per_unit_usd != null ? "$" + r.cost_per_unit_usd : "n/a"}`);
    console.log(`  sell price:        $${r.sell_price_per_unit_usd}`);
    console.log(`  ratio:             ${r.arbitrage_ratio != null ? r.arbitrage_ratio + "×" : "n/a"}`);
    console.log(`  VERDICT: ${r.verdict}`);
  }
}
