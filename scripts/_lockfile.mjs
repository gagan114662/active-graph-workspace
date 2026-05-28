// Lockfile helper (Gap F).
//
// Concurrent-writer protection for Phoenix's flywheel action path. Without
// this, two flywheel attempts targeting the same todo_id or same fix branch
// could:
//   - race on /tmp/flywheel-<id>/ worktree creation
//   - race on `git update-ref refs/heads/flywheel-fixes-YYYYMMDD`
//   - race on `git push` producing intermittent non-fast-forward rejections
//
// Strategy: O_CREAT | O_EXCL lock files holding the locking PID + start
// time. If the lock exists but the holding PID is dead, the lock is stale
// and gets reclaimed. Best-effort — POSIX file locks would be sturdier but
// require fcntl bindings; this is good enough for one Phoenix daemon's
// internal queue + the rare operator-running-two-daemons case.
//
// Usage:
//   const release = acquireLock("flywheel-todo-evt_X", { ttlMs: 600_000 });
//   if (!release) { console.error("could not acquire lock"); return; }
//   try { ... } finally { release(); }

import { openSync, closeSync, writeSync, writeFileSync, readFileSync, existsSync, unlinkSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const LOCK_DIR = resolve(process.env.FACTORY_LOCK_DIR || `${process.env.HOME}/.factory/locks`);

function ensureDir() {
  mkdirSync(LOCK_DIR, { recursive: true });
}

function pidAlive(pid) {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}

function readLockMeta(path) {
  try {
    const raw = readFileSync(path, "utf-8");
    const data = JSON.parse(raw);
    return data;
  } catch {
    return null;
  }
}

/**
 * Try to acquire a named lock. Returns a release function on success, null
 * on failure. Stale locks (dead holder OR older than ttlMs) are reclaimed.
 */
export function acquireLock(name, opts = {}) {
  ensureDir();
  const ttlMs = Number(opts.ttlMs || 600_000); // 10 min default
  const safeName = name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const lockPath = resolve(LOCK_DIR, `${safeName}.lock`);

  // Check for existing lock; reclaim if stale.
  if (existsSync(lockPath)) {
    const meta = readLockMeta(lockPath);
    if (meta) {
      const age = Date.now() - (meta.acquired_at_ms || 0);
      const holderAlive = pidAlive(meta.pid);
      const expired = age > ttlMs;
      // H8: a hung-but-alive holder otherwise keeps a long-TTL lock (e.g. the
      // 30-min per-todo lock) forever, blocking every retry. If the holder
      // advertised a heartbeat, treat the lock as stale once the heartbeat is
      // older than 3× its interval — even if the PID is still alive.
      const hbInterval = Number(meta.heartbeat_interval_ms || 0);
      const hbStale = hbInterval > 0 &&
        (Date.now() - (meta.heartbeat_ms || meta.acquired_at_ms || 0)) > 3 * hbInterval;
      if (!holderAlive || expired || hbStale) {
        // Stale: reclaim.
        try { unlinkSync(lockPath); } catch {}
      } else {
        return null;
      }
    } else {
      // Unreadable — assume corrupt + reclaim.
      try { unlinkSync(lockPath); } catch {}
    }
  }

  // Atomic create with O_EXCL. If another process raced us between the
  // existsSync check and here, this throws EEXIST.
  let fd;
  try {
    fd = openSync(lockPath, "wx");
  } catch (e) {
    if (e.code === "EEXIST") return null;
    throw e;
  }
  const heartbeatMs = Number(opts.heartbeatMs || 0);
  const meta = {
    name,
    pid: process.pid,
    acquired_at: new Date().toISOString(),
    acquired_at_ms: Date.now(),
    ttl_ms: ttlMs,
    ...(heartbeatMs ? { heartbeat_ms: Date.now(), heartbeat_interval_ms: heartbeatMs } : {}),
  };
  writeSync(fd, JSON.stringify(meta));
  closeSync(fd);

  // H8: if a heartbeat was requested, refresh heartbeat_ms on an interval so
  // other acquirers can tell a live-and-working holder from a hung one. The
  // timer is unref'd so it never keeps the process alive on its own.
  let hbTimer = null;
  if (heartbeatMs) {
    hbTimer = setInterval(() => {
      try {
        const cur = readLockMeta(lockPath);
        if (cur && cur.pid === process.pid) {
          cur.heartbeat_ms = Date.now();
          writeFileSync(lockPath, JSON.stringify(cur));
        }
      } catch {}
    }, heartbeatMs);
    if (hbTimer.unref) hbTimer.unref();
  }

  let released = false;
  return function release() {
    if (released) return;
    released = true;
    if (hbTimer) { try { clearInterval(hbTimer); } catch {} }
    try {
      // Only unlink if we still own it (PID match) — prevents stomping on
      // a stale-reclaim that took over.
      const current = readLockMeta(lockPath);
      if (current && current.pid === process.pid) {
        unlinkSync(lockPath);
      }
    } catch {}
  };
}

/**
 * Convenience: run fn while holding lock. Returns { acquired: bool, result }.
 */
export async function withLock(name, fn, opts = {}) {
  const release = acquireLock(name, opts);
  if (!release) return { acquired: false, result: null };
  try {
    const result = await fn();
    return { acquired: true, result };
  } finally {
    release();
  }
}
