# Goal: T7 medium — 25 reliability samples of medium-tier engineering

**Token budget:** 1.2M. STOP at any of the abort conditions below.

## Bootstrap

1. Read `CLAUDE.md`.
2. Outer HEAD should be `a069a91` (the T7 easy validation) or descendant. If not, STOP.
3. Read `frames/t6-real-autonomy-gauntlet-2026-05-23.md` (the MEDIUM section).
4. Read `frames/t6-native-medium-instruction-20260523.txt` (the existing medium instruction template — adapt for T7 hash format).
5. Read `scripts/t7-repetition-classifier.mjs` and `scripts/t7-repetition-harness.mjs` (the classifier + harness from `83f9344` + `856692b`).
6. Read `frames/t7-native-repetition-progress-20260525.jsonl` for reference on T7 easy's per-run data shape; T7 medium uses the same shape with its own ledger.

## Current state

- T7 easy graduated empirically: **95.5% agent-attributed pass rate (21/22), 18.5% Pentagon infrastructure failure rate (5/27)**.
- Classifier handles 4 known Pentagon defect modes (`message_poller_no_trigger_row`, `ghost_completion`, `no_trigger_timeout`, `runner_transport_after_dispatch`).
- Harness retry policy validated live (`a069a91`).
- Pentagon poller watchdog active (`af57375`); auto-restarts on > 60s unclaimed triggers, 5-min cooldown.

## Task — T7 medium, 25 fresh runs

For each run, `NNN` from `001` to `025`:

### Per-run protocol

- **Hash:** `T7_REPEAT_MEDIUM_20260526_NNN`
- **Seed:** fresh UUID per run (prepended as `RUN_SEED=<uuid>` per the T7 instruction format)
- **Target selection:** pick ONE public API surface in `activegraph/activegraph/` that is currently NOT covered by any file in `activegraph/tests/`. Different target every run; sample without replacement against the candidate set. Confirm coverage gap with:
  ```bash
  uv run pytest --collect-only -q -k <symbol>
  ```
  Must return 0 collected tests for that symbol.
