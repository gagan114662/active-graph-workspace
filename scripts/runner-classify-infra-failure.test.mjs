import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  OUTCOME_FAIL_VERIFIER,
  OUTCOME_INFRASTRUCTURE_RETRY,
  OUTCOME_PASS,
  INFRA_ROOT_GHOST_COMPLETION,
  INFRA_ROOT_MESSAGE_POLLER_NO_TRIGGER_ROW,
  INFRA_ROOT_NO_TRIGGER_TIMEOUT,
  INFRA_ROOT_LATE_ACK_AFTER_TRIGGER_COMPLETED,
  classifyNativeRunnerResult,
  classifyT7LedgerRows,
  computeT7ProgressMetrics,
  decideRetryAction,
} from "./t7-repetition-classifier.mjs";

test("classifier marks message_poller_no_trigger_row as infrastructure_retry", () => {
  const classified = classifyNativeRunnerResult({
    activation_path: "message_poller_no_trigger_row",
    native_pass: true,
    verdict: "native_task_passed",
    message: { id: "message-1" },
    final_trigger: null,
    response_rows: [{ id: "ack-1" }, { id: "ack-2" }],
    expected_file: { exists: true, contains_hash: true },
  });

  assert.equal(classified.native_pass, false);
  assert.equal(classified.outcome_class, OUTCOME_INFRASTRUCTURE_RETRY);
  assert.equal(classified.infrastructure_failure_root_cause, INFRA_ROOT_MESSAGE_POLLER_NO_TRIGGER_ROW);
  assert.equal(classified.verdict, "native_task_failed_or_incomplete");
  assert.deepEqual(classified.missing_trigger_evidence, {
    original_message_id: "message-1",
    agent_triggers_query: "/rest/v1/agent_triggers?message_id=eq.message-1",
    agent_triggers_result: [],
    ack_message_ids: ["ack-1", "ack-2"],
  });
});

test("classifier marks ghost completion as retryable infrastructure", () => {
  const classified = classifyNativeRunnerResult({
    activation_path: "agent_trigger",
    message: { id: "message-ghost" },
    final_trigger: {
      id: "trigger-ghost",
      claimed_at: "2026-05-26T14:51:58.241062+00:00",
      completed_at: "2026-05-26T14:52:08.701+00:00",
    },
    response_rows: [],
    expected_file: { exists: false, contains_hash: false },
  });

  assert.equal(classified.native_pass, false);
  assert.equal(classified.outcome_class, OUTCOME_INFRASTRUCTURE_RETRY);
  assert.equal(classified.infrastructure_failure_root_cause, INFRA_ROOT_GHOST_COMPLETION);
  assert.deepEqual(classified.ghost_completion_evidence, {
    trigger_id: "trigger-ghost",
    claimed_at: "2026-05-26T14:51:58.241062+00:00",
    completed_at: "2026-05-26T14:52:08.701+00:00",
    response_row_count: 0,
    expected_file_exists: false,
  });
});

test("classifier marks no-trigger timeout as retryable infrastructure", () => {
  const classified = classifyNativeRunnerResult({
    activation_path: "incomplete",
    message: { id: "message-timeout" },
    final_trigger: null,
    response_rows: [],
    expected_file: { exists: false, contains_hash: false },
  });

  assert.equal(classified.native_pass, false);
  assert.equal(classified.outcome_class, OUTCOME_INFRASTRUCTURE_RETRY);
  assert.equal(classified.infrastructure_failure_root_cause, INFRA_ROOT_NO_TRIGGER_TIMEOUT);
  assert.deepEqual(classified.no_trigger_timeout_evidence, {
    original_message_id: "message-timeout",
    agent_triggers_query: "/rest/v1/agent_triggers?message_id=eq.message-timeout",
    response_row_count: 0,
    expected_file_exists: false,
  });
});

