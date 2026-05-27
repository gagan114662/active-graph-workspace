# Goal: Audit and commit the uncommitted T7 adaptations sitting in the worktree

**Token budget:** 250K. STOP if your audit finds anything in the dirty edits that you cannot justify or that smells like verifier loosening.

## Why this exists

The worktree currently has 191 lines of uncommitted edits across three production scripts:

```
M scripts/pentagon-trigger-bridge.mjs            13 lines
M scripts/run-native-pentagon-task.mjs          126 lines
M scripts/verify-pentagon-autonomy-from-logs.mjs 80 lines
```

These edits enabled the 12 successful T7-easy runs (001-014). Without them, the verifier's tier-detection regex is hardcoded to T6 hashes from `20260523` and T7 runs would never grade. **These edits are not cruft — they are load-bearing for T7.**

But they were never committed. The verifier on `origin/main` (`83f9344` HEAD) is NOT the verifier that actually graded T7 runs 001-014. Anyone reverting the worktree to HEAD breaks T7. Anyone trying to reproduce T7's results from `origin/main` alone cannot.

This is an audit-trail gap. Fix it.

## Bootstrap

1. Read `CLAUDE.md` in full.
2. Run `git diff scripts/` and read EVERY hunk. Understand what each change does.
3. Cross-reference each hunk against the T7 spec in `frames/t7-t12-scale-reliability-gauntlet-2026-05-23.md` to confirm it's serving T7's requirements (not unrelated drift).
4. Cross-reference each hunk against the existing T6 verifier modes — confirm the changes are ADDITIVE (extending coverage to T7) and not loosening any existing T6 check.

## Audit phase (before any commit)

For EACH hunk in the diff, classify it into one of:

- **(A) T7 adaptation, additive, no loosening of existing T6 rules.** Safe to commit.
- **(B) T7 adaptation, modifies existing logic — confirm the modified path still grades T6 correctly.** Safe to commit only if T6 regression tests still pass.
- **(C) Unrelated drift, exploratory code, or unjustified change.** Revert this hunk; do NOT commit.
- **(D) Loosens an existing T6 check or weakens the canonical-trigger / ACK rules.** STOP and report. Do NOT commit. Operator decides.

Write the audit to:

```
frames/dirty-edits-audit-20260526.md
```

For each hunk, record: file, line range, classification (A/B/C/D), one-sentence justification.

## Regression gate

Before committing, run all four T6 tier regrades against the dirty-worktree verifier:

```bash
for tier in easy medium hard extra-hard; do
  case "$tier" in
    easy)       proof=activegraph/frames/t6-native-gauntlet-easy-20260523.proof ;;
    medium)     proof=activegraph/frames/t6-native-gauntlet-medium-20260523.proof ;;
    hard)       proof=activegraph/frames/t6-native-gauntlet-hard-20260523.proof ;;
    extra-hard) proof=frames/t6-native-gauntlet-extra-hard-20260525.proof ;;
  esac
  node scripts/verify-pentagon-autonomy-from-logs.mjs --t6 --tier=$tier --proof-file "$proof" > /tmp/regress-$tier.out 2>&1
  echo "$tier exit=$?"
  tail -3 /tmp/regress-$tier.out
done
```

All four MUST exit 0 with their original verdict (`t6_<tier>_verified`). If any regresses, STOP — the dirty edits broke something. Audit which hunk caused the regression, revert it, re-test.

Also re-run all the fixtures (both T6 good/bad and T7 good/bad if any). All must behave per their original contract.

## Commit

Once the audit log is written, all hunks classified, all (C)-class hunks reverted, and all four T6 regrades pass:

Commit ALL remaining hunks (A and B classes) AND the audit log file as ONE commit:

```
T7 enablement: verifier + runner adaptations that graded runs 001-014 (audited, no T6 regression)
```

Detailed commit body should reference the audit log and list each (A) and (B) hunk briefly.

Push to `origin/main`.

## Hard rules

- **Do NOT add new logic** beyond what's already in the dirty worktree
- **Do NOT loosen any check** — if a hunk does, classify (D) and stop
- **Do NOT rewrite history** — historical JSONL records stay untouched
- **Do NOT trigger any T7 run** during this audit
- **Do NOT modify the new files committed in `83f9344`** (`t7-repetition-classifier.mjs`, `t7-repetition-harness.mjs`, `runner-classify-infra-failure.test.mjs`)

If any T6 regrade regresses or any (D)-class hunk is found, STOP and report. The operator decides whether to proceed.

## Reply with

- Commit SHA (or "STOPPED — <reason>" if you aborted)
- Per-hunk classification counts: how many A, B, C, D
- The 4 T6 regrade exit codes
- The complete audit log content (or a summary if it's long)
- Whether any hunk was reverted (and which)
- Confirmation that no new logic was added beyond what was already in the worktree
