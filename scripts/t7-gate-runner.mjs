#!/usr/bin/env node
// LIVE capstone: chain the T7 reliability gates unattended.
//
// Sequences the proven, rate-limit-aware `t7-grind-daemon.mjs` across tiers:
//   medium (target 25, gate >=22) -> hard (25, >=19) -> extra-hard (25, >=18)
// For each ENABLED tier in order it runs the grind daemon until that tier's gate
// is met (daemon exit 0) or the daemon stops for an operator (exit != 0); on a
// stuck tier it halts so a human looks. It is resumable: a tier already at its
// gate is skipped instantly (the daemon re-grades the ledger at startup).
//
// SAFETY: only tiers named in --enable-tiers run. Default = medium only, because
// hard/extra-hard fire helpers must each pass ONE supervised live validation run
// before being trusted in an unattended chain (a brand-new dual/5-agent helper
// could carry the rubber-stamp/cascade bug class). Enable them explicitly once
// validated: --enable-tiers medium,hard  (or medium,hard,extra-hard).
//
// As a LaunchAgent (KeepAlive) this makes the factory grind the gates across
// reboots and session-limit walls with no human in the loop — the LIVE milestone.
//
// Usage:
//   node scripts/t7-gate-runner.mjs [--enable-tiers medium,hard] [--once] [--dry-run]

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { installCrashGuard } from "./factory-crash-guard.mjs";
installCrashGuard("t7-gate-runner");

// Ordered tier ladder. Each tier names its fire helper + ledger + gate.
export const TIERS = [
  {
    name: "medium",
    fireHelper: "scripts/t7-medium-cohortC-opus48-fire.mjs",
    ledger: "frames/t7-native-repetition-progress-medium-cohortC-opus48-20260528.jsonl",
    verifierTier: "medium",
    target: 25,
    gate: 22,
  },
  {
    name: "hard",
    fireHelper: "scripts/t7-hard-cohortC-opus48-fire.mjs",
    ledger: "frames/t7-native-repetition-progress-hard-cohortC-opus48-20260528.jsonl",
    verifierTier: "hard",
    target: 25,
    gate: 19,
  },
  {
    name: "extra-hard",
    fireHelper: "scripts/t7-extra-hard-cohortC-opus48-fire.mjs",
    ledger: "frames/t7-native-repetition-progress-extra-hard-cohortC-opus48-20260528.jsonl",
    verifierTier: "extra-hard",
    target: 25,
    gate: 18,
  },
];

// Pure: how many uniform passes a ledger currently has, given a regrade fn.
export function ledgerPassCount(ledgerPath, regrade, readFile = readFileSync, exists = existsSync) {
  if (!exists(ledgerPath)) return 0;
  const rows = readFile(ledgerPath, "utf8").split(/\n/).filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  // dedupe by run_idx keeping the latest entry, then regrade each proof.
  const byIdx = new Map();
  for (const r of rows) byIdx.set(r.run_idx, r);
  let pass = 0;
  for (const r of byIdx.values()) if (regrade(r.proof_file, r.verifierTier || "medium")) pass++;
  return pass;
}

// Pure: the next tier to work given enabled set + a "gate met?" predicate.
export function nextTier(tiers, enabledSet, gateMet) {
  for (const t of tiers) {
    if (!enabledSet.has(t.name)) continue;
    if (!gateMet(t)) return t;
  }
  return null;
}

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}
const has = (n) => process.argv.includes(n);

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function main() {
  const enabled = new Set((arg("--enable-tiers", "medium")).split(",").map((s) => s.trim()).filter(Boolean));
  const once = has("--once");
  const dryRun = has("--dry-run");
  // --keep-alive: in terminal states (all gates met / helper missing / stuck), SLEEP
  // and re-check instead of exiting. Required when run as a KeepAlive LaunchAgent —
  // otherwise exit -> launchd restart -> exit is a tight crash loop.
  const keepAlive = has("--keep-alive");
  const idleSleepMs = Number(arg("--idle-sleep-ms", String(15 * 60 * 1000)));
  const log = (...a) => console.log(`[gate-runner ${new Date().toISOString()}]`, ...a);

  const regrade = (proofPath, t) => {
    if (!proofPath) return false;
    let p = proofPath;
    if (!existsSync(p)) {
      const alt = p.startsWith("activegraph/") ? p.slice("activegraph/".length) : `activegraph/${p}`;
      if (!existsSync(alt)) return false;
      p = alt;
    }
    const r = spawnSync("node", [
      "scripts/verify-pentagon-autonomy-from-logs.mjs",
      "--t6", `--tier=${t}`, "--proof-file", p, "--no-db",
    ], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 300_000 });
    return r.status === 0;
  };
  const gateMet = (t) => ledgerPassCount(t.ledger, (pp) => regrade(pp, t.verifierTier)) >= t.gate;

  log(`enabled tiers: [${[...enabled].join(", ")}]  dryRun=${dryRun} once=${once}`);

  for (;;) {
    const t = nextTier(TIERS, enabled, gateMet);
    if (!t) {
      log("ALL ENABLED TIERS AT GATE. factory reliability ladder complete for enabled set.");
      if (keepAlive) { log(`keep-alive: sleeping ${(idleSleepMs/60000).toFixed(0)}min then re-checking`); await sleep(idleSleepMs); continue; }
      process.exit(0);
    }

    const pass = ledgerPassCount(t.ledger, (pp) => regrade(pp, t.verifierTier));
    log(`working tier=${t.name} (uniform ${pass}/${t.target}, gate ${t.gate})`);

    if (!existsSync(t.fireHelper)) {
      log(`tier=${t.name} fire helper missing (${t.fireHelper}); cannot grind it.`);
      if (keepAlive) { log(`keep-alive: sleeping ${(idleSleepMs/60000).toFixed(0)}min then re-checking (operator may add the helper)`); await sleep(idleSleepMs); continue; }
      log("STOPPING for operator to build it.");
      process.exit(3);
    }
    if (dryRun) { log(`dry-run: would run grind daemon for ${t.name}; stopping`); process.exit(0); }

    const r = spawnSync("node", [
      "scripts/t7-grind-daemon.mjs",
      "--fire-helper", t.fireHelper,
      "--ledger", t.ledger,
      "--verifier-tier", t.verifierTier,
      "--target", String(t.target),
      "--gate", String(t.gate),
    ], { encoding: "utf8", stdio: "inherit", maxBuffer: 64 * 1024 * 1024 });

    if (r.status === 0) { log(`tier=${t.name} GATE MET. advancing.`); }
    else {
      log(`tier=${t.name} grind daemon exited ${r.status} (stuck / target reached below gate).`);
      if (keepAlive) { log(`keep-alive: sleeping ${(idleSleepMs/60000).toFixed(0)}min then retrying`); await sleep(idleSleepMs); continue; }
      log("STOPPING for operator.");
      process.exit(r.status ?? 2);
    }
    if (once) { log("once mode: one tier processed; exiting"); process.exit(0); }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error("[gate-runner] fatal", e); process.exit(70); });
}
