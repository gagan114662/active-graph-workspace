# T7 Native Repetition Progress 2026-05-25

Scope: progress toward T7 repetition gauntlet from `frames/t7-t12-scale-reliability-gauntlet-2026-05-23.md`. Full T7 remains 25 fresh native runs per T6 tier, 100 total. This file records the first fourteen fresh native easy samples and the infrastructure findings needed before scaling.

## Current Status

- Full T7 graduation: not complete.
- `gauntlet_runs` Supabase table: missing (`/rest/v1/gauntlet_runs` returned PostgREST `PGRST205`).
- File-backed outcome rows: `frames/t7-native-repetition-progress-20260525.jsonl`.
- Prior reproducibility slice: `frames/t7-t6-regrade-25x-after-duplicate-ack-fix-20260525.md` shows existing T6 proofs regrade 25/25 after the duplicate-ACK equivalent-parent verifier fix.
- Runner-side attribution now separates agent variance from infrastructure retry:
  - `pass_rate = pass_count / (pass_count + agent_failure_count)`.
  - `infrastructure_failure_rate = infra_retry_count / total_run_attempts`.
  - Current reclassified sample after 2026-05-26 classifier-retry validation: pass_count=21, agent_failure_count=1, infra_retry_count=5, total_run_attempts=27.
  - Agent-attributed pass rate: 21/22 = 95.5%.
  - Infrastructure failure rate: 5/27 = 18.5%.
  - 23/25 = 92% original gate status: missed/aborted before the classifier extension. The 017 and 022 retry validation proves the new retry policy can recover both incomplete infrastructure modes in production.
  - Completed-run latency over the ledger: p50 wall-to-completed=183.192s, p95 wall-to-completed=336.601s.
  - Native-runner watchdog restarts recorded in the ledger: 12.

## 2026-05-26 Resume Summary

The resume from audited verifier head `52ba17c` resolved the previous retry-hash blocker and retried run 014.

- `14_retry_1`: pass, 10/10, canonical trigger `ea63af08-11a5-4491-abe5-0b9dca9a589f`.
- `015`: pass, 10/10, fresh target `activegraph.core.ids.IDGen.patch`.
- `016`: infrastructure_retry, known `message_poller_no_trigger_row`; proof and exact ACKs existed, but the original message had no trigger row.
- `16_retry_1`: pass, 10/10, canonical trigger `b8cf2c98-0d94-40be-8551-b9cdc8d104de`.
- `017`: abort-triggering new failure mode. Trigger `3b7deda1-de4f-4d9f-999a-0b08258f1c25` was claimed and completed in about 10.6s, but no hash-bearing Maya response rows and no proof file appeared before the runner deadline. Runner classified `outcome_class=incomplete`.
- `17_retry_1`: pass, 10/10, canonical trigger `336dcdc3-3649-49d8-bbce-813af590e22f`; validates production recovery after `ghost_completion`.
- `018`: pass, 10/10, fresh target `activegraph.core.ids.IDGen.run`.
- `019`: pass, 10/10, fresh target `activegraph.runtime.patterns.Match.get`; runner polling hit a Supabase connect timeout after dispatch, but Pentagon completed the work and independent verifier accepted the canonical ACK.
- `020`: pass, 10/10, fresh target `activegraph.core.patch.Patch.to_dict`.
- `021`: infrastructure_retry, known `message_poller_no_trigger_row`; proof and ACKs existed but original message had no trigger row.
- `21_retry_1`: pass, 10/10, canonical trigger `78e58d8a-7cfb-469d-bb74-ee35e01ef629`; closes run 021's target.
- `022`: incomplete/no-proof/no-ACK. No agent_triggers row, no hash-bearing response rows, and no proof file before runner deadline. At this point the 23-pass gate became mathematically impossible under the current retry policy.
- `22_retry_1`: pass, 10/10, canonical trigger `1bd35511-b238-4e9a-a7b9-c95b912c9cb8`; validates production recovery after `no_trigger_timeout`.

