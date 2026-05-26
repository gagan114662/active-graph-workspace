# Dirty T7 Adaptations Audit 2026-05-26

Scope: uncommitted production-script edits present after `83f9344` and before T7 resumes.

Baseline commit: `83f9344 T7 runner: classify message_poller_no_trigger_row as infrastructure_retry, separate from agent variance`

Audited files:

- `scripts/pentagon-trigger-bridge.mjs`
- `scripts/run-native-pentagon-task.mjs`
- `scripts/verify-pentagon-autonomy-from-logs.mjs`

Classification key:

- (A) T7 adaptation, additive, no loosening of existing T6 rules.
- (B) T7 adaptation, modifies existing logic; safe only if T6 regression tests pass.
- (C) Unrelated drift; revert before commit.
- (D) Loosens an existing T6 check or weakens canonical-trigger / ACK rules; stop.

## Per-Hunk Audit

| # | File / hunk | Class | Justification |
|---:|---|---|---|
| 1 | `scripts/pentagon-trigger-bridge.mjs` lines 9-12: add `RUN_SEED*` to watchdog native content filter | A | T7 instructions prepend `RUN_SEED=<uuid>` before `NATIVE_GAUNTLET`; this makes the existing stuck-trigger watchdog see T7 native triggers without changing T6 matching. |
| 2 | `scripts/pentagon-trigger-bridge.mjs` lines 247-256: let `commandResult` accept spawn options | A | Plumbing-only support for a bounded process timeout; no verifier or trigger-selection semantics change. |
| 3 | `scripts/pentagon-trigger-bridge.mjs` lines 305-310: accept `RUN_SEED` + `NATIVE` in stuck-trigger filter | A | Additive T7 native-trigger recognition matching the T7 spec seed convention; existing `NATIVE` and `PIPELINE_SMOKE_TEST` paths remain accepted. |
| 4 | `scripts/pentagon-trigger-bridge.mjs` line 326: add 3000ms timeout to `osascript quit app "Pentagon"` | A | Bounded watchdog restart behavior used during T7 reliability runs; prevents a hung AppleEvent from stalling recovery and does not affect verifier strictness. |
| 5 | `scripts/run-native-pentagon-task.mjs` lines 9-12: add native-runner watchdog constants | A | Adds T7 harness-side stuck-trigger recovery thresholds; no T6 verifier behavior is changed. |
| 6 | `scripts/run-native-pentagon-task.mjs` lines 21-38: extend command helper and add `commandResult` | A | Plumbing for bounded Pentagon restart evidence in runner logs; no grading or ACK semantics change. |
| 7 | `scripts/run-native-pentagon-task.mjs` lines 129-239: add Pentagon process discovery, trigger age, restart, and cooldown-aware native-runner watchdog helpers | A | Implements watchdog-compatible native harness behavior needed by T7 repetition; it only restarts Pentagon on stale unclaimed triggers and does not synthesize trigger rows or change verifier rules. |
| 8 | `scripts/run-native-pentagon-task.mjs` lines 281-284: add native watchdog state fields to runner result | A | Adds audit metadata fields for watchdog behavior; no pass/fail logic is loosened. |
| 9 | `scripts/run-native-pentagon-task.mjs` line 306: invoke `checkNativePentagonWatchdog` inside the poll loop | A | Allows the runner to recover stuck existing triggers during T7; it does not make missing trigger rows pass after `83f9344` classifier change. |
| 10 | `scripts/verify-pentagon-autonomy-from-logs.mjs` lines 580-583: normalize `__init__.py` module paths in AST symbol resolution | A | Additive support for T7 easy run 004 target `activegraph/packs/__init__.py`; existing T6 target resolution remains intact. |
| 11 | `scripts/verify-pentagon-autonomy-from-logs.mjs` lines 783-813: accept T7 repeat hashes, add baseline/T7 hash helpers, and strip `RUN_SEED` from instruction bodies | A | Extends hash and instruction matching to the T7 spec convention while preserving exact T6 baseline hashes and tier-specific validation. |
| 12 | `scripts/verify-pentagon-autonomy-from-logs.mjs` lines 1045-1055: expose `equivalent_ack_ids` in canonical ACK result details | A | Adds audit detail for duplicate-equivalent ACK handling; no acceptance condition changes by itself. |
| 13 | `scripts/verify-pentagon-autonomy-from-logs.mjs` lines 1111-1137 and 1162-1179: use `nativeInstructionBody` for Maya/Quinn trigger matching and parameterize Quinn hash | A | Additive T7 `RUN_SEED` compatibility and T7 hard hash support; existing T6 content still matches after no-op seed stripping. |
| 14 | `scripts/verify-pentagon-autonomy-from-logs.mjs` lines 1307-1322: allow extra-hard causal-chain parent to reference any equivalent duplicate ACK id | B | Modifies existing extra-hard causal-chain logic, but only within the already strict duplicate-identical ACK equivalence set; must be covered by T6 extra-hard regrade and bad chain fixtures. |
| 15 | `scripts/verify-pentagon-autonomy-from-logs.mjs` lines 1444-1500: easy verifier reads proof hash, accepts T7 repeat easy hashes, and queries DB/runtime rows with that hash | A | Enables T7 easy proof regrading while retaining exact T6 easy baseline acceptance; no ACK/canonical rule is weakened. |
| 16 | `scripts/verify-pentagon-autonomy-from-logs.mjs` lines 1519-1580: medium verifier reads proof hash, accepts T7 repeat medium hashes, and queries DB/runtime rows with that hash | A | Enables T7 medium proof regrading while retaining exact T6 medium baseline acceptance; no ACK/canonical rule is weakened. |
| 17 | `scripts/verify-pentagon-autonomy-from-logs.mjs` lines 1599-1689: hard verifier reads proof hash, accepts T7 repeat hard hashes, uses hash for trigger timestamp, Maya ACK, Quinn ACK, and runtime advisory | A | Enables T7 hard proof regrading while retaining exact T6 hard baseline acceptance and the strict canonical-trigger/ACK checks. |
| 18 | `scripts/verify-pentagon-autonomy-from-logs.mjs` lines 1709-1714: extra-hard verifier accepts T7 repeat extra-hard hashes plus dated T6 extra-hard hashes | A | Enables T7 extra-hard proof regrading while preserving existing dated T6 extra-hard hash acceptance. |

