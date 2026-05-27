# T7 Native Repetition Progress Medium 2026-05-26

Scope: T7 medium reliability measurement, 25 sequential native runs using the T6 medium task class.

## Current Status

- Run index reached: 014/025.
- Sequence status: stopped after run 014 on abort condition 3 (new failure mode).
- Authoritative ledger: `frames/t7-native-repetition-progress-medium-20260526.jsonl`.
- Authoritative metric command:
  `node scripts/t7-repetition-harness.mjs --ledger frames/t7-native-repetition-progress-medium-20260526.jsonl`
- Current metrics after run 014:
  - pass_count=12
  - agent_failure_count=1
  - infra_retry_count=4
  - total_run_attempts=17
  - pass_rate_percent=92.3
  - infrastructure_failure_rate_percent=23.5
- 22/25 = 88% gate: aborted before final determination; still mathematically reachable at stop.
- Wall time to completed: median=226.561s, p95=516.212s, max=516.212s.
- Native-runner watchdog restarts: 10 observed in run logs/diagnostic evidence (8 on agent-attributed rows, plus 2 during run 008 exhausted infrastructure attempts). This reaches but does not exceed the abort threshold of 10.
- Infrastructure root-cause distribution: ghost_completion=4.
- New failure modes: `late_ack_after_trigger_completed` on run 014.

## Batch 001-004

| run | hash | target_symbol | verifier | outcome | wall to completed | watchdog |
| ---: | --- | --- | --- | --- | ---: | --- |
| 001 | `T7_REPEAT_MEDIUM_20260526_001` | `activegraph.store.base.replay_into` | 12/12 | pass | 223.879s | restarted Pentagon |
| 002 | `T7_REPEAT_MEDIUM_20260526_002` | `activegraph.core.view.View.objects` | 12/12 | pass | 516.212s | none |
| 003 | `T7_REPEAT_MEDIUM_20260526_003` | `activegraph.runtime.view_builder.build_view` | 12/12 | pass | 340.799s | restarted Pentagon |
| 004 | `T7_REPEAT_MEDIUM_20260526_004` | `activegraph.observability.status.status_to_dict` | 12/12 | pass | 244.995s | none |

## Batch 005-008

| run | hash | target_symbol | verifier | outcome | wall to completed | watchdog |
| ---: | --- | --- | --- | --- | ---: | --- |
| 005 | `T7_REPEAT_MEDIUM_20260526_005` | `activegraph.runtime.budget.Budget.snapshot` | 12/12 | pass | 214.438s | restarted Pentagon |
| 006 | `T7_REPEAT_MEDIUM_20260526_006` | `activegraph.core.view.View.relations` | 12/12 | pass | 139.840s | none |
| 007 | `T7_REPEAT_MEDIUM_20260526_007` | `activegraph.core.view.View.events` | 12/12 | pass | 249.374s | restarted Pentagon |
| 008 | `T7_REPEAT_MEDIUM_20260526_008` | n/a | n/a | infrastructure_retry: ghost_completion | 93.976s | restarted Pentagon |
| 008 retry 1 | `T7_REPEAT_MEDIUM_20260526_008_RETRY_1` | n/a | n/a | infrastructure_retry: ghost_completion | 11.875s | none |
| 008 retry 2 | `T7_REPEAT_MEDIUM_20260526_008_RETRY_2` | n/a | n/a | infrastructure_retry: ghost_completion | 93.060s | restarted Pentagon |
| 008 retry 3 | `T7_REPEAT_MEDIUM_20260526_008_RETRY_3` | n/a | n/a | infrastructure_retry: ghost_completion | 17.477s | none |

## Batch 009-012

| run | hash | target_symbol | verifier | outcome | wall to completed | watchdog |
| ---: | --- | --- | --- | --- | ---: | --- |
| 009 | `T7_REPEAT_MEDIUM_20260526_009` | `activegraph.core.graph.Graph.neighborhood` | 12/12 | pass | 186.938s | none |
| 010 | `T7_REPEAT_MEDIUM_20260526_010` | `activegraph.core.graph.Graph.relations` | 12/12 | pass | 192.475s | none |
| 011 | `T7_REPEAT_MEDIUM_20260526_011` | `activegraph.core.graph.Graph.events` | 12/12 | pass | 293.961s | restarted Pentagon |
| 012 | `T7_REPEAT_MEDIUM_20260526_012` | `activegraph.core.graph.Graph.objects` | 12/12 | pass | 250.333s | restarted Pentagon |

## Batch 013-016

| run | hash | target_symbol | verifier | outcome | wall to completed | watchdog |
| ---: | --- | --- | --- | --- | ---: | --- |
| 013 | `T7_REPEAT_MEDIUM_20260526_013` | `activegraph.core.graph.Graph.has_object_of_type` | 12/12 | pass | 226.561s | restarted Pentagon |
| 014 | `T7_REPEAT_MEDIUM_20260526_014` | `activegraph.core.graph.Graph.get_object` | 11/12 | fail_verifier: late_ack_after_trigger_completed | 83.944s | restarted Pentagon |

Notes:
- Runs 003, 004, and 010 emitted duplicate exact ACKs. The verifier kept the latest equivalent ACK and passed all three runs.
- Run 008 exhausted its infrastructure retries as ghost_completion. Operator-reviewed diagnostic is in `frames/t7-medium-run-008-diagnostic-20260527.log`; no new ledger entry was needed before resuming at 009.
- Runs 009-013 all passed after the manual Pentagon restart. Runs 011, 012, and 013 required native-runner watchdog restarts; run 012 killed a surviving Pentagon pid before relaunch.
- Run 014 produced a valid proof file and exact ACK row, but the verifier failed because the exact ACK was created at `2026-05-27T14:49:28.240837+00:00`, after canonical trigger `be44f987-dec9-480c-8aef-04539548797d` had already been marked completed at `2026-05-27T14:46:25.035+00:00`. This is not one of the known retryable infrastructure modes, so the series stopped per abort condition 3.
- The inner repo branch has no upstream configured and has unrelated dirty docs/local artifacts. Maya committed only the new medium test files for successful runs.
