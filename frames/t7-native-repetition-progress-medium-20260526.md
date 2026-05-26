# T7 Native Repetition Progress Medium 2026-05-26

Scope: T7 medium reliability measurement, 25 sequential native runs using the T6 medium task class.

## Current Status

- Run index reached: 004/025.
- Authoritative ledger: `frames/t7-native-repetition-progress-medium-20260526.jsonl`.
- Authoritative metric command:
  `node scripts/t7-repetition-harness.mjs --ledger frames/t7-native-repetition-progress-medium-20260526.jsonl`
- Current metrics after run 004:
  - pass_count=4
  - agent_failure_count=0
  - infra_retry_count=0
  - total_run_attempts=4
  - pass_rate_percent=100.0
  - infrastructure_failure_rate_percent=0.0
- 22/25 = 88% gate: still reachable; current pass rate is above gate.
- Wall time to completed: median=244.995s, p95=516.212s, max=516.212s.
- Native-runner watchdog restarts: 2.
- Infrastructure root-cause distribution: none observed so far.
- New failure modes: none observed so far.

## Batch 001-004

| run | hash | target_symbol | verifier | outcome | wall to completed | watchdog |
| ---: | --- | --- | --- | --- | ---: | --- |
| 001 | `T7_REPEAT_MEDIUM_20260526_001` | `activegraph.store.base.replay_into` | 12/12 | pass | 223.879s | restarted Pentagon |
| 002 | `T7_REPEAT_MEDIUM_20260526_002` | `activegraph.core.view.View.objects` | 12/12 | pass | 516.212s | none |
| 003 | `T7_REPEAT_MEDIUM_20260526_003` | `activegraph.runtime.view_builder.build_view` | 12/12 | pass | 340.799s | restarted Pentagon |
| 004 | `T7_REPEAT_MEDIUM_20260526_004` | `activegraph.observability.status.status_to_dict` | 12/12 | pass | 244.995s | none |

Notes:
- Runs 003 and 004 emitted duplicate exact ACKs. The verifier kept the latest equivalent ACK and passed both runs.
- Runs 001 and 003 required the native-runner Pentagon watchdog restart. Total watchdog restarts across the medium series is 2, below the abort threshold of 10.
- The inner repo branch has no upstream configured and has unrelated dirty docs/local artifacts. Maya committed only the new medium test files for these runs.

