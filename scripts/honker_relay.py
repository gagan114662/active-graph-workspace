#!/usr/bin/env python3
"""Honker relay — tails frames/factory-events.jsonl and inserts new rows
into frames/factory-events.sqlite. The honker update_watcher fires
automatically on each INSERT so any consumer that subscribed via
honker_update_watcher_open() gets notified within ~50ms (default backend
polling interval).

Run as a foreground daemon (one process per machine):

    HONKER_EXTENSION_PATH=$HOME/.local/lib/libhonker_ext.dylib \\
        python3 scripts/honker_relay.py

Stop with SIGTERM. The relay is idempotent — it migrates the entire JSONL
on start (skips rows already in SQLite via INSERT OR IGNORE), then tails
appended lines from the byte offset where the previous migrate ended.

If HONKER_EXTENSION_PATH is unset OR the extension fails to load, the
relay still maintains the SQLite mirror but readers using the watcher API
will receive no notifications — they should fall back to JSONL polling
in that case (honker_listen.listen_factory_events handles this).
"""

from __future__ import annotations

import json
import os
import signal
import sqlite3
import sys
import time
from pathlib import Path

JSONL = Path(os.environ.get("FACTORY_EVENTS_PATH", "frames/factory-events.jsonl")).expanduser()
SQLITE = Path(os.environ.get("FACTORY_EVENTS_SQLITE", "frames/factory-events.sqlite")).expanduser()
HONKER_PATH = os.environ.get("HONKER_EXTENSION_PATH")
POLL_INTERVAL_MS = int(os.environ.get("HONKER_RELAY_POLL_MS", "200"))

_running = True


def _on_signal(_signum, _frame):
    global _running
    _running = False


def open_conn() -> sqlite3.Connection:
    SQLITE.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(SQLITE)
    if HONKER_PATH and Path(HONKER_PATH).exists():
        conn.enable_load_extension(True)
        try:
            conn.load_extension(HONKER_PATH)
        except sqlite3.OperationalError as e:
            print(f"[honker-relay] load_extension failed: {e}", file=sys.stderr)
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
    return conn


def _report_collision(ev: dict, existing_payload: str) -> None:
    """Make a SILENT DROP LOUD (audit C2). INSERT OR IGNORE discards a row whose
    id already exists. That is benign when the payload is identical (the relay
    re-read the JSONL after a restart), but a REAL collision (same id, different
    payload) means an emitted event was lost from the SQLite mirror with no
    trace. Log to stderr AND append a durable infrastructure event (which gets a
    fresh, non-colliding id via the fixed _next_event_id scheme)."""
    sys.stderr.write(
        f"[honker_relay] EVENT ID COLLISION id={ev.get('id')} "
        f"incoming_type={ev.get('type')} — incoming event LOST from SQLite mirror "
        f"(stored payload differs from incoming)\n"
    )
    sys.stderr.flush()
    try:
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        import factory_events as fe  # lazy: a broken emitter must not crash the relay
        fe.emit_infrastructure(
            subtype="event_id_collision",
            message=f"honker relay dropped a colliding event id={ev.get('id')}",
            extras={
                "colliding_id": ev.get("id"),
                "incoming_type": ev.get("type"),
                "incoming_payload": json.dumps(ev.get("payload") or {})[:1000],
                "stored_payload": str(existing_payload)[:1000],
            },
        )
    except Exception as exc:  # noqa: BLE001 — never let collision logging break the relay
        sys.stderr.write(f"[honker_relay] failed to emit collision event: {exc}\n")
        sys.stderr.flush()


