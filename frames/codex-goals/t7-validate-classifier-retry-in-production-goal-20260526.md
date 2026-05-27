# Goal: Re-fire runs 017 and 022 to validate classifier-retry in production

**Token budget:** 150K. STOP if any new failure mode appears or if a single target requires more than 3 infra retries.

## Why this exists

`856692b` extended the T7 classifier to handle `ghost_completion` (run 017's mode) and `no_trigger_timeout` (run 022's mode). Unit tests pass. **The retry policy has NOT yet been exercised end-to-end in production for these specific modes.** This goal validates the live integration before committing to T7 medium (75 more runs).

If Pentagon hits the same mode again on the retry, the harness should absorb it and retry up to 3 times per target. If Pentagon completes the work this time, the original target is satisfied and the run becomes a pass.

This is a 10-minute validation, not a new measurement.

## Bootstrap

1. Read `CLAUDE.md`.
2. Outer HEAD should be `856692b` or descendant. If not, STOP.
3. Read `frames/t7-native-repetition-progress-20260525.jsonl` to find the target symbols for runs 017 and 022.
4. Read `scripts/t7-repetition-harness.mjs` and `scripts/t7-repetition-classifier.mjs` to confirm the retry path for the new outcome classes.

## Task

### For each of runs 017 and 022:

1. Extract the target symbol from the original ledger entry.
2. Fire a fresh attempt using the SAME target symbol with hash:
   - `T7_REPEAT_EASY_20260525_017_RETRY_1` for run 017
   - `T7_REPEAT_EASY_20260525_022_RETRY_1` for run 022
3. Use a fresh seed UUID per attempt.
4. Generate per-run instruction file at:
   - `frames/t7-repeat-easy-017-retry-1-instruction-20260525.txt`
   - `frames/t7-repeat-easy-022-retry-1-instruction-20260525.txt`
5. Append the result to the ledger as a new entry (`run_idx=17_retry_1` and `run_idx=22_retry_1`).
6. The classifier should:
   - If Pentagon completes cleanly with proof + ACK → outcome=pass
   - If Pentagon hits `ghost_completion` again → `outcome_class=infrastructure_retry`, `infrastructure_failure_root_cause=ghost_completion`, harness retries
   - If Pentagon hits `no_trigger_timeout` again → `outcome_class=infrastructure_retry`, `infrastructure_failure_root_cause=no_trigger_timeout`, harness retries
   - If Pentagon hits ANY new mode not in {pass, narrative_wrapped_ack, message_poller_no_trigger_row, ghost_completion, no_trigger_timeout, runner_transport_after_dispatch} → STOP and report
7. The harness's retry budget is 3 attempts per target. If all 3 hit infra failures, escalate as `infrastructure_retry_exhausted` and stop that target.

### Sequence

Run 017's retry sequence first. Once it lands (pass or exhaustion), then run 022's retry sequence. Do NOT parallelize.

## Hard rules

- **Do NOT modify** the classifier, harness, verifier, runner, bridge, or instruction templates
- **Do NOT** fire any T7 medium runs
- **Do NOT** loosen any check
- **Do NOT** rewrite historical ledger rows for 017 / 022 — append new entries instead

## Reply with

For each target (017 and 022):
- Total attempts fired (1 to 3)
- Per-attempt: hash, trigger_id, claimed_at, completed_at, outcome_class, infrastructure_failure_root_cause (if any), wall_seconds
- Final classification (pass / infrastructure_retry_exhausted / new mode)
- Whether the harness retry policy fired automatically (no operator intervention)

After both targets:
- Updated harness summary via:
  ```bash
  node scripts/t7-repetition-harness.mjs --ledger frames/t7-native-repetition-progress-20260525.jsonl
  ```
- New pass_count, agent_failure_count, infra_retry_count, total_run_attempts
- Whether the classifier+retry integration worked as designed in production

Commit + push as ONE commit:
```
T7 easy: validate ghost_completion + no_trigger_timeout retry path in production (runs 017_retry_1, 022_retry_1)
```

## Validation outcome interpretation

This goal succeeds if:
- Both targets land in pass OR exhaustion within 3 attempts each
- No new failure modes appear
- The harness retry policy fires without operator intervention
- The classifier correctly applies `ghost_completion` or `no_trigger_timeout` if Pentagon hits those modes again

This goal fails (STOP and report) if:
- A new failure mode appears
- The harness retry doesn't auto-fire when it should
- The classifier misclassifies a result
- Pentagon stability has degraded further (e.g., a target requires > 3 retries)

If the goal fails, **T7 medium is blocked pending further investigation.** If it succeeds, T7 medium is unblocked.
