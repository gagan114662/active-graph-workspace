# Goal: Diagnose `late_ack_after_trigger_completed` (run 014)

**Token budget:** 100K. DIAGNOSTIC ONLY. No code changes, no commits, no T7 runs.

## Why

T7 medium completed runs 1-13 (with run 008 exhausted, runs 012-013 each requiring a watchdog restart). Run 014 produced a real proof file and an exact canonical ACK — but the verifier rejected because the ACK was created at `2026-05-27T14:49:28.240837+00:00`, **3 minutes after** the canonical trigger `be44f987-dec9-480c-8aef-04539548797d` had completed at `2026-05-27T14:46:25.035+00:00`.

This is a new failure mode: `late_ack_after_trigger_completed`. The agent did the work, the proof exists, the ACK exists with the right canonical pattern — but Pentagon's trigger lifecycle ended before the ACK landed in `messages`.

This shapes whether to:
- Extend the classifier to recognize this as a retryable Pentagon defect (like `ghost_completion`)
- Treat it as a Pentagon upstream bug worth filing
- Adjust the verifier rule to accept late ACKs (would be a verifier rule change — needs operator decision)

## Bootstrap

1. Read `CLAUDE.md`.
2. Outer HEAD should be `a095a7d` (or descendant). If not, STOP.
3. Read `frames/t7-native-repetition-progress-medium-20260526.jsonl` for run 014's full ledger entry.

## Investigation

### Part 1 — Full lifecycle trace of run 014

For trigger `be44f987-dec9-480c-8aef-04539548797d` and ACK message `81a1124f-7e72-465b-a61f-258bc0f2812c`, capture:

- Trigger row from `/rest/v1/agent_triggers?id=eq.be44f987-...`: created_at, claimed_at, completed_at, agent_id, error column (if any)
- All messages in the trigger's conversation, sorted by created_at: id, author, first 200 chars of content, exact created_at timestamp
- Maya's commit (the agent_commit_sha from the proof) — what time was it made? `git -C activegraph show -s --format=%ci <sha>`
- The proof file's filesystem mtime (when did the proof actually land on disk?)

Compute and report:
- `trigger_completed_at - claimed_at` = how long was the claim window
- `ACK_created_at - trigger_completed_at` = how late was the ACK (Codex reported 3 minutes; verify)
- `agent_commit_at - trigger_claimed_at` = when did Maya actually do the work
- `proof_mtime - agent_commit_at` = how long after commit did the proof file land

### Part 2 — Pentagon + watchdog activity during run 014's window

Read `~/.pentagon/trigger-bridge.err.log` for the window from trigger creation to ACK creation. Capture any `pentagon_watchdog_triggered`, `pentagon_restart_completed`, `pentagon_watchdog_suppressed`, `pentagon_watchdog_error` rows.

Specifically: was there a watchdog restart between `trigger.claimed_at` and `trigger.completed_at`? If yes, did Pentagon's restart cause the premature completion?

### Part 3 — Compare to runs 012 and 013 (which ALSO had watchdog restarts but passed)

Runs 012 and 013 both noted "one native-runner watchdog restart" in their notes. They still passed. Pull their trigger lifecycles and ACK timing for comparison:

- Was their `ACK_created_at` BEFORE or AFTER `trigger_completed_at`?
- Did the watchdog restart in the same place in the lifecycle for 012/013 vs 014?

If 012/013 had the watchdog restart in a different phase than 014, that's a clue about what makes 014 different.

### Part 4 — Hypothesis ranking

Based on Parts 1-3, rank these:

- **(a) Premature completion by Pentagon:** Pentagon marked completed_at too early (timeout, watchdog interaction). Maya was still working. The completion event raced ahead of the work.
- **(b) Slow ACK propagation:** Maya finished her work near completed_at, but the ACK message took 3 minutes to land in Supabase (rare; would be a Pentagon-to-Supabase write delay).
- **(c) Maya actually slow:** Maya genuinely took 3 minutes between her commit and her ACK send. Possible if she was retrying or waiting on something.
- **(d) Watchdog cascade:** A watchdog restart during run 014 caused Pentagon to artificially close out the trigger while Maya was mid-work elsewhere.
- **(e) Other:** specify.

### Part 5 — Recommended classifier handling

Based on the hypothesis, recommend ONE of:

- **Extend classifier:** add `late_ack_after_trigger_completed` as retryable infra, same shape as `ghost_completion`.
- **Tighten verifier:** allow ACKs to be valid if they're in the canonical trigger's conversation regardless of `completed_at` timing — only if the evidence supports that Pentagon's `completed_at` is unreliable.
- **Treat as agent_failure:** if the evidence shows Maya was actually slow (hypothesis c), this is agent variance, not infra.
- **Stop and file upstream:** if Pentagon's behavior here is a clear bug not classifiable, file an issue against Pentagon before any T7 work continues.

The recommendation should be evidence-supported, not preference.

## Output

Write the full investigation to:

```
frames/t7-medium-run-014-diagnostic-20260527.log
```

Reply with a SHORT summary (under 500 words):
- Trigger lifecycle timeline (5-7 key timestamps)
- Was the watchdog involved? If yes, when in the lifecycle?
- Hypothesis ranking with one-sentence why
- Recommended classifier handling
- Whether T7 medium can safely resume after this fix

## Hard rules

- NO modifications to code, classifier, verifier, runner, bridge, instruction files, ledger
- NO commits
- NO new T7 runs
- NO invented evidence — say "unknown" if data is unavailable
- If the investigation runs past 80K tokens without resolution, STOP and report partial findings
