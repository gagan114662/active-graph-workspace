# T7 T6 Regrade 25x After Duplicate ACK Fix 2026-05-25

Scope: 25 consecutive full T6 verifier regrades across easy, medium, hard, and extra-hard using existing T6 proof artifacts. This is a reproducibility slice, not the full native fresh-target T7 gauntlet.

started_at=2026-05-25T16:07:17.365Z
finished_at=2026-05-25T16:16:43.583Z
jsonl=frames/t7-t6-regrade-25x-after-duplicate-ack-fix-20260525.jsonl

## Overall

- full_t6_iteration_passes=25/25
- full_t6_iteration_pass_rate=1.0000
- verifier_invocations=100/100
- verifier_invocation_pass_rate=1.0000

## By Tier

| tier | passes | pass_rate | p95_wall_ms | warnings_total |
| --- | ---: | ---: | ---: | ---: |
| easy | 25/25 | 1.0000 | 1153 | 25 |
| medium | 25/25 | 1.0000 | 1553 | 25 |
| hard | 25/25 | 1.0000 | 4747 | 75 |
| extra-hard | 25/25 | 1.0000 | 16322 | 150 |

## Failure Rows

none

## Notes

- This run follows the verifier fix that accepts retry-identical prior ACK ids as equivalent parents in the extra-hard chain.
- Warnings are retained in the JSONL; WARN lines do not affect exit code.
- Cost/token fields are not available from the verifier regrade path.
- Full T7 still requires fresh target generation and native Pentagon executions per tier.
