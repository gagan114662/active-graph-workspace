# active-graph-workspace

Gagan's dark factory: an autonomous, auditable software-production system
that drives [activegraph](https://github.com/gagan114662/activegraph)
agents on the operator's Claude Code MAX subscription.

## What's running right now

| Service | What it does | Process |
|---|---|---|
| **Pentagon bridge** | Dispatches Pentagon agent triggers via `claude` CLI (or the unified Python dispatcher, see #28). | `scripts/pentagon-trigger-bridge.mjs` (launchd) |
| **Sasha-skeptic** | Tails `frames/factory-events.jsonl`; pauses bridge on `behavior.failed reason=llm.rate_limited`. | `scripts/sasha-skeptic.mjs` |
| **Blake Budget Marshal** | Aggregates `llm.responded` cost across hour/day/session windows; pauses bridge on cap breach. | `scripts/blake-budget-marshal.mjs` |
| **F1 daemon** | Watchdog of watchdogs — emits `daemon.heartbeat`; respawns dead daemons. | `scripts/f1-daemon.mjs` |
| **Slack adapter** | Forwards `behavior.failed`, `daemon.down`, `script.crash`, `verifier.check_failed` to a Slack webhook. | `scripts/slack-adapter.mjs` |
| **Puter** | Self-hosted internet computer; each Pentagon agent has its own user. | `http://puter.localhost:4100` |
| **Honker substrate** | SQLite `LISTEN`/`NOTIFY` for the factory event log. | `~/.local/lib/libhonker_ext.dylib` |
| **Pullfrog runner** | Self-hosted GitHub Actions runner that lets `@pullfrog` comments invoke claude. | `~/actions-runner-active-graph/` (launchd) |

## Architecture in 4 lines

1. Every dispatch (success + failure) emits an activegraph-shaped event to `frames/factory-events.jsonl`.
2. Bridge + verifier + runner + helpers + ClaudeCodeCliProvider all write to the same log.
3. Sasha, Blake, F1 consume the log. Slack adapter forwards alerts.
4. activegraph itself runs on the operator's Claude Code subscription via `ClaudeCodeCliProvider` — no API key.

## Quick query

```bash
node scripts/factory-events-list.mjs --counts                # histogram of all events
node scripts/factory-events-list.mjs --type behavior.failed  # only failures
node scripts/factory-events-list.mjs --reason llm.rate_limited
node scripts/factory-events-list.mjs --since 2026-05-27T16:00:00Z
node scripts/factory-arbitrage-meter.mjs                     # cost-per-run, output tokens per dollar
```

## Key files

| Path | What it is |
|---|---|
| `CLAUDE.md` | Bootstrap doc — read first if you're a fresh Claude session. |
| `agent-os/agent-cohort.json` | Canonical (provider, model, harness_id) for all 20 agents. Verifier reads this. |
| `agent-os/RELIABILITY_OPERATING_CONTRACT.md` | Operating contract every Pentagon agent follows (now includes Brandon-B "satisfaction of search" rule). |
| `scripts/bridge_dispatch.py` | #28 unifier — Python dispatcher that uses activegraph's `ClaudeCodeCliProvider`. |
| `scripts/factory-events.mjs` / `factory_events.py` | Node + Python emitters writing to the same JSONL. |
| `scripts/honker_listen.py` | Honker-backed realtime listener with JSONL polling fallback. |
| `scripts/research-packet.mjs` | Brandon-A pre-flight research packet generator. |
| `frames/factory-events.jsonl` | Single source of truth for all dispatch events. |
| `frames/factory-events.sqlite` | Honker-aware SQLite mirror. |
| `frames/remaining-todos-v0-design-2026-05-27.md` | Design specs for items not yet shipped. |

## What's in the merged repo (`gagan114662/activegraph`)

This workspace has been merged into a single repo at
[`gagan114662/activegraph`](https://github.com/gagan114662/activegraph)
on `main`. The Python library lives at root (`activegraph/`, `examples/`,
`tests/`, `docs/`). The dark-factory operator tooling lives at the same
root level (`scripts/`, `frames/`, `agent-os/`, this README mirrored as
`DARK_FACTORY_README.md`).

This `active-graph-workspace` repo continues to mirror the working tree
on the operator's Mac.

## How it was built

Long story, ~12-hour session 2026-05-27. See:
- `CLAUDE.md` for the architectural rules and the activity log
- `frames/codex-goals/` for the goal-mode prompts used along the way
- `frames/migrations/` for cohort migration evidence
- `frames/brandon-d-frozen-evidence-audit-2026-05-27.md` for the cache-staleness audit
