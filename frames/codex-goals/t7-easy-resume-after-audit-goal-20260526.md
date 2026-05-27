# Goal: Resume T7 easy after the audit + classifier fix

**Token budget:** 900K. STOP if any of the abort conditions below trip.

## Bootstrap

1. Read `CLAUDE.md` in full.
2. Read `frames/t7-native-repetition-progress-20260525.{jsonl,md}` — current state ends at run 014.
3. Read `scripts/t7-repetition-classifier.mjs` and `scripts/t7-repetition-harness.mjs` — the infrastructure-retry policy you must use.
4. Read `frames/dirty-edits-audit-20260526.md` — confirms the verifier on origin/main is now the verifier that graded prior runs.

## Current state

- Outer HEAD: `95d6b31` (T7 enablement audited + committed)
- Runs 001-014 recorded in the ledger
- Run 008 is an agent failure (narrative-wrapped ACK; known mode; counts against pass rate)
- Run 014 is an infrastructure_retry per the classifier (Pentagon silently skipped trigger row creation; does NOT count against pass rate per `83f9344` policy)
- Current agent-attributed pass rate: 12/13 = 92.3%
- Current infrastructure_failure_rate: 1/14 = 7.1%

## Task

### Part 1 — Retry run 014

Use the same target symbol as run 014 (`activegraph.core.graph.Relation.to_dict`) with a fresh hash and seed:

- `hash=T7_REPEAT_EASY_20260525_014_RETRY_1`
- Fresh `seed` UUID
- New instruction file `frames/t7-repeat-easy-014-retry-1-instruction-20260525.txt`
- Append the result to the ledger as `run_idx=14_retry_1` (or whatever scheme is consistent with the harness retry policy from `83f9344`)

If this retry succeeds (`outcome=pass`), the agent has completed run 014's target. Move on.

If this retry produces another `infrastructure_retry`, do up to 2 more retries (max 3 total per harness policy). After 3 retries, ESCALATE — stop the goal and report.

### Part 2 — Runs 015 through 025

For each remaining run:

- Generate `hash=T7_REPEAT_EASY_20260525_NNN` where NNN is 015..025
- Fresh seed UUID per run
- Fresh target symbol (different from all prior runs — including 014's retry)
- Same instruction template as runs 006-009 (do NOT modify it)
- Per-run instruction file, run log, proof file
- Append to ledger with the new classifier fields populated

### Commit cadence

Batch commits every 4-5 runs. Commit message format:

```
T7 easy repetition runs <range>: <pass_count>/<batch> pass, <agent_pass_rate>%/<infra_rate>% so far
```

## Hard rules

- **Do NOT modify the verifier** (`scripts/verify-pentagon-autonomy-from-logs.mjs`)
- **Do NOT modify the easy instruction template**
- **Do NOT loosen** any verifier check or canonical-trigger rule
- Sequential runs only; **NO parallelization**
- Each run uses the per-run instruction file pattern Codex established for runs 006-009
- Use the harness from `scripts/t7-repetition-harness.mjs` to drive runs and apply retry policy

## Abort conditions (STOP and report; do NOT continue)

1. **Agent-attributed pass rate** falls below `(passes_needed_in_remaining > remaining_runs)` — meaning 23/25 gate becomes mathematically impossible. Math: at any point, if `(23 - current_pass_count) > remaining_agent_attempts_left`, STOP.
2. **Three consecutive infrastructure_retry results** at the same target (means the Pentagon defect is hitting that symbol pathologically — escalate)
3. **New failure mode encountered** beyond {pass, narrative_wrapped_ack, infrastructure_retry, watchdog-handled activation hiccups}. Report and stop.
4. **Watchdog restart count exceeds 10** across this batch (Pentagon is degrading; investigate before continuing)
5. Token budget approaches 800K — wrap up the current batch, commit, and stop.

## After the run series completes (or aborts)

Recompute final metrics via:

```bash
node scripts/t7-repetition-harness.mjs --ledger frames/t7-native-repetition-progress-20260525.jsonl > /tmp/t7-final.out 2>&1
echo "exit=$?"
cat /tmp/t7-final.out
```

This is the authoritative metric source per the classifier policy.

Update `frames/t7-native-repetition-progress-20260525.md` with the final summary including:
- `pass_count`, `agent_failure_count`, `infra_retry_count`
- `pass_rate_percent`, `infrastructure_failure_rate_percent`
- Whether 23/25 = 92% gate was cleared
- p50 / p95 wall time
- Watchdog restart count over the series

## Reply with

- Final run index reached (e.g. 025, or where stopped)
- Total pass count, agent failure count, infra retry count
- Agent-attributed pass rate %, infrastructure failure rate %
- Whether the 92% gate cleared, missed, or was aborted before reachable
- All commit SHAs from this batch
- Any new failure modes encountered

If the gate cleared cleanly, mark T7 easy as Sample 25 complete and report what the data says. If it didn't, the result is still valuable — it's the first honest reliability measurement in the project's history under audited verifier code.
