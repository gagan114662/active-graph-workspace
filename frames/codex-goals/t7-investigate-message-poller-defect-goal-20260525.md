# Goal: Investigate `message_poller_no_trigger_row` defect (run 014)

**Token budget:** 200K. **DIAGNOSTIC ONLY — do NOT modify production code, do NOT commit fixes.** Investigate, report, propose. Operator decides whether/how to fix.

## Bootstrap

1. Read `CLAUDE.md` in full.
2. Read `frames/t7-native-repetition-progress-20260525.jsonl` — entry for run 008 (narrative-wrap, known mode) and run 014 (new defect, this investigation's subject).
3. Read `scripts/pentagon-trigger-bridge.mjs` — locate the code path that emits `activation_path=message_poller_no_trigger_row`. Understand what conditions cause it.
4. Read `scripts/verify-pentagon-autonomy-from-logs.mjs` for the canonical-trigger rule from `b6c774c` — the rule that correctly rejected run 014.

## Context

Run 014 of the T7-easy repetition series produced a real Maya ACK message in Pentagon's `messages` table, but Pentagon never created a corresponding row in `agent_triggers` for the original instruction. The bridge fell back to an alternate `message_poller_no_trigger_row` activation path. The verifier correctly failed the run because the canonical-trigger rule requires a real trigger row to anchor the audit chain.

This is a NEW failure mode beyond the previously-known narrative-wrapped ACK pattern (run 008) and the watchdog-handled activation hiccups. It is the second known Pentagon-side audit-creation gap (the first being the empty `agent_runtime_events` table, documented in CLAUDE.md).

## Investigation tasks

### 1. Trace run 014 in Pentagon

For trigger creation attempt(s) related to run 014's hash `T7_REPEAT_EASY_20260525_014`:

- Find the message-id from `frames/t7-native-repetition-progress-20260525.jsonl` (run 014's `message_id` field)
- Query `/rest/v1/messages?id=eq.<message_id>` — confirm the original instruction message exists
- Query `/rest/v1/agent_triggers?message_id=eq.<message_id>` — confirm 0 rows (the missing trigger)
- Query `/rest/v1/agent_triggers?created_at=gte.<run_014_start>&created_at=lte.<run_014_end>` — list ALL triggers created during run 014's window; check if any of them reference Maya's conversation
- Read Maya's full reply messages in the conversation; record their content + created_at + ids

### 2. Look at the bridge code path

In `scripts/pentagon-trigger-bridge.mjs`:

- Where is `activation_path=message_poller_no_trigger_row` set? Under what conditions?
- Is this a deliberate fallback path or an error-recovery branch?
- What did the bridge do AT THE TIME it took this path — is there a try/catch that swallowed a trigger-insertion error?
- Are there bridge err.log entries for this run period that show the trigger-insertion failing?

### 3. Compare to known-good runs

Pick two known-good T7 easy runs (e.g. runs 011 and 013) and compare:

- Did they have agent_triggers rows? Yes/no
- Was their activation_path different (e.g. `agent_trigger` instead of `message_poller_no_trigger_row`)?
- Is the difference behavioral (Pentagon sometimes skips trigger creation) or environmental (something failed during run 014 specifically)?

### 4. Check the broader pattern

Query `/rest/v1/messages?created_at=gte.<24h_ago>&select=id,content,created_at&limit=500` and cross-reference against agent_triggers. How many recent messages have NO matching trigger row?

This tells you whether `message_poller_no_trigger_row` is:
- A rare race condition that only hit run 014
- A systematic pattern affecting some % of runs
- A growing trend (frequency-increasing)

### 5. Hypothesize root cause

Based on the evidence above, propose ONE most-likely root cause from these candidates (or a new one):

a. **Race condition:** message arrives at Pentagon before the trigger row commit lands. Bridge sees the message via `message_poller`, processes it, ACK comes through, but trigger row was never written.
b. **Pentagon bug:** trigger creation silently fails for certain inputs (e.g., specific content patterns, specific message timing) and Pentagon doesn't log the failure.
c. **Bridge race condition:** the bridge created the trigger but Pentagon's auto-claim happened so fast the trigger row was deleted or moved before the verifier looked.
d. **Schema/permissions:** Supabase RLS or schema constraint silently rejected the trigger insert.
e. **Something else entirely.**

### 6. Propose remediation (do NOT implement)

Three categories of possible fixes:

- **Fix Pentagon-side:** if Pentagon should always create a trigger row, fixing it there is correct.
- **Fix bridge-side:** if the bridge can detect the missing trigger row and synthesize one, that's a workaround.
- **Acknowledge as known mode:** if the rate is low enough and rooting it out isn't worth it, document as a known T7 fail mode (alongside narrative-wrap) and the verifier already handles it correctly (by failing the run).

## Output

Write the full investigation to:

```
frames/t7-message-poller-defect-investigation-20260525.log
```

Reply with a SHORT summary (< 500 words):

- One-line description of `message_poller_no_trigger_row` semantics in the bridge code
- Run 014's full trace: was the instruction sent, was the trigger row created, what path did the bridge take, when did Maya reply
- Pattern frequency: count of messages without matching triggers in the last 24h
- Most-likely root cause from (a)-(e)
- Recommended remediation category (Pentagon fix / bridge fix / acknowledge as known mode)
- Whether you think T7 easy should resume (and continue past this failure mode as known) or stop pending a fix

## Hard rules

- **Do NOT modify** `scripts/pentagon-trigger-bridge.mjs` or `scripts/verify-pentagon-autonomy-from-logs.mjs`
- **Do NOT commit** anything except the investigation log file
- **Do NOT trigger any T7 runs** during this investigation
- **Do NOT loosen** the canonical-trigger rule — it correctly rejected run 014 and that's the right behavior
- If you find evidence that the defect requires more than 10 lines of code to fix, STOP and report; operator decides scope.
