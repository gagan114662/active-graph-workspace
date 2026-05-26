import { randomUUID } from "node:crypto";

export const OUTCOME_PASS = "pass";
export const OUTCOME_FAIL_VERIFIER = "fail_verifier";
export const OUTCOME_INFRASTRUCTURE_RETRY = "infrastructure_retry";
export const OUTCOME_INCOMPLETE = "incomplete";
export const MAX_INFRASTRUCTURE_RETRIES = 3;

export function classifyNativeRunnerResult(result) {
  const responseRows = Array.isArray(result?.response_rows) ? result.response_rows : [];
  const finalTrigger = result?.final_trigger ?? null;
  const activationPath = result?.activation_path ?? (
    finalTrigger?.claimed_at && finalTrigger?.completed_at
      ? "agent_trigger"
      : "incomplete"
  );
  const filePassed = !result?.expected_file || result.expected_file.contains_hash === true;
  const triggerPassed = Boolean(finalTrigger?.claimed_at && finalTrigger?.completed_at);
  const messagePollerOnly = activationPath === "message_poller_no_trigger_row";

  if (messagePollerOnly) {
    const originalMessageId = result?.message?.id ?? result?.message_id ?? null;
    const triggerRows = Array.isArray(result?.agent_triggers_result)
      ? result.agent_triggers_result
      : (finalTrigger ? [finalTrigger] : []);
    return {
      ...result,
      activation_path: activationPath,
      native_pass: false,
      outcome_class: OUTCOME_INFRASTRUCTURE_RETRY,
      verdict: "native_task_failed_or_incomplete",
      missing_trigger_evidence: {
        original_message_id: originalMessageId,
        agent_triggers_query: originalMessageId
          ? "/rest/v1/agent_triggers?message_id=eq." + originalMessageId
          : null,
        agent_triggers_result: triggerRows,
        ack_message_ids: responseRows.map((row) => row.id).filter(Boolean),
      },
    };
  }

  const nativePass = Boolean(triggerPassed && responseRows.length && filePassed);
  return {
    ...result,
    activation_path: activationPath,
    native_pass: nativePass,
    outcome_class: nativePass ? OUTCOME_PASS : OUTCOME_INCOMPLETE,
    verdict: nativePass ? "native_task_passed" : "native_task_failed_or_incomplete",
  };
}

export function classifyT7LedgerRow(row, runnerResult = null) {
  if (row?.outcome_class === OUTCOME_INFRASTRUCTURE_RETRY || row?.outcome === OUTCOME_INFRASTRUCTURE_RETRY) {
    return {
      ...row,
      outcome: OUTCOME_INFRASTRUCTURE_RETRY,
      outcome_class: OUTCOME_INFRASTRUCTURE_RETRY,
      infrastructure_failure_root_cause: row?.infrastructure_failure_root_cause ?? "message_poller_no_trigger_row",
    };
  }
  if (row?.outcome_class === OUTCOME_PASS) {
    return { ...row, outcome_class: OUTCOME_PASS };
  }
  if (row?.outcome_class === OUTCOME_FAIL_VERIFIER) {
    return {
      ...row,
      outcome_class: OUTCOME_FAIL_VERIFIER,
      agent_failure_root_cause: row?.agent_failure_root_cause ?? inferAgentFailureRootCause(row),
    };
  }

  if (runnerResult) {
    const classified = classifyNativeRunnerResult(runnerResult);
    if (classified.outcome_class === OUTCOME_INFRASTRUCTURE_RETRY) {
      return {
        ...row,
        outcome: OUTCOME_INFRASTRUCTURE_RETRY,
        outcome_class: OUTCOME_INFRASTRUCTURE_RETRY,
        infrastructure_failure_root_cause: "message_poller_no_trigger_row",
        missing_trigger_evidence: classified.missing_trigger_evidence,
      };
    }
  }

  const notes = String(row?.notes ?? "");
  const looksLikeMessagePollerDrop = (
    row?.trigger_id === null ||
    row?.trigger_id === undefined ||
    row?.activation_path === "message_poller_no_trigger_row"
  ) && /message_poller_no_trigger_row|trigger_rows=0|no canonical agent_triggers row/i.test(notes);

  if (looksLikeMessagePollerDrop) {
    return {
      ...row,
      outcome: OUTCOME_INFRASTRUCTURE_RETRY,
      outcome_class: OUTCOME_INFRASTRUCTURE_RETRY,
      infrastructure_failure_root_cause: "message_poller_no_trigger_row",
    };
  }

  if (row?.outcome === OUTCOME_PASS || row?.verifier_exit === 0) {
    return { ...row, outcome_class: OUTCOME_PASS };
  }

  if (row?.outcome === OUTCOME_FAIL_VERIFIER || Number(row?.verifier_exit) !== 0) {
    return {
      ...row,
      outcome_class: OUTCOME_FAIL_VERIFIER,
      agent_failure_root_cause: row?.agent_failure_root_cause ?? inferAgentFailureRootCause(row),
    };
  }

  return { ...row, outcome_class: row?.outcome_class ?? OUTCOME_INCOMPLETE };
}

