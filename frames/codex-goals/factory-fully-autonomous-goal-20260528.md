# Goal: Make the dark factory run FULLY autonomously, every failure logged as an event, the factory picks it up, keeps working, and self-improves DETERMINISTICALLY

**Status:** open. Goal document, not an implementation plan — implementation tasks #13–#17 + #18–#23 (created below) carry it out.
**Created:** 2026-05-28
**Owner:** operator + Claude (with multi-agent fan-out as substrate)
**Scope:** the whole dark factory, end-to-end

## North star (one sentence)

> Every failure that occurs anywhere in the factory becomes an event, the event triggers a deterministic sequence of agent actions that fixes the underlying cause AND improves the factory's own ability to handle that class of failure in the future, with every step reproducible from the event log alone.

## Eval is the flywheel (Phil Hetzel maturity ladder — explicitly wired in)

Phil Hetzel (BrainTrust, AI Engineer talk 2026-05-28) names exactly the pattern this goal is chasing — he calls it "the flywheel," same word we use. His maturity ladder maps directly onto where the dark factory is and where it needs to go:

| Phil's level | Description | Dark factory state |
|---|---|---|
| **Level 0 — Vibes** | Just trust the agent. No measurement. | We were here pre-T6. |
| **Level 1 — Simple evals + LLM judges** | Eval an agent's final output via LLM-as-judge. Build ground-truth datasets for the judges themselves. | We have judge primitives (Theo/Rowan/Grace parsers ship) but NO ground truth, NO rubrics, NO eval-the-eval. |
| **Level 2 — Tool calls + CRUD + full trace evaluation** | Score the entire agent trace, not just the final output. Hard problem because CRUD changes state. | **We are here.** Pentagon agents do tool calls + repo CRUD. We evaluate NOTHING about the trace. |
| **Level 3 (emerging)** | Topic modeling on production failures + claude-code + eval-provider CLI loop. | This is the deterministic-self-improvement target of this goal. |

Phil's five load-bearing claims (each translated to a concrete factory requirement):