- **Instruction file:** `frames/t7-repeat-medium-NNN-instruction-20260526.txt`. Pattern after `frames/t6-native-medium-instruction-20260523.txt` with:
  - `RUN_SEED=<fresh_uuid>` line prepended
  - Hash replaced with `T7_REPEAT_MEDIUM_20260526_NNN`
  - Test file path `activegraph/tests/test_<feature>_t7m_NNN_coverage.py`
  - Proof file path `frames/t7-repeat-medium-NNN-20260526.proof` (accept either outer or inner per the verifier's path-variants resolver)
- **Maya's deliverables (per the T6 medium spec):**
  - Pick uncovered symbol
  - Write ≥2 tests in `activegraph/tests/test_<feature>_t7m_NNN_coverage.py` exercising the API in distinct configurations (no mocks of the API under test)
  - Run new tests alone — all green
  - Run full suite — `pytest_after >= pytest_before` (no regression)
  - Confirm `pytest --collect-only -k <uncovered_symbol>` returns ≥ 2 at HEAD
  - Commit in inner repo with message `T7 medium NNN: cover <uncovered_symbol>`
  - Run `uv run ruff check <test_file>` — must exit 0
  - Write proof file with full field set (mirror the T6 medium proof shape)
  - Reply with exact ACK: `MAYA_NATIVE_GAUNTLET_ACK T7_REPEAT_MEDIUM_20260526_NNN MEDIUM <proof_path>`
- **Run log:** `frames/t7-repeat-medium-NNN-run-20260526.log`
- **Verifier:** invoke as
  ```bash
  node scripts/verify-pentagon-autonomy-from-logs.mjs --t6 --tier=medium --proof-file <proof_path>
  ```
  (The `--t6 --tier=medium` mode accepts T7_REPEAT_MEDIUM hashes via the generalized regex from `95d6b31`.)

### Ledger

Append each outcome to:

```
frames/t7-native-repetition-progress-medium-20260526.jsonl
```

Per-row fields: same shape as `frames/t7-native-repetition-progress-20260525.jsonl` rows, including `outcome_class`, `infrastructure_failure_root_cause` (when applicable), `wall_seconds_to_completed`, `agent_commit_sha`, etc.

Also maintain a human-readable progress file:

```
frames/t7-native-repetition-progress-medium-20260526.md
```

### Classifier + retry policy

- Apply `scripts/t7-repetition-classifier.mjs` to each result before appending.
- If `outcome_class=infrastructure_retry` (any of the 4 Pentagon defect modes), the harness retries the same target with a fresh `_RETRY_N` hash, up to 3 retries.
- For `ghost_completion` and `no_trigger_timeout`, where the original run produced no usable target_symbol or proof, the retry should use a FRESH uncovered symbol (per the `a069a91` precedent — documented in run notes).
- For `message_poller_no_trigger_row` where the proof DID exist, the retry should reference the same target.
- `runner_transport_after_dispatch` (run 019-style): outcome stays `pass` if the verifier passed; no retry needed.

### Commit cadence

Batch commits every 4-5 runs. Commit message format:

```
T7 medium repetition runs <range>: <pass_count>/<batch> pass, <agent_rate>%/<infra_rate>% so far
```

## Hard rules

- **Do NOT modify** the verifier, classifier, harness, runner, or bridge during the run series.
- **Do NOT modify** the medium instruction template — variance under the existing prompt is what's being measured.
- **Do NOT loosen** any check.
- **Sequential only.** No parallelization.
- **No mocks** of the API under test (per the medium-tier spec).

## Abort conditions (STOP and report; do NOT continue)

1. **Agent pass rate floor unreachable.** At any point, if `(22 - current_pass_count) > remaining_agent_attempts_left`, the 22/25 = 88% gate becomes mathematically impossible. STOP.
2. **Three consecutive `infrastructure_retry_exhausted` results.** A single target hitting 3 infra retries is acceptable; three different targets all exhausting suggests Pentagon degradation. STOP.
3. **New failure mode encountered** beyond {pass, narrative_wrapped_ack, message_poller_no_trigger_row, ghost_completion, no_trigger_timeout, runner_transport_after_dispatch, agent variance during coverage-test logic}. Report and stop. Add to known modes via a new classifier extension (separate goal).
4. **Watchdog restart count exceeds 10** across this batch. Pentagon is degrading; investigate.
5. **Token budget approaches 1M.** Wrap up the current batch, commit, and stop short of 025 if needed.

## Final summary

After completion (or abort), run:

```bash
node scripts/t7-repetition-harness.mjs --ledger frames/t7-native-repetition-progress-medium-20260526.jsonl
```

This is the authoritative metric source.

Update `frames/t7-native-repetition-progress-medium-20260526.md` with:
- `pass_count`, `agent_failure_count`, `infra_retry_count`, `total_run_attempts`
- `pass_rate_percent`, `infrastructure_failure_rate_percent`
- Whether the 22/25 = 88% gate cleared
- p50 / p95 wall time
- Watchdog restart count across the series
- Distribution of `infrastructure_failure_root_cause` values (which Pentagon defects were most common)

## Reply with

- Final run index reached (e.g. 025, or wherever stopped)
- Pass count, agent failure count, infra retry count, total attempts
- Agent-attributed pass rate %, infrastructure failure rate %
- Whether the 88% gate cleared, missed, or was aborted before reachable
- All commit SHAs from this batch
- Any new failure modes encountered (should be zero per abort condition #3)
- Wall time distribution (median + max)
- Most common Pentagon defect mode in this series

If the gate cleared cleanly, T7 medium is graduated. Whether it cleared or not, the result is the second honest reliability measurement in the project's history (first was T7 easy at 95.5% agent / 18.5% infra).
