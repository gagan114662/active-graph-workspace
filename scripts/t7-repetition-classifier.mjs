import { randomUUID } from "node:crypto";

export const OUTCOME_PASS = "pass";
export const OUTCOME_FAIL_VERIFIER = "fail_verifier";
export const OUTCOME_INFRASTRUCTURE_RETRY = "infrastructure_retry";
export const OUTCOME_INCOMPLETE = "incomplete";
export const INFRA_ROOT_MESSAGE_POLLER_NO_TRIGGER_ROW = "message_poller_no_trigger_row";
export const INFRA_ROOT_GHOST_COMPLETION = "ghost_completion";
export const INFRA_ROOT_NO_TRIGGER_TIMEOUT = "no_trigger_timeout";
export const INFRA_ROOT_LATE_ACK_AFTER_TRIGGER_COMPLETED = "late_ack_after_trigger_completed";
export const INFRA_ROOT_CLAUDE_CODE_SESSION_LIMIT = "claude_code_session_limit";
export const INFRA_ROOT_CODEX_USAGE_LIMIT = "codex_usage_limit";

// Regexes for upstream-provider rate-limit detection. Match the exact strings
// the CLIs return so we can disambiguate "Pentagon dispatched and the agent
// got nothing done" (ghost_completion) from "Pentagon dispatched but the LLM
// provider 429'd us before the agent could think" (rate-limited).
const CLAUDE_CODE_SESSION_LIMIT_PATTERNS = [
  /You've hit your session limit\b/i,
  /session limit\b.*resets/i,
];
const CODEX_USAGE_LIMIT_PATTERNS = [
  /You've hit your usage limit\b/i,
  /chatgpt\.com\/codex\/settings\/usage/i,
];

function _matchesAny(text, patterns) {
  if (!text) return false;
  const s = String(text);
  return patterns.some((re) => re.test(s));
}

/**
 * Inspect a runner-shaped result for upstream-provider rate-limit fingerprints.
 * Returns the specific INFRA_ROOT_* code when matched, or null otherwise.
 *
 * Inputs we look at:
 *   - result.bridge_failure_reason (set by the runner when it correlates with
 *     a recent behavior.failed factory event for the trigger)
 *   - result.bridge_failure_message (verbatim message from the same event)
 *   - result.claude_error (when the runner is invoked in-process by the bridge)
 *   - result.dispatch_error (catch-all extras carried by the helper script)
 */
export function detectUpstreamRateLimit(result) {
  if (!result) return null;
  const reason = result.bridge_failure_reason || result.claude_error?.reason;
  const apiStatus = result.bridge_api_error_status ?? result.claude_error?.apiErrorStatus;
  const msg = (
    result.bridge_failure_message ||
    result.claude_error?.text ||
    result.dispatch_error ||
    ""
  );
  // Claude Code MAX session limit: HTTP 429 + matching message text.
  if (apiStatus === 429 && _matchesAny(msg, CLAUDE_CODE_SESSION_LIMIT_PATTERNS)) {
    return { root: INFRA_ROOT_CLAUDE_CODE_SESSION_LIMIT, retry_after: _extractClaudeResetTime(msg) };
  }
  if (_matchesAny(msg, CLAUDE_CODE_SESSION_LIMIT_PATTERNS)) {
    return { root: INFRA_ROOT_CLAUDE_CODE_SESSION_LIMIT, retry_after: _extractClaudeResetTime(msg) };
  }
  // Codex usage limit (older cohort).
  if (_matchesAny(msg, CODEX_USAGE_LIMIT_PATTERNS)) {
    return { root: INFRA_ROOT_CODEX_USAGE_LIMIT, retry_after: _extractCodexResetTime(msg) };
  }
  if (reason === "llm.rate_limited") {
    // Generic rate-limit without a recognizable upstream fingerprint; fall
    // back to the Claude Code label so callers still get a specific code.
    return { root: INFRA_ROOT_CLAUDE_CODE_SESSION_LIMIT, retry_after: null };
  }
  return null;
}

