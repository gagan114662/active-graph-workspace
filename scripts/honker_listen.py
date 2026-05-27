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
            except Exception:
                pass
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
    conn = sqlite3.connect(sqlite_path)
    conn.enable_load_extension(True)
    conn.load_extension(HONKER_PATH)
    conn.row_factory = sqlite3.Row
    last_id = ""
    started = time.monotonic()
    # Subscribe via honker_listen — exact API name depends on the
    # crate version. As of honker 0.3.3, the listen interface is:
    #   SELECT honker_listen('factory_events', NULL);
    # Notifications fire when emit_factory_event INSERTs new rows
    # and the writer also runs `honker_notify('factory_events', ...)`.
    try:
        conn.execute("SELECT honker_listen('factory_events', NULL)")
    except sqlite3.OperationalError as e:
        # Fallback if honker API name differs in installed version.
        yield {"type": "_warning", "payload": {"message": f"honker_listen() failed: {e}; falling back to polling"}}
        yield from _listen_via_jsonl_poll(DEFAULT_JSONL, 1000, stop_after_seconds)
        return
    while stop_after_seconds is None or time.monotonic() - started < stop_after_seconds:
        rows = conn.execute(
            "SELECT id, created_at, type, payload FROM factory_events WHERE id > ? ORDER BY id ASC",
            (last_id,),
        ).fetchall()
        for row in rows:
            last_id = row["id"]
            yield {
                "id": row["id"],
                "created_at": row["created_at"],
                "type": row["type"],
                "payload": json.loads(row["payload"]),
            }
        # honker_poll blocks briefly until a notification arrives.
        try:
            conn.execute("SELECT honker_poll(100)")  # 100ms timeout
        except sqlite3.OperationalError:
            time.sleep(0.05)
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
    parser.add_argument("--limit", type=int, default=10)
    args = parser.parse_args()
    if args.migrate:
        n = migrate_jsonl_to_sqlite()
        print(f"Migrated {n} events to {DEFAULT_SQLITE}")
        print(f"Honker available: {honker_available()}")
    if args.listen:
        print(f"Listening (honker_available={honker_available()})...")
        count = 0
        for ev in listen_factory_events(stop_after_seconds=5):
            print(json.dumps(ev))
            count += 1
            if count >= args.limit:
                break
