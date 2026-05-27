// Top-level crash guard for Node scripts.
//
// Import this from any long-running or single-shot Node script that should
// emit a factory event on uncaught exceptions or unhandled rejections,
// instead of dying silently to stderr. Usage:
//
//   import { installCrashGuard } from "./factory-crash-guard.mjs";
//   installCrashGuard("bridge");
//
// The label gets recorded as the `behavior` so the event log can group
// crashes by which script died.
//
// After emitting the event, the original error is re-thrown so the
// process still exits with a non-zero code. This is intentional: we want
// the LaunchAgent to restart the script per its KeepAlive policy, AND we
// want a queryable record of every crash.

import { emitFactoryEvent } from "./factory-events.mjs";

export function installCrashGuard(scriptLabel) {
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
        },
      });
    } catch {
      // Never let the guard itself crash the process. Original error
      // propagation below is what matters.
    }
  }

  process.on("uncaughtException", (err) => {
    emitCrash(err, "uncaughtException");
    // Match Node's default behavior — print and exit non-zero so the
    // LaunchAgent KeepAlive triggers a restart.
    console.error("[crash-guard] uncaughtException in " + scriptLabel + ":", err);
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    emitCrash(err, "unhandledRejection");
    console.error("[crash-guard] unhandledRejection in " + scriptLabel + ":", reason);
    process.exit(1);
  });
}