function _extractClaudeResetTime(msg) {
  const m = String(msg || "").match(/resets\s+([0-9]{1,2}:[0-9]{2}\s*[ap]m\s*\([^)]+\))/i);
  return m ? m[1] : null;
}
function _extractCodexResetTime(msg) {
  const m = String(msg || "").match(/try again at\s+([^.]+\.)/i);
  return m ? m[1].trim() : null;
}
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
  const proofMissing = result?.expected_file && result.expected_file.exists === false;
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
      infrastructure_failure_root_cause: INFRA_ROOT_MESSAGE_POLLER_NO_TRIGGER_ROW,
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

  if (triggerPassed && responseRows.length === 0 && proofMissing) {
    // Disambiguate ghost_completion (Pentagon claimed+completed with no
    // work) from upstream rate-limit (LLM provider 429'd before agent
    // could think). Same DB shape; different root cause + retry policy.
    const upstream = detectUpstreamRateLimit(result);
    const root = upstream?.root ?? INFRA_ROOT_GHOST_COMPLETION;
    return {
      ...result,
      activation_path: activationPath,
      native_pass: false,
      outcome_class: OUTCOME_INFRASTRUCTURE_RETRY,
      infrastructure_failure_root_cause: root,
      verdict: "native_task_failed_or_incomplete",
      ghost_completion_evidence: {
        trigger_id: finalTrigger?.id ?? null,
        claimed_at: finalTrigger?.claimed_at ?? null,
        completed_at: finalTrigger?.completed_at ?? null,
        response_row_count: responseRows.length,
        expected_file_exists: result?.expected_file?.exists ?? null,
      },
      ...(upstream?.retry_after ? { retry_after: upstream.retry_after } : {}),
    };
  }

  if (!finalTrigger && responseRows.length === 0 && proofMissing) {
    const originalMessageId = result?.message?.id ?? result?.message_id ?? null;
    return {
      ...result,
      activation_path: activationPath,
      native_pass: false,
      outcome_class: OUTCOME_INFRASTRUCTURE_RETRY,
      infrastructure_failure_root_cause: INFRA_ROOT_NO_TRIGGER_TIMEOUT,
      verdict: "native_task_failed_or_incomplete",
      no_trigger_timeout_evidence: {
        original_message_id: originalMessageId,
        agent_triggers_query: originalMessageId
          ? "/rest/v1/agent_triggers?message_id=eq." + originalMessageId
          : null,
        response_row_count: responseRows.length,
        expected_file_exists: result?.expected_file?.exists ?? null,
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
      infrastructure_failure_root_cause: row?.infrastructure_failure_root_cause ?? inferInfrastructureRootCause(row),
    };
  }
  if (row?.outcome_class === OUTCOME_PASS) {
    return { ...row, outcome_class: OUTCOME_PASS };
  }
  if (row?.outcome_class === OUTCOME_FAIL_VERIFIER) {
    const failNotes = String(row?.notes ?? "");
    if (looksLikeLateAckAfterTriggerCompleted(row, failNotes)) {
      return {
        ...row,
        outcome: OUTCOME_INFRASTRUCTURE_RETRY,
        outcome_class: OUTCOME_INFRASTRUCTURE_RETRY,
        infrastructure_failure_root_cause: INFRA_ROOT_LATE_ACK_AFTER_TRIGGER_COMPLETED,
        late_ack_evidence: lateAckEvidence(row),
      };
    }
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
        infrastructure_failure_root_cause: classified.infrastructure_failure_root_cause,
        missing_trigger_evidence: classified.missing_trigger_evidence,
        ghost_completion_evidence: classified.ghost_completion_evidence,
        no_trigger_timeout_evidence: classified.no_trigger_timeout_evidence,
      };
    }
  }

  const notes = String(row?.notes ?? "");
  const looksLikeMessagePollerDrop = (
    row?.trigger_id === null ||
    row?.trigger_id === undefined ||
    row?.activation_path === "message_poller_no_trigger_row"
  ) && hasMessagePollerWorkEvidence(row, notes);

  if (looksLikeMessagePollerDrop) {
    return {
      ...row,
      outcome: OUTCOME_INFRASTRUCTURE_RETRY,
      outcome_class: OUTCOME_INFRASTRUCTURE_RETRY,
      infrastructure_failure_root_cause: INFRA_ROOT_MESSAGE_POLLER_NO_TRIGGER_ROW,
    };
  }

  if (looksLikeGhostCompletion(row, notes)) {
    return {
      ...row,
      outcome: OUTCOME_INFRASTRUCTURE_RETRY,
      outcome_class: OUTCOME_INFRASTRUCTURE_RETRY,
      infrastructure_failure_root_cause: INFRA_ROOT_GHOST_COMPLETION,
    };
  }

  if (looksLikeNoTriggerTimeout(row, notes)) {
    return {
      ...row,
      outcome: OUTCOME_INFRASTRUCTURE_RETRY,
      outcome_class: OUTCOME_INFRASTRUCTURE_RETRY,
      infrastructure_failure_root_cause: INFRA_ROOT_NO_TRIGGER_TIMEOUT,
    };
  }

  if (looksLikeLateAckAfterTriggerCompleted(row, notes)) {
    return {
      ...row,
      outcome: OUTCOME_INFRASTRUCTURE_RETRY,
      outcome_class: OUTCOME_INFRASTRUCTURE_RETRY,
      infrastructure_failure_root_cause: INFRA_ROOT_LATE_ACK_AFTER_TRIGGER_COMPLETED,
      late_ack_evidence: lateAckEvidence(row),
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

export function inferInfrastructureRootCause(row) {
  const notes = String(row?.notes ?? "");
  if (looksLikeLateAckAfterTriggerCompleted(row, notes)) return INFRA_ROOT_LATE_ACK_AFTER_TRIGGER_COMPLETED;
  if (looksLikeGhostCompletion(row, notes)) return INFRA_ROOT_GHOST_COMPLETION;
  if (looksLikeNoTriggerTimeout(row, notes)) return INFRA_ROOT_NO_TRIGGER_TIMEOUT;
  if (hasMessagePollerWorkEvidence(row, notes)) return INFRA_ROOT_MESSAGE_POLLER_NO_TRIGGER_ROW;
  return INFRA_ROOT_MESSAGE_POLLER_NO_TRIGGER_ROW;
}

function hasMessagePollerWorkEvidence(row, notes = String(row?.notes ?? "")) {
  if (row?.activation_path === "message_poller_no_trigger_row") return true;
  if (row?.ack_id || row?.ack_created_at) return true;
  if (/exact ACK message ids|exact ACK messages|proof file and exact ACK|harness succeeded via activation_path=message_poller_no_trigger_row/i.test(notes)) {
    return true;
  }
  return false;
}

function looksLikeGhostCompletion(row, notes = String(row?.notes ?? "")) {
  const triggerCompleted = Boolean(row?.trigger_id && row?.claimed_at && row?.completed_at);
  const noAgentOutput = !row?.ack_id && /no hash-bearing response rows|zero hash-bearing responses|no expected proof file/i.test(notes);
  return triggerCompleted && noAgentOutput;
}

function looksLikeNoTriggerTimeout(row, notes = String(row?.notes ?? "")) {
  const missingTrigger = row?.trigger_id === null || row?.trigger_id === undefined;
  const noWorkEvidence = !hasMessagePollerWorkEvidence(row, notes);
  const timeoutEvidence = /no agent_triggers row.*no hash-bearing response rows.*no proof file|no trigger row.*no proof.*no ACK|runner deadline/i.test(notes);
  return missingTrigger && noWorkEvidence && timeoutEvidence;
}

function looksLikeLateAckAfterTriggerCompleted(row, notes = String(row?.notes ?? "")) {
  const hintedByRoot = row?.agent_failure_root_cause === INFRA_ROOT_LATE_ACK_AFTER_TRIGGER_COMPLETED ||
    row?.infrastructure_failure_root_cause === INFRA_ROOT_LATE_ACK_AFTER_TRIGGER_COMPLETED;
  const hintedByNotes = /late_ack_after_trigger_completed|ACK row was created after the canonical trigger completed/i.test(notes);

  const triggerComplete = Boolean(row?.trigger_id && row?.claimed_at && row?.completed_at);
  const ackPresent = Boolean(row?.ack_id && row?.ack_created_at);
  if (!triggerComplete || !ackPresent) {
    return hintedByRoot;
  }

  const completedTime = Date.parse(row.completed_at);
  const ackTime = Date.parse(row.ack_created_at);
  if (!Number.isFinite(completedTime) || !Number.isFinite(ackTime)) {
    return hintedByRoot;
  }
  const ackAfterCompleted = ackTime > completedTime;

  const workEvidence = Boolean(row?.proof_file && row?.agent_commit_sha);

  if (hintedByRoot && workEvidence) return true;
  if (hintedByNotes && workEvidence && ackAfterCompleted) return true;
  if (ackAfterCompleted && workEvidence) return true;
  return false;
}

function lateAckEvidence(row) {
  const completedTime = Date.parse(row?.completed_at ?? "");
  const ackTime = Date.parse(row?.ack_created_at ?? "");
  return {
    trigger_id: row?.trigger_id ?? null,
    claimed_at: row?.claimed_at ?? null,
    completed_at: row?.completed_at ?? null,
    ack_id: row?.ack_id ?? null,
    ack_created_at: row?.ack_created_at ?? null,
    ack_to_completed_delta_ms: Number.isFinite(completedTime) && Number.isFinite(ackTime)
      ? ackTime - completedTime
      : null,
    agent_commit_sha: row?.agent_commit_sha ?? null,
    test_file: row?.test_file ?? null,
    proof_file: row?.proof_file ?? null,
    native_runner_watchdog_triggered_at: row?.native_runner_watchdog_triggered_at ?? null,
  };
}

// Default-noop work-at-HEAD resolver. The harness layer provides a real
// implementation that calls git + fs. Tests inject their own.
export function noopLateAckResolver() {
  return { resolved: false, reason: "no_resolver_provided" };
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

export function decideRetryAction(attemptRows, { maxRetries = MAX_INFRASTRUCTURE_RETRIES, seedFactory = randomUUID, lateAckResolver = noopLateAckResolver } = {}) {
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

  // Special case: late_ack_after_trigger_completed. Maya's work may already
  // be at HEAD (commit landed, test file committed). If so, the audit chain
  // is recoverable without re-running the agent. Resolver does the fs/git
  // check; tests inject a fake resolver.
  if (last.infrastructure_failure_root_cause === INFRA_ROOT_LATE_ACK_AFTER_TRIGGER_COMPLETED) {
    const resolution = lateAckResolver(last) ?? { resolved: false, reason: "resolver_returned_nothing" };
    if (resolution.resolved) {
      return {
        action: "final_pass_via_late_ack",
        reason: "late_ack_work_at_head",
        late_ack_resolution: resolution,
        final_row: { ...last, outcome_class: OUTCOME_PASS, late_ack_resolved: true },
      };
    }
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
