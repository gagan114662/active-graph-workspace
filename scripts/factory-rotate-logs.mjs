#!/usr/bin/env node
// Factory log rotation + todo archive (gaps K + R).
//
// - factory-events.jsonl rotates when >ROTATE_MAX_MB (default 50MB) → file
//   moves to frames/archive/factory-events-<ISO>.jsonl.gz (gzipped) and a
//   fresh empty JSONL is created. SQLite (factory-events.sqlite) is NOT
//   touched; consumers query it directly and historical events stay queryable
//   without the JSONL being on disk.
// - factory-todos.jsonl: completed todos older than ARCHIVE_DAYS (default 14)
//   migrate to frames/archive/factory-todos-<YYYYMMDD>.jsonl.gz. Open todos
//   stay in the live file.
// - Idempotent. Safe to run repeatedly.
//
// Usage:
//   node scripts/factory-rotate-logs.mjs [--once] [--interval-ms 3600000]
//                                        [--events-max-mb 50] [--archive-days 14]
//                                        [--dry-run]

import { existsSync, statSync, readFileSync, writeFileSync, renameSync, mkdirSync, createReadStream, createWriteStream } from "node:fs";
import { resolve, dirname } from "node:path";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";

const FACTORY_EVENTS_PATH = resolve(process.env.FACTORY_EVENTS_PATH || "frames/factory-events.jsonl");
const FACTORY_TODOS_PATH = resolve(process.env.FACTORY_TODOS_PATH || "frames/factory-todos.jsonl");
const ARCHIVE_DIR = resolve("frames/archive");
const PANIC_FILE = resolve(process.env.FACTORY_PANIC_FILE || `${process.env.HOME}/.factory/PANIC`);

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i < 0) return fallback;
  return process.argv[i + 1];
}
function flag(name) { return process.argv.includes(name); }

const once = flag("--once");
const intervalMs = Number(arg("--interval-ms", 60 * 60 * 1000));
const eventsMaxBytes = Number(arg("--events-max-mb", 50)) * 1024 * 1024;
const archiveDays = Number(arg("--archive-days", 14));
const dryRun = flag("--dry-run");

function log(...args) { console.log(new Date().toISOString(), "[rotate-logs]", ...args); }

async function gzipFile(src, dest) {
  await pipeline(createReadStream(src), createGzip(), createWriteStream(dest));
}

async function rotateEvents() {
  if (!existsSync(FACTORY_EVENTS_PATH)) return { rotated: false, reason: "no_file" };
  const st = statSync(FACTORY_EVENTS_PATH);
  if (st.size < eventsMaxBytes) return { rotated: false, reason: "under_threshold", bytes: st.size };
  mkdirSync(ARCHIVE_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const archived = resolve(ARCHIVE_DIR, `factory-events-${stamp}.jsonl.gz`);
  if (dryRun) {
    log(`[dry-run] would rotate ${FACTORY_EVENTS_PATH} (${st.size}B) → ${archived}`);
    return { rotated: false, reason: "dry_run", bytes: st.size };
  }
  // Atomic-ish rotation: rename live file to staging, gzip to archive, delete
  // staging, create empty live file. SQLite watchers query SQLite, so brief
  // JSONL absence is harmless. Phoenix's relay tails JSONL — it'll resume on
  // the new empty file via fs.watch (Node's tail logic re-opens).
  const staging = `${FACTORY_EVENTS_PATH}.rotating-${process.pid}`;
  renameSync(FACTORY_EVENTS_PATH, staging);
  writeFileSync(FACTORY_EVENTS_PATH, ""); // fresh empty file
  await gzipFile(staging, archived);
  // unlink staging via writeFileSync with "" then rename — actually simpler:
  const { unlinkSync } = await import("node:fs");
  unlinkSync(staging);
  log(`rotated events: ${st.size}B → ${archived}`);
  return { rotated: true, archived, bytes: st.size };
}

async function archiveTodos() {
  if (!existsSync(FACTORY_TODOS_PATH)) return { archived: 0, reason: "no_file" };
  const cutoffMs = Date.now() - archiveDays * 24 * 60 * 60 * 1000;
  const lines = readFileSync(FACTORY_TODOS_PATH, "utf-8").split("\n").filter(Boolean);
  const keep = [];
  const archive = [];
  for (const line of lines) {
    let row;
    try { row = JSON.parse(line); } catch { keep.push(line); continue; }
    if (row.completed_at) {
      const ts = Date.parse(row.completed_at);
      if (!isNaN(ts) && ts < cutoffMs) {
        archive.push(line);
        continue;
      }
    }
    keep.push(line);
  }
  if (archive.length === 0) return { archived: 0, reason: "nothing_to_archive" };
  if (dryRun) {
    log(`[dry-run] would archive ${archive.length} completed todos older than ${archiveDays}d`);
    return { archived: 0, reason: "dry_run", would_archive: archive.length };
  }
  mkdirSync(ARCHIVE_DIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const archiveFile = resolve(ARCHIVE_DIR, `factory-todos-${stamp}.jsonl`);
  // append, then gzip
  const existing = existsSync(archiveFile) ? readFileSync(archiveFile, "utf-8") : "";
  writeFileSync(archiveFile, existing + archive.join("\n") + "\n");
  // gzip the day-bucket and remove plaintext
  const gzipped = `${archiveFile}.gz`;
  await gzipFile(archiveFile, gzipped);
  const { unlinkSync } = await import("node:fs");
  unlinkSync(archiveFile);
  writeFileSync(FACTORY_TODOS_PATH, keep.join("\n") + (keep.length ? "\n" : ""));
  log(`archived ${archive.length} todos → ${gzipped} (kept ${keep.length} live)`);
  return { archived: archive.length, archive_file: gzipped, kept: keep.length };
}

function panicCheck() {
  if (existsSync(PANIC_FILE)) {
    log("PANIC file present, exiting");
    process.exit(2);
  }
}

async function tick() {
  panicCheck();
  try {
    const e = await rotateEvents();
    const t = await archiveTodos();
    if (e.rotated || t.archived > 0) log("tick result:", JSON.stringify({ events: e, todos: t }));
  } catch (err) {
    log("tick error:", err.message);
  }
}

async function main() {
  log(`starting (events-max=${eventsMaxBytes}B, archive-days=${archiveDays}, dry-run=${dryRun})`);
  await tick();
  if (once) return;
  setInterval(tick, intervalMs);
  setInterval(panicCheck, 5000);
}

main().catch((err) => { console.error(err); process.exit(1); });
