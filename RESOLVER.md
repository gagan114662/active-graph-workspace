# RESOLVER — context routing map

> Garry Tan / gbrain "resolver" pattern + the Stanford CS153 "Agentic Company" primitive
> **Filing rules = Internal process = where information lives.**
>
> Instead of dumping all ~1200 lines of `CLAUDE.md` into every agent's context (the
> context-pollution anti-pattern), this file is a **routing table**: *when an action touches file
> path X, load context doc(s) Y.* An agent (or `scripts/resolve-context.mjs`) consults this map to
> pull the exact knowledge a task needs — deterministically — instead of guessing the codebase
> structure or crawling the whole repo.
>
> Machine-readable: `scripts/resolve-context.mjs <path>` parses the RULES table below and returns the
> doc set a path maps to. The bridge's `researchPacketFor` consults it so every dispatch is
> pre-loaded with the right context.

## How to use
- **Editing code?** Find the first RULES row whose glob matches your target path; load those docs
  BEFORE acting. First match wins (most specific rows first).
- **Context doesn't fit any row?** Drop it in `inbox/` (see below) — that's the signal the schema
  needs a new row, not that you should cram it somewhere wrong.
- **Overlap?** A path that relates to two areas: prefer the more specific row; cross-reference rather
  than duplicate (MECE: every concern has ONE primary home).

## RULES
<!-- machine-parsed: | glob | docs (comma-separated) | why | -->

| glob | docs | why |
|---|---|---|
| `scripts/verify-pentagon-autonomy-from-logs.mjs` | `agent-os/context/discipline.md`, `agent-os/context/known-defects.md`, `frames/factory-determinism-audit-20260528.md` | The verifier is the heart of the system; load the discipline rules (esp. #3 never loosen it) + hardening history + gaming holes (in known-defects.md) before touching it. |
| `agent-os/context/**`, `CLAUDE.md` | `agent-os/context/discipline.md`, `agent-os/context/repo-layout.md`, `agent-os/context/README.md` | Discipline rules + repo layout are single-source here (P21 MECE migration). Load before governance/bootstrap edits; do NOT re-inline them into CLAUDE.md. |
| `scripts/factory-routing.mjs`, `agent-os/factory-routing-config.json`, `scripts/sasha-skeptic.mjs` | `memory/deterministic-routing-shared-module.md`, `agent-os/factory-routing-config.json`, `frames/factory-determinism-audit-20260528.md` | Routing is the shared deterministic decision fn; one source of truth — read the determinism contract first. |
| `scripts/pentagon-trigger-bridge.mjs`, `scripts/bridge_dispatch.py`, `scripts/pentagon-rest.mjs` | `agent-os/context/known-defects.md`, `memory/flywheel-cascade-risk.md` | The bridge is THE dispatch path; load the cascade-amplifier + orphaned-trigger defects before editing. |
| `agent-os/context/activity-log.md`, `agent-os/context/backlog.md` | `agent-os/context/activity-log.md`, `agent-os/context/backlog.md` | Session journal + open backlog (moved out of CLAUDE.md, P21 split pt.19). Read the activity log when picking up cold; the backlog for what's decided-but-not-started. |
| `scripts/phoenix-todo-keeper.mjs` | `frames/factory-determinism-audit-20260528.md`, `frames/codex-goals/safety-monitor-agent-backlog-20260528.md` | Phoenix is the action layer (review gate + commit + safety gate). |
| `agent-os/rubrics/**`, `agent-os/judges/**` | `frames/codex-goals/skillopt-adoption-20260528.md`, `agent-os/judges/<judge>/ground-truth.jsonl` | Editing a judge rubric → load the eval suite + ground truth (the canonical resolver example from the talk). |
| `scripts/safety-monitor.mjs` | `frames/codex-goals/safety-monitor-agent-backlog-20260528.md` | Sentinel harm-gate design + the harm rubric. |
| `scripts/factory-events.mjs`, `scripts/factory_events.py`, `scripts/honker_*.py` | `memory/python-event-id-collision-fix.md`, `memory/honeycomb-factory-events.md` | Event emission + the realtime substrate; collision-resistant id scheme matters. |
| `activegraph/**` | `activegraph/CLAUDE.md`, `activegraph/tests/**` | Inner package — its own context + test suite (run `.venv/bin/python -m pytest`). |
| `frames/codex-goals/**` | `frames/codex-goals/factory-fully-autonomous-goal-20260528.md` | Goal-doc convention for long prompts. |
| `scripts/launch-agents/**`, `scripts/factory-activate.sh`, `scripts/factory-reload.sh` | `memory/factory-activation-checklist.md`, `memory/panic-kill-switch.md` | Daemon lifecycle — activation + reload + the PANIC kill switch. |
| `RESOLVER.md`, `scripts/resolve-context.mjs` | `frames/codex-goals/resolver-framework-backlog-20260528.md` | This map itself + its routing tool. |

## inbox/
Context that doesn't cleanly map to a row above goes in `inbox/` with a short note. A growing `inbox/`
is the architectural signal that the routing schema needs a new row — resolve it by adding a RULES row
and moving the doc to its MECE home, not by leaving it in `inbox/`.

## Roadmap (full MECE split — staged)
Today the docs above are mostly `CLAUDE.md#section` anchors + `frames/` + `memory/` files. The next
step (per `frames/codex-goals/resolver-framework-backlog-20260528.md`) is to split the 1200-line
`CLAUDE.md` into MECE topic docs under `agent-os/context/` (dispatch / verifier / flywheel / cohort /
defects / activity-log) so each row points at a focused doc, and make `CLAUDE.md` a thin index that
points here. The routing mechanism (this file + `resolve-context.mjs`) works now and is forward
-compatible with that split.