def insert_lines(conn: sqlite3.Connection, lines: list[str], report_collisions: bool = True) -> int:
    inserted = 0
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            ev = json.loads(line)
        except json.JSONDecodeError:
            continue
        try:
            incoming_payload = json.dumps(ev.get("payload") or {})
            cur = conn.execute(
                "INSERT OR IGNORE INTO factory_events (id, created_at, type, payload) "
                "VALUES (?, ?, ?, ?)",
                (ev["id"], ev["created_at"], ev["type"], incoming_payload),
            )
            if cur.rowcount:
                inserted += 1
            elif report_collisions:
                # id already present: benign duplicate (identical) or real
                # collision (differing payload = lost event). Only flag the latter,
                # and ONLY on the live tail — the initial full-file migration
                # re-reads history that contains known-legacy evt_<seq:06d> ids
                # which genuinely collided pre-fix; re-flagging those on every
                # restart would emit hundreds of noise events. Legacy ids
                # (no '_' separator) are never flagged regardless.
                evid = str(ev.get("id", ""))
                is_legacy = "_" not in evid  # new scheme is evt_<ms>_<pid>_<seq>
                if not is_legacy:
                    row = conn.execute(
                        "SELECT payload FROM factory_events WHERE id = ?", (ev["id"],)
                    ).fetchone()
                    if row is not None and row[0] != incoming_payload:
                        _report_collision(ev, row[0])
        except KeyError:
            continue
    if inserted:
        conn.commit()
    return inserted


def main() -> int:
    signal.signal(signal.SIGINT, _on_signal)
    signal.signal(signal.SIGTERM, _on_signal)

    conn = open_conn()

    # Initial migration: copy any rows in JSONL not yet in SQLite.
    last_offset = 0
    if JSONL.exists():
        with JSONL.open() as f:
            initial = f.read()
        # Initial full-file migration re-reads history (incl. known-legacy
        # colliding ids) — never report collisions here, only on the live tail.
        first_pass = insert_lines(conn, initial.split("\n"), report_collisions=False)
        last_offset = JSONL.stat().st_size
        print(
            json.dumps(
                {
                    "status": "honker_relay_started",
                    "jsonl": str(JSONL),
                    "sqlite": str(SQLITE),
                    "honker_path": HONKER_PATH,
                    "initial_inserted": first_pass,
                    "starting_byte_offset": last_offset,
                    "poll_interval_ms": POLL_INTERVAL_MS,
                }
            ),
            flush=True,
        )
    else:
        print(
            json.dumps(
                {
                    "status": "honker_relay_started",
                    "jsonl": str(JSONL),
                    "sqlite": str(SQLITE),
                    "honker_path": HONKER_PATH,
                    "warning": "jsonl_does_not_exist_yet",
                }
            ),
            flush=True,
        )

    # Tail loop.
    while _running:
        try:
            if not JSONL.exists():
                time.sleep(POLL_INTERVAL_MS / 1000.0)
                continue
            size = JSONL.stat().st_size
            if size < last_offset:
                # File was truncated/rotated. Re-read from the start.
                last_offset = 0
            if size > last_offset:
                with JSONL.open() as f:
                    f.seek(last_offset)
                    chunk = f.read()
                # If chunk doesn't end with a newline, the last line may be
                # partial — leave it for next iteration by rolling back the
                # offset to the last complete-line boundary.
                if chunk and not chunk.endswith("\n"):
                    last_complete = chunk.rfind("\n")
                    if last_complete == -1:
                        # No complete line yet.
                        time.sleep(POLL_INTERVAL_MS / 1000.0)
                        continue
                    chunk = chunk[: last_complete + 1]
                    last_offset += last_complete + 1
                else:
                    last_offset = size
                inserted = insert_lines(conn, chunk.split("\n"))
                if inserted:
                    print(
                        json.dumps(
                            {
                                "status": "honker_relay_tick",
                                "inserted": inserted,
                                "byte_offset": last_offset,
                            }
                        ),
                        flush=True,
                    )
        except Exception as exc:
            print(
                json.dumps(
                    {"status": "honker_relay_error", "error": str(exc)}
                ),
                flush=True,
            )
        time.sleep(POLL_INTERVAL_MS / 1000.0)

    conn.close()
    print(json.dumps({"status": "honker_relay_stopped"}), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