Authoritative metric command after appending 017/022 retry validation: `node scripts/t7-repetition-harness.mjs --ledger frames/t7-native-repetition-progress-20260525.jsonl`; exit 0; pass_count=21, agent_failure_count=1, infra_retry_count=5, total_run_attempts=27, pass_rate_percent=95.5, infrastructure_failure_rate_percent=18.5.

## Fresh Native Easy Results

| run | hash | final verifier | harness | wall to completed | gate |
| ---: | --- | --- | --- | ---: | --- |
| 001 | `T7_REPEAT_EASY_20260525_001` | pass, 10/10 | exit 2, timed out | 1244.306s | fails 10 min wall gate |
| 002 | `T7_REPEAT_EASY_20260525_002` | pass, 10/10 | exit 0, native pass | 336.601s | within 10 min wall gate |
| 003 | `T7_REPEAT_EASY_20260525_003` | pass, 10/10 | exit 0, native pass | 229.984s | within 10 min wall gate |
| 004 | `T7_REPEAT_EASY_20260525_004` | pass, 10/10 | exit 0, native pass | 203.653s | within 10 min wall gate |
| 005 | `T7_REPEAT_EASY_20260525_005` | pass, 10/10 | exit 0, native pass | 326.362s | within 10 min wall gate |
| 006 | `T7_REPEAT_EASY_20260525_006` | pass, 10/10 | exit 0, native pass | 123.396s | within 10 min wall gate |
| 007 | `T7_REPEAT_EASY_20260525_007` | pass, 10/10 | exit 0, native pass | 103.545s | within 10 min wall gate |
| 008 | `T7_REPEAT_EASY_20260525_008` | fail, 9/10 | exit 0, native pass | 158.976s | within 10 min wall gate |
| 009 | `T7_REPEAT_EASY_20260525_009` | pass, 10/10 | exit 0, native pass | 127.808s | within 10 min wall gate |
| 010 | `T7_REPEAT_EASY_20260525_010` | pass, 10/10 | exit 0, native pass | 173.721s | within 10 min wall gate |
| 011 | `T7_REPEAT_EASY_20260525_011` | pass, 10/10 | exit 0, native pass | 183.192s | within 10 min wall gate |
| 012 | `T7_REPEAT_EASY_20260525_012` | pass, 10/10 | exit 0, native pass | 223.621s | within 10 min wall gate |
| 013 | `T7_REPEAT_EASY_20260525_013` | pass, 10/10 | exit 0, native pass | 184.210s | within 10 min wall gate |
| 014 | `T7_REPEAT_EASY_20260525_014` | fail, 9/10 | infrastructure_retry | n/a | missing trigger row; retry same target |
| 014 retry 1 | `T7_REPEAT_EASY_20260525_014_RETRY_1` | pass, 10/10 | exit 0, native pass | 156.422s | within 10 min wall gate |
| 015 | `T7_REPEAT_EASY_20260525_015` | pass, 10/10 | exit 0, native pass | 251.589s | within 10 min wall gate |
| 016 | `T7_REPEAT_EASY_20260525_016` | fail, 9/10 | infrastructure_retry | n/a | missing trigger row; retry same target |
| 016 retry 1 | `T7_REPEAT_EASY_20260525_016_RETRY_1` | pass, 10/10 | exit 0, native pass | 158.422s | within 10 min wall gate |
| 017 | `T7_REPEAT_EASY_20260525_017` | not run; no proof | exit 2, incomplete | 10.615s to trigger completion; 1214.7s harness | abort: trigger completed without proof/ACK |
| 017 retry 1 | `T7_REPEAT_EASY_20260525_017_RETRY_1` | pass, 10/10 | exit 0, native pass | 191.833s | within 10 min wall gate |
| 018 | `T7_REPEAT_EASY_20260525_018` | pass, 10/10 | exit 0, native pass | 223.483s | within 10 min wall gate |
| 019 | `T7_REPEAT_EASY_20260525_019` | pass, 10/10 | exit 1 transport timeout after dispatch; verifier pass | 237.384s | within 10 min wall gate |
| 020 | `T7_REPEAT_EASY_20260525_020` | pass, 10/10 | exit 0, native pass | 174.270s | within 10 min wall gate |
| 021 | `T7_REPEAT_EASY_20260525_021` | fail, 9/10 | infrastructure_retry | n/a | missing trigger row; retry same target |
| 021 retry 1 | `T7_REPEAT_EASY_20260525_021_RETRY_1` | pass, 10/10 | exit 0, native pass | 164.273s | within 10 min wall gate |
| 022 | `T7_REPEAT_EASY_20260525_022` | not run; no proof | exit 2, incomplete | n/a | no trigger/proof/ACK; gate impossible |
| 022 retry 1 | `T7_REPEAT_EASY_20260525_022_RETRY_1` | pass, 10/10 | exit 0, native pass | 118.073s | within 10 min wall gate |

