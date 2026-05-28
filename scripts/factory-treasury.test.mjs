import test from "node:test";
import assert from "node:assert/strict";
import { budgetStatus, sessionBurn, recentSpend } from "./factory-treasury.mjs";

const NOW = 1_000_000_000_000;
const EV = [
  { at: NOW - 100, cost: 10, agent: "maya" },        // hour + day
  { at: NOW - 7_200_000, cost: 5, agent: "quinn" },   // day, not hour
  { at: NOW - 200_000_000, cost: 3, agent: "maya" },  // older than a day
];

test("budgetStatus windows spend correctly (hour/day/total)", () => {
  const b = budgetStatus(EV, NOW, { hour: 25, day: 100, session: 50 });
  assert.equal(b.hour.spent, 10);
  assert.equal(b.day.spent, 15);
  assert.equal(b.total_spent, 18);
  assert.equal(b.dispatches, 3);
});

test("budgetStatus flags over-cap", () => {
  const b = budgetStatus(EV, NOW, { hour: 5, day: 100, session: 50 });
  assert.equal(b.hour.over, true);
  assert.equal(b.hour.remaining, 0);
});

test("sessionBurn computes 1h rate", () => {
  const burn = sessionBurn(EV, NOW);
  assert.equal(burn.spend, 10);          // only the in-hour event
  assert.equal(burn.dispatches, 1);
  assert.equal(burn.avg_per_dispatch, 10);
});

test("recentSpend returns newest-first, capped", () => {
  const r = recentSpend(EV, 2);
  assert.equal(r.length, 2);
  assert.equal(r[0].cost, 10);           // newest
  assert.equal(r[1].agent, "quinn");
});
