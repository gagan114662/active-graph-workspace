# Brandon-D audit: frozen historical evidence cache staleness

**Date:** 2026-05-27
**Trigger:** Backlog task #17, prompted by Brandon Walsenuk's "lesson 3"
  from "Stop babysitting your agents" (AI Engineer, 2026-05-26): *"The
  moment you write the docs they're invalid because things are
  changing."* Cached "correct" answers compound stale over 24h.
**Question:** The verifier (`scripts/verify-pentagon-autonomy-from-logs.mjs`)
  has `requireText` assertions against four log files from 2026-05-23.
  After today's cohort migration (gpt-5.5/codex → opus-4.7/claude-code),
  do those frozen assertions still pin truth or have they become stale
  cached lies?

## Files audited

| Verifier line | File | Stated date | File mtime |
|---|---|---|---|
| 2166 (CODEX_HARNESS_NATIVE_RECHECK_LOG) | `frames/t5n-codex-harness-native-recheck-2026-05-23.log` | 2026-05-23 | May 23 10:03 |
| 2191 (CLEARED_QUEUE_NATIVE_ATTRIBUTION_LOG) | `frames/t5o-cleared-queue-native-attribution-2026-05-23.log` | 2026-05-23 | May 23 10:10 |
| 2201 (NATIVE_POLLER_SURFACE_AUDIT_LOG) | `frames/t5p-native-poller-surface-audit-2026-05-23.log` | 2026-05-23 | May 23 10:13 |
| 2229 (RESTARTED_APP_NATIVE_ACTIVATION_LOG) | `frames/t5q-restarted-app-native-activation-2026-05-23.log` | 2026-05-23 | May 23 10:23 |

## What the verifier asserts about each file

Each file is read once and checked for specific text fragments via
`requireText(<label>, <file-content>, <substring>)`. The assertions are
about the file's *literal content*, not about live system state.

Sample assertions (from `frames/t5n-...`):
- `"INTERPRETER_OK Codex"` is in the file
- `"codex|gpt-5.5|claude-code|local: 20"` is in the file
- `"updated_count: 20"` is in the file
- `"native Pentagon handoff activation remains red."` is in the file

These are forensic claims about a frozen snapshot taken at the file's
creation moment.

## Is Brandon's lesson 3 violated?

**No, in the strict sense.** Brandon's lesson is about *cached current-state
answers* going stale. The frozen files here are NOT cached current-state —
they are historical evidence pinning what was true at file-creation time.
Their assertions remain accurate because:

1. **The file content doesn't change.** A 2026-05-23 log saying
   `"native Pentagon handoff activation remains red."` is still TRUE as
   a description of 2026-05-23.
2. **The verifier's check is "does this evidence record exist with
   these strings".** Not "is the live system in this state right now".
3. **Live system state has its own check.** Lines 764-774 + line 1978
   (now config-driven via `agent-os/agent-cohort.json`) assert on the
   live DB. The frozen files don't interfere.

## Where Brandon-D would catch us

**Risk:** if a future operator reads these frozen log files OUT OF
CONTEXT and treats them as descriptions of CURRENT state, they would
conclude:
- Pentagon agents are still on gpt-5.5/codex (false — migrated 2026-05-27)
- Native Pentagon handoff is red (TRUE — still confirmed today, not a
  cache-staleness issue)
- The 20-agent count was last verified on 2026-05-23 (true; still 20
  today after migration)

**Specifically wrong claims if read as live:**
- `INTERPRETER_OK Codex` — operator is no longer using Codex as the
  active harness for active_graph agents (claude-code is now the
  harness). Per the frozen file's stated purpose, "Codex" referred to
  what was active on 2026-05-23; today's interpreter check would
  produce `INTERPRETER_OK Claude` or similar.
- `provider_model_harness_execution_counts.codex|gpt-5.5|codex|local: 20`
  — currently false. Today's actual count is
  `claude-code|claude-opus-4-7|claude-code|local: 20`.

## Verdict per file

All four files: **KEEP AS-IS. Historical snapshot, not stale cache.**

The risk of misinterpretation exists but the verifier itself uses these
files correctly. The fix is documentation, not regeneration:

- Add a one-line header marker to each frozen file: `# FROZEN HISTORICAL
  SNAPSHOT — describes Pentagon state as of <date>. Do NOT interpret as
  current state.`
- Or rename them with a `.historical-snapshot.` infix so the path itself
  signals intent.

## Recommendations

1. **No change to verifier assertions.** They are forensically correct.
2. **Add an inline comment in `verify-pentagon-autonomy-from-logs.mjs`**
   above the frozen-file block explaining the historical-snapshot
   semantic. This prevents future "let me clean up these stale-looking
   strings" refactors.
3. **Track cohort transitions explicitly.** When the next cohort
   migration happens (claude-opus-4-7 → claude-opus-4-9 or whatever),
   create *new* dated snapshot files alongside the existing ones.
   Don't modify or delete the old ones — they're the audit trail.
4. **The live-DB checks (lines 764-774 + 1978) are the only ones that
   should change with each cohort migration.** Those are already
   config-driven via `agent-os/agent-cohort.json` (shipped today).

## Closing

Brandon-D was correct to flag the *risk* but the audit finds the verifier
implementation correctly distinguishes "what the log file contains"
from "what the live system is doing now". The frozen evidence files
serve as cryptographic-feeling pins on history. They are operationally
analogous to git blobs — content-addressable historical truth.

The takeaway from Brandon's lesson 3 still applies broadly: *don't
treat any cached answer as load-bearing without an expiry/refresh
mechanism*. The verifier's frozen evidence files happen to have one
built in by their nature (they describe a fixed past moment), but other
caches in the dark factory might not. Worth a follow-up audit for
anything that LOOKS like a frozen snapshot but is actually a stale
cache.

Audit closed 2026-05-27.
