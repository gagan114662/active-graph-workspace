# Factory Determinism + Reliability Audit — 2026-05-28

Audit of the dark-factory flywheel: `factory-events.mjs` / `factory_events.py` (event log),
`honker_relay.py` (JSONL→SQLite realtime substrate), `sasha-skeptic.mjs` (routing),
`phoenix-todo-keeper.mjs` (action layer + review gate), `pentagon-trigger-bridge.mjs` (dispatch),
`factory-replay.mjs` (replay verifier), `_lockfile.mjs` (concurrency primitive),
and the rotation/alert daemons.

91 raw findings were triaged: deduplicated into clusters, false positives dropped,
sorted by severity then gap type.

## Executive Summary

**Is the flywheel deterministic?** No — not yet replay-deterministic. Two structural gaps break it:

1. **Routing decisions are not replay-classifiable.** `todo.created` events do not record the
   `matched_rule` or a `config_hash`/`config_version`. When `factory-replay.mjs` re-routes a
   historical failure against the *current* routing config and gets a different answer, it cannot
   tell whether the divergence is an *expected* config evolution or a *real* routing bug. SKIP
   decisions emit no event at all, so a whole category of decisions is invisible to replay.
2. **Judge verdicts are not model-pinned.** `flywheel.review.completed` and `judge.error` events
   carry no `judge_model` / `judge_model_pinned_at`, even though the rubric files pin them.
   Promoting a judge model silently changes the semantics of every historical verdict, and
   `factory-replay --mode judge-replay` reads fields that are never written.

State mutations (git commits, routing-config writes, the todo file itself) partially carry
CRUD-replay hashes — the new `state.git_commit` event does, but the legacy `flywheel.commit.*`
event emitted alongside it does not, and routing-config + todo-file writes emit no state-mutation
event at all. Replay therefore must trust live git/file state rather than reconstructing from the
log.

**Are all failures logged as events?** Mostly, but with real holes:

- **Bridge dispatch is the worst offender.** Several `await`ed calls inside `processCandidates`
  (`mintAgentToken`, `agentById`, `persistAgentMessage`, `completeTrigger`, `claimTrigger`) have
  no try/catch. A rejection there is an *unhandled* rejection that crashes the loop, emits **no**
  factory event, and leaves the trigger **claimed-but-never-completed** (orphaned). This is the
  single biggest "failure with no event" cluster.
- **Honker's `INSERT OR IGNORE` silently drops** any colliding event id without a trace. The
  collision *cause* (the old `evt_<seq:06d>` scheme) was fixed — both Node `nextId()` and Python
  `_next_event_id()` now use `evt_<unix_ms>_<pid>_<seq>` under a lock — so this is much rarer, but
  clock-skew or a future writer can still collide, and the drop would still be invisible.
- **The review gate fails open.** Reviewer-dispatch failure, review timeout (10min), and malformed
  reviewer replies all fall back to landing an **ungated commit**. That may be intended degraded
  behavior, but it is not surfaced as a distinct, operator-visible event class and lands code with
  no human in the loop.
- **Bare `except: pass` / `catch {}`** in the event-emission paths (`bridge_dispatch.py::_emit`,
  `claude_code_cli.py::_try_emit_factory_event`, `honker_listen.py` migration) swallow emission
  failures with no stderr line, so a broken event pipeline is undetectable.

**Verdict:** the loop *runs* and most failures *are* logged, but it is **not yet safe to trust
replay** for either routing or judging, and the dispatch + review-gate layers have failure paths
that produce orphaned triggers and ungated commits without an event. The fixes below are ordered
to close the determinism gaps and the silent-orphan paths first.

### Dropped as false / stale

- **Python `_next_sequence()` TOCTOU race + OSError sequence reset** (3 raw findings): the code
  audited describes the retired `evt_<seq:06d>` scheme. The current `factory_events.py`
  `_next_event_id()` builds `evt_<unix_ms>_<pid>_<seq>` under `_LOCK` and never scans the JSONL for
  a max sequence. No file scan, no OSError-driven reset, no cross-writer collision from sequence
  reuse. Verified at `scripts/factory_events.py:66-75,105-114`.

---

## Critical

### C1. Bridge dispatch: unhandled rejections orphan triggers with no event
**File:** `scripts/pentagon-trigger-bridge.mjs:759,765,766,823,824`
**gap_type:** missing_failure_event / state_unsafe
**Evidence:** Inside `processCandidates`, `claimTrigger` (759), `mintAgentToken` (765),
`agentById` (766), `persistAgentMessage` (823), and `completeTrigger` (824) are each `await`ed with
**no surrounding try/catch**. Any rejection becomes an unhandled promise rejection that crashes the
candidate loop. By line 759 the trigger is already claimed, so the failure leaves it
`claimed_at=set, completed_at=null` forever, and **no factory event is emitted**. This is the
documented "bridge orphans trigger row" defect, generalized across five call sites.
**Fix:** Wrap each call in try/catch that (a) emits `emitInfrastructureEvent({subtype})` with a
distinct reason per site (`trigger_claim_failed`, `agent_token_mint_failed`, `agent_lookup_failed`,
`message_persist_failed`, `trigger_completion_failed`), and (b) for any site at or after the claim,
calls `completeTrigger(claimed.id)` (or releases the claim) before continuing so the trigger never
orphans. A single `try { ... } catch (e) { emit + complete + continue }` block around the
per-candidate body covers all five.

