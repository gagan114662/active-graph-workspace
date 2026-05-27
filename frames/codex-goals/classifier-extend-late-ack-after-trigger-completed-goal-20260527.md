# Goal: Extend classifier with `late_ack_after_trigger_completed` mode

**Token budget:** 250K. STOP if scope grows beyond the classifier + harness + tests described below.

## Why

Run 014 of T7 medium hit a new infrastructure failure mode. The diagnostic at `frames/t7-medium-run-014-diagnostic-20260527.log` identified the cause as watchdog-cascade: the runner-side Pentagon watchdog restarted Pentagon mid-trigger; the new Pentagon's recovery logic wrote `claimed_at` 4ms AFTER `completed_at` (wrong order); Maya then did real work on the new Pentagon and produced a real ACK 3 minutes later, but Pentagon had already "closed" the trigger lifecycle.

Maya's work is real and audit-correct (verifiable via agent_commit_sha + proof file at HEAD + test_file collects ≥2 tests). The failure is Pentagon-side. The classifier should route this to `infrastructure_retry`, not `fail_verifier` / `agent_failure`.

This goal extends the classifier to recognize the new mode, applies the standard retry policy, and adds regression tests. **It does NOT loosen the verifier's strict canonical-trigger rule.** The verifier correctly rejects the trigger; the classifier just changes how the rejection is interpreted.

## Bootstrap

1. Read `CLAUDE.md`.
2. Read `frames/t7-medium-run-014-diagnostic-20260527.log` (the evidence backing this extension).
3. Read `scripts/t7-repetition-classifier.mjs` — particularly the existing infrastructure_failure_root_cause taxonomy (`message_poller_no_trigger_row`, `ghost_completion`, `no_trigger_timeout`, `runner_transport_after_dispatch`).
4. Read `scripts/runner-classify-infra-failure.test.mjs` for the test pattern.
5. Outer HEAD should be `a095a7d` (or descendant). If not, STOP.

## Classification rule (exact)

Use `late_ack_after_trigger_completed` when ALL of these hold:

1. Original instruction message exists with the run hash.
2. Canonical trigger row exists with BOTH `claimed_at` and `completed_at` populated.
3. An exact canonical ACK message exists in the trigger's conversation matching the run hash.
4. **`ack.created_at > trigger.completed_at`** (the defining signal — ACK arrived after Pentagon closed the trigger).
5. Maya's work is real and evidence-supported:
   - Proof file exists at the expected path
   - `agent_commit_sha` in the proof resolves in the inner repo
   - The commit touches the claimed `test_file`
   - The verifier had already passed all engineering checks (proof shape, test count, ruff, etc.) and ONLY failed on the canonical-trigger lookup

The watchdog-event evidence (`native_runner_watchdog_triggered_at` in the ledger row) is a STRONG indicator but NOT a required condition. Some Pentagon premature-completion paths may not involve the watchdog; we still want to classify them correctly when Maya's work was real.

If ANY of conditions 1-5 fail, do NOT classify as this mode. Fall through to other modes or `fail_verifier`.

## Retry policy

Same as `ghost_completion` and `no_trigger_timeout`:

- `outcome_class = "infrastructure_retry"`
- `infrastructure_failure_root_cause = "late_ack_after_trigger_completed"`
- Harness retries with a fresh `_RETRY_N` hash, up to 3 retries per target
- Retry uses the SAME target_symbol (Maya's work was real on this target; fresh trigger should succeed)
- This is different from `ghost_completion` / `no_trigger_timeout` which use fresh targets (no work was done in those modes); here we retry the same target because Maya's commit IS in the inner repo and her test file IS present at HEAD

Actually — wait. Since Maya already committed her work and the test file is at HEAD, retrying the same target would cause Maya to find her own work as already-covered and skip it. So the retry policy needs adjustment:

- If `late_ack_after_trigger_completed` is detected AND Maya's commit is at HEAD AND her test_file already exists, the harness should mark the run as `pass` (her work is real and committed; the lifecycle issue is purely Pentagon's audit timing) — NOT retry.
- This special case avoids wasting a retry on work that's already done.

This requires a small additional change to the harness retry policy: when the classifier returns `late_ack_after_trigger_completed`, the harness should check the inner-repo state. If Maya's work is present, mark as pass (with a note in the ledger explaining the late-ACK path). Otherwise retry with fresh target.

## Required changes

### scripts/t7-repetition-classifier.mjs

