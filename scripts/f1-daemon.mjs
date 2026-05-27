#!/usr/bin/env node
// F1 daemon — keeps the dark factory operational 24/7.
//
// Pancake-gap-1 from getpancake.ai analysis. Pancake's pitch: "Your
// agent org runs 24/7 — no downtime, no sick days." Dark factory has
// the underlying machinery (bridge, sasha, blake) but no overseer that
// proves they stay alive. F1 is that overseer.
//
// What F1 does on each interval (default every 5 min):
//   1. Checks expected daemons are loaded in launchctl and have a live
//      PID (bridge always; sasha + blake if their plists exist).
//   2. Emits a `daemon.heartbeat` factory event with the status of each
//      daemon — alive (PID), missing (not loaded), or zombie (loaded
//      but no PID).
//   3. On state transitions (alive → missing/zombie), emits a stronger
//      `daemon.down` event with the daemon name and last known good
//      timestamp.
//   4. Optionally auto-respawns daemons via `launchctl bootstrap` (off
//      by default — operator must pass --auto-respawn).
//
// Usage:
//   node scripts/f1-daemon.mjs                                # readonly heartbeats
//   node scripts/f1-daemon.mjs --auto-respawn                 # also respawn dead daemons
//   node scripts/f1-daemon.mjs --interval-seconds 60          # tighter cadence
//   node scripts/f1-daemon.mjs --dry-run                      # no actions, just log
//
// Wrap in a LaunchAgent plist (KeepAlive=true, RunAtLoad=true) once
// the operator wants it to actually run 24/7.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { emitFactoryEvent } from "./factory-events.mjs";
import { installCrashGuard } from "./factory-crash-guard.mjs";

installCrashGuard("f1-daemon");

function arg(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  return idx === -1 ? fallback : process.argv[idx + 1] ?? fallback;
}
function has(name) { return process.argv.includes(name); }

const INTERVAL_SECONDS = Number(arg("--interval-seconds", "300"));
const AUTO_RESPAWN = has("--auto-respawn");
const DRY_RUN = has("--dry-run");
const HOME = process.env.HOME;

const DAEMONS = [
  {
    label: "run.pentagon.trigger-bridge",
    plist: `${HOME}/Library/LaunchAgents/run.pentagon.trigger-bridge.plist`,
    process_signature: "pentagon-trigger-bridge",
    required: true,
  },
  {
    label: "run.pentagon.sasha-skeptic",
    plist: `${HOME}/Library/LaunchAgents/run.pentagon.sasha-skeptic.plist`,
    process_signature: "sasha-skeptic.mjs",
    required: false,
  },
  {
    label: "run.pentagon.blake-budget-marshal",
    plist: `${HOME}/Library/LaunchAgents/run.pentagon.blake-budget-marshal.plist`,
    process_signature: "blake-budget-marshal.mjs",
    required: false,
  },
];

const lastStatus = new Map(); // label -> "alive" | "missing" | "zombie" | "not_configured"

function pgrepCount(signature) {
  // macOS pgrep doesn't support -c; emulate via pgrep -f | wc -l.
  const r = spawnSync("pgrep", ["-f", signature], { encoding: "utf8" });
  const lines = String(r.stdout || "").trim().split(/\r?\n/).filter(Boolean);
  return lines.length;
}

function launchctlListed(label) {
  const r = spawnSync("launchctl", ["list", label], { encoding: "utf8" });
  return r.status === 0;
}

function evaluateDaemon(d) {
  const plistExists = existsSync(d.plist);
  const isListed = launchctlListed(d.label);
  const processCount = pgrepCount(d.process_signature);
  if (!plistExists) return { ...d, status: "not_configured", plistExists, isListed, processCount };
  if (!isListed) return { ...d, status: "missing", plistExists, isListed, processCount };
  if (processCount === 0) return { ...d, status: "zombie", plistExists, isListed, processCount };
  return { ...d, status: "alive", plistExists, isListed, processCount };
}

function maybeRespawn(d) {
  if (!AUTO_RESPAWN || DRY_RUN) return null;
  if (d.status !== "missing" && d.status !== "zombie") return null;
  const uid = process.getuid?.() ?? process.env.UID;
  // For zombie: bootout first, then bootstrap.
  if (d.status === "zombie") {
    spawnSync("launchctl", ["bootout", `gui/${uid}/${d.label}`], { encoding: "utf8" });
  }
  const r = spawnSync("launchctl", ["bootstrap", `gui/${uid}`, d.plist], { encoding: "utf8" });
  return { action: "bootstrap", exit: r.status, stderr: String(r.stderr || "").slice(0, 500) };
}

function tick() {
  const snapshot = DAEMONS.map(evaluateDaemon);
  const heartbeat = {
    type: "daemon.heartbeat",
    behavior: "f1-daemon",
    extras: {
      checked_at: new Date().toISOString(),
      daemons: snapshot.map((d) => ({
        label: d.label,
        status: d.status,
        process_count: d.processCount,
        listed: d.isListed,
        configured: d.plistExists,
      })),
      auto_respawn: AUTO_RESPAWN,
      dry_run: DRY_RUN,
    },
  };
  try { emitFactoryEvent(heartbeat); } catch {}

  for (const d of snapshot) {
    const prev = lastStatus.get(d.label);
    if (prev && prev !== d.status && d.status !== "alive" && d.status !== "not_configured") {
      // Transition into a degraded state — louder event.
      try {
        emitFactoryEvent({
          type: "daemon.down",
          behavior: "f1-daemon",
          reason: "daemon." + d.status,
          message: `${d.label} transitioned from ${prev} to ${d.status}`,
          extras: {
            label: d.label,
            from: prev,
            to: d.status,
            process_count: d.processCount,
            listed: d.isListed,
            required: d.required,
          },
        });
      } catch {}
      const respawned = maybeRespawn(d);
      if (respawned) {
        try {
          emitFactoryEvent({
            type: "daemon.respawned",
            behavior: "f1-daemon",
            message: `${d.label} respawn attempted (exit=${respawned.exit})`,
            extras: { label: d.label, ...respawned },
          });
        } catch {}
      }
    }
    lastStatus.set(d.label, d.status);
  }
  console.log(JSON.stringify({ status: "f1_tick", daemons: snapshot.map((d) => `${d.label}=${d.status}`) }));
}

console.log(JSON.stringify({
  status: "f1_started",
  interval_seconds: INTERVAL_SECONDS,
  auto_respawn: AUTO_RESPAWN,
  dry_run: DRY_RUN,
  daemons: DAEMONS.map((d) => d.label),
}));

tick();
const interval = setInterval(tick, INTERVAL_SECONDS * 1000);

function shutdown(signal) {
  console.log(JSON.stringify({ status: "f1_shutting_down", signal }));
  clearInterval(interval);
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
