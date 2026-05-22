# Pentagon Flywheel Bottleneck Gate Map

Status: active control artifact
Owner: Riley / Evidence Lead

## Rule

Every repeated failure must become one of four durable things before more work starts: gate, skill update, Purpose rule, or frame predicate.

## Converted Bottlenecks

| Bottleneck family | Evidence source | Durable conversion | Current state |
| --- | --- | --- | --- |
| Narrow frame permissions blocked required edits | bottleneck-feedback.log and v0 amendment | frame preflight permission gate | converted_to_gate |
| Stale install hid current code behavior | early frame logs | interpreter/repo-cwd preflight | converted_to_gate |
| Direct fallback when owners were silent | judge logs, T4/T5 logs | capability proof and activation protocol | open_until_flywheel_green |
| T2 partial closure caveats | T2 eval/review/status | tracked follow-up predicates | converted_to_debt |
| Adversary bugs after green tests | T3/T4 adversary logs | Quinn adversary pass before closure | converted_to_gate |
| RLS/DM routing did not activate worker | T4/T5 Pentagon logs | sender DM is context only; watcher must activate recipient | open_runtime_blocker |
| Purpose coverage was partial or generic | purpose audit entries | Purpose proof checklist for active core | open_until_repatched |
| Model drift / Opus display confusion | model audit and defaults check | default plus per-agent model audit | partially_converted |
| Model default reverted after repair | live defaults check at 2026-05-22T21:54Z | fresh-launch default check plus per-agent readback before autonomous frame start | open_until_durable |
| Legacy/current name conflict | old Atlas/Forge/Nova/Hawk/Verdict logs | agent-os/AGENT_IDENTITY_MAP.md | converted_to_identity_rule |
| T1b missing gauntlet accounting | GAUNTLET.md vs missing frame artifacts | evidence index classification | converted_to_accounting_rule |
| v0.1 orphan frame | frame list vs v0 amendment | evidence index superseded classification | converted_to_accounting_rule |
| Untracked proof files | git status | commit, supersede, or retire before proof use | converted_in_current_repair |
| Active count can hit zero while frame open | T5 status and live Pentagon behavior | Riley/Avery five-minute watcher rule | open_runtime_blocker |
| Recipient self-watchdog did not wake Maya | T5c status/evaluation/dispatch | require target-agent turn activation primitive or equivalent visible recipient output channel | open_product_blocker |

## Readiness Enforcement

frames/flywheel-readiness.status is the single readiness gate. If it is red, no new Pentagon-autonomous gauntlet frame may start or reopen.
