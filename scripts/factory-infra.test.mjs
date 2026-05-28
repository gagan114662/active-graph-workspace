// Unit tests for the determinism-critical primitives the audit (H15) flagged:
// the collision-resistant event-id generator and the lockfile staleness logic.
// These functions DEFINE the guarantees (no lost events, no double-processing),
// so a silent regression in either is a determinism break.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { nextId } from "./factory-events.mjs";

test("nextId is collision-free and monotonically sortable within a process", () => {
  const ids = Array.from({ length: 5000 }, () => nextId());
  assert.equal(new Set(ids).size, ids.length, "all ids unique");
  // Lexicographic order must match generation order (the Honker watcher relies
  // on `WHERE id > last_id ORDER BY id ASC`).
  const sorted = [...ids].sort();
  assert.deepEqual(sorted, ids, "ids are already in lexicographic order");
});

test("nextId format is evt_<15ms>_<6pid>_<4+seq> and legacy ids sort before it", () => {
  const id = nextId();
  assert.match(id, /^evt_\d{15}_\d{6}_\d{4,}$/);
  // A legacy evt_000123 id must sort BEFORE any new id so historical queries
  // and the watcher cursor still work after the id-scheme migration.
  assert.ok("evt_000123" < id, "legacy id sorts before new id");
});

// --- lockfile staleness (H8 / H15) ---
// Use an isolated lock dir per test run so we never touch ~/.factory/locks.
const LOCK_DIR = mkdtempSync(resolve(tmpdir(), "factory-lock-test-"));
process.env.FACTORY_LOCK_DIR = LOCK_DIR;
const { acquireLock } = await import("./_lockfile.mjs");

test("acquireLock is exclusive while held, reusable after release", () => {
  const r1 = acquireLock("t1");
  assert.ok(r1, "first acquire succeeds");
  const r2 = acquireLock("t1");
  assert.equal(r2, null, "second acquire blocked while held");
  r1();
  const r3 = acquireLock("t1");
  assert.ok(r3, "re-acquire after release succeeds");
  r3();
});

test("acquireLock reclaims a lock whose holder PID is dead", () => {
  const name = "t-deadpid";
  const lockPath = resolve(LOCK_DIR, `${name}.lock`);
  // Write a lock owned by a PID that cannot be alive (very high, never running).
  writeFileSync(lockPath, JSON.stringify({ name, pid: 2 ** 30, acquired_at_ms: Date.now(), ttl_ms: 600000 }));
  const r = acquireLock(name);
  assert.ok(r, "dead-holder lock is reclaimed");
  r();
});

test("acquireLock reclaims a lock older than its TTL even if PID is alive", () => {
  const name = "t-expired";
  const lockPath = resolve(LOCK_DIR, `${name}.lock`);
  // Holder is THIS process (alive), but acquired long ago and TTL is tiny.
  writeFileSync(lockPath, JSON.stringify({ name, pid: process.pid, acquired_at_ms: Date.now() - 10000, ttl_ms: 600000 }));
  const r = acquireLock(name, { ttlMs: 1 });  // 1ms TTL → already expired
  assert.ok(r, "expired lock is reclaimed");
  r();
});

test("acquireLock refuses a fresh lock held by a live holder", () => {
  const name = "t-fresh-live";
  const lockPath = resolve(LOCK_DIR, `${name}.lock`);
  writeFileSync(lockPath, JSON.stringify({ name, pid: process.pid, acquired_at_ms: Date.now(), ttl_ms: 600000 }));
  const r = acquireLock(name, { ttlMs: 600000 });
  assert.equal(r, null, "fresh live-holder lock is NOT reclaimed");
});

test("H8: acquireLock reclaims a hung-but-alive holder via stale heartbeat", () => {
  const name = "t-hung-heartbeat";
  const lockPath = resolve(LOCK_DIR, `${name}.lock`);
  // Alive PID (this process), long TTL not expired, but heartbeat is way older
  // than 3× its interval → hung holder → reclaimable.
  writeFileSync(lockPath, JSON.stringify({
    name, pid: process.pid, acquired_at_ms: Date.now() - 5000, ttl_ms: 600000,
    heartbeat_interval_ms: 100, heartbeat_ms: Date.now() - 5000,
  }));
  const r = acquireLock(name, { ttlMs: 600000 });
  assert.ok(r, "hung-holder (stale heartbeat) lock is reclaimed even though PID is alive and TTL not expired");
  r();
});

test("H8: a fresh heartbeat from a live holder is NOT reclaimed", () => {
  const name = "t-live-heartbeat";
  const lockPath = resolve(LOCK_DIR, `${name}.lock`);
  writeFileSync(lockPath, JSON.stringify({
    name, pid: process.pid, acquired_at_ms: Date.now(), ttl_ms: 600000,
    heartbeat_interval_ms: 10000, heartbeat_ms: Date.now(),
  }));
  const r = acquireLock(name, { ttlMs: 600000 });
  assert.equal(r, null, "fresh-heartbeat live holder is NOT reclaimed");
});
