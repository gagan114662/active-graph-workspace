# T8 — task class breadth gauntlet

**Defined:** 2026-05-27.
**Status:** Spec written. Not yet run on either cohort.

## What T8 proves

T6 proved capability sample=1. T7 proves reliability at sample=25 for ONE task class. T8 proves the dark factory generalizes ACROSS task classes — that the engineering discipline is not over-fit to "Maya picks an uncovered API and writes 2 tests."

## Task class taxonomy (5 classes × 5 runs each = 25 total gauntlets)

Each class follows the same Maya+Quinn shape as T6 hard. Sample 5 per class to control for variance within a class while testing breadth across classes.

| Class | What Maya does | Verifier check |
|---|---|---|
| **BUGFIX** | Find a real bug via grep/code-reading or by deliberately exploring edge cases. Write a failing reproducer test. Fix the bug. Confirm test now passes. | `pytest_before == pytest_after - new_tests` AND `bug_source` is in production code, not tests |
| **PERF** | Identify a hot path (via `tests/perf/*` or profiling). Write a perf test (`pytest --benchmark`). Make it pass. | New perf test exists, baseline + post deltas recorded, regression budget honored |
| **SECURITY** | Find a real (or plausible) security smell — unescaped input, missing auth check, naive crypto, etc. Write a regression test. Harden the code. | New test under `tests/security/*` exists; no regressions in the regular suite |
| **DEPRECATION** | Pick an API marked deprecated or one that's been functionally superseded. Remove it. Update call sites + docs + CHANGELOG. | The removed symbol is gone from `git grep`; tests still pass; CHANGELOG entry has a removal line |
| **REFACTOR** | Find code with a clear duplication or violation of established factory pattern. Refactor (no behavior change). | Pytest output unchanged; lines-of-code reduced or complexity-metric improved; no new public APIs |

## Instruction templates (to be written in `frames/templates/t8-*-instruction.txt`)

Each follows the existing T6-hard Maya template shape. Just swap the "find an uncovered symbol" step with "find a {bugfix,perf,security,deprecation,refactor} target".

## Verifier (`scripts/verify-pentagon-autonomy-from-logs.mjs`)

Extend with `--t8 --class={bugfix,perf,security,deprecation,refactor}` modes. Each mode applies the class-specific check on top of the existing T6-hard verifier checks.

## Ledger

`frames/t8-native-progress-{class}-{date}.jsonl` per class. Same row shape as T7 medium ledger.

## Pass criteria

- Each class: 4/5 PASS (80%) to consider that class "honestly green"
- Overall T8 graduation: 4/5 classes green + ≥ 16/25 overall PASS rate

## Cost expectation

- Avg ~$4 per Maya gauntlet × 25 = ~$100
- Plus Quinn adversarial pass on each = additional ~$50
- Total ~$150 to fully run T8 on one cohort

## Reason to consider per-token-arbitrage BEFORE T8

T8 is expensive. The dark factory should establish an output→revenue pipeline (one shipped activegraph feature per N gauntlet runs) before sinking $150 into a breadth proof. Brandon-A research packet may also cut cost 6×.

## Open question

Should T8 fire on the gpt-5.5 cohort (cheaper) first, then re-prove on opus-4.7? Or skip the gpt-5.5 cohort entirely now that the new cohort is live? CLAUDE.md cohort-separation rule says samples don't mix; deciding-to-re-run on the new cohort is the operator's call.