test("retry policy retries infra twice then accepts pass", () => {
  const attempts = [
    { run_idx: 14, hash: "T7_REPEAT_EASY_20260525_014", target_symbol: "activegraph.core.graph.Relation.to_dict", outcome_class: OUTCOME_INFRASTRUCTURE_RETRY },
    { retry_of_run_idx: 14, hash: "T7_REPEAT_EASY_20260525_014_RETRY_1", target_symbol: "activegraph.core.graph.Relation.to_dict", outcome_class: OUTCOME_INFRASTRUCTURE_RETRY },
  ];

  const retryDecision = decideRetryAction(attempts, { seedFactory: () => "seed-2" });
  assert.equal(retryDecision.action, "retry");
  assert.equal(retryDecision.retry.hash, "T7_REPEAT_EASY_20260525_014_RETRY_2");
  assert.equal(retryDecision.retry.seed, "seed-2");
  assert.equal(retryDecision.retry.target_symbol, "activegraph.core.graph.Relation.to_dict");

  const finalDecision = decideRetryAction([
    ...attempts,
    { retry_of_run_idx: 14, hash: "T7_REPEAT_EASY_20260525_014_RETRY_2", target_symbol: "activegraph.core.graph.Relation.to_dict", outcome_class: OUTCOME_PASS },
  ]);
  assert.equal(finalDecision.action, "final_pass");
});

test("retry policy escalates after three infrastructure attempts", () => {
  const decision = decideRetryAction([
    { run_idx: 14, hash: "T7_REPEAT_EASY_20260525_014", target_symbol: "activegraph.core.graph.Relation.to_dict", outcome_class: OUTCOME_INFRASTRUCTURE_RETRY },
    { retry_of_run_idx: 14, hash: "T7_REPEAT_EASY_20260525_014_RETRY_1", target_symbol: "activegraph.core.graph.Relation.to_dict", outcome_class: OUTCOME_INFRASTRUCTURE_RETRY },
    { retry_of_run_idx: 14, hash: "T7_REPEAT_EASY_20260525_014_RETRY_2", target_symbol: "activegraph.core.graph.Relation.to_dict", outcome_class: OUTCOME_INFRASTRUCTURE_RETRY },
  ]);

  assert.equal(decision.action, "escalate");
  assert.equal(decision.reason, "max_infrastructure_retries_exhausted");
  assert.equal(decision.infrastructure_attempts, 3);
});

test("existing T7 easy ledger classifies Pentagon infrastructure modes without hiding agent failure", () => {
  const rows = readFileSync("frames/t7-native-repetition-progress-20260525.jsonl", "utf8")
    .trim()
    .split(/\n/)
    .map((line) => JSON.parse(line));
  const classified = classifyT7LedgerRows(rows);
  const infraRows = classified.filter((row) => row.outcome_class === OUTCOME_INFRASTRUCTURE_RETRY);
  const run008 = classified.find((row) => row.run_idx === 8);
  const run014 = classified.find((row) => row.run_idx === 14);
  const run016 = classified.find((row) => row.run_idx === 16);
  const run017 = classified.find((row) => row.run_idx === 17);
  const run019 = classified.find((row) => row.run_idx === 19);
  const run021 = classified.find((row) => row.run_idx === 21);
  const run022 = classified.find((row) => row.run_idx === 22);
  const metrics = computeT7ProgressMetrics(rows);

  assert.deepEqual(infraRows.map((row) => row.run_idx), [14, 16, 17, 21, 22]);
  assert.equal(run008.outcome_class, OUTCOME_FAIL_VERIFIER);
  assert.equal(run008.agent_failure_root_cause, "narrative_wrapped_ack");
  assert.equal(run014.outcome_class, OUTCOME_INFRASTRUCTURE_RETRY);
  assert.equal(run014.infrastructure_failure_root_cause, INFRA_ROOT_MESSAGE_POLLER_NO_TRIGGER_ROW);
  assert.equal(run016.infrastructure_failure_root_cause, INFRA_ROOT_MESSAGE_POLLER_NO_TRIGGER_ROW);
  assert.equal(run017.infrastructure_failure_root_cause, INFRA_ROOT_GHOST_COMPLETION);
  assert.equal(run019.outcome_class, OUTCOME_PASS);
  assert.equal(run021.infrastructure_failure_root_cause, INFRA_ROOT_MESSAGE_POLLER_NO_TRIGGER_ROW);
  assert.equal(run022.infrastructure_failure_root_cause, INFRA_ROOT_NO_TRIGGER_TIMEOUT);
  assert.equal(metrics.pass_count, 21);
  assert.equal(metrics.agent_failure_count, 1);
  assert.equal(metrics.infra_retry_count, 5);
  assert.equal(metrics.total_run_attempts, 27);
  assert.equal(Number((metrics.pass_rate * 100).toFixed(1)), 95.5);
  assert.equal(Number((metrics.infrastructure_failure_rate * 100).toFixed(1)), 18.5);
});