- Add `OUTCOME_LATE_ACK_AFTER_TRIGGER_COMPLETED` constant (or reuse `OUTCOME_INFRASTRUCTURE_RETRY` with a new root_cause string — match existing pattern from `b6c774c` and `856692b`)
- Add detection function `looksLikeLateAckAfterTriggerCompleted(row)` that checks conditions 1-5 above against ledger row data
- Update the main classify function to call the new detector

### scripts/t7-repetition-harness.mjs

- Update retry policy to handle `late_ack_after_trigger_completed` per the special case above
- If Maya's commit + test_file exist at HEAD, mark the ledger entry as resolved-pass with annotation
- Otherwise retry the same target

### scripts/runner-classify-infra-failure.test.mjs

- Add unit test for `late_ack_after_trigger_completed` detection
- Add unit test for harness retry policy on this mode (the "Maya's work already at HEAD" special case)
- Add regression test asserting that run 014 reclassifies from `fail_verifier` to `infrastructure_retry` + `late_ack_after_trigger_completed`
- Add regression test asserting that runs 1-13 do NOT reclassify (still pass or other known mode)
- Add a fixture-row test for the case where Maya's work is NOT at HEAD (still infra-retry, but harness retries fresh attempt)

### Update CLAUDE.md (note in the activity log)

Append to the activity log: "2026-05-27 — classifier extended to cover `late_ack_after_trigger_completed` per the run 014 diagnostic. Pentagon's watchdog-cascade lifecycle defect is now classified as retryable infra, with a special harness rule that recognizes Maya's already-committed work and avoids redundant retries."

## Self-test (mandatory)

1. **Unit tests pass:** `node --test scripts/runner-classify-infra-failure.test.mjs > /tmp/t.out 2>&1; echo "exit=$?"` — must be 0.
2. **Regression: run 014 reclassifies.** Re-grade the T7 medium ledger:
   ```bash
   node scripts/t7-repetition-harness.mjs --ledger frames/t7-native-repetition-progress-medium-20260526.jsonl
   ```
   Expected: `agent_failure_count` drops from 1 to 0; `infra_retry_count` increases by 1 (or run 014 marks as pass if Maya's work is at HEAD, in which case `pass_count` increases by 1).
3. **Regression: T6 tier regrades unchanged.** All 4 T6 tier regrades still exit 0 with their original verdicts.
4. **Regression: T7 easy ledger unchanged.** `node scripts/t7-repetition-harness.mjs --ledger frames/t7-native-repetition-progress-20260525.jsonl` still produces pass_count=21, agent_failure_count=1, infra_retry_count=5.
5. **Bad fixtures still fail correctly.** Re-run T6 hard bad fixtures (bad-ack-contradiction, bad-no-canonical-ack); both must still exit 1.

Document outcomes in:

```
frames/classifier-extend-late-ack-selftest-20260527.log
```

## Hard rules

- **DO NOT modify** `scripts/verify-pentagon-autonomy-from-logs.mjs` — the verifier's canonical-trigger rule stays strict.
- **DO NOT** loosen any verifier check.
- **DO NOT** rewrite historical ledger rows for run 014 — the new classifier should derive the new classification on-the-fly when re-reading the ledger (same pattern as the prior classifier extensions).
- **DO NOT** trigger any T7 runs.
- **DO NOT** commit Pentagon fixes (Pentagon's bug is upstream; this goal only handles the classifier-side workaround).

If the self-test reveals an unexpected regression OR if Maya's work-at-HEAD detection logic exceeds 50 lines, STOP and report — the operator decides whether to scope the harness change separately.

## Commit

Single commit (do NOT amend):

```
T7 classifier: add late_ack_after_trigger_completed mode (Pentagon watchdog-cascade lifecycle defect; classify as retryable infra; special harness rule for Maya-work-at-HEAD)
```

Push to `origin/main`.

## Reply with

- Commit SHA
- All 5 self-test outcomes from the list above
- Run 014's new classification (should be `infrastructure_retry` + root cause `late_ack_after_trigger_completed`)
- Whether the harness special case (Maya-work-at-HEAD → mark pass) fired for run 014
- Updated T7 medium harness summary numbers
- Whether T6 + T7 easy regressions held
- Confirmation that the verifier code was NOT modified (`git diff <prev_HEAD>..HEAD -- scripts/verify-pentagon-autonomy-from-logs.mjs` is empty)

## After this lands

T7 medium can safely resume at run 015. Run 014 will already be resolved (either as pass via the work-at-HEAD path, or via successful retry). The watchdog restart counter question (currently at 10, at abort threshold) is a SEPARATE operator decision — handle it in the T7 medium resume goal, not here.
