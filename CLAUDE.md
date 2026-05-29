# Claude Context — active_graph Dark Factory

**Last updated:** 2026-05-29 (pt.19 — P21 lean-rulebook split: journal/backlog/defects moved to agent-os/context/, RESOLVER-routed)
**Maintained by:** Claude. The user updates lightly; the agent updates after each working session.

## Active cohort

As of 2026-05-28 (pt.9) all 20 active_graph Pentagon agents run on the **opus-4.8-claude-code-2026-05-28** cohort (migrated from opus-4.7 on 2026-05-27):

- provider: `claude-code`
- model: `claude-opus-4-8`
- harness_id: `claude-code`
- Pentagon default model: `claude-opus-4-8[1m]` (note `[1m]` suffix for 1M-context variant)

Canonical source of truth: `agent-os/agent-cohort.json`. The verifier reads it via `loadCohortExpectations()` and checks live DB rows against it. Pre-migration snapshots: `/tmp/active-graph-agents-pre-migration.json`. Post-migration: `/tmp/active-graph-agents-post-migration.json`. Bulk migration log: `frames/migrations/bulk-20260527.jsonl`.

**Cohort separation for variance measurement:**
- T6 sample 1 (easy/medium/hard/extra-hard), T7 easy, and T7 medium runs 001-014 = **gpt-5.5-codex-2026-05-22 cohort**.
- T7 medium runs 015+ onwards, T7 hard/extra-hard, T8+ = **opus-4.7-claude-code-2026-05-27 cohort**.
- Sample sizes do not mix across cohorts.

## If you're a fresh Claude session, read this first

You're working on a "dark factory" project — autonomous, auditable software production. The user is building this seriously, not as a demo. Today's discipline has been: refuse soft-fails, verify independently, never let the verifier lie.

Before doing anything substantive in this repo:

1. Read this whole file
2. Run `git log --oneline -30` in both the outer repo (this dir) and `git -C activegraph log --oneline -10` for the inner repo
3. Read `scripts/verify-pentagon-autonomy-from-logs.mjs` — this is the heart of the system
4. Glance at `frames/t6-real-autonomy-gauntlet-2026-05-23.md` — the T6 spec
5. Check `frames/` for recent `.log` and `.proof` files to see current state
6. Update this file at the END of any working session (the bottom has an Activity Log section)

Don't trust this file as the ground truth — verify with git/file system. But use it as the bootstrap.

## What this project is

**Goal:** Prove that AI agents can produce production-ready, bug-free software autonomously with full auditability. The system is "dark factory" — agents do engineering work, a verifier independently confirms each result, an event store records every step.

**The bet:** the discipline of building real verification (not the model itself) is the moat.

## Repository layout

→ Single source: **`agent-os/context/repo-layout.md`** (P21 MECE migration). Short version: outer
repo = scripts/frames/agent-os; inner repo = `activegraph/.git/` (the Python package + Maya's
commits); **always `git -C activegraph`** for inner-repo ops.

## The T-tier ladder

| Tier | Proves | Status |
|---|---|---|
| T6 (capability) | Factory can do real engineering once per task class | **easy ✅ medium ✅ hard ✅ extra-hard ✅ — all 4 sub-tiers cleared at sample 1** |
| T7 easy (reliability sample) | Easy tier is repeatable at scale | **measured 2026-05-26: 27 attempts (25 fresh + 2 validation retries per `a069a91`), 21 pass, 1 agent fail, 5 infra retries. Agent-attributed pass rate=95.5% (21/22). Infrastructure failure rate=18.5% (5/27). Raw 23/25 gate missed on the original 25 (19); validation retries pushed total passes to 21. Honest agent-rate gate exceeded. Production validation confirms classifier+retry integration; Pentagon's auto-recovery-on-retry path under stress is NOT yet stress-tested (today's retries passed first try).** |
| T7 medium (opus-4.8) | Reliability at medium tier | **✅ 25/25 uniform PASS (honest harness, pt.16-17)** |
| T7 hard (opus-4.8) | Reliability at hard tier | **20/25 graded — 80% first-attempt, gate ≥19 met; verifier rejected 5 genuinely-flawed first attempts (pt.17)** |
| T7 extra-hard | Reliability at 5-agent chain tier | ⏸ helper not built (operator-supervised) |
| T8–T12 (reliability ladder) | Generalization beyond easy tier | ⏸ not started; spec in `frames/t7-t12-scale-reliability-gauntlet-2026-05-23.md` |
| T13–T17 (survivability) | Factory survives attacks, incidents, makes money, stays current | ⏸ not started; spec in `frames/t13-and-beyond-factory-survivability-2026-05-23.md` |
| Post-baseline | Flywheel + business validation | spec in `frames/post-baseline-flywheel-roadmap-2026-05-23.md` |

