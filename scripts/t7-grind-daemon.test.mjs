import { test } from "node:test";
import assert from "node:assert/strict";
import { tzOffsetMs, parseResetTime, computeState, nextIndexToFire } from "./t7-grind-daemon.mjs";

test("tzOffsetMs: Toronto is UTC-4 in late May (EDT)", () => {
  const may28 = new Date("2026-05-28T20:00:00Z");
  assert.equal(tzOffsetMs(may28, "America/Toronto"), -4 * 60 * 60 * 1000);
});

test("tzOffsetMs: Toronto is UTC-5 in January (EST)", () => {
  const jan15 = new Date("2026-01-15T20:00:00Z");
  assert.equal(tzOffsetMs(jan15, "America/Toronto"), -5 * 60 * 60 * 1000);
});

test("parseResetTime: '11:10pm (America/Toronto)' from 8:37pm EDT -> 03:10 UTC same night", () => {
  // now = 2026-05-29T00:37Z = 8:37pm EDT May 28. reset 11:10pm EDT = 03:10 UTC May 29.
  const now = new Date("2026-05-29T00:37:04Z");
  const r = parseResetTime("You've hit your session limit · resets 11:10pm (America/Toronto)", now);
  assert.ok(r instanceof Date);
  assert.equal(r.toISOString(), "2026-05-29T03:10:00.000Z");
});

test("parseResetTime: reset earlier than now rolls to next day", () => {
  // now = 2026-05-29T05:00Z = 1:00am EDT May 29. reset 11:10pm -> later TODAY (May 29) 03:10 UTC May 30.
  const now = new Date("2026-05-29T05:00:00Z");
  const r = parseResetTime("session limit · resets 11:10pm (America/Toronto)", now);
  assert.equal(r.toISOString(), "2026-05-30T03:10:00.000Z");
});

test("parseResetTime: handles whole-hour '9pm'", () => {
  const now = new Date("2026-05-29T00:00:00Z"); // 8pm EDT May 28
  const r = parseResetTime("session limit · resets 9pm (America/Toronto)", now);
  // 9pm EDT May 28 = 01:00 UTC May 29
  assert.equal(r.toISOString(), "2026-05-29T01:00:00.000Z");
});

test("parseResetTime: '12am' midnight", () => {
  const now = new Date("2026-05-29T02:00:00Z"); // 10pm EDT May 28
  const r = parseResetTime("session limit · resets 12am (America/Toronto)", now);
  // 12am EDT May 29 = 04:00 UTC May 29
  assert.equal(r.toISOString(), "2026-05-29T04:00:00.000Z");
});

test("parseResetTime: '12pm' noon", () => {
  const now = new Date("2026-05-29T15:00:00Z"); // 11am EDT
  const r = parseResetTime("session limit · resets 12pm (America/Toronto)", now);
  // 12pm EDT = 16:00 UTC same day
  assert.equal(r.toISOString(), "2026-05-29T16:00:00.000Z");
});

test("parseResetTime: returns null for non-session-limit messages", () => {
  assert.equal(parseResetTime("some other error", new Date()), null);
  assert.equal(parseResetTime("", new Date()), null);
  assert.equal(parseResetTime(null, new Date()), null);
});

test("parseResetTime: null when message lacks a parseable reset clause", () => {
  assert.equal(parseResetTime("session limit hit, try later", new Date()), null);
});

test("computeState: re-grades each row via the supplied fn", () => {
  const rows = [
    { run_idx: 1, proof_file: "a", tier: "medium" },
    { run_idx: 2, proof_file: "b", tier: "medium" },
    { run_idx: 3, proof_file: "c", tier: "medium" },
  ];
  // b fails uniform re-grade
  const regrade = (p) => p !== "b";
  const { passed, realFail } = computeState(rows, regrade);
  assert.deepEqual([...passed].sort(), [1, 3]);
  assert.deepEqual([...realFail].sort(), [2]);
});

test("nextIndexToFire: lowest 1..target not yet passed", () => {
  const passed = new Set([1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  assert.equal(nextIndexToFire(passed, 25), 4); // 4 missing, then 16..25
});

test("nextIndexToFire: null when target reached", () => {
  const passed = new Set(Array.from({ length: 25 }, (_, i) => i + 1));
  assert.equal(nextIndexToFire(passed, 25), null);
});
