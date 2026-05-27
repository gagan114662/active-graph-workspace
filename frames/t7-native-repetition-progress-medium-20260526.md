# T7 Native Repetition Progress Medium 2026-05-26

Scope: T7 medium reliability measurement, 25 sequential native runs using the T6 medium task class.

## Current Status

- Run index reached: 012/025.
- Sequence status: resumed at run 009 after operator-managed Pentagon restart and run 008 diagnostic review.
- Authoritative ledger: `frames/t7-native-repetition-progress-medium-20260526.jsonl`.
- Authoritative metric command:
  `node scripts/t7-repetition-harness.mjs --ledger frames/t7-native-repetition-progress-medium-20260526.jsonl`
- Current metrics after run 012:
  - pass_count=11
  - agent_failure_count=0
  - infra_retry_count=4
  - total_run_attempts=15
  - pass_rate_percent=100.0
  - infrastructure_failure_rate_percent=26.7
- 22/25 = 88% gate: still reachable; current agent-attributed pass rate is above gate.
- Wall time to completed: median=214.438s, p95=516.212s, max=516.212s.
- Native-runner watchdog restarts: 8 observed in run logs/diagnostic evidence (6 on passing runs, plus 2 during run 008 exhausted infrastructure attempts). This is below the abort threshold of 10.
- Infrastructure root-cause distribution: ghost_completion=4.
- New failure modes: none.

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

Notes:
- Runs 003, 004, and 010 emitted duplicate exact ACKs. The verifier kept the latest equivalent ACK and passed all three runs.
- Run 008 exhausted its infrastructure retries as ghost_completion. Operator-reviewed diagnostic is in `frames/t7-medium-run-008-diagnostic-20260527.log`; no new ledger entry was needed before resuming at 009.
- Runs 009-012 all passed after the manual Pentagon restart. Runs 011 and 012 required native-runner watchdog restarts; run 012 killed a surviving Pentagon pid before relaunch.
- The inner repo branch has no upstream configured and has unrelated dirty docs/local artifacts. Maya committed only the new medium test files for successful runs.