### C2. Honker `INSERT OR IGNORE` silently drops colliding event ids
**File:** `scripts/honker_relay.py:81-92`
**gap_type:** silent_drop
**Evidence:** On a duplicate `id`, `INSERT OR IGNORE` returns `rowcount=0` and the row is discarded
with no log line, no event, no operator signal — a lost event vanishes from the audit trail. The
collision *cause* (old per-process sequence ids) is fixed, but clock skew, a PID wrap, or a future
writer can still produce a duplicate id, and the drop remains invisible.
**Fix:** After `INSERT OR IGNORE`, if `cur.rowcount == 0`, `SELECT payload FROM factory_events WHERE
id = ?`; if the stored payload differs from the incoming one, write a stderr line and append an
`infrastructure.event_id_collision` event (with both payloads) to a fallback channel so the
collision is itself logged.

### C3. Review gate fails open — ungated commits on dispatch failure / timeout / malformed reply
**File:** `scripts/phoenix-todo-keeper.mjs:735-747,793-828,752-788`
**gap_type:** missing_failure_event / silent_drop
**Evidence:** Three paths all bypass the reviewer and land a commit:
(a) `dispatchReviewer().catch()` (735) emits one `behavior.failed` then immediately calls
`commitAndPushFromWorktree` (746); (b) `scanStuckReviews` (793) commits after a 10-min timeout with
`review_verdict='TIMEOUT_FALLBACK'`; (c) `handleReviewMalformed` (752) commits after a protocol
drift with `review_verdict='MALFORMED_FALLBACK'`. The commit message records "(not gated)" but the
code still pushes unreviewed code with no operator approval and no distinct, queryable event class.
**Fix:** Decide and encode the policy explicitly. Recommended: on all three paths, do **not**
auto-commit. Emit a dedicated `flywheel.review.bypassed` event (with sub-reason
`dispatch_failed` / `timeout` / `malformed`), set the todo to an operator-visible `needs_review`
terminal state, and require an operator approval event before commit. If degraded auto-commit must
stay, gate it behind an explicit `--allow-ungated-fallback` flag so the default is fail-closed.

### C4. Stuck `awaiting_review`: no terminal event, per-todo lock held until TTL
**File:** `scripts/phoenix-todo-keeper.mjs:701-750,558-586`
**gap_type:** missing_failure_event / state_unsafe
**Evidence:** `handleDiffProposed` sets `action_phase='awaiting_review'` (701) and fire-and-forgets
`dispatchReviewer` (713). The per-todo lock acquired at 558 is stored in `actionLocks` (585) and
released only by `rejectAttempt` or `commitAndPushFromWorktree`. If the reviewer never replies and
the promise never settles, the row sits in `awaiting_review` with no terminal event until
`scanStuckReviews` fires — but until the 30-min lock TTL expires, any reload or re-dispatch of the
same todo hard-fails at the lock (`acquireLock` returns null → silent skip at 561). The
early-return paths (570/575/580) *do* release the lock; this hang path does not.
**Fix:** Release the todo lock once phase 1 succeeds (phase 2 only needs the branch lock), in both
the `.then()` and `.catch()` of `dispatchReviewer`. Ensure `scanStuckReviews` emits a terminal
event (`flywheel.review.bypassed timeout` per C3) so replay sees an outcome for every
`flywheel.diff.proposed`.

### C5. Judge verdicts not model-pinned → replay non-deterministic
**File:** `scripts/phoenix-todo-keeper.mjs:833-877` (verdict emitted by bridge); rubrics at `agent-os/rubrics/*.yaml`
**gap_type:** nondeterminism
**Evidence:** `flywheel.review.completed` (and the `judge.error` events at 766-779 / 807-820) carry
no `judge_model` / `judge_model_pinned_at`, although the rubric files pin them (e.g.
`rowan-code-review.yaml` → `claude-opus-4-7 @ 2026-05-28`). `factory-replay.mjs:268-271` reads
`ev.payload.judge_model` / `judge_model_pinned_at`, which are never set. Promoting a judge model
silently re-interprets every historical verdict.
**Fix:** At verdict-emission time (in the bridge) read the judge's rubric and attach
`judge_model` + `judge_model_pinned_at` to the event extras. Pass the same fields through
`emitJudgeError({judge, judge_model, judge_model_pinned_at, original_verdict_event_id})`. Phoenix
should refuse to act on a verdict event missing these fields.