**Honest sample sizes: T6-easy=1, T6-medium=1, T6-hard=1, T6-extra-hard=1.** All four sub-tiers honestly green. **T6 capability ladder is now complete at sample 1.** Sample 1 ≠ reliability — T7 is the first tier that measures variance.

## Critical files

| File | What it is |
|---|---|
| `scripts/verify-pentagon-autonomy-from-logs.mjs` | The verifier. Has modes `--t6 --tier={easy,medium,hard}`, `--t6-debug-events`. ~900+ lines. PASS/FAIL via `must()`, WARN is advisory, `--no-db` skips DB queries. |
| `scripts/run-native-pentagon-task.mjs` | Triggers an agent gauntlet task and waits for a proof file. |
| `scripts/pentagon-trigger-bridge.mjs` | The bridge between outer-repo orchestration and Pentagon desktop app. |
| `frames/t6-real-autonomy-gauntlet-2026-05-23.md` | T6 spec |
| `frames/t6-native-{easy,medium,hard}-*-instruction-20260523.txt` | Maya/Quinn instruction files used at runtime |
| `frames/t6-{easy,medium,hard}-proof-fixture-{good,bad}*.txt` | Verifier self-test fixtures |
| `activegraph/frames/t6-native-gauntlet-{tier}-20260523.proof` | Real proof files from agent runs |
| `agent-os/AGENT_IDENTITY_MAP.md` | Org chart of named agents (Maya, Quinn, Sasha, Sofia, Grace, Riley, Sam, etc.) |
| `agent-os/RELIABILITY_OPERATING_CONTRACT.md` | Operating contract the agents follow |

## Discipline rules that NEVER bend

→ Single source: **`agent-os/context/discipline.md`** (P21 MECE migration). The 10 rules in one line
each: (1) verify independently; (2) no-pipe exit capture; (3) never loosen the verifier; (4) no
destructive ops without authorization; (5) sample 1 ≠ reliability; (6) activation bottleneck is
systemic (native poller is dead — bridge is the path); (7) `agent_runtime_events` empty → audit via
ACK; (8) Quinn dispatch operator-driven; (9) RESOLVER-first context; (10) epistemic discipline. Read
the doc before relying on any of them.


## The user

- **Email:** gagan@getfoolish.com
- **Building:** the dark factory described above
- **Working style:** long sessions (12+ hours), heads-down, demands real verification not narrative wins
- **Demonstrated behavior:** repeatedly catches soft-fails, refuses to push through, treats each defect as a real finding
- **Tool stack:** Codex CLI is the agent runtime; Pentagon.app is the desktop orchestrator; Supabase is the event store
- **Other personal config:** uses `but` (GitButler CLI) instead of raw `git` for commits (per global memory); uses gstack workflow tools (separate from this project)
- **Note:** the user does NOT want `git commit` to be invoked manually by Claude after a task — GitButler hooks handle commits. Per global instructions.


## What I (Claude) commit to

- Play **Sasha-skeptic by proxy** when adversarial agents aren't yet integrated. Read the diff. Read the test bodies. Don't just trust the verifier output.
- **Re-verify everything** the user reports back from Codex, using independent commands.
- **Update this file** at the end of every working session — append to the Activity Log, update the T-tier scoreboard, add new gaming holes to the backlog.
- **Flag any backsliding** toward T5R-style "passing through transcription" — the whole point of this project is to not do that.


## Reference docs (load on demand — RESOLVER-routed, NOT loaded every session)

The chronological journal, backlog, and defect tables used to live inline here and bloated
this file to 1,622 lines (~83% journal). Per the P21 lean-rulebook split (pt.19) they now
live as focused docs so the always-loaded rulebook stays small (lean context = sharper agent).
Read the relevant one on demand; `RESOLVER.md` routes to them by task:

- **`agent-os/context/activity-log.md`** — full session journal (pt.1…latest) + logged decisions. Read this if picking up cold or tracing why something was built. Most recent at the bottom.
- **`agent-os/context/backlog.md`** — decided-but-not-started work (strategic, org-chart, flywheel, pattern adoptions, hygiene, capability ladder).
- **`agent-os/context/known-defects.md`** — known factory defects, verifier gaming holes, and the verifier hardening history.
- **`agent-os/context/discipline.md`** — the 10 discipline rules (single source; summarized above).
- **`agent-os/context/repo-layout.md`** — outer/inner repo layout (single source; summarized above).

At the END of a working session, append your entry to `agent-os/context/activity-log.md`
(not here) and add any new defects to `known-defects.md` / new todos to `backlog.md`.
