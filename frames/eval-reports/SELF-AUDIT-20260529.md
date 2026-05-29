# Self-audit from the logs — where the system broke, what can be fixed

**Source of truth:** `frames/referee/*.proof.jsonl` (55 ledgers, 67 runs) + `frames/eval-reports/`.
**Tally:** 43 VERIFIED / 24 ERROR verdicts. LLM builder/repair: 39 attempts, 31 VERIFIED, 8 caught, 0 bad ships.

---

## A) Where the BUILDERS broke — 8 (the referee WORKING, caught them all)

| Failure | Gate | Root cause |
|---|---|---|
| comms-builder-2 | `comms_security_acceptance` | `post_tweet` missed `whsec_` → would leak a Stripe secret. Its own self-test passed; the holdout oracle caught it. |
| queue-builder-1 | `queue_drain_invariant` | `AttributeError` (over-engineered stale re-read) → 0 tasks drained. |
| daemon-builder 1-3 + v2 1-3 (6) | `orchestration_invariant` | **API-contract gaps**: v1 read status from the wrong dict level; v2 invented `register_daemon(graph)` + `@graph.behavior`. All inert (0 executions). Fixed in v3 with an explicit API skeleton → 3/3. |

Common thread: **every one passed its own mock/stub self-test.** The independent real-framework oracle is what caught them. That's the system working — but it points at a real fixable gap (see C-3).

---

## B) Where the FACTORY / REFEREE ITSELF broke — the defects that actually matter

These are NOT the system working; these are the referee/tooling being wrong. Each was caught by a human/replay reading the logs, then fixed (append-only).

1. **Cross-process ledger bug → FALSE ERROR** (15:27:46). `grade-live` ran in a separate process and didn't see `bug_is_real` cleared by `prepare-live` → recorded ERROR on a correct build. *Failed safe* (false-negative, never false-positive). **Fixed:** ledger replays history on attach. Replay caught it.
2. **Provenance mislabeling.** Deterministic controls were stamped "blind LLM builder" by `prepare-live` → made an injected overfit look like an LLM cheat (caused real confusion). **Patched** with append-only provenance corrections — but the *root cause* (stamping happens generically, post-hoc) is still there.
3. **Report header lied.** It asserted "every ERROR is a deterministic control" after real LLM bugs existed. **Fixed** (header now distinguishes real bugs from controls).
4. **Report was alphabetical + provenance-blind.** Buried the latest batch and made an injected control read as an LLM cheat → caused repeated stale-read confusion. **Fixed** (chronological + provenance column).
5. **Scoreboard false-victory.** First version counted all 22 upstream merged PRs as "shipped by us." **Fixed** to attribute only our authored PRs → 0.
6. **Safe-write oracle over-strict.** Rejected a jail-safe `..%2f..` literal; the *positive control* (safe ref failed) caught my own bad oracle. **Fixed** (grade on escape, not on must-raise).
7. **Triage plan was wrong.** The documented "behavior subscribes to `behavior.failed`" is impossible (behaviors never fire on lifecycle events — test + source). **Corrected** to external detection.
8. **Easy-tier fix didn't propagate.** The snapshot fix was uncommitted → a fresh HEAD sandbox still failed. **Fixed** (committed + PR).

**The pattern in B:** none of these were caught by an automated gate — they were caught by *me/you reading the logs*. See D.

---

## C) What can still be FIXED (open weaknesses / where it could break next)

1. **Oracles inherit pytest/behavior blind spots.** A bug no test can see, the referee can't catch. Fundamental limit — mitigate with broader oracles, not eliminable.
2. **The "deterministic adversary" is a fixed battery.** It catches known attack shapes (traversal, spoof, secret patterns) but a novel attack outside the battery passes. *Fix:* property-based / fuzz generation, and rotate the battery.
3. **Builders self-test against mocks/stubs — worthless.** Every failure's self-test "passed." *Fix:* ship builders a real-framework test harness (or enforce real-framework self-test). The referee is the backstop today, but builders waste effort on false confidence.
4. **Contract/doc gap is the #1 builder-failure cause** (daemon 0/6 → 3/3 on a skeleton). *Fix:* write the `llms.txt`-style API docs the framework lacks (empirically proven necessary). This is the highest-leverage fix.
5. **Small sample per task.** Most tasks ran 1 defect × 3 builders. Reliability claims need many defects × many runs.
6. **`Policy` primitive is v0/permissive.** Billing/SSRF are enforced in *behavior logic*, not the framework's `Policy` primitive (which doesn't enforce). If `Policy` matures, move enforcement there.
7. **Provenance is stamped post-hoc.** *Fix:* stamp build provenance at creation so no correction is ever needed (prevent B-2).
8. **Self-heal used file-diff, not `compute_diff`.** *Fix:* use the framework's real `compute_diff` for graph-level changes.
9. **Everything is OFFLINE.** No primitive has run against a real API / real money / real comms. Live integration is unproven (operator-gated).

---

## D) The deepest fixable gap: there is no referee FOR the referee

Every defect in section B was caught by a **human reading the logs**, not by an automated gate. The oracles, reports, scoreboard, and provenance are **hand-verified, not gate-verified.** The biggest next-layer fix is a **meta-referee**: automated checks that (a) every oracle has a passing positive control AND a failing no-op control (non-vacuity) before it grades anything, (b) every ledger's replayed verdict matches its recorded verdict (catch cross-process bugs automatically), (c) provenance is present and consistent on every run, (d) reports can't assert claims the ledgers contradict. Until that exists, the referee's own correctness depends on someone reading the trace — which is exactly the manual step the project set out to remove.
