#!/usr/bin/env python3
"""Honker-backed realtime listener for the factory event log.

#30 wiring. Honker is a SQLite extension implementing Postgres-style
NOTIFY/LISTEN over SQLite files. When loaded, it replaces our 1Hz file
polling (Sasha, Blake, F1, Slack adapter) with sub-millisecond LISTEN
callbacks driven by `PRAGMA data_version` watches.

This module ships in two modes:

  1. **Honker-enabled** (when `honker-extension.dylib` is on
     `HONKER_EXTENSION_PATH` or in a standard location):
     - Opens the events SQLite file with `enable_load_extension(True)`.
     - Loads the Honker extension.
     - Subscribes to `honker_listen('factory_events')`.
     - Yields each new event row as it arrives.

  2. **Fallback** (Honker not installed):
     - Polls `frames/factory-events.jsonl` every `--poll-interval-ms`.
     - Same callback shape; just slower.

Usage:
    from scripts.honker_listen import listen_factory_events

    for event in listen_factory_events():
        print(event["type"], event["payload"].get("reason"))

The events store is `frames/factory-events.sqlite` if Honker is enabled
(loaded once by `migrate_jsonl_to_sqlite()`), otherwise the JSONL.

Install Honker (one-time setup):
    git clone https://github.com/russellromney/honker
    cd honker/honker-extension
    cargo build --release
    cp target/release/libhonker_extension.dylib ~/.local/lib/honker.dylib
    export HONKER_EXTENSION_PATH=~/.local/lib/honker.dylib

Or use the Python wrapper crate (when published):
    pip install honker-py  # not yet on PyPI as of 2026-05-27
"""

from __future__ import annotations

import json
import os
import sqlite3
import sys
import time
from pathlib import Path
from typing import Iterator, Optional

DEFAULT_JSONL = Path(os.environ.get("FACTORY_EVENTS_PATH", "frames/factory-events.jsonl")).expanduser()
DEFAULT_SQLITE = Path(os.environ.get("FACTORY_EVENTS_SQLITE", "frames/factory-events.sqlite")).expanduser()
HONKER_PATH = os.environ.get("HONKER_EXTENSION_PATH")


def honker_available() -> bool:
    """Return True if the Honker SQLite extension can be loaded."""
    if not HONKER_PATH:
        return False
    if not Path(HONKER_PATH).exists():
        return False
    try:
        conn = sqlite3.connect(":memory:")
        conn.enable_load_extension(True)
        conn.load_extension(HONKER_PATH)
        conn.close()
        return True
    except sqlite3.OperationalError:
        return False


