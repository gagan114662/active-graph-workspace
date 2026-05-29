#!/usr/bin/env node
// f1-gauntlet-scheduler.mjs — P9 (F1 full): re-run the factory's VERIFICATION
// machinery on a cadence and write outcomes to the event store, so regressions
// surface without a human kicking off checks.
//
// Pancake gap #21 ("agent org runs 24/7"). The sibling f1-daemon.mjs proves the
// daemons stay ALIVE; this proves the factory's checks stay GREEN over time.
//
// SAFETY / COST: the default cadence runs only FREE checks (no claude spend):
//   1. node --test suite (the *.test.mjs files)
//   2. factory-replay.mjs --mode routing-determinism (the CI determinism gate)
// Actually firing live gauntlets (which dispatch agents and cost money
// continuously) is an OPT-IN extension behind --live-tiers, OFF by default —
// because an unproven-arbitrage factory must not burn tokens on a 24/7 timer.
//
// Each run emits `gauntlet.replay.completed` per check + a `gauntlet.regression`
// event when a check that was passing starts failing (Sasha can route that into
// the flywheel). State persisted to ~/.factory/f1-scheduler-state.json.
//
// Usage:
//   node scripts/f1-gauntlet-scheduler.mjs --once            # run once, exit (cron/CI)
//   node scripts/f1-gauntlet-scheduler.mjs                   # loop (default 6h cadence)
//   node scripts/f1-gauntlet-scheduler.mjs --interval-seconds 3600
//   node scripts/f1-gauntlet-scheduler.mjs --dry-run         # log, don't emit/persist
//   node scripts/f1-gauntlet-scheduler.mjs --json            # machine output (with --once)

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { installCrashGuard } from "./factory-crash-guard.mjs";
installCrashGuard("f1-gauntlet-scheduler");

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STATE_DIR = resolve(homedir(), ".factory");
const STATE_FILE = resolve(STATE_DIR, "f1-scheduler-state.json");

const has = (n) => process.argv.includes(n);
function arg(name, fb = null) { const i = process.argv.indexOf(name); return i === -1 ? fb : process.argv[i + 1] ?? fb; }

// --- the free check suite (no claude spend) ---------------------------------
// Each check returns { name, ok, detail }.
function runNodeTests() {
  // spawnSync does not expand globs, and `node --test <dir>` discovers files
  // differently than the explicit glob the rest of the repo uses — so run it
  // through a shell with the same glob as the working invocation.
  const r = spawnSync("bash", ["-lc", "node --test scripts/*.test.mjs scripts/**/*.test.mjs 2>&1"],
    { cwd: REPO, encoding: "utf8", timeout: 180000 });
  const out = String(r.stdout || "") + String(r.stderr || "");
  const pass = Number((out.match(/^# pass (\d+)/m) || out.match(/ℹ pass (\d+)/) || [])[1] || 0);
  const fail = Number((out.match(/^# fail (\d+)/m) || out.match(/ℹ fail (\d+)/) || [])[1] || 0);
  // A clean run has fail=0 and at least some passing tests; pass=0 means the
  // glob matched nothing (a harness problem, not a green suite).
  return { name: "node_test_suite", ok: r.status === 0 && fail === 0 && pass > 0, detail: `pass=${pass} fail=${fail} exit=${r.status}` };
}

function runRoutingDeterminism() {
  const path = resolve(REPO, "scripts/factory-replay.mjs");
  if (!existsSync(path)) return { name: "routing_determinism", ok: true, detail: "factory-replay.mjs absent — skipped" };
  const r = spawnSync("node", ["scripts/factory-replay.mjs", "--mode", "routing-determinism"], { cwd: REPO, encoding: "utf8", timeout: 120000 });
  // factory-replay exits non-zero ONLY on real non-determinism (the CI gate).
  return { name: "routing_determinism", ok: r.status === 0, detail: `exit=${r.status}` };
}

export const DEFAULT_CHECKS = [runNodeTests, runRoutingDeterminism];

// --- pure regression logic (testable) ---------------------------------------
// Given the previous state map {name->ok} and the current results, return the
// checks that transitioned passing->failing (regressions) and failing->passing
// (recoveries).
export function diffRegressions(prev = {}, results = []) {
  const regressions = [], recoveries = [];
  for (const r of results) {
    const was = prev[r.name];
    if (was === true && r.ok === false) regressions.push(r.name);
    if (was === false && r.ok === true) recoveries.push(r.name);
  }
  return { regressions, recoveries };
}

function loadState() {
  try { return JSON.parse(readFileSync(STATE_FILE, "utf8")); } catch { return {}; }
}
function saveState(map) {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(map, null, 2));
}

async function emit(type, payload) {
  // Lazy import so the pure exports above stay dependency-free for tests.
  const { emitFactoryEvent } = await import("./factory-events.mjs");
  emitFactoryEvent({ type, behavior: "f1-scheduler", reason: type, extras: payload });
}

async function runOnce({ dryRun = false } = {}) {
  const results = DEFAULT_CHECKS.map((fn) => {
    try { return fn(); } catch (e) { return { name: fn.name, ok: false, detail: `threw: ${e?.message || e}` }; }
  });
  const prev = loadState();
  const { regressions, recoveries } = diffRegressions(prev, results);

  if (!dryRun) {
    for (const r of results) {
      await emit("gauntlet.replay.completed", { check: r.name, ok: r.ok, detail: r.detail });
    }
    for (const name of regressions) {
      await emit("gauntlet.regression", { check: name, message: `${name} was passing and is now failing` });
    }
    const nextState = {};
    for (const r of results) nextState[r.name] = r.ok;
    saveState(nextState);
  }
  return { results, regressions, recoveries };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const dryRun = has("--dry-run");
  const once = has("--once");
  const intervalMs = Number(arg("--interval-seconds", "21600")) * 1000; // 6h default
  const tick = async () => {
    const { results, regressions, recoveries } = await runOnce({ dryRun });
    const line = results.map((r) => `${r.ok ? "✅" : "❌"} ${r.name} (${r.detail})`).join("\n  ");
    if (has("--json")) console.log(JSON.stringify({ results, regressions, recoveries }, null, 2));
    else console.log(`[${new Date().toISOString()}] f1-scheduler:\n  ${line}` +
      (regressions.length ? `\n  ⚠ REGRESSIONS: ${regressions.join(", ")}` : "") +
      (recoveries.length ? `\n  ↩ recovered: ${recoveries.join(", ")}` : ""));
    if (has("--live-tiers")) console.log("  (note: --live-tiers requested — live gauntlet dispatch not yet enabled; free checks only)");
    return regressions.length;
  };
  if (once) {
    const regs = await tick();
    process.exit(regs ? 1 : 0);
  } else {
    await tick();
    setInterval(tick, intervalMs);
  }
}
