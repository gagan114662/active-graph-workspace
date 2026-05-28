// Honker subscriber — Node wrapper around python3 scripts/honker_listen.py.
//
// Why: the realtime substrate (honker SQLite watcher + JSONL→SQLite relay)
// is Python-side. This module spawns the Python listener as a subprocess,
// reads JSON-per-line from its stdout, and yields one event at a time to
// a Node callback. Consumers (sasha-skeptic, blake-budget-marshal, f1-daemon)
// can replace their 1Hz file-poll with this and react to events in <500ms.
//
// Fallback: if HONKER_EXTENSION_PATH is unset or the extension fails to load,
// honker_listen.py falls back to JSONL polling internally — same callback
// shape, just slower. Consumers never need to know whether honker is live.
//
// Usage:
//   import { subscribeToFactoryEvents } from "./honker-subscribe.mjs";
//   const sub = subscribeToFactoryEvents((event) => {
//     console.log("got event", event.id, event.type);
//   });
//   // Later:
//   sub.close();

import { spawn } from "node:child_process";
import { resolve } from "node:path";

const DEFAULT_PYTHON = process.env.HONKER_PYTHON || "python3";
const LISTENER_SCRIPT = resolve(
  process.env.HONKER_LISTENER_SCRIPT || "scripts/honker_listen.py"
);

/**
 * Subscribe to factory events in realtime.
 *
 * @param {(event: object) => void} onEvent  Called once per event with the
 *   parsed JSON object: {id, created_at, type, payload}.
 * @param {object} [opts]
 * @param {string} [opts.python]              Python interpreter (default: python3)
 * @param {string} [opts.listenerScript]      Path to honker_listen.py
 * @param {string} [opts.honkerExtensionPath] Path to libhonker_ext.dylib (default: $HONKER_EXTENSION_PATH or ~/.local/lib/libhonker_ext.dylib)
 * @param {(line: string) => void} [opts.onWarning]  Called for non-JSON stderr lines.
 * @returns {{ close: () => void, pid: number }}
 */
export function subscribeToFactoryEvents(onEvent, opts = {}) {
  const python = opts.python || DEFAULT_PYTHON;
  const script = opts.listenerScript || LISTENER_SCRIPT;
  const extPath =
    opts.honkerExtensionPath ||
    process.env.HONKER_EXTENSION_PATH ||
    `${process.env.HOME}/.local/lib/libhonker_ext.dylib`;

  const env = { ...process.env, HONKER_EXTENSION_PATH: extPath };
  const child = spawn(python, [script, "--listen", "--json-lines"], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let buf = "";
  child.stdout.on("data", (chunk) => {
    buf += chunk.toString("utf8");
    let newlineIdx;
    while ((newlineIdx = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, newlineIdx);
      buf = buf.slice(newlineIdx + 1);
      if (!line.trim()) continue;
      try {
        const ev = JSON.parse(line);
        onEvent(ev);
      } catch (e) {
        if (opts.onWarning) opts.onWarning(`malformed-line: ${line.slice(0, 200)}`);
      }
    }
  });

  child.stderr.on("data", (chunk) => {
    const msg = chunk.toString("utf8").trim();
    if (msg && opts.onWarning) opts.onWarning(msg);
  });

  child.on("exit", (code, signal) => {
    if (opts.onWarning) opts.onWarning(`listener_exited code=${code} signal=${signal}`);
  });

  return {
    pid: child.pid,
    close: () => {
      try {
        child.kill("SIGTERM");
      } catch {}
    },
  };
}
