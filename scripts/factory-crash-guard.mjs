// Top-level crash guard + lifecycle tracker for Node scripts.
//
// Import this from any long-running or single-shot Node script that should
// emit a factory event on uncaught exceptions or unhandled rejections,
// instead of dying silently to stderr. Usage:
//
//   import { installCrashGuard } from "./factory-crash-guard.mjs";
//   installCrashGuard("bridge");
//
// What it does on import:
//   1. Emits `script.started` with pid, argv, node version, startup timestamp.
//   2. Scans the event log for prior `script.started` rows for the same label
//      with no matching `script.shutdown` — emits `script.silently_died` for
//      each one. This is the post-hoc SIGKILL/OOM detector: in-process
//      handlers cannot catch SIGKILL, but the next launch can notice the
//      orphaned started event and record that the previous instance died
//      uncleanly.
//   3. Registers process.on('uncaughtException') and process.on(
//      'unhandledRejection') handlers that emit script.crash before exit.
//   4. Registers process.on('SIGINT'|'SIGTERM') handlers that emit
//      `script.shutdown` for clean exits. Receipt order is: signal -> emit
//      shutdown -> process.exit. Daemons that intercept these signals
//      themselves should still call into our handler or emit explicitly.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { emitFactoryEvent } from "./factory-events.mjs";

const EVENTS_PATH = resolve(
  process.env.FACTORY_EVENTS_PATH || "frames/factory-events.jsonl"
);

function detectSilentlyDiedPredecessors(scriptLabel) {
  if (!existsSync(EVENTS_PATH)) return;
  let text;
  try { text = readFileSync(EVENTS_PATH, "utf8"); } catch { return; }
  const orphans = new Map(); // key=pid, value=last-started-event
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    if (ev.payload?.behavior !== scriptLabel) continue;
    if (ev.type === "script.started") {
      orphans.set(ev.payload?.pid, ev);
    } else if (ev.type === "script.shutdown" || ev.type === "script.crash") {
      orphans.delete(ev.payload?.pid);
    } else if (ev.type === "script.silently_died") {
      // Bug A fix: a silently_died event records the dead pid in
      // extras.dead_pid (-> payload.dead_pid), NOT payload.pid. Clearing by
      // payload.pid (undefined) meant a once-reported orphan was NEVER cleared,
      // so it was re-emitted on every single launch (122 events from ~5 real
      // deaths). Clear by dead_pid so a reported death stays reported once.
      orphans.delete(ev.payload?.dead_pid);
    }
  }
  for (const orphan of orphans.values()) {
    try {
      emitFactoryEvent({
        type: "script.silently_died",
        behavior: scriptLabel,
        reason: "script.silently_died",
        message: `prior ${scriptLabel} instance pid=${orphan.payload?.pid} started at ${orphan.created_at} had no shutdown event — likely SIGKILL, OOM, or hard crash`,
        extras: {
          dead_pid: orphan.payload?.pid,
          dead_started_at: orphan.created_at,
          detected_by_pid: process.pid,
          detected_at: new Date().toISOString(),
        },
      });
    } catch {
      // Never let detection itself crash the new instance.
    }
  }
}

export function installCrashGuard(scriptLabel) {
  const startedAtMs = Date.now();

  // Post-hoc SIGKILL/OOM detection: any orphaned script.started from this
  // label gets reported now, before we record our own started event.
  detectSilentlyDiedPredecessors(scriptLabel);

  // Lifecycle: emit script.started immediately so the next instance can
  // detect an unclean exit.
  try {
    emitFactoryEvent({
      type: "script.started",
      behavior: scriptLabel,
      extras: {
        pid: process.pid,
        argv: process.argv,
        node_version: process.version,
        platform: process.platform,
        cwd: process.cwd(),
      },
    });
  } catch {}

  function emitCrash(err, source) {
    try {
      emitFactoryEvent({
        type: "script.crash",
        behavior: scriptLabel,
        reason: "script." + (err?.name || "Error"),
        message: String(err?.message || err),
        extras: {
          source,
          exception_type: err?.name || "Error",
          code: err?.code ?? null,
          stack_tail: String(err?.stack || "").split(/\r?\n/).slice(0, 12).join("\n"),
          pid: process.pid,
          argv: process.argv,
          uptime_seconds: Math.round((Date.now() - startedAtMs) / 1000),
        },
      });
    } catch {
      // Never let the guard itself crash the process.
    }
  }

  let shutdownEmitted = false;
  function emitShutdown(signal) {
    if (shutdownEmitted) return;  // avoid signal+exit double-emit
    shutdownEmitted = true;
    try {
      emitFactoryEvent({
        type: "script.shutdown",
        behavior: scriptLabel,
        extras: {
          signal,
          pid: process.pid,
          uptime_seconds: Math.round((Date.now() - startedAtMs) / 1000),
        },
      });
    } catch {}
  }

  process.on("uncaughtException", (err) => {
    emitCrash(err, "uncaughtException");
    console.error("[crash-guard] uncaughtException in " + scriptLabel + ":", err);
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    emitCrash(err, "unhandledRejection");
    console.error("[crash-guard] unhandledRejection in " + scriptLabel + ":", reason);
    process.exit(1);
  });

  // Clean-shutdown signals — these match the next-instance detector so an
  // orphan started event without a matching shutdown means SIGKILL/OOM.
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => {
      emitShutdown(signal);
      process.exit(0);
    });
  }
  // process.exit() called by app code — emit shutdown synchronously via
  // an exit handler. (`process.on('exit')` only allows sync work.)
  // Bug B fix: emit shutdown on ANY exit code, not just 0. A non-zero exit is
  // still a CLEAN process termination (the process ran its exit path) — not a
  // SIGKILL/OOM. Single-shot scripts like run-native-pentagon-task.mjs exit
  // with code 2, which previously never emitted shutdown and thus orphaned
  // forever, re-flagged as silently_died on every launch (78 of the 122).
  // Only a true hard-kill (no terminal event at all) should be silently_died.
  process.on("exit", (code) => {
    emitShutdown(code === 0 ? "process.exit" : `process.exit:${code}`);
  });
}