export function inferAgentFailureRootCause(row) {
  const notes = String(row?.notes ?? "");
  if (/narrative|did not reply with the exact ACK|no canonical ACK/i.test(notes)) {
    return "narrative_wrapped_ack";
  }
  return "unknown_agent_side";
}

export function classifyT7LedgerRows(rows, runnerResultsByRunIdx = new Map()) {
  return rows.map((row) => classifyT7LedgerRow(row, runnerResultsByRunIdx.get(row.run_idx)));
}

export function computeT7ProgressMetrics(rows) {
  const classifiedRows = classifyT7LedgerRows(rows);
  const passCount = classifiedRows.filter((row) => row.outcome_class === OUTCOME_PASS).length;
  const agentFailureCount = classifiedRows.filter((row) => row.outcome_class === OUTCOME_FAIL_VERIFIER).length;
  const infraRetryCount = classifiedRows.filter((row) => row.outcome_class === OUTCOME_INFRASTRUCTURE_RETRY).length;
  const agentDenominator = passCount + agentFailureCount;
  return {
    pass_count: passCount,
    agent_failure_count: agentFailureCount,
    infra_retry_count: infraRetryCount,
    total_run_attempts: classifiedRows.length,
    pass_rate: agentDenominator ? passCount / agentDenominator : null,
    infrastructure_failure_rate: classifiedRows.length ? infraRetryCount / classifiedRows.length : null,
    classified_rows: classifiedRows,
  };
}

export function buildRetryAttempt({ originalRow, retryNumber, seed = randomUUID() }) {
  if (!originalRow) throw new Error("originalRow is required");
  if (!Number.isInteger(retryNumber) || retryNumber < 1) throw new Error("retryNumber must be a positive integer");
  return {
    retry_of_run_idx: originalRow.retry_of_run_idx ?? originalRow.run_idx,
    retry_of_hash: originalRow.retry_of_hash ?? originalRow.hash,
    retry_attempt: retryNumber,
    hash: (originalRow.retry_of_hash ?? originalRow.hash) + "_RETRY_" + retryNumber,
    seed,
    target_symbol: originalRow.target_symbol,
  };
}

export function decideRetryAction(attemptRows, { maxRetries = MAX_INFRASTRUCTURE_RETRIES, seedFactory = randomUUID } = {}) {
  if (!attemptRows.length) return { action: "start" };
  const classifiedRows = classifyT7LedgerRows(attemptRows);
  const last = classifiedRows[classifiedRows.length - 1];
  const original = classifiedRows[0];

  if (last.outcome_class === OUTCOME_PASS) {
    return { action: "final_pass", final_row: last };
  }
  if (last.outcome_class === OUTCOME_FAIL_VERIFIER) {
    return { action: "final_agent_failure", final_row: last };
  }
  if (last.outcome_class !== OUTCOME_INFRASTRUCTURE_RETRY) {
    return { action: "incomplete", final_row: last };
  }

  const infraAttempts = classifiedRows.filter((row) => row.outcome_class === OUTCOME_INFRASTRUCTURE_RETRY).length;
  if (infraAttempts >= maxRetries) {
    return {
      action: "escalate",
      reason: "max_infrastructure_retries_exhausted",
      infrastructure_attempts: infraAttempts,
      final_row: last,
    };
  }

  return {
    action: "retry",
    reason: "infrastructure_retry",
    infrastructure_attempts: infraAttempts,
    retry: buildRetryAttempt({
      originalRow: original,
      retryNumber: infraAttempts,
      seed: seedFactory(),
    }),
  };
}