## Run 001

- instruction: `frames/t7-repeat-easy-001-instruction-20260525.txt`
- instruction SHA-256: `69dc574180e13c3076ca7f3b80533d17fff547f21f3bcd9bf5d3679747b51791`
- run log: `frames/t7-repeat-easy-001-run-20260525.log`
- trigger: `900220bf-c8ef-45c9-ab44-c7063f391a76`
- proof: `activegraph/frames/t7-repeat-easy-001-20260525.proof`
- target: `activegraph.core.graph.Graph.store`
- commit: `488401cecbeb117ce6b154c46c8ab6326fd3495f`

Result:

- The original native harness timed out after 913.9s with `native_pass=false`, `claimed_at=null`, no response rows, and no proof.
- After patching the seeded-trigger watchdog classifier and restarting the bridge, watchdog restarted Pentagon at `2026-05-25T16:41:25.899Z`.
- The trigger was claimed at `2026-05-25T16:41:44.039368+00:00` and completed at `2026-05-25T16:46:08.111+00:00`.
- The proof later verified green: `node scripts/verify-pentagon-autonomy-from-logs.mjs --t6 --tier=easy --proof-file activegraph/frames/t7-repeat-easy-001-20260525.proof --since 2026-05-25T16:25:00Z` exited 0 with 10/10.
- It is still a latency failure against the easy 10 minute wall gate.

## Run 002

- instruction: `frames/t7-repeat-easy-002-instruction-20260525.txt`
- instruction SHA-256: `84d5de49758b68efb8563b789ff86aee5126e8a0069da7b906a7f3332974b98a`
- run log: `frames/t7-repeat-easy-002-run-20260525.log`
- trigger: `1a4c70af-3661-4bde-b483-4a9f9265bf99`
- proof: `activegraph/frames/t7-repeat-easy-002-20260525.proof`
- target: `activegraph.runtime.patterns.PatternMatcher.matches`
- commit: `7bb4edcfc4ead5ee2c405414a08b49c438b7be06`

Result:

- The native-runner watchdog fired at trigger age 64s.
- `osascript` quit timed out after AppleEvent timeout `-1712`, then the runner killed survivor pid 5303 and relaunched Pentagon as pid 12764.
- Trigger was claimed at `2026-05-25T16:50:41.377882+00:00` and completed at `2026-05-25T16:52:53.802+00:00`.
- The harness exited 0 with `native_pass=true`.
- The proof verified green: `node scripts/verify-pentagon-autonomy-from-logs.mjs --t6 --tier=easy --proof-file activegraph/frames/t7-repeat-easy-002-20260525.proof --since 2026-05-25T16:40:00Z` exited 0 with 10/10.

## Run 003

- instruction: `frames/t7-repeat-easy-003-instruction-20260525.txt`
- instruction SHA-256: `2f72b537e9893f9dc2207223018c448a5379a5c02fc6a7b04378ea926ade5970`
- run log: `frames/t7-repeat-easy-003-run-20260525.log`
- trigger: `3aa62b2d-544e-42a5-a233-73886f3abec7`
- proof: `activegraph/frames/t7-repeat-easy-003-20260525.proof`
- target: `activegraph.tools.cache.ToolCache.from_events`
- commit: `51caacd60237f9935c53bffbfd767e308b875899`

Result:

- The native-runner watchdog fired at trigger age 63s and relaunched Pentagon in 7.308s.
- Trigger was claimed at `2026-05-25T17:00:09.311153+00:00` and completed at `2026-05-25T17:02:38.456+00:00`.
- The harness exited 0 with `native_pass=true`.
- The proof verified green: `node scripts/verify-pentagon-autonomy-from-logs.mjs --t6 --tier=easy --proof-file activegraph/frames/t7-repeat-easy-003-20260525.proof --since 2026-05-25T16:55:00Z` exited 0 with 10/10.

## Run 004

- instruction: `frames/t7-repeat-easy-004-instruction-20260525.txt`
- instruction SHA-256: `ff423d5ebf6844946ebbbf5a8336e3800803d5b2ed0b6c4874362a4c0497e4a9`
- run log: `frames/t7-repeat-easy-004-run-20260525.log`
- trigger: `f0154e1f-82bf-4a17-ba11-541a39b626a1`
- proof: `activegraph/frames/t7-repeat-easy-004-20260525.proof`
- target: `activegraph.packs.PackPrompt.from_body`
- commit: `7ea36a252b21d5c3b246012fc89d531f92cb734e`

Result:

- The trigger was claimed immediately at `2026-05-25T17:04:44.890357+00:00` and completed at `2026-05-25T17:08:08.381+00:00`.
- The harness exited 0 with `native_pass=true`; no watchdog restart was needed.
- The verifier initially exposed a package `__init__.py` symbol normalization hole, then verified green after mapping `activegraph/packs/__init__.py` to `activegraph.packs`.

## Run 005

- instruction: `frames/t7-repeat-easy-005-instruction-20260525.txt`
- instruction SHA-256: `42ba46d1181118b23b779dfa6b5f8d41987473dad6f7bd346746dc13e09cca56`
- run log: `frames/t7-repeat-easy-005-run-20260525.log`
- trigger: `a14b2a9a-963c-4db8-8a2f-a4f3fd3cb369`
- proof: `activegraph/frames/t7-repeat-easy-005-20260525.proof`
- target: `activegraph.core.event.Event.to_dict`
- commit: `9a065bcb06714053a6d317cf73f1de0cc1b31f0b`

Result:

- The native-runner watchdog fired at trigger age 63s and relaunched Pentagon in 7.335s.
- Trigger was claimed at `2026-05-25T17:12:20.932691+00:00` and completed at `2026-05-25T17:16:26.502+00:00`.
- The harness exited 0 with `native_pass=true`.
- The proof verified green: `node scripts/verify-pentagon-autonomy-from-logs.mjs --t6 --tier=easy --proof-file activegraph/frames/t7-repeat-easy-005-20260525.proof --since 2026-05-25T17:10:00Z` exited 0 with 10/10.
- The verifier observed two identical exact ACKs and kept the latest canonical ACK `5fb40a0c-b8b4-4fb5-a6d6-66c475155ab4`.

## Run 006

- instruction: `frames/t7-repeat-easy-006-instruction-20260525.txt`
- instruction SHA-256: `d11ead6e15e271c02b042b90360b438ff7def4202abeed19343622714222d94a`
- run log: `frames/t7-repeat-easy-006-run-20260525.log`
- trigger: `75df0f2b-5c6c-40b5-b09d-a1e177e9bd00`
- proof: `activegraph/frames/t7-repeat-easy-006-20260525.proof`
- target: `activegraph.behaviors.base.RelationBehavior.run`
- commit: `2049de285e3bf92327b3f8d63b64da12a1418c89`

Result:

- The trigger was claimed immediately at `2026-05-25T17:21:01.747617+00:00` and completed at `2026-05-25T17:23:04.953+00:00`.
- The harness exited 0 with `native_pass=true`; no watchdog restart was needed.
- The proof verified green: `node scripts/verify-pentagon-autonomy-from-logs.mjs --t6 --tier=easy --proof-file activegraph/frames/t7-repeat-easy-006-20260525.proof --since 2026-05-25T17:20:00Z` exited 0 with 10/10.
- The verifier observed one canonical ACK `ceca94a2-5c37-454d-93e6-d660f6b4d69b`.

## Run 007

