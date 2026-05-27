# Goal: Runner-side classification fix for `message_poller_no_trigger_row`

**Token budget:** 250K. STOP if scope grows beyond the runner + repetition-harness changes described below.

## Bootstrap

1. Read `CLAUDE.md` in full.
2. Read `frames/t7-message-poller-defect-investigation-20260525.log` (the investigation that motivated this fix).
3. Read `scripts/run-native-pentagon-task.mjs` — locate where it sets `native_pass=true` and where it reports `activation_path`.
4. Read whatever script drove the T7 repetition series (look for the loop that calls `run-native-pentagon-task.mjs` 14 times — the harness is somewhere in `scripts/` or the bridge).

## Problem statement

Pentagon silently skips `agent_triggers` row creation for ~7% of native T7-easy instructions (1/14 in run 014). The runner currently treats this as `native_pass=true` because Maya's ACK arrives via a fallback `message_poller_no_trigger_row` path. The verifier then correctly fails the run because no canonical trigger row anchors the audit chain.

**The runner is conflating "Pentagon dropped the audit row" with "agent succeeded." These are different categories.**

## Required changes (small, surgical)

### Change 1 — `scripts/run-native-pentagon-task.mjs`

When the runner observes `activation_path=message_poller_no_trigger_row`:

- Set `native_pass=false`
- Set a new field `outcome_class="infrastructure_retry"` (alongside the existing `verdict` field — do NOT remove or rename the existing fields)
- Include in the proof/log: the missing-trigger evidence — original instruction message_id, queried agent_triggers result (should be `[]`), Maya's ACK message ids
- The verifier should still be run (so the verifier output is captured), but the runner's own classification is `infrastructure_retry` regardless of verifier outcome

### Change 2 — T7 repetition harness

Locate the loop that drove T7-easy runs 001-014. For runs that return `outcome_class=infrastructure_retry`:

- Retry the SAME target symbol with a fresh hash + fresh seed (e.g. `T7_REPEAT_EASY_20260525_014_RETRY_1`)
- Max 3 retries per target (then escalate to operator-visible failure)
- Retry attempts are appended to the JSONL ledger with `outcome=infrastructure_retry` and a back-reference to the original run
- The FINAL outcome (after retries succeed or max retries hit) is what counts toward T7 pass rate

### Change 3 — Pass-rate denominator

Update the T7 progress reporting (the `.md` file) to compute pass rate as:

```
pass_rate = pass_count / (pass_count + agent_failure_count)
```

where `agent_failure_count` = `outcome_class == "fail_verifier"` AND failure root cause is agent-side (narrative-wrap or similar), NOT `infrastructure_retry`.

Add a SECOND metric for transparency:

```
infrastructure_failure_rate = infra_retry_count / total_run_attempts
```

This second metric tracks Pentagon's reliability separately from agent reliability. Both should be reported in the `.md`.

## Hard rules

- **Do NOT modify** `scripts/verify-pentagon-autonomy-from-logs.mjs` — verifier behavior unchanged
- **Do NOT change** the canonical-trigger rule from `b6c774c` — keep strict
- **Do NOT** add a runner-side fallback that synthesizes a fake trigger row in Supabase (that would be the T5R failure mode)
- The change is RUNNER classification + HARNESS retry policy, nothing else

## Self-test

The defect is hard to deterministically reproduce (Pentagon's silent skip is non-deterministic). Use these tests instead:

1. **Unit-test the classifier:** synthesize a mock runner result with `activation_path=message_poller_no_trigger_row` and confirm the runner now sets `native_pass=false`, `outcome_class=infrastructure_retry`.
2. **Unit-test the harness retry:** simulate a sequence of {infra_retry, infra_retry, pass} and confirm the harness retries twice then records the pass. Simulate {infra_retry × 3} and confirm escalation.
3. **Regression check:** re-grade run 014's existing data WITH the new classifier logic — it should now read as `outcome_class=infrastructure_retry`, NOT `fail_verifier`.
4. **Regression check:** re-grade runs 001-013 (known good) — none should reclassify as `infrastructure_retry`. (They should remain `pass` or `fail_verifier`.)

Document the self-test outcomes in:

```
frames/runner-classify-infra-failure-selftest-20260525.log
```

## Commit

Single commit, do NOT amend prior commits:

```
T7 runner: classify message_poller_no_trigger_row as infrastructure_retry, separate from agent variance
```

Push to `origin/main`.

## Reply with

- Commit SHA
- Each self-test outcome
- Whether run 014 now reclassifies (it should)
- Whether any of runs 001-013 reclassifies (none should)
- New pass-rate computation across all 14 runs after reclassification (expected: 12/13 = 92.3% on agent attribution, 1/14 = 7.1% infra failure rate)
- Confirmation that the verifier and canonical-trigger rule are unchanged

## After this lands

The operator will re-fire T7 easy runs 014_RETRY through 025 with the new classification active. The retry of run 014 will use the same target symbol so the result is comparable. T7 easy completes when the post-reclassification pass count reaches 23 (the gate) or the remaining-runs math makes it impossible.