### C6. Legacy `flywheel.commit.landed/local_only` events ship without state hashes
**File:** `scripts/phoenix-todo-keeper.mjs:1003-1044`
**gap_type:** missing_failure_event
**Evidence:** `commitAndPushFromWorktreeImpl` correctly emits `state.git_commit` via
`emitStateMutation` with `state_before_hash`/`state_after_hash` (1003-1017), then emits a **second**
event `flywheel.commit.landed`/`local_only` (1031-1044) carrying the same info but **without** the
hashes. `crud-replay-verifier.mjs` lists these legacy types as mutation-shadow types and only warns,
so replay can be fooled into trusting the hashless event as the mutation record.
**Fix:** Make `state.git_commit` the single source of truth. Either drop the legacy emission
(1031-1044) and update downstream readers (`factory-replay`, `crud-replay-verifier`) to read
`state.git_commit`, or carry `state_before_hash`/`state_after_hash`/`mutation_kind`/`crud_replay_safe`
on the legacy event too. The dual emission is redundant and corruption-prone.

---

## High

### H1. SKIP routing decisions emit no event
**File:** `scripts/sasha-skeptic.mjs:136-157`
**gap_type:** missing_failure_event
**Evidence:** When `routeFailureToAgent` returns `null` (rate-limited, synthetic-not-canary,
transient-network), `maybeCreateTodo` returns null and **nothing is emitted**. You cannot count
skipped-vs-routed, replay can't verify skip correctness, and `factory-learn` has no skip data.
**Fix:** Emit a `routing.decision_skipped` event with `{failure_event_id, reason, behavior,
matched_rule, skip_reason_code, config_version, config_hash}` so every routing decision is auditable.

### H2. `todo.created` omits `matched_rule` + `config_version`/`config_hash`
**File:** `scripts/sasha-skeptic.mjs:94-99,102-116,141-152`; `agent-os/factory-routing-config.json:1-4`
**gap_type:** nondeterminism / missing_failure_event
**Evidence:** `routeFailureToAgent` returns `matched_rule` (98) but `maybeCreateTodo` discards it,
and the hardcoded fallback ladder (102-116) returns no rule name at all. The config file has a
static `version=1` and a human-readable `last_updated`, but no hash. Result: when
`factory-replay.mjs:100-177` re-routes with the current config and diverges, it cannot tell a real
bug from an expected config evolution.
**Fix:** Compute `config_sha256` at config load; bump `version` to semver and increment on each
learned rule; add `matched_rule` to every fallback-ladder return (named, e.g.
`fallback_agent_prefix`); pass `matched_rule` + `config_version` + `config_sha256` into
`emitTodoCreated` extras (and the `routing.decision_skipped` event from H1). Then
`routingDeterminismReplay` can split divergences into `same_config` (bug) vs `config_evolved`
(expected).

### H3. `judge.error` / verdict events lack model pinning for accuracy tracking
**File:** `scripts/factory-events.mjs:285-311` (`emitJudgeError`); `scripts/phoenix-todo-keeper.mjs:766-779,807-820`
**gap_type:** nondeterminism / idempotency
**Evidence:** `emitJudgeError` takes a judge name but has no mechanism to record the model version,
so "rowan@opus-4-7 was wrong" cannot be distinguished from "rowan@opus-4-8 was wrong." This breaks
model-version-specific accuracy and the judge-promotion gate's premise.
**Fix:** Extend `emitJudgeError` to accept `judge_model` + `judge_model_pinned_at` (or read the
rubric); every caller supplies the current pinned model. (Pairs with C5.)

### H4. `factory.config.applied` (routing-config write) emits no state-mutation event
**File:** `scripts/phoenix-todo-keeper.mjs:495-509`
**gap_type:** missing_failure_event
**Evidence:** `handleConfigApproved` atomically rewrites the routing config (497-499) and emits
`factory.config.applied` (500) with **no** `state_before_hash`/`state_after_hash`. The routing
config governs all dispatch routing; replay can't reconstruct it from the log.
**Fix:** Hash before/after with `hashFileState(ROUTING_CONFIG_PATH)` and emit via `emitStateMutation`
(`type:'state.config_apply', mutation_kind:'file_write', target:ROUTING_CONFIG_PATH`).

