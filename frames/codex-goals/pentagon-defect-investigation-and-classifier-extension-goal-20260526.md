# Goal: Investigate Pentagon's 3 defect modes + extend classifier to cover 2 new ones

**Token budget:** 350K. Phased work. STOP at end of Phase 1 if investigation is inconclusive — operator decides whether to implement classifier extensions based on what Phase 1 finds.

## Why this exists

T7 easy completed 25 runs with **agent-attributed 95% / infrastructure 84%**. Pentagon's 16% infra failure rate is dominated by **3 distinct defect modes**:

1. `message_poller_no_trigger_row` — Maya ACKs, but Pentagon never wrote the `agent_triggers` row. Already classified.
2. **"ghost completion"** — Pentagon writes `claimed_at` and `completed_at` quickly (~10s) but Maya produces zero hash-bearing responses and no proof file. Run 017. NOT yet classified — currently triggers abort.
3. **"no-trigger timeout"** — runner deadline expires before any `agent_triggers` row appears for the dispatched message. Run 022. NOT yet classified — currently triggers abort.

Hypothesis (operator's, to be tested): **the 3 modes share a common root cause** in Pentagon's trigger ingestion or claim machinery. If they do, one fix helps all three. If they don't, classify them separately.

Goal of this work, in order:

- Phase 1: Investigate Pentagon's behavior across all 6 known infra failures (4× `message_poller_no_trigger_row`, 1× ghost completion, 1× no-trigger timeout). Look for shared root cause evidence.
- Phase 2: Based on Phase 1 findings, propose classifier extensions for the 2 new modes.
- Phase 3: Implement classifier extensions + harness retry policy + unit tests.
- Phase 4: STOP. Do NOT run T7 medium. Operator decides next.

## Bootstrap

1. Read `CLAUDE.md` in full — particularly the "Known factory defects" table.
2. Read `frames/t7-native-repetition-progress-20260525.jsonl` — find the 6 problematic runs.
3. Read `scripts/t7-repetition-classifier.mjs` and `scripts/t7-repetition-harness.mjs` — understand the current classifier shape.
4. Read `scripts/pentagon-trigger-bridge.mjs` and `scripts/run-native-pentagon-task.mjs` — understand how `activation_path` is set and how the runner interprets timeouts.
5. Outer HEAD should be the latest T7 easy batch commit (`e570686` or descendant). Confirm before proceeding.

## Phase 1 — Investigation (DIAGNOSTIC ONLY, no code changes, no commits)

For EACH of the 6 known Pentagon-side failures, gather:

### Per-run trace
- The instruction message id (from JSONL ledger or run log)
- Query `/rest/v1/messages?id=eq.<message_id>` — confirm the original instruction message exists, capture its created_at
- Query `/rest/v1/agent_triggers?message_id=eq.<message_id>` — does any trigger row exist? If yes, what are claimed_at, completed_at, agent_id? If no, that's the defect.
- Query for ALL agent_triggers rows in the run's time window — was a trigger created for a different message_id? Was the bridge confused?
- Read Maya's reply messages (if any) — did she ACK with anything?
- Check the bridge err.log for the run's time window — any errors / JWT refreshes / ECONNRESETs?

### Per-run state snapshot at failure time
- Pentagon process status (was Pentagon running? recently restarted? memory pressure?)
- Bridge JWT freshness (when was the last `session_refreshed_after_loop_error`?)
- Supabase response latency (look for slow queries in the bridge err.log around that timestamp)
- Watchdog activity (was the watchdog mid-restart or in cooldown?)
- Pentagon's `last terminating signal` from launchctl print (if available)

### Cross-run pattern analysis
After all 6 are traced, look for:
- **Timing correlation:** are the failures clustered in time? Do they happen near Pentagon restarts? Near JWT expirations? Near specific times of day?
- **Sequence correlation:** does Pentagon fail more often on the Nth consecutive run? (load buildup?)
- **Content correlation:** anything special about the messages that failed? (length, structure, target symbol)
- **State correlation:** is Pentagon's poller in a specific state when these happen? (just restarted vs steady-state)

Write all findings to:

```
frames/pentagon-defect-investigation-20260526.log
```

### Phase 1 STOP rule

If the investigation **cannot identify a shared root cause OR distinct per-mode root causes within 200K tokens**, STOP. Reply with:

```
PHASE_1_INCONCLUSIVE
- traces gathered for: <list>
- patterns observed: <list>
- patterns NOT observed: <list>
- next step: operator decides whether to extend the investigation, file Pentagon issues upstream, or accept the modes as opaque and proceed to classifier extension blindly
```

If shared root cause IS identifiable (or distinct per-mode root causes ARE clear), proceed to Phase 2.

## Phase 2 — Classifier extension proposal (still no code changes)

Based on Phase 1 findings, propose:

- New `outcome_class` value(s) for the 2 new modes. Likely candidates:
  - `ghost_completion` — Pentagon claimed+completed without agent execution
  - `no_trigger_timeout` — runner deadline before any trigger row exists

- Whether each new mode should:
  - (a) Be treated as `infrastructure_retry` (same as `message_poller_no_trigger_row`) — retry policy applies
  - (b) Be treated as a distinct retryable class — retry policy applies but with different max_retries or cooldown
  - (c) Be treated as **non-retryable** — escalate to operator (likely if root cause is deterministic and retry won't help)

- Whether existing `infrastructure_retry` should be renamed/split based on Phase 1 evidence.

Write the proposal to:

```
frames/classifier-extension-proposal-20260526.md
```

Then STOP. Operator reviews before Phase 3.

### Phase 2 STOP rule

If Phase 1 found inconclusive patterns and you don't have evidence to support the classification choices, STOP and ask for operator decision rather than guess.

## Phase 3 — Implement classifier extensions (only if operator explicitly approves the Phase 2 proposal)

For Phase 3 to begin, the goal file's invoker should re-invoke with explicit operator approval like: "Proceed with Phase 3 of `pentagon-defect-investigation-and-classifier-extension-goal-20260526.md` per the proposal at `frames/classifier-extension-proposal-20260526.md`."

If approved:

- Add the new outcome class(es) to `scripts/t7-repetition-classifier.mjs`
- Update the harness retry policy in `scripts/t7-repetition-harness.mjs` to handle the new classes
- Update unit tests in `scripts/runner-classify-infra-failure.test.mjs`
- Add regression tests against the existing 25 ledger entries — runs 017 and 022 must now reclassify per the new policy; runs 001-013, 015, 018-021 must NOT reclassify
- Self-test outputs to `frames/classifier-extension-selftest-20260526.log`
- Commit + push as ONE commit:
  ```
  T7 classifier: extend to cover ghost_completion and no_trigger_timeout modes (Pentagon defect categories per investigation 20260526)
  ```

## Hard rules

- **Do NOT modify** Pentagon itself (out of scope; upstream concern)
- **Do NOT modify** the verifier (`scripts/verify-pentagon-autonomy-from-logs.mjs`)
- **Do NOT run** any T7 medium / hard / extra-hard gauntlet
- **Do NOT** invent root causes Phase 1 evidence doesn't support
- If patterns conflict (e.g., 2 modes share root cause but 3rd doesn't), say so explicitly in the proposal
- The classifier extension should NOT be an excuse to lower the gate — the agent-attributed pass rate metric stays as the meaningful capability number

## Reply structure

After Phase 1: a clean summary of what was found + go/stop decision for Phase 2.

After Phase 2: the proposal file content + recommendation for Phase 3.

After Phase 3 (if reached): commit SHA + self-test results + regression confirmation.

Do NOT skip phases. Each phase is a separate operator gate.

## Token budget guidance

- Phase 1 (investigation): 200K
- Phase 2 (proposal): 50K
- Phase 3 (implementation, if reached): 100K
- Total: 350K

If you blow past 300K during Phase 1, stop and report partial findings rather than rushing Phase 2.
