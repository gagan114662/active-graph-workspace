# Goal: Resume T7 medium (runs 015-025) after classifier extension

**Token budget:** 800K. STOP at any of the abort conditions below.

## Why this exists

T7 medium stopped at run 014 with a new failure mode (`late_ack_after_trigger_completed`) per abort condition #3. The classifier extension landed in commit `7b256ce` (2026-05-27); the new mode is now classified as retryable infra. Run 014 specifically resolves via the harness's work-at-HEAD path (Maya's commit + test file + proof file all at HEAD), so it counts as a pass in the harness summary.

Current T7 medium state per `node scripts/t7-repetition-harness.mjs --ledger frames/t7-native-repetition-progress-medium-20260526.jsonl`:

```
pass_count: 13
agent_failure_count: 0
infra_retry_count: 4
late_ack_resolved_count: 1
total_run_attempts: 17
pass_rate_percent: 100.0 (agent-attributed)
infrastructure_failure_rate_percent: 23.5
```

Remaining: 11 runs (015 through 025). The 22/25 = 88% gate requires 22 passes; currently at 13. Need 9 of next 11 to clear (≤ 2 agent failures permitted, plus any infra retries the harness absorbs automatically).

## Bootstrap

1. Read `CLAUDE.md`.
2. Outer HEAD should be `7b256ce` (the classifier extension) or descendant. If not, STOP.
3. Read `frames/codex-goals/t7-medium-goal-20260526.md` — the per-run protocol is unchanged. Reference it for instruction template, hash format, proof shape, ledger fields.
4. Read `frames/t7-native-repetition-progress-medium-20260526.jsonl` to see the current state of the ledger.

## Pre-flight (must pass before any run fires)

```bash
pgrep -fl "Pentagon.app/Contents/MacOS" | head -2
pgrep -fl pentagon-trigger-bridge | head -2
```

If Pentagon is dead, launch it: `open -a Pentagon` and wait 5s. If bridge is dead, the LaunchAgent will auto-respawn; verify.

If either remains absent after 30s, STOP and report — operator handles infrastructure restart manually before the goal continues.

## Task

For each `NNN` from 015 to 025 sequentially:

- Hash: `T7_REPEAT_MEDIUM_20260526_NNN`
- Fresh seed UUID per run
- Per-run instruction file: `frames/t7-repeat-medium-NNN-instruction-20260526.txt`
- Per-run log: `frames/t7-repeat-medium-NNN-run-20260526.log`
- Per-run proof: `frames/t7-repeat-medium-NNN-20260526.proof` (accept either outer or inner path)
- Same instruction template + protocol as runs 001-013 per `frames/codex-goals/t7-medium-goal-20260526.md`
- Append result to `frames/t7-native-repetition-progress-medium-20260526.jsonl` with full field set including all classifier fields (`outcome_class`, `infrastructure_failure_root_cause` when applicable, `late_ack_evidence` when applicable, etc.)
- Update `frames/t7-native-repetition-progress-medium-20260526.md` after each batch

### Classifier + retry policy

- Use `scripts/t7-repetition-classifier.mjs` and `scripts/t7-repetition-harness.mjs` exactly as committed in `7b256ce`.
- All 4 Pentagon defect modes are now retryable infra: `message_poller_no_trigger_row`, `ghost_completion`, `no_trigger_timeout`, `late_ack_after_trigger_completed`.
- Retry budget: 3 per target.
- `runner_transport_after_dispatch`: outcome stays pass if verifier confirms work, no retry.
- For `late_ack_after_trigger_completed`: harness will auto-check work-at-HEAD; if Maya's commit + test_file + proof are present, mark pass instead of retrying.

## Commit cadence

Batch commits every 3-5 runs. Format:

```
T7 medium repetition runs <range>: <pass>/<batch> pass, <agent_rate>%/<infra_rate>% so far
```

## Hard rules

- **Do NOT modify** classifier, harness, verifier, runner, bridge, or instruction template
- **Do NOT loosen** any check
- **Sequential only** — no parallelization
- **Do NOT** trigger Quinn or any other agent — T7 medium is Maya-only
- **Do NOT** rewrite historical ledger rows

## Abort conditions (STOP and report; do NOT continue)

1. **88% gate mathematically unreachable.** At any point during runs 015-025, if `(22 - current_pass_count) > remaining_agent_attempts_left`, STOP. (Current pass count starts at 13; need 9 more in 11 attempts; ≤ 2 agent failures permitted.)

2. **Three consecutive `infrastructure_retry_exhausted` results** at different targets. A single target exhausting is acceptable (Pentagon's defect, not Maya's); three different targets all exhausting suggests Pentagon degradation that needs operator review.

3. **New failure mode encountered** beyond the known set: {pass, narrative_wrapped_ack, message_poller_no_trigger_row, ghost_completion, no_trigger_timeout, late_ack_after_trigger_completed, runner_transport_after_dispatch}. Report and stop.

4. **Watchdog restart count exceeds 5 within this batch.** Counter is **session-scoped to runs 015-025 only** (operator decision 2026-05-27: prior 10 restarts spanned multiple session boundaries and pre-date the classifier extension; lifetime counting is too aggressive). 5 restarts within this single batch would indicate Pentagon is genuinely degrading, not just session-end staleness.

5. **Token budget approaches 700K.** Wrap the current batch, commit, and stop short of 025 if needed.

## Final summary

After completion (or abort):

```bash
node scripts/t7-repetition-harness.mjs --ledger frames/t7-native-repetition-progress-medium-20260526.jsonl
```

Update `frames/t7-native-repetition-progress-medium-20260526.md` with:
- Final pass_count, agent_failure_count, infra_retry_count, late_ack_resolved_count, total_run_attempts
- pass_rate_percent (agent-attributed), infrastructure_failure_rate_percent
- Whether the 22/25 = 88% gate cleared
- p50 / p95 wall time
- Watchdog restart count (session-scoped, this batch only)
- Distribution of `infrastructure_failure_root_cause` across this batch

## Reply with

- Final run index reached
- Pass count, agent failure count, infra retry count, late_ack_resolved count, total attempts
- Agent-attributed pass rate, infrastructure failure rate
- Whether the 88% gate cleared, missed, or aborted
- All commit SHAs from this batch
- Any new failure modes encountered (should be zero per abort condition #3)
- Wall time distribution (median + max)
- Watchdog restart count for this batch (session-scoped)

After clean completion, T7 medium graduates as a measurement. Next decision: fire the agent model migration goal (gpt-5.5/codex → opus-4.7/claude-code) before T7 hard begins.