- instruction: `frames/t7-repeat-easy-007-instruction-20260525.txt`
- instruction SHA-256: `69003fc4fef8899e8a08be896bc4611190c39e84a275acc264c434ba3908c64b`
- run log: `frames/t7-repeat-easy-007-run-20260525.log`
- trigger: `f3115c1b-22c1-4e08-a4fb-c1e855f54d38`
- proof: `activegraph/frames/t7-repeat-easy-007-20260525.proof`
- target: `activegraph.core.clock.Clock.now`
- commit: `f36880a20a41b2b6de0e84a589891ac58066b688`

Result:

- The trigger was claimed immediately at `2026-05-25T17:24:52.758448+00:00` and completed at `2026-05-25T17:26:36.115+00:00`.
- The harness exited 0 with `native_pass=true`; no watchdog restart was needed.
- The proof verified green: `node scripts/verify-pentagon-autonomy-from-logs.mjs --t6 --tier=easy --proof-file activegraph/frames/t7-repeat-easy-007-20260525.proof --since 2026-05-25T17:24:00Z` exited 0 with 10/10.
- The verifier observed one canonical ACK `9d523553-d04f-4cdb-8e46-505dd2173c2e`.

## Run 008

- instruction: `frames/t7-repeat-easy-008-instruction-20260525.txt`
- instruction SHA-256: `d8de1b6eba382e0b98c10e5aa268e662fd2dfb8ef43f5d45200a126c2e839ed0`
- run log: `frames/t7-repeat-easy-008-run-20260525.log`
- trigger: `3a399354-e5b7-4bd2-9d92-490e95f8854b`
- proof: `activegraph/frames/t7-repeat-easy-008-20260525.proof`
- target: `activegraph.core.ids.IDGen.object`
- commit: `d3f17e9aa01e5e0aef0d39491453ee93b5830621`

Result:

- The trigger was claimed immediately at `2026-05-25T17:28:12.607285+00:00` and completed at `2026-05-25T17:30:51.38+00:00`.
- The harness exited 0 with `native_pass=true`; no watchdog restart was needed.
- The proof/code checks all passed, but the independent verifier failed: `node scripts/verify-pentagon-autonomy-from-logs.mjs --t6 --tier=easy --proof-file activegraph/frames/t7-repeat-easy-008-20260525.proof --since 2026-05-25T17:28:00Z` exited 1 with 9/10.
- Failure reason: Maya produced hash-bearing narrative messages whose content included the ACK line, but did not reply with the exact ACK as the whole message. The verifier correctly reported `no Maya ACK in canonical trigger`.

## Run 009

- instruction: `frames/t7-repeat-easy-009-instruction-20260525.txt`
- instruction SHA-256: `e871aea087d394ecb22b38ae16610b2fe5560d32e07125032ea2b848cafbca66`
- run log: `frames/t7-repeat-easy-009-run-20260525.log`
- trigger: `e00e6b73-0c15-430b-b86c-1d406d97c357`
- proof: `activegraph/frames/t7-repeat-easy-009-20260525.proof`
- target: `activegraph.core.ids.IDGen.event`
- commit: `d0f548517fb25c6c98ce71658ac6514b63954598`

Result:

- The trigger was claimed immediately at `2026-05-25T17:32:41.232331+00:00` and completed at `2026-05-25T17:34:48.827+00:00`.
- The harness exited 0 with `native_pass=true`; no watchdog restart was needed.
- The proof verified green: `node scripts/verify-pentagon-autonomy-from-logs.mjs --t6 --tier=easy --proof-file activegraph/frames/t7-repeat-easy-009-20260525.proof --since 2026-05-25T17:32:00Z` exited 0 with 10/10.
- The verifier observed one canonical ACK `fc96a505-949d-42ad-950d-28fc84cbda45`.

## Run 010

- instruction: `frames/t7-repeat-easy-010-instruction-20260525.txt`
- instruction SHA-256: `8c8ce1427c0920bca38ad42a3af799ebd36be882400da7b3136d8405cb13e1c7`
- run log: `frames/t7-repeat-easy-010-run-20260525.log`
- trigger: `11c5645c-1c48-4fcf-a069-c01adec5ac46`
- proof: `activegraph/frames/t7-repeat-easy-010-20260525.proof`
- target: `activegraph.core.clock.FrozenClock.now`
- commit: `4475c7a8ea286f5cc153aa1f45b13557b1d8bf2a`