## Classification Counts

- A: 17
- B: 1
- C: 0
- D: 0

No hunks were classified as unrelated drift or verifier-loosening. No hunks were reverted.

## T7 Spec Cross-Reference

The T7 spec requires per-run hashes in the shape `T7_REPEAT_<TIER>_<DATE>_<NNN>` and says every instruction file prepends `RUN_SEED=<uuid4>`. The bridge and verifier changes above are the minimal adaptations needed for those two conventions:

- Watchdog matching must treat `RUN_SEED`-prefixed native instructions as native triggers.
- Verifier hash validation must accept T7 repeat hashes while continuing to accept the original T6 hashes.
- Canonical trigger matching must strip only the seed prefix before checking the existing `NATIVE_GAUNTLET ...` body.

## Existing T6 Rule Cross-Check

The T6 checks are not loosened:

- Existing T6 baseline hashes are still explicitly accepted by `t6BaselineHash`.
- T7 hashes are tier-specific and require a run index.
- `parseMayaAck`, `parseQuinnAck`, canonical trigger eligibility, ACK contradiction handling, and no-canonical-ACK failure semantics are unchanged.
- The only modified existing acceptance path is the extra-hard parent ACK equivalence hunk, which accepts parent references to duplicate-identical ACKs that the existing retry-aware rule already classifies as equivalent. This is class (B) and is gated by T6 extra-hard real regrade plus bad-chain fixtures.

## Regression Gate

Real-DB regrades against the dirty-worktree verifier:

```text
easy exit=0
summary: 10/10 checks passed
verdict: t6_easy_verified

medium exit=0
summary: 12/12 checks passed
verdict: t6_medium_verified

hard exit=0
summary: 16/16 checks passed
verdict: t6_hard_verified

extra-hard exit=0
summary: 15/15 checks passed
verdict: t6_extra_hard_verified
```

Fixture contract suite:

```text
contract_fixture_suite_exit=0
easy good --no-db exit=0 expected=0 summary=10/10 verdict=t6_easy_verified
easy bad --no-db exit=1 expected=1 summary=6/10 verdict=failed
medium good --no-db exit=0 expected=0 summary=12/12 verdict=t6_medium_verified
medium bad --no-db exit=1 expected=1 summary=11/12 verdict=failed
hard good --no-db exit=0 expected=0 summary=16/16 verdict=t6_hard_verified
hard bad --no-db exit=1 expected=1 summary=12/16 verdict=failed
hard bad-global-leak --no-db exit=1 expected=1 summary=14/16 verdict=failed
hard duplicate-identical-acks real-db fixture exit=0 expected=0 summary=16/16 verdict=t6_hard_verified
hard bad-ack-contradiction real-db fixture exit=1 expected=1 summary=15/16 verdict=failed
hard bad-no-canonical-ack real-db fixture exit=1 expected=1 summary=15/16 verdict=failed
extra-hard good --no-db exit=0 expected=0 summary=15/15 verdict=t6_extra_hard_verified
extra-hard bad-broken-audit-chain --no-db exit=1 expected=1 summary=14/15 verdict=failed
extra-hard bad-missing-spec --no-db exit=1 expected=1 summary=14/15 verdict=failed
extra-hard bad-quinn-found-nothing --no-db exit=1 expected=1 summary=14/15 verdict=failed
```

Note: the simple good proof fixtures are proof-shape fixtures, not production DB fixtures, so they are expected to be run with `--no-db`. The ACK-rule fixtures that exercise duplicate/contradictory/no-canonical ACK behavior were run in real-DB fixture mode.

## Final Decision

Regression gate passed. Commit all audited hunks. No new logic beyond the existing dirty worktree was added during this audit.
