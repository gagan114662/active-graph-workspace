# Goal: Diagnose why T7-medium run 008 deterministically hits ghost_completion

**Token budget:** 80K. DIAGNOSTIC ONLY. No code changes, no commits, no DB writes, no T7 runs. Investigation + report only.

## Why

T7 medium completed runs 1-7 perfectly, then run 008 deterministically failed 4 times in a row with `ghost_completion`. All 4 attempts had `target_symbol=null`. Wall times split bimodally: 12s, 17s (very fast — looks like Pentagon claim+complete without dispatching Maya) vs 93s, 94s (looks like Maya ran but output didn't land).

Operator wants to know:
1. Is there anything structurally different about run 008's instruction message vs the 7 that worked?
2. Did Pentagon's state change between run 007 (pass) and run 008 (deterministic fail)?
3. Are the 12-17s and 93-94s sub-modes actually different defects under one label?

This shapes whether to skip 008 as exhausted, investigate Pentagon deeper, or split the classifier.

## Bootstrap

1. Read `CLAUDE.md`.
2. Outer HEAD should be `3f7d991` (or descendant). If not, STOP.
3. Read `frames/t7-native-repetition-progress-medium-20260526.jsonl` for runs 1-8 details.

## Investigation

### Part 1 — Compare run 008's instruction to runs 005-007 (the 3 most recent successes)

Read all 4 files:
- `frames/t7-repeat-medium-005-instruction-20260526.txt`
- `frames/t7-repeat-medium-006-instruction-20260526.txt`
- `frames/t7-repeat-medium-007-instruction-20260526.txt`
- `frames/t7-repeat-medium-008-instruction-20260526.txt`

For each, capture:
- Total character count
- Number of lines
- The hash line
- The RUN_SEED value
- Any task-description differences (was 008's instruction wording materially different from the others?)
- Anything else unusual

Report whether run 008's instruction file is **structurally similar** to runs 5-7 or **different in some specific way**.

### Part 2 — Run 008's 4 attempt traces from Supabase

For each of run 008's 4 attempts (original + retry_1, retry_2, retry_3):

Look up the trigger via the harness/runner logs in:
- `frames/t7-repeat-medium-008-run-20260526.log`
- `frames/t7-repeat-medium-008-retry-1-run-20260526.log` (if exists)
- `frames/t7-repeat-medium-008-retry-2-run-20260526.log` (if exists)
- `frames/t7-repeat-medium-008-retry-3-run-20260526.log` (if exists)

For each attempt, find the trigger_id and:
- Query `/rest/v1/agent_triggers?id=eq.<trigger_id>` — capture claimed_at, completed_at, agent_id, error column
- Query `/rest/v1/messages` for the original instruction message and any Maya responses in the trigger's conversation
- Compute claim-to-complete delta (the 12s vs 93s split)

Specifically: for the 93-94s attempts, did Maya produce ANY message in the conversation that we can grade? Even if the proof file didn't land, maybe she emitted partial output that's in the messages table.

Report whether the 12-17s sub-mode and 93-94s sub-mode have **different DB-level shapes** or look the same modulo timing.

### Part 3 — Pentagon + bridge state correlation

Read `~/.pentagon/trigger-bridge.err.log` and look at events between run 007's completion and run 008's first attempt:
- Watchdog restarts?
- JWT refreshes?
- ECONNRESETs?
- Cooldown events?

Did anything change in Pentagon's state between the last successful run and the failed run?

Read launchctl print for the bridge LaunchAgent — what's its `runs` count? `last terminating signal`? Did Pentagon restart between runs 7 and 8?

### Part 4 — Hypothesis ranking

Based on Parts 1-3, rank these hypotheses by evidence support:

- **(a) The instruction itself triggers Pentagon misbehavior** — something specific about run 008's content (RUN_SEED collision, hash collision, message length, etc.)
- **(b) Pentagon's state degraded** — JWT, memory, process state changed between run 7 and run 8
- **(c) Sampling variance** — same Pentagon, same instruction shape, just unlucky 4 times in a row
- **(d) Two sub-modes of `ghost_completion`** — the 12s and 93s patterns are actually distinct defects sharing one label
- **(e) Something else** — explain

## Output

Write the full investigation to:

```
frames/t7-medium-run-008-diagnostic-20260527.log
```

Reply with a SHORT summary (under 400 words):
- Part 1 finding: instruction structurally similar / different (one line)
- Part 2 finding: 12s vs 93s sub-modes have same/different DB shape
- Part 3 finding: Pentagon state changed / did not change between runs 7 and 8
- Hypothesis rank: (a) > (b) > (c) > (d) > (e) or whatever the evidence shows
- Recommended next action: skip run 008 as exhausted / investigate further / split classifier / fix Pentagon

## Hard rules

- **NO** modifications to: classifier, harness, verifier, runner, bridge, instruction files, ledger
- **NO** commits
- **NO** new T7 runs
- **NO** invented evidence — say "unknown" if data is unavailable
- If the investigation runs past 60K tokens without resolving, STOP and report partial findings; operator decides
