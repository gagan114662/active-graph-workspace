#!/usr/bin/env node
// LIVE keystone: rate-limit-aware, resumable T7 grind daemon.
//
// The single hardest blocker to running the dark factory unattended on a Claude
// Code MAX subscription is the SESSION LIMIT (HTTP 429 "You've hit your session
// limit · resets HH:MMpm"). When it hits, the bridge marks the trigger complete
// in a few seconds with no work output (a `ghost_completion` to the runner), and
// a naive grind burns a tail of doomed dispatches then dead-stops, needing a human.
//
// This daemon makes the grind SURVIVE that wall:
//   - After every fired run that did NOT pass, it inspects the factory-events log
//     for a fresh `llm.rate_limited` "session limit" event. If present, it parses
//     the reset time, sleeps until reset + a buffer, and RETRIES THE SAME index
//     (the attempt is not consumed and not counted as a reliability failure — it
//     never reached the agent).
//   - A verifier-REJECTED proof (the fire helper exits 4) is a REAL agent failure:
//     counted toward the reliability denominator, no retry.
//   - A non-rate-limited ghost/infra failure is retried up to --max-infra-retries.
//
// It is RESUMABLE: at startup it re-grades every existing proof in the ledger with
// the current verifier (uniform re-grade), so its notion of "done" is always honest
// and independent of whatever verifier version graded each run at the time.
//
// Generic over tier so the same daemon drives medium now and hard/extra-hard once
// their fire helpers exist.
//
// Usage:
//   node scripts/t7-grind-daemon.mjs \
//     --fire-helper scripts/t7-medium-cohortC-opus48-fire.mjs \
//     --ledger frames/t7-native-repetition-progress-medium-cohortC-opus48-20260528.jsonl \
//     --verifier-tier medium --target 25 --gate 22 [--max-infra-retries 3] [--once] [--dry-run]

import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

// ---------------------------------------------------------------------------
// Pure, unit-testable helpers (exported for t7-grind-daemon.test.mjs)
// ---------------------------------------------------------------------------

// ms that `timeZone`'s wall clock is ahead of UTC at instant `date` (negative west of UTC).
export function tzOffsetMs(date, timeZone) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = Object.fromEntries(dtf.formatToParts(date).map((x) => [x.type, x.value]));
  // Intl can emit hour "24" at midnight; normalize.
  const hour = p.hour === "24" ? 0 : Number(p.hour);
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, hour, +p.minute, +p.second);
  return asUTC - date.getTime();
}

// Parse a Claude session-limit message into the next UTC reset instant.
// Recognizes e.g. "You've hit your session limit · resets 11:10pm (America/Toronto)".
// Returns a Date (UTC instant) or null if the message isn't a session-limit notice.
export function parseResetTime(message, now = new Date()) {
  if (!message || !/session limit/i.test(message)) return null;
  const m = message.match(/resets\s+(\d{1,2})(?::(\d{2}))?\s*([ap]m)\s*\(([^)]+)\)/i);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : 0;
  const mer = m[3].toLowerCase();
  const tz = m[4].trim();
  if (mer === "pm" && hour !== 12) hour += 12;
  if (mer === "am" && hour === 12) hour = 0;

  // Toronto wall date "now"
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit",
  });
  const p = Object.fromEntries(dtf.formatToParts(now).map((x) => [x.type, x.value]));
  const offset = tzOffsetMs(now, tz);
  // wall-clock target interpreted as if UTC, then shifted to the real UTC instant.
  let target = Date.UTC(+p.year, +p.month - 1, +p.day, hour, minute) - offset;
  if (target <= now.getTime()) target += 24 * 60 * 60 * 1000; // next day
  return new Date(target);
}

// Given ledger rows (parsed) + a re-grade fn, return {passed:Set, realFail:Set, byIdx}.
// re-grade fn: (proofPath, tier) => boolean (true = uniform PASS now)
export function computeState(rows, regrade) {
  const passed = new Set();
  const realFail = new Set();
  const byIdx = new Map();
  for (const r of rows) {
    const ok = regrade(r.proof_file, r.tier || "medium");
    byIdx.set(r.run_idx, { ...r, uniform_pass: ok });
    if (ok) passed.add(r.run_idx); else realFail.add(r.run_idx);
  }
  return { passed, realFail, byIdx };
}

// Next index to fire to reach `target` runs: lowest 1..target not yet uniformly-passed.
export function nextIndexToFire(passed, target) {
  for (let i = 1; i <= target; i++) if (!passed.has(i)) return i;
  return null; // target reached
}

// ---------------------------------------------------------------------------
// Daemon (skipped when imported for tests)
// ---------------------------------------------------------------------------

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}
const has = (name) => process.argv.includes(name);

