# Classifier Extension Proposal - 2026-05-26

Scope: proposal only. No classifier, verifier, Pentagon, database, or ledger changes were made.

Input evidence: frames/pentagon-defect-investigation-20260526.log plus the current classifier output from:
node scripts/t7-repetition-harness.mjs --ledger frames/t7-native-repetition-progress-20260525.jsonl --classify

## Problem

The current classifier can reclassify run 022 as message_poller_no_trigger_row because it matches note text containing no agent_triggers row / no canonical trigger row. That is too broad.

Evidence-supported message_poller_no_trigger_row requires more than a missing trigger row. It requires proof that the agent actually did the work despite the missing canonical trigger row: proof file and/or exact ACK/hash-bearing response evidence.

Run 022 has no trigger row, no proof, and no ACK/hash-bearing agent response. Treating it as the same class as runs 014, 016, and 021 hides a different failure mode.

## Proposed Outcome / Root-Cause Model

Keep PASS/FAIL verifier semantics unchanged. Extend T7 repetition classification only.

### 1. message_poller_no_trigger_row

Use when:
- original instruction message exists;
- no canonical agent_triggers row exists for that original message;
- proof/ACK/work evidence exists for the same run hash.

Acceptable evidence:
- runner activation_path is message_poller_no_trigger_row, or
- expected proof file exists and verifier/proof contains the run hash, or
- ledger/run-log has exact ACK ids or response rows for the same run hash.

Do not classify as this solely because notes mention no trigger row.

Observed runs:
- 014
- 016
- 021

Retry policy:
- retryable infrastructure; retry budget unchanged.

### 2. ghost_completion

Use when:
- canonical trigger row exists for original instruction;
- claimed_at is non-null;
- completed_at is non-null;
- no proof file exists;
- no hash-bearing agent ACK/response exists for the run before deadline.

Observed run:
- 017

Interpretation:
The trigger lifecycle completed without observable task execution. This is infrastructure, not agent capability variance, because there is no agent output to grade.

Retry policy:
- retryable infrastructure; retry budget unchanged.
- Keep the root-cause label separate from message_poller_no_trigger_row.

### 3. no_trigger_timeout

Use when:
- original instruction message exists;
- no canonical trigger row exists for original instruction;
- no proof file exists;
- no hash-bearing ACK/response exists for the run before deadline.

Observed run:
- 022

Interpretation:
Trigger ingestion or native activation missed the instruction, and no fallback execution path produced work. It may share a lower-level cause with message_poller_no_trigger_row, but the available evidence is different and should remain separately labeled.

Retry policy:
- retryable infrastructure; retry budget unchanged.
- Do not count as agent failure unless a later investigation finds agent output that can be graded.

### 4. runner_transport_after_dispatch

Use as an advisory/root-cause note, not as a failing outcome, when:
- canonical trigger exists;
- proof/ACK exists;
- verifier passes;
- runner/harness returned an error due local network or polling transport.

Observed run:
- 019

Interpretation:
Pentagon completed the work and the verifier passed; the runner error is an observability/transport defect.

Retry policy:
- no retry needed if verifier pass is established.
- Preserve outcome_class=pass and add a non-failing infrastructure warning/root-cause field if the current schema can represent it.

## Metric Handling Proposal

Preferred implementation:
- Allow distinct root-cause labels: message_poller_no_trigger_row, ghost_completion, no_trigger_timeout, runner_transport_after_dispatch.
- Either keep outcome_class=infrastructure_retry for retryable infra rows and store the specific value in infrastructure_failure_root_cause, or introduce distinct outcome_class values and update metric aggregation to count them as retryable infrastructure.

Conservative path:
- Keep outcome_class=infrastructure_retry for 014, 016, 017, 021, and 022.
- Set infrastructure_failure_root_cause to:
  - 014: message_poller_no_trigger_row
  - 016: message_poller_no_trigger_row
  - 017: ghost_completion
  - 021: message_poller_no_trigger_row
  - 022: no_trigger_timeout
- Keep 019 outcome_class=pass, with optional advisory root cause runner_transport_after_dispatch if schema supports non-failing annotations.

This avoids changing top-level pass-rate math while preserving audit clarity.

## Regression Test Requirements For Phase 3

Add focused fixtures or ledger-row tests that prove:

1. Run 014 shape classifies as infrastructure_retry / message_poller_no_trigger_row.
2. Run 016 shape classifies as infrastructure_retry / message_poller_no_trigger_row.
3. Run 021 shape classifies as infrastructure_retry / message_poller_no_trigger_row.
4. Run 017 shape classifies as infrastructure_retry / ghost_completion.
5. Run 022 shape classifies as infrastructure_retry / no_trigger_timeout, not message_poller_no_trigger_row.
6. Run 019 remains pass, not infrastructure_retry.
7. Existing agent failure remains agent_failure.
8. Existing verifier/pass rows are unchanged.

Also run:
- node scripts/t7-repetition-harness.mjs --ledger frames/t7-native-repetition-progress-20260525.jsonl --classify
- existing T6 verifier regression fixtures, if Phase 3 touches shared verifier utilities.

## Recommended Phase 3 Scope

If approved:
1. Tighten looksLikeMessagePollerDrop so missing-trigger text alone is insufficient.
2. Add explicit detectors for ghost_completion and no_trigger_timeout.
3. Ensure metrics aggregate retryable infrastructure consistently.
4. Add focused regression tests or fixture rows covering 014/016/017/019/021/022.
5. Recompute T7 easy classified summary without running new T7 work.

Stop condition:
If classifier changes require loosening verifier PASS/FAIL semantics or mutating historical ledger rows, stop and return to the operator.