1. **"Treat evals like rerunning production, not running tests."** → factory-events.jsonl IS the production trace. The eval substrate REPLAYS those events through current agent + judge versions; deltas are the signal. (Task #16c + #26)
2. **"LLM-as-judge is fine, but eval the eval."** → Every judge verdict must be a recorded event with the judge's model+version. When downstream evidence proves a verdict wrong, emit `judge.error`. Per-judge accuracy is itself a tracked event-derived statistic. (Task #16b + #27)
3. **"Capture production data as the eval dataset."** → factory-events.jsonl gets snapshotted hourly; snapshots become the canonical eval dataset. (Task #26)
4. **"CRUD makes replay hard — represent system state in the trace itself."** → Every action that modifies state (commit, file write, conversation insert) must emit a factory event with the state-before + state-after hash. Replay reads that state from the event, not from current world. (Task #16c constraint)
5. **"Embrace LLM judges, but build ground-truth datasets so they stay aligned with what a human would decide."** → For each judge (Theo/Rowan/Grace + any LLM-as-judge we add), maintain a `agent-os/judges/<name>/ground-truth.jsonl` of human-graded examples. Judge promotion to a new model version requires the new judge to match the ground-truth at ≥X% before it activates. (Task #25 + #27)

This isn't an addendum to the goal — it IS the quality layer the goal hinges on. Without eval-the-eval, "deterministic self-improvement" devolves into "the LLM said the LLM did good." Phil's whole talk is the warning against exactly that.

## Why "deterministic"

The factory MUST NOT rely on "vibes" — LLM judgments that can't be replayed, agent choices that can't be re-derived, or behavior that depends on hidden state. Every:

- routing decision (which agent picks up a failure) is a function of `(event payload, routing config)` — pure
- judge verdict (PASS/FAIL on Maya's fix) is reproducible from `(diff, rubric, judge model+version)` — replayable
- self-improvement step (Sasha learns that script.crash routes better to Rowan than Maya) is recorded as an event, the routing config update is a recorded delta, and the next run uses the new config
- failure → fix attempt → outcome triple is logged so any future replay produces the same outcome unless inputs changed

This is the bet: the verifier was already deterministic. Now the factory's own self-improvement must be deterministic too.

## End-state acceptance criteria (the factory "works" when ALL hold)

| # | Criterion | How to verify |
|---|---|---|
| C1 | Every failure source emits a factory event with reason code + behavior + extras | `node scripts/factory-events-list.mjs --counts` shows non-zero counts for `behavior.failed`, `verifier.check_failed`, `infrastructure.*`, `script.crash`, `phoenix.dispatch_failed`, `pentagon_watchdog_error` |
| C2 | Honker substrate is daemonized; events surface to consumers in <500ms p99 | factory-health shows honker-relay running; emit→Sasha-action latency timed |
| C3 | Sasha + Phoenix + Blake daemonized 24/7; they survive bridge restarts, reboots, code edits | All 5 daemons green in factory-health after `factory-reload.sh` runs and `reboot`; KeepAlive verified |
| C4 | Phoenix autonomously dispatches failure → Pentagon agent → response → todo closed | `node scripts/factory-todos.mjs --counts` shows `completed > 0` with `dispatched_open` shrinking to 0 |
| C5 | Dispatched agents PRODUCE engineering deltas, not just chat | `git -C activegraph log --grep "FLYWHEEL_TODO"` shows commits attributed to flywheel dispatches |
| C6 | Every agent commit is reviewed by a different agent (Rowan) before it lands | `git log` shows reviewer in trailer; verifier asserts ROWAN_REVIEW_PASS exists per commit |
| C7 | Every reviewed commit triggers a test run; failure rolls back | CI signal recorded as event; revert commits land deterministically on test failure |
| C8 | Blake's caps are real values; runaway dispatches stop hard at cap | `factory-health` shows `$<cap_per_day` real spend; bridge auto-pauses at threshold |
| C9 | Replay determinism: re-running the factory against `frames/factory-events.jsonl` snapshot produces same routing/dispatch/outcome decisions | `node scripts/factory-replay.mjs --from <snapshot>` produces identical action stream |
| C10 | Self-improvement: when an agent fixes a failure, the routing config (which agent handles which reason) updates deterministically based on track record | Sasha's `routeFailureToAgent` reads `frames/factory-routing-config.json`; the config is updated by `scripts/factory-learn.mjs --from-events` which is itself replayable |
| C11 | Eval-the-eval: when an agent's PASS verdict is later proven wrong, the verdict is recorded as `judge.error`, the judge's accuracy drops, and the judge config can be updated | LLM-judge confidence is tracked as an event-derived statistic; judges with <X% historical accuracy are demoted |
| C11b | Each judge has a ground-truth dataset of human-graded examples (Phil's "eval the eval"); judge promotion to a new model version requires passing the ground-truth at ≥95% | `agent-os/judges/<name>/ground-truth.jsonl` exists; `scripts/factory-eval-judges.mjs` runs the candidate judge against ground-truth and gates promotion |
| C11c | Production-trace replay (Phil's "rerun production, not run tests"): factory-events.jsonl is the canonical eval dataset; new judge/agent versions are validated against the historical trace before activation | `scripts/factory-replay.mjs --from snapshot --version V` runs; emits `replay.divergence` events for any deltas |
| C12 | Failure-mode discovery: recurring failure shapes are auto-clustered, surfaced to operator | Topic modeling over the failure log produces named clusters; new clusters trigger `topic.discovered` events |
| C12b | CRUD-replay-safety (Phil's "CRUD makes replay hard"): every state-modifying action emits a factory event with state-before + state-after hash so replay reads state from the event log, not from the current world | Verifier scans events; any commit/file-write/conv-insert without before+after hashes is a check failure |
| C13 | No single point of failure: if bridge dies, watchdog restarts it; if a daemon dies, F1 detects + respawns | Killing any factory daemon → factory-health shows it back up within 60s |
| C14 | Cost is accurate (no triple-count); operator can see real $$$/hour at a glance | factory-health $ line matches Blake; matches Anthropic dashboard within 5% |
| C15 | Per-token arbitrage proof: at least ONE output→revenue pipeline measured and positive | Documented in CLAUDE.md backlog; cost-per-shipped-feature recorded; ratio > 1 |

## The deterministic improvement contract

Every self-improvement step MUST follow this shape:

```
(event_stream_snapshot, current_config) → new_config'  [pure function]
```

Concretely:

1. **Snapshot** the factory event log at time T (`frames/factory-events.jsonl` truncated to events <= T)
2. **Snapshot** the current routing/judge/policy config at time T (single JSON file, version-controlled)
3. **Compute** a proposed new config from those two inputs via a named scoring function (e.g. `scripts/factory-learn.mjs`)
4. **Diff** old config vs new config; show diff as a `factory.config.proposed` event
5. **Apply** when an explicit `factory.config.approved` event lands (operator one-tap OR Carmen-as-contract-owner agent agrees)
6. **Effective** at the next event the consumer processes

Replayability test: given snapshot at T, the SAME `factory-learn.mjs --version V` produces the SAME proposed config delta, byte-identical. No clock, no random, no network. The judge models themselves have a deterministic temperature=0 + pinned model version (`claude-opus-4-7@2026-05-27`).

When a judge model is upgraded, that is itself an event (`judge.model.upgraded`) with the old and new versions. All decisions before the event use the old judge; all after, the new. Replay is deterministic with respect to event order.

## Gaps to close (mapped to existing tasks + new ones)

### Substrate (must be solid before adding more autonomy)

- [x] **factory-events.jsonl unification** — every failure is an event (DONE pt.4)
- [x] **Honker realtime substrate** — events surface in <500ms (DONE pt.2)
- [x] **Phoenix closed loop** — failure → todo → dispatch → response → closed (DONE pt.3/pt.4/pt.5)
- [x] **Synthetic-event filter + 2-party guard** — prevent test contamination (DONE pt.5)
- [x] **Triple-count fix** — cost reporting accurate (DONE pt.6)
- [x] **Blake + factory-health filtered** — historical 3× inflation removed from dashboard (DONE this stretch)
- [ ] **Task #13** — `factory-reload.sh`: bootout+bootstrap daemons whose source files changed. (Code edits don't apply to running daemons; we hit this 3× this week.)
- [ ] **Task #14a** — real Blake budget caps in the plist (`--cap-per-day 50` or operator-chosen value)
- [ ] **Task #14b** — verify bridge LaunchAgent KeepAlive actually restarts on death (kill the process, watch launchd respawn within 10s)

### Action layer (the existential gap)

- [ ] **Task #15a** — extend Phoenix prompt template to allow commits. The current prompt explicitly forbids autonomous commits ("Do NOT autonomously commit"). Replace with: "Maya, you may commit to the worktree at $WORKTREE_PATH. Reply with `FLYWHEEL_TODO_<id>_COMMIT <sha>` on success, OR `FLYWHEEL_TODO_<id>_BLOCKED <reason>` if no fix is possible."
- [ ] **Task #15b** — Phoenix dispatches with worktree provisioning. For each flywheel todo, create `/tmp/flywheel-<todo_id>/` as a fresh git worktree off main. Maya works there. (Reuses the verifier's existing worktree pattern.)
- [ ] **Task #15c** — Bridge detects `FLYWHEEL_TODO_<id>_COMMIT <sha>` in agent replies, parses the sha, emits `flywheel.commit.proposed` event.
- [ ] **Task #15d** — On `flywheel.commit.proposed`, Phoenix-or-a-new-Atlas-daemon dispatches Rowan as code-reviewer of `git -C <worktree> show <sha>`. Rowan replies with `ROWAN_REVIEW_PASS <sha>` or `ROWAN_REVIEW_FAIL <sha> <reason>`.
- [ ] **Task #15e** — On `ROWAN_REVIEW_PASS`, the same daemon runs the test suite in the worktree (`.venv/bin/python -m pytest -q` per CLAUDE.md's c1c2603 lesson). Emits `flywheel.tests.passed` or `flywheel.tests.failed`.
- [ ] **Task #15f** — On `flywheel.tests.passed`, merge the worktree commit to a branch `flywheel-fixes-YYYYMMDD` and push. Emits `flywheel.commit.landed`. Phoenix closes the original todo with `completion_evidence=<sha>`.
- [ ] **Task #15g** — On any failure (commit rejected, review failed, tests failed), revert + emit `flywheel.attempt.rejected` with the reason. Sasha sees this as a new behavior.failed and the loop continues with the reason added to the dedup_key (so the next attempt has different context).

### Quality (Phil Hetzel's "eval is the flywheel" — Level 2 → Level 3 transition)

- [ ] **Task #16a** — Theo/Rowan/Grace LLM-judge rubrics formalized in `agent-os/rubrics/`. Each rubric = a YAML file listing pass/fail criteria. Judges call out which criterion they're invoking. Pinned judge model+version (e.g. `claude-opus-4-7@2026-05-27`). Rubric format includes a `failure_modes` enum so judge verdicts are categorical, not free-text.
- [ ] **Task #16b** — Eval-the-eval substrate. When a Rowan PASS is later proven wrong (test failed downstream, revert happened, operator noted the regression), emit `judge.error judge=rowan original_verdict_event_id=evt_X downstream_evidence=evt_Y`. Aggregate per-judge accuracy as an event-derived statistic. Per Phil: "you should eval the eval."
- [ ] **Task #16c** — Replay layer. `scripts/factory-replay.mjs --from <snapshot> --judge-version V` re-runs every judge call in the snapshot against judge version V and compares verdicts. Drift events emitted as `judge.replay.divergence`. Per Phil: "treat evals like rerunning production, not running tests."
- [ ] **Task #16d** — Topic modeling on failure log. `scripts/factory-topics.mjs` clusters `behavior.failed` events by reason+behavior+message embedding. New clusters → `topic.discovered` events. Operator decides if cluster becomes a new routing rule. Per Phil's "what's next" slide: emerging Level 3 pattern.
- [ ] **Task #25** — Judge model version pinning + promotion gate. Every judge call records `judge_model=<model>@<date>` in the event. Promoting a judge to a new model version requires passing the ground-truth dataset at ≥95% (configurable per judge). Promotion itself is an event (`judge.model.upgraded`) with old+new version. Replay before the event uses old judge, after uses new. Per Phil: "you would eval the eval as an eval."
- [ ] **Task #26** — Production-trace replay harness. `scripts/factory-replay.mjs` is the canonical eval method: takes a factory-events.jsonl snapshot, replays every dispatch + judge call through current factory configuration, emits divergence events. Becomes our pre-merge regression test for any factory code change. Per Phil: "capture production data as the eval dataset."
- [ ] **Task #27** — Ground-truth dataset construction. `agent-os/judges/<name>/ground-truth.jsonl` per judge (Theo, Rowan, Grace). Each entry is a (input, expected verdict, expected failure_mode) triple, human-graded. Operator-facing CLI `scripts/grade-judge-example.mjs` seeds these. Used by Task #25 promotion gate. Per Phil: "build ground-truth datasets so [judges] stay aligned with what a human would decide."
- [ ] **Task #28** — CRUD-replay-safety. Every state-modifying action (commit, file write, conv-insert, trigger-create, todo-mutation) emits a factory event tagged with `state_before_hash` + `state_after_hash`. Replay reads state from the event log, never from current world. Per Phil: "CRUD makes replay hard — represent system state in the trace itself."

### Self-improvement (the deterministic config layer)

- [ ] **Task #18** — Move Sasha's routing logic out of code into `frames/factory-routing-config.json`. `routeFailureToAgent(event)` reads the config. Changes to routing are config diffs, not code commits.
- [ ] **Task #19** — `scripts/factory-learn.mjs --from-events` — pure function: read event snapshot + current routing config, propose a new routing config based on which agent has the best historical success rate per `(reason, behavior)` pair. Emits `factory.config.proposed` event.
- [ ] **Task #20** — Operator approval path. `factory.config.approved` event activates the proposed config. (Could be a `@pullfrog approve` comment, an operator-typed event, or eventually Carmen-the-contract-owner-agent ACK.)
- [ ] **Task #21** — Replay determinism harness. `scripts/factory-replay.mjs` re-runs every event in the log through the current factory configuration; verifies the SAME routing decisions, the SAME judge calls, the SAME dispatches would have happened. Any divergence is a determinism bug.

### Efficiency (Brandon-A)

- [ ] **Task #17** — Pre-flight research packet. At trigger time, generate `(recent commits touching target, recent failures in target area, relevant CLAUDE.md sections, relevant prior conversation snippets)` and inject into the prompt. 6× efficiency leverage per Brandon's evidence.

### Survivability (no single point of failure)

- [ ] **Task #22** — F1 daemon proper (multi-week per CLAUDE.md backlog). Watchdog over the watchdog — detects when honker-relay, sasha, blake, phoenix die and respawns them. Also restarts the bridge if its LaunchAgent KeepAlive fails.
- [ ] **Task #23** — Bridge → activegraph dispatcher migration completion (consolidate Supabase helpers across bridge + runner + pentagon-rest.mjs, remove the duplicate auth code paths).

### Revenue (the existential check)

- [ ] **Task #24** — Per-token arbitrage proof. Pick ONE output→revenue pipeline (e.g. "factory ships N activegraph issues per week for $X total compute"). Measure cost-per-shipped-feature. Verify ratio > 1. (Existing CLAUDE.md backlog item, restated here.)

## Operator-side surface

The operator should be able to ask, at any time:

```
node scripts/factory-health.mjs          # what's the factory doing right now?
node scripts/factory-todos.mjs --counts  # what's in the backlog?
node scripts/factory-events-list.mjs --since 1h --counts  # what failed recently?
node scripts/factory-replay.mjs --check  # is the factory deterministic?
node scripts/factory-learn.mjs --propose # what config update is being proposed?
git -C activegraph log --grep FLYWHEEL_TODO  # what's the factory shipped?
```

Plus exactly two ON/OFF switches:

```
bash scripts/factory-activate.sh
bash scripts/factory-deactivate.sh
```

That's the entire interface. Everything else is automated and queryable.

## Anti-goals (what the factory MUST NOT do)

- **No autonomous push to operator-owned remotes without explicit Carmen-or-operator approval.** The factory can land commits on internal fix branches; pushing to `main` or to gagan114662/activegraph requires explicit ACK.
- **No autonomous spend over Blake's cap.** Period. The cap is a hard stop.
- **No silent judge upgrades.** Every model version change is an event.
- **No retroactive config changes.** Past decisions stay made; only future routing changes.
- **No multi-party conversation fan-out from Phoenix.** Every flywheel dispatch is a fresh 2-party conv. (Already enforced in pentagon-rest.mjs but anti-goal codified here.)
- **No suppressing failures.** A bug in the factory is still a failure event; Sasha sees it; Phoenix may dispatch a fix for the factory itself (meta-flywheel).

## Definition of done for this goal

When all 15 acceptance criteria (C1–C15) hold green for 7 consecutive days under real load, the goal is met. Mark this file `## Status: closed` and append to CLAUDE.md activity log.

## Order of attack (Claude's recommendation)

1. **Survivability + safety first** (#13, #14a, #14b) — half a day. Locks the foundation.
2. **Action layer** (#15a–#15g) — 1-2 days. The existential gap; converts chat-loop to code-loop.
3. **Brandon-A** (#17) — 1 day. Makes everything cheaper. Should land before scaling dispatch volume.
4. **Quality / eval substrate — Phil's Level 2 → Level 3 transition** (#16a–#16d + #25, #26, #27, #28) — 4-5 days. Eval-the-eval, ground-truth datasets, replay harness, CRUD-replay-safety. Needed before trusting any judge verdict, AND needed before the deterministic-self-improvement contract can even be defined.
5. **Deterministic self-improvement** (#18–#21) — 2-3 days. Reads from #25-#28's eval substrate. The contract that makes the factory provably-improving rather than vibes-improving.
6. **F1 daemon, refactor pass** (#22, #23) — multi-week. Hardens against single-point-of-failure scenarios.
7. **Revenue proof** (#24) — open-ended. Existential.

End-state estimate: ~3 weeks of focused work (revised up from 2 weeks after wiring Phil's eval substrate into the critical path). With the production-trace substrate already built (events + honker + phoenix + bridge dispatch), the remaining work is ~50% glue, ~30% new architecture (eval-the-eval + deterministic config + CRUD-state-in-trace), and ~20% ground-truth dataset construction (the unavoidable human effort).

---

_This document is the single source of truth for "what does the factory need to do." Update it when scope changes; never update CLAUDE.md activity log to contradict it._
