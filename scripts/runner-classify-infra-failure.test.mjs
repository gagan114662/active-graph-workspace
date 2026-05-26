import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  OUTCOME_FAIL_VERIFIER,
  OUTCOME_INFRASTRUCTURE_RETRY,
  OUTCOME_PASS,
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
  assert.equal(classified.verdict, "native_task_failed_or_incomplete");
  assert.deepEqual(classified.missing_trigger_evidence, {
    original_message_id: "message-1",
    agent_triggers_query: "/rest/v1/agent_triggers?message_id=eq.message-1",
    agent_triggers_result: [],
    ack_message_ids: ["ack-1", "ack-2"],
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

test("existing runs 001-014 reclassify only run 014 as infrastructure_retry", () => {
  const rows = readFileSync("frames/t7-native-repetition-progress-20260525.jsonl", "utf8")
    .trim()
    .split(/\n/)
    .map((line) => JSON.parse(line));
  const classified = classifyT7LedgerRows(rows);
  const infraRows = classified.filter((row) => row.outcome_class === OUTCOME_INFRASTRUCTURE_RETRY);
  const run008 = classified.find((row) => row.run_idx === 8);
  const run014 = classified.find((row) => row.run_idx === 14);
  const metrics = computeT7ProgressMetrics(rows);

  assert.deepEqual(infraRows.map((row) => row.run_idx), [14]);
  assert.equal(run008.outcome_class, OUTCOME_FAIL_VERIFIER);
  assert.equal(run008.agent_failure_root_cause, "narrative_wrapped_ack");
  assert.equal(run014.outcome_class, OUTCOME_INFRASTRUCTURE_RETRY);
  assert.equal(metrics.pass_count, 12);
  assert.equal(metrics.agent_failure_count, 1);
  assert.equal(metrics.infra_retry_count, 1);
  assert.equal(metrics.total_run_attempts, 14);
  assert.equal(Number((metrics.pass_rate * 100).toFixed(1)), 92.3);
  assert.equal(Number((metrics.infrastructure_failure_rate * 100).toFixed(1)), 7.1);
});