test("retry policy treats ghost completion and no-trigger timeout as retryable infra", () => {
  const ghostDecision = decideRetryAction([
    {
      run_idx: 17,
      hash: "T7_REPEAT_EASY_20260525_017",
      outcome_class: "incomplete",
      trigger_id: "3b7deda1-de4f-4d9f-999a-0b08258f1c25",
      claimed_at: "2026-05-26T14:51:58.241062+00:00",
      completed_at: "2026-05-26T14:52:08.701+00:00",
      notes: "trigger was created, claimed, and completed in about 10.6s, but Maya produced no hash-bearing response rows and no expected proof file.",
    },
  ], { seedFactory: () => "ghost-retry-seed" });
  assert.equal(ghostDecision.action, "retry");
  assert.equal(ghostDecision.reason, "infrastructure_retry");
  assert.equal(ghostDecision.retry.hash, "T7_REPEAT_EASY_20260525_017_RETRY_1");

  const timeoutDecision = decideRetryAction([
    {
      run_idx: 22,
      hash: "T7_REPEAT_EASY_20260525_022",
      outcome_class: "incomplete",
      trigger_id: null,
      notes: "no agent_triggers row, no hash-bearing response rows, and no proof file before runner deadline.",
    },
  ], { seedFactory: () => "timeout-retry-seed" });
  assert.equal(timeoutDecision.action, "retry");
  assert.equal(timeoutDecision.reason, "infrastructure_retry");
  assert.equal(timeoutDecision.retry.hash, "T7_REPEAT_EASY_20260525_022_RETRY_1");
});

test("classifier reclassifies late_ack_after_trigger_completed from fail_verifier to infra_retry", () => {
  const lateAckRow = {
    run_idx: 14,
    hash: "T7_REPEAT_MEDIUM_20260526_014",
    outcome: "fail_verifier",
    outcome_class: "fail_verifier",
    agent_failure_root_cause: "late_ack_after_trigger_completed",
    trigger_id: "be44f987-dec9-480c-8aef-04539548797d",
    claimed_at: "2026-05-27T14:46:25.039607+00:00",
    completed_at: "2026-05-27T14:46:25.035+00:00",
    ack_id: "81a1124f-7e72-465b-a61f-258bc0f2812c",
    ack_created_at: "2026-05-27T14:49:28.240837+00:00",
    proof_file: "activegraph/frames/t7-repeat-medium-014-20260526.proof",
    agent_commit_sha: "5c6639f4534dc52ea4b1b8fb30f00a03d8356273",
    test_file: "activegraph/tests/test_graph_get_object_t7m_014_coverage.py",
  };
  const [classified] = classifyT7LedgerRows([lateAckRow]);
  assert.equal(classified.outcome_class, OUTCOME_INFRASTRUCTURE_RETRY);
  assert.equal(classified.infrastructure_failure_root_cause, INFRA_ROOT_LATE_ACK_AFTER_TRIGGER_COMPLETED);
  assert.equal(classified.late_ack_evidence.ack_to_completed_delta_ms, 183205);
  assert.equal(classified.late_ack_evidence.proof_file, "activegraph/frames/t7-repeat-medium-014-20260526.proof");
});

test("classifier does NOT reclassify normal passing run as late_ack (ack < completed)", () => {
  const normalPassRow = {
    run_idx: 1,
    hash: "T7_REPEAT_EASY_20260525_001",
    outcome: "pass",
    outcome_class: "pass",
    trigger_id: "some-uuid",
    claimed_at: "2026-05-25T20:00:00.000+00:00",
    completed_at: "2026-05-25T20:05:00.000+00:00",
    ack_id: "ack-uuid",
    ack_created_at: "2026-05-25T20:04:55.000+00:00",  // BEFORE completed_at (normal)
    proof_file: "activegraph/frames/t7-repeat-easy-001.proof",
    agent_commit_sha: "abc123",
  };
  const [classified] = classifyT7LedgerRows([normalPassRow]);
  assert.equal(classified.outcome_class, OUTCOME_PASS);
});