async function main() {
  const fireHelper = arg("--fire-helper", "scripts/t7-medium-cohortC-opus48-fire.mjs");
  const ledgerPath = arg("--ledger", "frames/t7-native-repetition-progress-medium-cohortC-opus48-20260528.jsonl");
  const tier = arg("--verifier-tier", "medium");
  const target = Number(arg("--target", "25"));
  const gate = Number(arg("--gate", "22"));
  const maxInfraRetries = Number(arg("--max-infra-retries", "3"));
  const resetBufferMs = Number(arg("--reset-buffer-ms", String(120_000)));
  const once = has("--once");
  const dryRun = has("--dry-run");
  const eventsPath = arg("--events", "frames/factory-events.jsonl");

  const log = (...a) => console.log(`[grind-daemon ${new Date().toISOString()}]`, ...a);

  // Re-grade an existing proof with the current verifier (uniform, --no-db).
  const regrade = (proofPath, t) => {
    if (!proofPath || !existsSync(proofPath)) {
      // proof_file in the ledger may be repo-relative with a different cwd; try both.
      const alt = proofPath && proofPath.startsWith("activegraph/")
        ? proofPath.slice("activegraph/".length)
        : `activegraph/${proofPath}`;
      if (!alt || !existsSync(alt)) return false;
      proofPath = alt;
    }
    const r = spawnSync("node", [
      "scripts/verify-pentagon-autonomy-from-logs.mjs",
      "--t6", `--tier=${t}`, "--proof-file", proofPath, "--no-db",
    ], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 240_000 });
    return r.status === 0;
  };

  const readLedger = () => {
    if (!existsSync(ledgerPath)) return [];
    return readFileSync(ledgerPath, "utf8").split(/\n/).filter(Boolean).map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  };

  // Find a session-limit reset instant from factory events created since `sinceMs`.
  const detectRateLimitReset = (sinceMs) => {
    if (!existsSync(eventsPath)) return null;
    const lines = readFileSync(eventsPath, "utf8").split(/\n/).filter(Boolean);
    let reset = null;
    for (let i = lines.length - 1; i >= 0 && i > lines.length - 400; i--) {
      let ev; try { ev = JSON.parse(lines[i]); } catch { continue; }
      const created = Date.parse(ev.created_at || "");
      if (!Number.isFinite(created) || created < sinceMs) continue;
      const p = ev.payload || {};
      if (p.reason === "llm.rate_limited" && /session limit/i.test(p.message || "")) {
        const r = parseResetTime(p.message, new Date());
        if (r) { reset = r; break; }
      }
    }
    return reset;
  };

  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

  log(`config: tier=${tier} target=${target} gate=${gate} fire=${fireHelper} ledger=${ledgerPath} once=${once} dryRun=${dryRun}`);

  for (;;) {
    const rows = readLedger();
    const { passed, realFail } = computeState(rows, regrade);
    const passCount = passed.size;
    const idx = nextIndexToFire(passed, target);
    log(`state: uniform passed=${passCount}/${target} realFail=[${[...realFail].sort((a,b)=>a-b).join(",")}] next=${idx ?? "NONE"}`);

    if (idx === null) {
      const verdict = passCount >= gate ? "GATE MET" : "GATE MISSED";
      log(`DONE: ${target} runs reached. uniform PASS=${passCount}/${target} (gate ${gate}) => ${verdict}`);
      process.exit(passCount >= gate ? 0 : 1);
    }

    if (dryRun) { log(`dry-run: would fire index ${idx}; stopping`); process.exit(0); }

    let infraRetries = 0;
    let fired = false;
    while (!fired) {
      const fireStart = Date.now();
      log(`firing index ${idx} (infra-retry ${infraRetries}/${maxInfraRetries})`);
      const r = spawnSync("node", [fireHelper, String(idx)], {
        encoding: "utf8", stdio: "inherit", maxBuffer: 32 * 1024 * 1024, timeout: 660_000,
      });
      const rc = r.status;
      log(`fire index ${idx} rc=${rc}`);

      if (rc === 0) { fired = true; break; } // PASS appended; loop re-reads ledger

      // Non-pass. Is it the session-limit wall?
      const reset = detectRateLimitReset(fireStart - 5_000);
      if (reset) {
        const waitMs = Math.max(0, reset.getTime() - Date.now()) + resetBufferMs;
        log(`SESSION LIMIT detected. resets ${reset.toISOString()} — sleeping ${(waitMs/1000/60).toFixed(1)}min then retrying SAME index ${idx} (attempt not consumed)`);
        if (once) { log("once mode: not sleeping; exiting after rate-limit detection"); process.exit(75); }
        await sleep(waitMs);
        continue; // retry same idx, no attempt consumed
      }

      if (rc === 4) {
        // Verifier REJECTED the proof — a real agent failure. Counted; do not retry.
        log(`index ${idx} VERIFIER-REJECTED (real reliability fail). recorded by fire helper; advancing.`);
        fired = true; // ledger has a fail row for this idx; computeState will see realFail
        break;
      }

      // Non-rate-limited ghost/infra failure (rc===3 proof-missing, or other).
      infraRetries += 1;
      if (infraRetries > maxInfraRetries) {
        log(`index ${idx} exceeded ${maxInfraRetries} infra retries with no rate-limit signal. STOPPING for operator.`);
        process.exit(2);
      }
      log(`infra failure (rc=${rc}), not rate-limited. retrying same index after 30s.`);
      await sleep(30_000);
    }

    if (once) { log("once mode: one index fired; exiting"); process.exit(0); }
  }
}

// Only run the daemon when invoked directly (not when imported by tests).
// Use pathToFileURL so paths containing spaces (e.g. "my projects") match —
// process.argv[1] has a literal space but import.meta.url URL-encodes it.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error("[grind-daemon] fatal", e); process.exit(70); });
}