### H5. JSONL concurrent-writer race: append-during-tail / rotate-during-tail drops events
**File:** `scripts/phoenix-todo-keeper.mjs:141`; `scripts/honker_relay.py:152-167`; `scripts/factory-rotate-logs.mjs:64-69`
**gap_type:** silent_drop
**Evidence:** `persistRow`/event appends use `appendFileSync` with no lock while `honker_relay`
tails via `seek`+`read`. A partial line mid-read is dropped by the relay's `except
json.JSONDecodeError: continue` (78-79), so a successfully-emitted event never reaches SQLite. The
rotation daemon renames the file out from under a mid-read relay (64), and lines emitted between the
relay's last insert and the rename are lost (the relay resumes tailing the new empty file).
**Fix:** (a) Guard event/todo appends with `acquireLock('factory-jsonl-append', {ttlMs:5000})`.
(b) Have rotation emit a `log.rotated` checkpoint with the final byte offset and wait for the relay
to confirm it has inserted up to that offset before gzip+delete. Append-only files only ever grow
within a generation, so a length-based "everything before offset is complete" invariant holds.

### H6. Todo dedup/rewrite + scanStuckReviews race without serialization
**File:** `scripts/phoenix-todo-keeper.mjs:144-151,180,375,499,794-831`
**gap_type:** state_unsafe
**Evidence:** Multiple handlers (`handleTodoCreated`, `handleTodoCompletion`, `handleConfigApproved`)
and the 60s `scanStuckReviews` sweep all do read-modify-write on the in-memory index then
`rewriteAllTodos()` (atomic file write at 151). Two concurrent operations on the same row — e.g. an
incoming `handleReviewCompleted` and a `scanStuckReviews` timeout on the same todo — race: one's
mutation overwrites the other's. A crash between an in-memory increment (164) and the flush loses
the increment.
**Fix:** Wrap each handler's mutation+flush, and the `scanStuckReviews` body, in
`acquireLock('phoenix-todo-mutations', {ttlMs:10000})` so all index mutations serialize.

### H7. Reviewer-dispatch metadata persisted only after the promise settles (crash-loses-dispatch)
**File:** `scripts/phoenix-todo-keeper.mjs:721-734`
**gap_type:** nondeterminism / state_unsafe
**Evidence:** `review_dispatched_at` / `review_conversation_id` are set inside the `.then()` (721)
and flushed at 727 — *after* the main function returns. A crash between the first flush (707, with
`action_phase` set) and 727 leaves the row unable to distinguish "never dispatched" from "dispatched
but metadata lost." Also `.catch()` (735) calls `commitAndPushFromWorktree` while `action_phase` is
still `awaiting_review`, so a racing reload could double-process the row.
**Fix:** Set a `review_dispatch_pending` flag *before* the call and flush it synchronously; clear it
on settlement. In the `.catch()`, set `action_phase` to a distinct `commit_fallback` state before
committing so other instances don't treat it as awaiting review.

### H8. Stale-lock reclamation misses a hung-but-alive holder
**File:** `scripts/_lockfile.mjs:61-78`
**gap_type:** production_risk
**Evidence:** A lock is reclaimed only if the holder PID is dead **or** age > ttlMs. A process that
is *alive but hung* mid-operation keeps the lock until the full TTL elapses (30 min for the per-todo
lock), blocking every retry for that todo with a silent skip.
**Fix:** Add a heartbeat: the holder rewrites `acquired_at_ms`/a `heartbeat_ms` field every ~10s;
treat the lock as stale if the holder is alive but the heartbeat is older than (e.g.) 3× the
heartbeat interval, independent of the long TTL.

### H9. Unhandled-rejection `main().catch` in daemons logs to console but emits no event
**File:** `scripts/factory-alert.mjs:217`; `scripts/factory-rotate-logs.mjs:139`
**gap_type:** missing_failure_event
**Evidence:** Both daemons do `main().catch(err => { console.error(err); process.exit(1); })`. A
fatal error in the alert or rotation loop exits without a `script.crash`/`behavior.failed` event —
the very failure-logging guarantee these daemons exist to uphold is itself unlogged. (Ironically the
alerting daemon dying is exactly the case operators most need surfaced.)
**Fix:** Before `process.exit(1)`, emit `emitFactoryEvent({type:'script.crash', behavior, reason})`
inside its own try/catch (so a broken emitter can't re-throw).

### H10. Bridge subprocess timeout (SIGTERM) is not a distinct, signal-specific event
**File:** `scripts/pentagon-trigger-bridge.mjs:277,337,385,821,1007-1009`
**gap_type:** missing_failure_event
**Evidence:** `spawnSync` calls set a timeout but the success check at 821 (`run.status===0 &&
!claudeError`) doesn't inspect `run.signal`. On a timeout kill, status is null, signal is `SIGTERM`,
and the reason at 1007-1009 defaults to the generic `llm.network_error` — timeouts and real network
errors are conflated in the audit trail.
**Fix:** After 821, if `run.signal === 'SIGTERM'` emit a distinct `llm.timeout` reason before the
generic fallback.

### H11. Python-dispatcher / `finalClaudeMessage` parse failure taken as success (silent drop)
**File:** `scripts/pentagon-trigger-bridge.mjs:401-432,812,385-394`
**gap_type:** silent_drop
**Evidence:** `JSON.parse` of the dispatcher stdout is wrapped in `try {} catch {}` (401) that
returns null on truncation; `finalClaudeMessage` returns `{text:null,isError:false}` on malformed
stdout. With `claudeError` null and `run.status===0`, the success path (821) is taken,
`persistAgentMessage(null)` no-ops (221), and the run is recorded as completed with no message and
no error.
**Fix:** When status is 0 but parsed text is null, treat as `llm.stream_parse_error` and emit
`emitBehaviorFailed`. In `translateDispatcherResult`, return an error row instead of null on
unparseable stdout.

### H12. Runner doesn't emit an infra event for `agent_trigger` + `OUTCOME_INCOMPLETE`
**File:** `scripts/run-native-pentagon-task.mjs:414-460`; `scripts/t7-repetition-classifier.mjs:183,211-215`
**gap_type:** missing_failure_event
**Evidence:** The runner emits infra events for `activation_path='incomplete'` and
`message_poller_no_trigger_row`, but not for `activation_path='agent_trigger'` with
`outcome_class='incomplete'` (trigger claimed, no agent response or missing proof). It also only
emits a verifier rejection when `outcome_class==='fail_verifier'` AND `agent_failure_root_cause` is
set, but `classifyT7LedgerRow` can produce `FAIL_VERIFIER` with no root cause.
**Fix:** Add an `else if (activation_path==='agent_trigger' && outcome_class===OUTCOME_INCOMPLETE)`
emit (`subtype:'trigger_incomplete'`). Make `inferAgentFailureRootCause` always return a non-null
reason and emit on every `fail_verifier` regardless of root cause presence.

### H13. Bare `except/catch` swallows event-emission failures with no stderr
**File:** `scripts/bridge_dispatch.py:133-134`; `activegraph/activegraph/llm/claude_code_cli.py:59-80`; `scripts/honker_listen.py:118-119`
**gap_type:** silent_drop
**Evidence:** `_emit` (`except Exception: pass`), `_try_emit_factory_event` (`except Exception: pass`),
and the migration loop all swallow emission/parse failures silently. The "swallow, don't break
dispatch" design is correct, but swallowing *without logging* makes a broken event pipeline
invisible — the exact thing the event log exists to catch.
**Fix:** Before `pass`, write a stderr line (`[component] event emission failed: {type}: {e}`) and,
where feasible, maintain a `skipped_count`. Operators/bridge can then tail stderr for these.

### H14. PR / push failure does not block todo completion (orphaned local commit)
**File:** `scripts/phoenix-todo-keeper.mjs:948-1028,956-998`
**gap_type:** idempotency / silent_drop
**Evidence:** On push failure, `completion_evidence` is annotated "(push failed)" but the todo is
still marked `completed_at` (1019), so it is never retried and the commit is orphaned locally.
`gh pr create` failure is logged (995) but emits no event; an operator sees a "complete" todo with
no PR.
**Fix:** On push failure, do **not** complete the todo — emit `state.git_commit push_status='failed'`
and either reject for manual push or queue a backoff retry. On `gh pr create` failure emit
`flywheel.pr.create_failed` with stderr.

### H15. Core deterministic functions have no unit tests
**File:** `scripts/factory-replay.mjs:60-65,86-98,100` (`parseSince`, `matchPredicate`, `routeReplay`); `scripts/factory-events.mjs:38-43,182` (`nextId`, dedup_key contract); `scripts/phoenix-todo-keeper.mjs:168-179` (priority aging); `scripts/_lockfile.mjs:31-78` (staleness)
**gap_type:** nondeterminism / missing_failure_event
**Evidence:** The functions that *define* determinism — predicate matching, replay routing, the
collision-resistant id generator, the dedup-key contract, priority aging at the 24h boundary, and
lock staleness/PID-liveness — are exercised only indirectly. A regression in any silently changes
routing or replay semantics.
**Fix:** Add a focused test suite: `nextId` monotonic+collision-free across concurrent procs and at
the 9999 seq boundary; `matchPredicate` for `always`/`reason_equals`/`reason_prefix`/`synthetic`/null;
`routeReplay` matching+fallthrough+empty-config; `dedup_key` determinism + collision matrix +
`::`-in-message escaping; priority aging at 23h59m vs 24h00m + once-only; lock reclaim on dead PID,
on TTL expiry, and refusal while alive+fresh.

---

## Medium

### M1. `loadRoutingConfig` caches by file byte-length, not content hash
**File:** `scripts/sasha-skeptic.mjs:56-67`
**gap_type:** nondeterminism
**Evidence:** Freshness is checked via `readFileSync(...).length`. Two same-length edits (add a rule,
drop a comment) won't trigger a reload, so Sasha can keep routing on a stale config.
**Fix:** Cache on SHA-256 of the file content instead of byte length.

### M2. Routing-config read can see a torn write
**File:** `scripts/sasha-skeptic.mjs:56-66`; `scripts/phoenix-todo-keeper.mjs:497-499`
**gap_type:** nondeterminism
**Evidence:** Phoenix writes the config via tmpfile+rename (atomic), but Sasha's read has no retry on
`JSON.parse` failure — it silently falls back to the cached config (caught at 61), which is
nondeterministic if a parse coincides with a rename.
**Fix:** On parse failure, retry the read 2-3× with short backoff before falling back; emit an event
if it keeps failing.

### M3. `factory-replay` action-determinism trusts log order and the last outcome
**File:** `scripts/factory-replay.mjs:207-221`
**gap_type:** nondeterminism
**Evidence:** `actionDeterminismReplay` takes the *last* outcome per todo without checking for
contradictory terminal states (e.g. `flywheel.commit.landed` then `flywheel.attempt.rejected`), and
doesn't verify each `flywheel.diff.proposed` is followed by its `flywheel.review.completed` *before*
the outcome (out-of-order events from bridge delay produce non-deterministic logs).
**Fix:** Flag `conflicting_outcomes` when first and last outcome types differ; flag
`sequence_violation` when a review.completed timestamp precedes its diff.proposed.

### M4. No intermediate `action_phase` states (`tests_running`, `commit_in_flight`)
**File:** `scripts/phoenix-todo-keeper.mjs:584,701,879-899`
**gap_type:** state_unsafe
**Evidence:** Only `diff_attempted_at` and `action_phase='awaiting_review'` exist. A crash during the
~5-min pytest run leaves the row with `diff_attempted_at` set but no `action_phase`, so
`scanStuckReviews` (which requires `awaiting_review`) never reclaims it — a permanent zombie.
**Fix:** Set `action_phase='tests_running'` before pytest and `'commit_in_flight'` in the commit
path; have `scanStuckReviews` reclaim any `action_phase` older than its timeout.

### M5. `handleReviewCompleted` leaves the row stuck on an unknown verdict
**File:** `scripts/phoenix-todo-keeper.mjs:852-877`
**gap_type:** production_risk
**Evidence:** Only `PASS`/`FAIL` are handled; any other string (typo, `PASS_WITH_RESERVATIONS`)
falls through to a log line at 873 and the row stays `awaiting_review` with no `judge.error`.
**Fix:** Whitelist `['PASS','FAIL']`; on anything else emit a `judge.error` (with model pinning per
C5/H3) and route to the bypass/operator path rather than hanging.

### M6. Diff integrity not verified against the proposed event
**File:** `scripts/phoenix-todo-keeper.mjs:588-642`
**gap_type:** state_unsafe
**Evidence:** The diff is decoded from `payload.diff_b64` with no hash check. A corrupted/replayed
diff applies and tests against a possibly-different tree without detection.
**Fix:** Hash `diff_b64` at proposal time (bridge), store it in extras, recompute on apply, and emit
`state.integrity_check_failed` + reject on mismatch.

### M7. Test run can fall back to system Python with ambiguous environment
**File:** `scripts/phoenix-todo-keeper.mjs:646-684`
**gap_type:** nondeterminism
**Evidence:** Fallback chain `.venv` → `uv run` → `/opt/homebrew/bin/python3`; the `.venv` symlink
errors are swallowed (658). Tests can pass against the wrong interpreter, so a green run isn't
reproducible.
**Fix:** After running, assert the interpreter/venv/pytest version from stdout matches the intended
environment; reject the attempt if ambiguous.

### M8. Bridge `completeTrigger` return value not validated (silent completion failure)
**File:** `scripts/pentagon-trigger-bridge.mjs:211-217,824,975,1047`
**gap_type:** state_unsafe
**Evidence:** `completeTrigger` returns `rows?.[0]`; if the RPC runs but the returned row has
`completed_at=null`, downstream code treats the trigger as completed.
**Fix:** Assert `completed?.completed_at !== null`; emit `trigger_completion_silent_fail` otherwise.

### M9. Dispatch rate-limiter + circuit-breaker state is in-memory only
**File:** `scripts/phoenix-todo-keeper.mjs:91-93`
**gap_type:** idempotency
**Evidence:** `dispatchTimestamps` and `dispatchCircuitOpenUntil` reset on crash/restart, so a restart
during an open circuit immediately resumes dispatching and the rate window resets (burst).
**Fix:** Persist to a sidecar JSON, reload on startup, and reset only if older than the cooldown.

### M10. Crash mid-dispatch leaves todo partially-updated, no rollback
**File:** `scripts/phoenix-todo-keeper.mjs:263-328`
**gap_type:** missing_failure_event
**Evidence:** `dispatched_at` is set (267) around the remote `dispatchTodo` call (264). A crash after
the remote dispatch succeeds but before persistence (or vice versa) leaves the row in an ambiguous
state with no record of the failure.
**Fix:** Use an `awaiting_dispatch` phase persisted before the call; only set `dispatched_at` on
confirmed response; reconcile `awaiting_dispatch` rows on startup.

### M11. Fix-branch update-ref + push are non-atomic, no conflict recovery
**File:** `scripts/phoenix-todo-keeper.mjs:943-949`
**gap_type:** other
**Evidence:** A crash between `update-ref` (943) and `push` (949) advances the local ref without
pushing; the next retry hits a non-fast-forward and fails with no handling.
**Fix:** On non-fast-forward, fetch the branch, compare remote SHA; if remote already contains our
work mark complete, else revert the local ref and retry.

### M12. `classifyT7LedgerRow` catch-all silently downgrades unmatched rows to INCOMPLETE
**File:** `scripts/t7-repetition-classifier.mjs:289`
**gap_type:** silent_drop
**Evidence:** Rows matching none of the explicit patterns return `outcome_class:INCOMPLETE` with no
diagnostic, so genuinely-novel failure shapes are quietly bucketed.
**Fix:** Log/emit a diagnostic for unclassified rows before defaulting, with a reason field for
auditability.

### M13. `decideRetryAction` collapses PASS/FAIL_VERIFIER/INCOMPLETE into one action
**File:** `scripts/t7-repetition-classifier.mjs:428-430`
**gap_type:** nondeterminism
**Evidence:** Any non-`INFRASTRUCTURE_RETRY` outcome maps to `action:'incomplete'`, so an agent
failure that should halt retries is indistinguishable from a debuggable incomplete state.
**Fix:** Branch explicitly: `FAIL_VERIFIER` → `final_agent_failure`, `INCOMPLETE` → `incomplete`.

### M14. Pentagon auth helpers throw without an event boundary
**File:** `scripts/pentagon-auth.mjs:35-42,50-64,70-78`; `scripts/pentagon-rest.mjs:34-61,211,293`
**gap_type:** missing_failure_event
**Evidence:** `decodeJwtPayload`, `readSession`, `readAnonKey`, and `request()` throw on
malformed JWT / missing plist key / missing anon key / HTTP error, but the callers
(`findOrCreateConversation`, `insertMessage`, `dispatchTodo`) don't wrap them, so REST/auth failures
propagate with no factory event.
**Fix:** Wrap the auth + REST calls in `pentagon-rest.mjs::ensureState`/`dispatchTodo` with
try/catch that emits `behavior.failed` (`auth.*` / `rest_request_failed`) before re-throwing.

### M15. MCP config `JSON.stringify` can throw before spawn, orphaning the trigger
**File:** `scripts/pentagon-trigger-bridge.mjs:314-321`
**gap_type:** missing_failure_event
**Evidence:** Serializing the inline MCP config has no try/catch; a throw crashes before
`spawnSync`, leaving the claimed trigger uncompleted.
**Fix:** Wrap in try/catch → emit `mcp_config_serialization_failed` + `completeTrigger`. (Subsumed by
the C1 per-candidate guard if that wraps the whole body.)

### M16. Worktree cleanup failure leaks `/tmp`, no event
**File:** `scripts/phoenix-todo-keeper.mjs:1054-1063`
**gap_type:** production_risk
**Evidence:** A failed `rmSync` of the worktree is caught and logged but emits no event; over time
`/tmp/flywheel-*` accumulates.
**Fix:** Emit `infrastructure.worktree_cleanup_failed` on failure; add a periodic sweep of
`/tmp/flywheel-*` older than 24h.

### M17. Idempotency hole: crash between `diff_attempted_at` and `actionLocks.set` orphans worktree
**File:** `scripts/phoenix-todo-keeper.mjs:579-599`
**gap_type:** idempotency
**Evidence:** `diff_attempted_at` is set + flushed (584/586) before `actionLocks.set` (585) and
before worktree creation. A crash in the 594-623 window leaves the worktree on disk but a replay
skips at 581 ("already had a diff attempt") and never cleans it.
**Fix:** Run the worktree cleanup (596) on the skip path too, or make cleanup idempotent by
detecting+removing any existing worktree before bailing.

### M18. `verify-pentagon-autonomy-from-logs.mjs` `must()` failures untracked if emitter import fails
**File:** `scripts/verify-pentagon-autonomy-from-logs.mjs:189-210`
**gap_type:** production_risk
**Evidence:** `_loadEmitter()` returns a sentinel `false` if `factory-events.mjs` fails to import;
all 124 `must()` calls then skip emission silently, so verifier failures never reach the log.
**Fix:** On module-load failure, write a synthetic fallback event (or a stderr marker) and fail fast
at load rather than per-call.

### M19. PANIC kill switch polled every 5s (worst-case 5s of continued work)
**File:** `scripts/phoenix-todo-keeper.mjs:1153-1158`
**gap_type:** production_risk
**Evidence:** During the up-to-5s window after the operator touches `PANIC`, daemons can still
dispatch/emit, risking inconsistent state mid-shutdown.
**Fix:** `fs.watch(PANIC_PATH)` for an immediate callback; keep 1s polling as a fallback.

---

## Low

### L1. `factory.config.proposed` (factory-learn) omits a baseline state hash
**File:** `scripts/factory-learn.mjs:~220`
**gap_type:** missing_failure_event
**Evidence:** Proposals don't reference the config state they were computed from. Not a mutation, so
informational, but it weakens the audit chain from proposal → approval → apply.
**Fix:** Add `state_before_hash = hashFileState(ROUTING_CONFIG_PATH)` to the proposed event extras.

### L2. `dedupKeyFor` uses unescaped `::` delimiter
**File:** `scripts/sasha-skeptic.mjs:127-134`
**gap_type:** other
**Evidence:** A message containing `::` makes `reason::behavior::msgPrefix` ambiguous (collisions
across distinct failures).
**Fix:** Use a structured key (`JSON.stringify({reason, behavior, msg_prefix})`) or escape components.

### L3. Test-failure rejection truncates output to 500 chars, full log discarded
**File:** `scripts/phoenix-todo-keeper.mjs:685-690`
**gap_type:** missing_failure_event
**Evidence:** Only `(stdout+stderr).slice(0,500)` is kept; on multi-test failure the actual failing
test/assertion is often cut off, hampering diagnosis.
**Fix:** Persist full output to `frames/flywheel-test-failures/<todo_id>.log` and reference the path
in the rejection event; parse a `failed_test_name` where possible.

### L4. Branch-lock-failure reason not recorded before reject
**File:** `scripts/phoenix-todo-keeper.mjs:886-891`
**gap_type:** production_risk
**Evidence:** When the branch lock can't be acquired (another commit in flight), `rejectAttempt`
runs but the "in-flight race" reason isn't captured in `completion_evidence`, so operators can't
distinguish it from a push failure.
**Fix:** Record the branch-lock-failure reason in `completion_evidence` before rejecting.

### L5. `dispatchReviewer` has no retry/backoff before falling back
**File:** `scripts/phoenix-todo-keeper.mjs:713-747`
**gap_type:** other
**Evidence:** A transiently-slow reviewer API triggers an immediate fallback to direct commit (per
C3) with no retry, conflating transient slowness with hard failure.
**Fix:** Retry the reviewer dispatch up to 3× with exponential backoff (separate circuit from the
dispatch-todo circuit) before invoking the bypass path.

### L6. SQLite write serialization unprotected against future maintenance ops
**File:** `scripts/honker_relay.py:81-96`; `scripts/factory-rotate-logs.mjs`
**gap_type:** other
**Evidence:** `honker_relay` inserts with no exclusive lock; a future vacuum/truncate task would
race. WAL mode mitigates row writes but not schema/maintenance ops.
**Fix:** Add a `frames/.sqlite.lock` mutex any SQLite-mutating process must hold for
schema/maintenance operations.

---

## Recommended fix order (top 10 highest-leverage)

1. **C1 — Wrap the `processCandidates` per-candidate body in try/catch that emits + completes the
   trigger.** Closes the single biggest "failure with no event + orphaned trigger" cluster
   (5 call sites) with one block. (Subsumes M15.)
2. **C3 + C4 — Make the review gate fail-closed.** Emit `flywheel.review.bypassed` on
   dispatch-failure/timeout/malformed, stop auto-landing ungated commits by default, and release the
   per-todo lock + emit a terminal event in the awaiting-review hang path.
3. **H2 — Record `matched_rule` + `config_sha256` + `config_version` on `todo.created`.** Without
   this, routing replay cannot classify any divergence; it's the keystone of routing determinism.
4. **H1 — Emit `routing.decision_skipped`.** Completes the routing audit so replay can verify skip
   decisions and `factory-learn` sees the full decision space.
5. **C5 + H3 — Pin `judge_model` + `judge_model_pinned_at` on verdict and `judge.error` events.**
   Restores judge-replay determinism and makes the promotion gate meaningful.
6. **C2 + H13 — Make silent drops loud.** Detect+log Honker id collisions and add stderr lines to the
   bare `except/catch` emission paths so a broken pipeline is observable.
7. **H5 + H6 — Serialize JSONL appends and todo-index mutations with the existing lockfile, and
   coordinate rotation with the relay via a checkpoint.** Stops the under-load event/update loss.
8. **C6 + H4 — Unify state-mutation events.** Make `state.git_commit` the single commit record (drop
   or backfill the hashless legacy event) and emit a state-mutation event for routing-config writes.
9. **H14 + M11 — Don't complete a todo on push/PR failure; add non-fast-forward recovery.** Prevents
   orphaned local commits that are silently marked done.
10. **H15 — Add the unit-test suite for `nextId`, `matchPredicate`, `routeReplay`, the dedup-key
    contract, priority aging, and lock staleness.** Locks in the determinism guarantees the above
    fixes establish so they can't silently regress.