def migrate_jsonl_to_sqlite(
    jsonl_path: Path = DEFAULT_JSONL,
    sqlite_path: Path = DEFAULT_SQLITE,
) -> int:
    """One-time migration: copy all events from the JSONL log into a
    Honker-aware SQLite store. Subsequent emits should write to the
    SQLite directly (TODO: update factory_events.py to dual-write
    behind an env flag).

    Returns the number of events migrated.
    """
    if not jsonl_path.exists():
        return 0
    sqlite_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(sqlite_path)
    if honker_available():
        conn.enable_load_extension(True)
        conn.load_extension(HONKER_PATH)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS factory_events (
            id TEXT PRIMARY KEY,
            created_at TEXT NOT NULL,
            type TEXT NOT NULL,
            payload TEXT NOT NULL
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS factory_events_type_idx ON factory_events(type)")
    conn.execute("CREATE INDEX IF NOT EXISTS factory_events_created_at_idx ON factory_events(created_at)")
    count = 0
    with jsonl_path.open() as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                continue
            try:
                conn.execute(
                    "INSERT OR IGNORE INTO factory_events (id, created_at, type, payload) VALUES (?, ?, ?, ?)",
                    (ev["id"], ev["created_at"], ev["type"], json.dumps(ev.get("payload") or {})),
                )
                count += 1
            except Exception as exc:  # noqa: BLE001
                # Don't let one bad row abort the migration, but make it visible (H13).
                sys.stderr.write(f"[honker_listen] migration insert failed for id={ev.get('id')}: {exc}\n")
                sys.stderr.flush()
    conn.commit()
    conn.close()
    return count


def listen_factory_events(
    sqlite_path: Path = DEFAULT_SQLITE,
    jsonl_path: Path = DEFAULT_JSONL,
    poll_interval_ms: int = 1000,
    stop_after_seconds: Optional[float] = None,
) -> Iterator[dict]:
    """Yield factory events as they arrive.

    With Honker: uses LISTEN, sub-millisecond detection.
    Without Honker: polls the JSONL file at `poll_interval_ms`.

    `stop_after_seconds` is mostly for testing; production daemons leave
    it None.
    """
    if honker_available() and sqlite_path.exists():
        yield from _listen_via_honker(sqlite_path, stop_after_seconds)
    else:
        yield from _listen_via_jsonl_poll(jsonl_path, poll_interval_ms, stop_after_seconds)


def _listen_via_honker(sqlite_path: Path, stop_after_seconds: Optional[float]) -> Iterator[dict]:
    """Real honker v0.2.x watcher API.

    Honker exposes a file-level update watcher (not a per-table NOTIFY).
    Pattern:
      handle = honker_update_watcher_open(db_path, NULL)
      loop: honker_update_watcher_wait(handle, timeout_ms) -> 1=update, 0=timeout, -1=closed
            on 1 -> query new rows since last seen id
      honker_update_watcher_close(handle)

    The watcher fires for ANY write to the SQLite file, including writes
    from other processes (honker-relay tails JSONL into the same DB).
    """
    conn = sqlite3.connect(sqlite_path)
    conn.enable_load_extension(True)
    conn.load_extension(HONKER_PATH)
    conn.row_factory = sqlite3.Row
    started = time.monotonic()

    try:
        (handle_id,) = conn.execute(
            "SELECT honker_update_watcher_open(?, NULL)",
            (str(sqlite_path),),
        ).fetchone()
    except sqlite3.OperationalError as e:
        yield {
            "type": "_warning",
            "payload": {
                "message": f"honker_update_watcher_open() failed: {e}; falling back to polling"
            },
        }
        yield from _listen_via_jsonl_poll(DEFAULT_JSONL, 1000, stop_after_seconds)
        conn.close()
        return

    # Seed last_id from current max in DB so we only yield NEW rows after subscribe.
    row = conn.execute("SELECT COALESCE(MAX(id), '') FROM factory_events").fetchone()
    last_id = row[0] if row else ""

    try:
        while stop_after_seconds is None or time.monotonic() - started < stop_after_seconds:
            # Wait up to 200ms for any DB write.
            (code,) = conn.execute(
                "SELECT honker_update_watcher_wait(?, ?)",
                (handle_id, 200),
            ).fetchone()
            if code == -1:
                # Watcher closed/disconnected — break out so caller can re-subscribe.
                break
            if code == 0:
                continue  # timeout, loop
            # code == 1: at least one write since last wait. Drain new rows.
            rows = conn.execute(
                "SELECT id, created_at, type, payload FROM factory_events "
                "WHERE id > ? ORDER BY id ASC",
                (last_id,),
            ).fetchall()
            for r in rows:
                last_id = r["id"]
                yield {
                    "id": r["id"],
                    "created_at": r["created_at"],
                    "type": r["type"],
                    "payload": json.loads(r["payload"]),
                }
    finally:
        try:
            conn.execute("SELECT honker_update_watcher_close(?)", (handle_id,))
        except sqlite3.OperationalError:
            pass
        conn.close()


def _listen_via_jsonl_poll(
    jsonl_path: Path,
    poll_interval_ms: int,
    stop_after_seconds: Optional[float],
) -> Iterator[dict]:
    if not jsonl_path.exists():
        return
    last_size = jsonl_path.stat().st_size
    started = time.monotonic()
    while stop_after_seconds is None or time.monotonic() - started < stop_after_seconds:
        try:
            size = jsonl_path.stat().st_size
            if size > last_size:
                with jsonl_path.open() as f:
                    f.seek(last_size)
                    chunk = f.read()
                last_size = size
                for line in chunk.split("\n"):
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        yield json.loads(line)
                    except json.JSONDecodeError:
                        continue
        except FileNotFoundError:
            pass
        time.sleep(poll_interval_ms / 1000.0)


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--migrate", action="store_true", help="Migrate JSONL → SQLite, then exit")
    parser.add_argument("--listen", action="store_true", help="Listen and print events")
    parser.add_argument("--limit", type=int, default=0, help="0 = unlimited (daemon mode)")
    parser.add_argument("--stop-after-seconds", type=float, default=None,
                        help="Exit after N seconds (default: run forever)")
    parser.add_argument("--json-lines", action="store_true",
                        help="Print only JSON-per-line, no banner (for piping into other tools)")
    args = parser.parse_args()
    if args.migrate:
        n = migrate_jsonl_to_sqlite()
        print(f"Migrated {n} events to {DEFAULT_SQLITE}")
        print(f"Honker available: {honker_available()}")
    if args.listen:
        if not args.json_lines:
            print(f"Listening (honker_available={honker_available()})...", flush=True)
        count = 0
        for ev in listen_factory_events(stop_after_seconds=args.stop_after_seconds):
            print(json.dumps(ev), flush=True)
            count += 1
            if args.limit and count >= args.limit:
                break
