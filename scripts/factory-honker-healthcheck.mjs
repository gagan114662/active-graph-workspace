#!/usr/bin/env node
// Honker substrate end-to-end health check (Gap Q).
//
// Emits a canary event into the JSONL log, then polls the SQLite mirror for
// it to appear within HEALTHCHECK_TIMEOUT_MS (default 5000). Prints exactly
// one of:
//   HONKER_HEALTHY latency_ms=<N>
//   HONKER_DEGRADED reason=<code> detail=<...>
//
// Exits 0 if healthy, 1 if degraded — so factory-activate.sh can branch on
// $? and surface a loud warning. Idempotent. Safe to run repeatedly.

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { emitFactoryEvent } from "./factory-events.mjs";

const SQLITE = resolve(process.env.FACTORY_EVENTS_SQLITE || "frames/factory-events.sqlite");
const TIMEOUT_MS = Number(process.env.HONKER_HEALTHCHECK_TIMEOUT_MS || 5000);
const POLL_MS = 100;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  if (!existsSync(SQLITE)) {
    console.log(`HONKER_DEGRADED reason=sqlite_missing detail=${SQLITE}`);
    process.exit(1);
  }
  const probeId = "healthcheck_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
  const ev = emitFactoryEvent({
    type: "infrastructure.honker_healthcheck",
    behavior: "factory-honker-healthcheck",
    reason: "infrastructure.honker_healthcheck",
    message: "canary probe — verifies JSONL → SQLite relay alive",
    extras: { probe_id: probeId, synthetic: true, probe_origin: "factory-honker-healthcheck.mjs" },
  });
  const start = Date.now();
  const evId = ev.id;
  while (Date.now() - start < TIMEOUT_MS) {
    const res = spawnSync("sqlite3", [SQLITE, "-cmd", ".timeout 1000", `SELECT id FROM factory_events WHERE id = '${evId}' LIMIT 1;`], { encoding: "utf-8" });
    if (res.status === 0 && res.stdout.trim() === evId) {
      const latency = Date.now() - start;
      console.log(`HONKER_HEALTHY latency_ms=${latency} probe_id=${probeId}`);
      process.exit(0);
    }
    await sleep(POLL_MS);
  }
  console.log(`HONKER_DEGRADED reason=relay_not_responding detail=event_${evId}_not_in_sqlite_after_${TIMEOUT_MS}ms`);
  process.exit(1);
}

main().catch((err) => {
  console.log(`HONKER_DEGRADED reason=exception detail=${err.message}`);
  process.exit(1);
});