Result:

- The native-runner watchdog fired at trigger age 64s and relaunched Pentagon in 7.270s.
- Trigger was claimed at `2026-05-25T18:25:04.01379+00:00` and completed at `2026-05-25T18:26:36.547+00:00`.
- The harness exited 0 with `native_pass=true`.
- The proof verified green: `node scripts/verify-pentagon-autonomy-from-logs.mjs --t6 --tier=easy --proof-file activegraph/frames/t7-repeat-easy-010-20260525.proof --since 2026-05-25T18:23:00Z` exited 0 with 10/10.
- The verifier observed one canonical ACK `49839e7f-3000-421d-a47a-3a29e0fa333f`.

## Run 011

- instruction: `frames/t7-repeat-easy-011-instruction-20260525.txt`
- instruction SHA-256: `a2efd47846369de9e4c332d94a49af46ed1426362a820dd8000bd51cb0ec5375`
- run log: `frames/t7-repeat-easy-011-run-20260525.log`
- trigger: `6a2f04b2-3f7a-4c54-8782-e74b9be49a3f`
- proof: `activegraph/frames/t7-repeat-easy-011-20260525.proof`
- target: `activegraph.core.clock.TickingClock.now`
- commit: `4e28f29acb12a2007e1cce2ed250e9a28e2e3c0b`

Result:

- Trigger was claimed immediately at `2026-05-25T18:28:18.764215+00:00` and completed at `2026-05-25T18:31:21.815+00:00`.
- The harness exited 0 with `native_pass=true`.
- The proof verified green: `node scripts/verify-pentagon-autonomy-from-logs.mjs --t6 --tier=easy --proof-file activegraph/frames/t7-repeat-easy-011-20260525.proof --since 2026-05-25T18:28:00Z` exited 0 with 10/10.
- The verifier observed duplicate identical exact ACKs and kept canonical ACK `0d6f7758-26ed-42d5-80e1-fc1a61bcd834`.

## Run 012

- instruction: `frames/t7-repeat-easy-012-instruction-20260525.txt`
- instruction SHA-256: `d2106d082ca5bdba9a883c58da036e5ec07d206edbc9c6fde5eb72e7e135fa34`
- run log: `frames/t7-repeat-easy-012-run-20260525.log`
- trigger: `99b6a56f-aa49-4cde-b3f7-f1c92318c167`
- proof: `activegraph/frames/t7-repeat-easy-012-20260525.proof`
- target: `activegraph.core.ids.IDGen.relation`
- commit: `f55ed8a87bc7d8e1f3e76bb967dd18037a0682fd`

Result:

- The native-runner watchdog fired at trigger age 63s and relaunched Pentagon in 7.253s.
- Trigger was claimed at `2026-05-25T18:34:18.260379+00:00` and completed at `2026-05-25T18:36:41.328+00:00`.
- The harness exited 0 with `native_pass=true`.
- The proof verified green: `node scripts/verify-pentagon-autonomy-from-logs.mjs --t6 --tier=easy --proof-file activegraph/frames/t7-repeat-easy-012-20260525.proof --since 2026-05-25T18:32:00Z` exited 0 with 10/10.
- The verifier observed duplicate identical exact ACKs and kept canonical ACK `f3d64bd8-49e2-436f-b868-fefd2aa719b2`.

## Run 013

- instruction: `frames/t7-repeat-easy-013-instruction-20260525.txt`
- instruction SHA-256: `b1edd3f65b3dfd232714a71ddd4534ca2d21cfc3d9b8f96a428948474f11fee4`
- run log: `frames/t7-repeat-easy-013-run-20260525.log`
- trigger: `2cb871e9-cdd7-44f9-a947-d04670cd8e6b`
- proof: `activegraph/frames/t7-repeat-easy-013-20260525.proof`
- target: `activegraph.core.graph.Object.to_dict`
- commit: `52e01ae901fc248d0b64092808caaa198349aa1f`

