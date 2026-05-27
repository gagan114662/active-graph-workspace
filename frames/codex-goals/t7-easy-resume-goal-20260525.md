# Goal: Resume T7 Easy Repetition (runs 010–025)

**Token budget:** 800K. STOP if any of the abort conditions below trip.

## Bootstrap

1. Read `CLAUDE.md` in full.
2. Read `frames/t7-native-repetition-progress-20260525.jsonl` — last recorded run is 009.
3. Read `frames/t7-native-repetition-progress-20260525.md` — human-readable progress.
4. Examine one prior successful run (e.g. 007) to learn the instruction template, JSONL fields, and proof handling.

## Current state to resume from

- Runs 001-009 are recorded
- Pass rate so far: 8/9 (1 fail at run 008 — narrative-wrapped ACK; verifier correctly rejected per `b6c774c` retry-aware ACK rule)
- Inner repo `main` HEAD: `d0f5485` (T7 easy 009)
- Outer HEAD should reflect Codex's prior progress commits

## Task

Execute runs **010 through 025** sequentially using the SAME protocol as runs 006-009:

- Each run picks a different public symbol in `activegraph/activegraph/` matching the easy-tier criteria (no docstring + missing annotation) and Maya documents+types it
- Each run uses a fresh `<HASH>_010..._025` and a fresh seed UUID
- Each run produces a proof in `activegraph/frames/t7-repeat-easy-NNN-20260525.proof`
- Each run's outcome is appended to `frames/t7-native-repetition-progress-20260525.jsonl` with all the same fields as run 008's record
- Update `frames/t7-native-repetition-progress-20260525.md` after each run

## Hard rules (do NOT skip)

- **Do NOT modify the verifier** (`scripts/verify-pentagon-autonomy-from-logs.mjs`) — this is a controlled experiment
- **Do NOT modify the easy instruction template** (`frames/t6-native-easy-instruction-20260523.txt` or any T7-derived variant) — variance under the existing prompt is what's being measured
- **Do NOT loosen** any verifier check or ACK matching rule
- Sequential only; **do NOT parallelize runs** (avoids activation/auth races)
- Each run uses the per-run instruction file pattern Codex established for runs 006-009

## Abort conditions (STOP and report instead of continuing)

1. Cumulative pass count falls below `(8 + remaining_runs - 1)` — meaning the 23/25 = 92% gate becomes unreachable
2. Three consecutive failures (regardless of total pass rate)
3. Any new failure mode beyond narrative-wrapped ACK or watchdog-handled activation hiccups — report and stop so the operator can grade the new mode
4. Watchdog restart count exceeds 5 across the run window — investigate Pentagon stability before continuing
5. Token budget hits 700K — report progress and stop short of 025 if needed

## After the last run completes (or you abort)

Commit + push the JSONL/MD/per-run logs as **one commit per batch of 4-5 runs** (not 16 separate commits, not one giant commit). Suggested commit message format:

```
T7 easy repetition runs 010-014: <N>/<5> pass, p95 wall <X>s
```

## Reply with

- Final run index reached (e.g. 025 or wherever stopped)
- Total pass count of 25 (or of however many runs landed)
- Pass rate, p95 wall time, watchdog restart count
- Any new failure modes encountered
- Whether the 92% gate (23/25) was cleared, missed, or aborted before reachable
- All commit SHAs from this batch

If the gate is cleared cleanly, mark T7 easy as Sample 25 complete. If not, the result is still meaningful — it's the first honest reliability measurement in the project's history.
