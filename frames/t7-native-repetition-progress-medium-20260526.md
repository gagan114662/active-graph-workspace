# T7 Native Repetition Progress Medium 2026-05-26

Scope: T7 medium reliability measurement, 25 sequential native runs using the T6 medium task class.

## Current Status

- Run index reached: 008/025.
- Sequence status: stopped for operator review after run 008 exhausted infrastructure retries with repeated ghost_completion.
- Authoritative ledger: `frames/t7-native-repetition-progress-medium-20260526.jsonl`.
- Authoritative metric command:
  `node scripts/t7-repetition-harness.mjs --ledger frames/t7-native-repetition-progress-medium-20260526.jsonl`
- Retry-decision command for run 008:
  `node scripts/t7-repetition-harness.mjs --ledger frames/t7-native-repetition-progress-medium-20260526.jsonl --retry-decision --run-idx 8`
- Current metrics after run 008 retry 3:
  - pass_count=7
  - agent_failure_count=0
  - infra_retry_count=4
  - total_run_attempts=11
  - pass_rate_percent=100.0
  - infrastructure_failure_rate_percent=36.4
- 22/25 = 88% gate: still mathematically reachable if the series resumes and enough future runs pass, but run 008 requires operator review first.
- Wall time to completed: median=214.438s, p95=516.212s, max=516.212s.
- Native-runner watchdog restarts: 4.
- Infrastructure root-cause distribution: ghost_completion=4.
- New failure modes: none; run 008 used the existing ghost_completion classifier path.

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
| 008 | `T7_REPEAT_MEDIUM_20260526_008` | n/a | n/a | infrastructure_retry: ghost_completion | 93.976s | none |
| 008 retry 1 | `T7_REPEAT_MEDIUM_20260526_008_RETRY_1` | n/a | n/a | infrastructure_retry: ghost_completion | 11.875s | none |
| 008 retry 2 | `T7_REPEAT_MEDIUM_20260526_008_RETRY_2` | n/a | n/a | infrastructure_retry: ghost_completion | 93.060s | none |
| 008 retry 3 | `T7_REPEAT_MEDIUM_20260526_008_RETRY_3` | n/a | n/a | infrastructure_retry: ghost_completion | 17.477s | none |

Notes:
- Runs 003 and 004 emitted duplicate exact ACKs. The verifier kept the latest equivalent ACK and passed both runs.
- Runs 001, 003, 005, and 007 required the native-runner Pentagon watchdog restart. Total watchdog restarts across the medium series is 4, below the abort threshold of 10.
- Run 008 and retries 1-3 all produced canonical triggers that were claimed and completed, but no exact ACK rows and no proof files appeared before the runner deadline. The classifier path is the existing `ghost_completion` infrastructure retry path.
- The run 008 retry-decision command returned `action=escalate`, `reason=max_infrastructure_retries_exhausted`, `infrastructure_attempts=4`. The series is stopped here for operator review before run 009.
- The inner repo branch has no upstream configured and has unrelated dirty docs/local artifacts. Maya committed only the new medium test files for successful runs.