Result:

- Trigger was claimed immediately at `2026-05-25T18:38:15.556799+00:00` and completed at `2026-05-25T18:41:19.636+00:00`.
- The harness exited 0 with `native_pass=true`.
- The proof verified green: `node scripts/verify-pentagon-autonomy-from-logs.mjs --t6 --tier=easy --proof-file activegraph/frames/t7-repeat-easy-013-20260525.proof --since 2026-05-25T18:38:00Z` exited 0 with 10/10.
- The verifier observed duplicate identical exact ACKs and kept canonical ACK `1008355a-06e1-444a-8905-9edc56337115`.

## Run 014

- instruction: `frames/t7-repeat-easy-014-instruction-20260525.txt`
- instruction SHA-256: `85c53c97d7d010c32876874ff1e722c048b57f1647dc9623d6d988b9451e85c6`
- run log: `frames/t7-repeat-easy-014-run-20260525.log`
- trigger: none for the original instruction message
- proof: `activegraph/frames/t7-repeat-easy-014-20260525.proof`
- target: `activegraph.core.graph.Relation.to_dict`
- commit: `83eaef0140c3e7fcfee4f654920b0de6309fec34`

Result:

- The harness exited 0 with `native_pass=true`, but only after the full watch window. Its activation path was `message_poller_no_trigger_row`.
- Maya produced exact ACK messages and the proof/code checks passed, but no canonical `agent_triggers` row existed for the original instruction.
- The independent verifier failed: `node scripts/verify-pentagon-autonomy-from-logs.mjs --t6 --tier=easy --proof-file activegraph/frames/t7-repeat-easy-014-20260525.proof --since 2026-05-25T18:42:00Z` exited 1 with 9/10.
- Failure reason: `no Maya ACK in canonical trigger` with `trigger_rows=0`.
- This is a new failure mode beyond narrative-wrapped ACK and watchdog-handled activation hiccups, so the resume goal's abort rule stops the run window here.

## Infrastructure Changes Made During This Slice

1. `scripts/verify-pentagon-autonomy-from-logs.mjs` accepts `T7_REPEAT_<TIER>_<DATE>_<NNN>` hashes for T6-mode verification while preserving existing T6 hashes.
2. The verifier strips an optional `RUN_SEED=...` prefix before canonical trigger matching.
3. The extra-hard verifier treats retry-identical ACK ids as equivalent parents in the causal chain.
4. `scripts/pentagon-trigger-bridge.mjs` classifies seeded native instructions as native watchdog targets.
5. `scripts/run-native-pentagon-task.mjs` now has an in-process native-runner Pentagon watchdog, because the harness intentionally unloads the bridge to force native pickup.
6. The native-runner and bridge watchdogs bound the polite `osascript` quit attempt to 3 seconds before survivor kill/relaunch. Run 003 restarted in 7.308s versus run 002's 128.553s restart.
7. The verifier now normalizes package `__init__.py` symbols, e.g. `activegraph/packs/__init__.py` maps to `activegraph.packs`, not `activegraph.packs.__init__`.

## Findings

1. T7 immediately reproduced the native poller desync: run 001 stayed unclaimed through the full harness window.
2. Watchdog recovery can make an easy sample pass inside the harness window: run 002 passed in 336.601s.
3. `gauntlet_runs` persistence is still absent; current T7 rows are file-backed JSONL only.
4. Easy tier is currently 12/14 verifier-pass eventually, with 12/14 runs completing within the easy 10 minute wall gate.
5. Run 008 is the first T7 easy verifier failure: the engineering work passed, but the auditable ACK contract failed.
6. Run 014 is the second T7 easy verifier failure and the first new failure mode in the resume window: exact ACK/proof existed, but the canonical trigger row for the original instruction was missing.

## Next Required Work

- Add durable `gauntlet_runs` persistence or an accepted file-backed substitute before scaling.
- STOP before run 015 per resume abort rule 3: run 014 introduced a new failure mode beyond narrative-wrapped ACK and watchdog-handled activation hiccups.
- Keep separate metrics for final verifier pass rate and wall-gate pass rate; run 001 proves they can diverge.