test("harness retry policy resolves late_ack to final_pass when work is at HEAD", () => {
  const lateAckAttempt = {
    run_idx: 14,
    hash: "T7_REPEAT_MEDIUM_20260526_014",
    outcome: "fail_verifier",
    outcome_class: "fail_verifier",
    agent_failure_root_cause: "late_ack_after_trigger_completed",
    trigger_id: "be44f987-dec9-480c-8aef-04539548797d",
    claimed_at: "2026-05-27T14:46:25.039607+00:00",
    completed_at: "2026-05-27T14:46:25.035+00:00",
    ack_id: "81a1124f-7e72-465b-a61f-258bc0f2812c",
    ack_created_at: "2026-05-27T14:49:28.240837+00:00",
    proof_file: "activegraph/frames/t7-repeat-medium-014-20260526.proof",
    agent_commit_sha: "5c6639f4534dc52ea4b1b8fb30f00a03d8356273",
    test_file: "activegraph/tests/test_graph_get_object_t7m_014_coverage.py",
  };
  const decision = decideRetryAction([lateAckAttempt], {
    lateAckResolver: () => ({ resolved: true, reason: "work_at_head", checks: { mocked: true } }),
  });
  assert.equal(decision.action, "final_pass_via_late_ack");
  assert.equal(decision.reason, "late_ack_work_at_head");
  assert.equal(decision.final_row.outcome_class, OUTCOME_PASS);
  assert.equal(decision.final_row.late_ack_resolved, true);
});

test("harness retry policy retries late_ack when work is NOT at HEAD", () => {
  const lateAckAttempt = {
    run_idx: 14,
    hash: "T7_REPEAT_MEDIUM_20260526_014",
    target_symbol: "activegraph.core.graph.Graph.get_object",
    outcome: "fail_verifier",
    outcome_class: "fail_verifier",
    agent_failure_root_cause: "late_ack_after_trigger_completed",
    trigger_id: "be44f987-dec9-480c-8aef-04539548797d",
    claimed_at: "2026-05-27T14:46:25.039607+00:00",
    completed_at: "2026-05-27T14:46:25.035+00:00",
    ack_id: "81a1124f-7e72-465b-a61f-258bc0f2812c",
    ack_created_at: "2026-05-27T14:49:28.240837+00:00",
    proof_file: "activegraph/frames/t7-repeat-medium-014-20260526.proof",
    agent_commit_sha: "5c6639f4534dc52ea4b1b8fb30f00a03d8356273",
    test_file: "activegraph/tests/test_graph_get_object_t7m_014_coverage.py",
  };
  const decision = decideRetryAction([lateAckAttempt], {
    lateAckResolver: () => ({ resolved: false, reason: "commit_not_in_inner_repo" }),
    seedFactory: () => "late-ack-retry-seed",
  });
  assert.equal(decision.action, "retry");
  assert.equal(decision.retry.hash, "T7_REPEAT_MEDIUM_20260526_014_RETRY_1");
  assert.equal(decision.retry.target_symbol, "activegraph.core.graph.Graph.get_object");
});

test("T7 medium ledger run 014 reclassifies to infrastructure_retry with late_ack root cause", () => {
  const rows = readFileSync("frames/t7-native-repetition-progress-medium-20260526.jsonl", "utf8")
    .trim()
    .split(/\n/)
    .map((line) => JSON.parse(line));
  const classified = classifyT7LedgerRows(rows);
  const run014 = classified.find((row) => row.run_idx === 14);
  assert.equal(run014.outcome_class, OUTCOME_INFRASTRUCTURE_RETRY);
  assert.equal(run014.infrastructure_failure_root_cause, INFRA_ROOT_LATE_ACK_AFTER_TRIGGER_COMPLETED);
  assert.ok(run014.late_ack_evidence);
  assert.ok(run014.late_ack_evidence.ack_to_completed_delta_ms > 100000);
});
