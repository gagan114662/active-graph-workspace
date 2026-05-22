# Skills Installation Proof - 2026-05-22

Status: installed_for_codex_and_repo_backed_for_pentagon
Owner: Riley / Evidence Lead

## Installed For Codex

The following active_graph skills were installed into /Users/gaganarora/.codex/skills:

- activegraph-frame-registration
- activegraph-evidence-audit
- activegraph-adversary-regression
- activegraph-provider-parity
- activegraph-closure-discipline
- activegraph-handoff-recovery
- activegraph-bottleneck-feedback
- activegraph-interpreter-smoke
- activegraph-activation-watchdog
- activegraph-evidence-indexing
- activegraph-model-audit
- activegraph-clean-venv-replay

## Repo-Backed For Pentagon

Pentagon agents should treat agent-os/skills as the source skill pack for this
workspace. New skills added in this pass:

- agent-os/skills/interpreter-smoke.md
- agent-os/skills/activation-watchdog.md
- agent-os/skills/evidence-indexing.md
- agent-os/skills/model-audit.md
- agent-os/skills/clean-venv-replay.md

## Role Mapping

| Role | Required skills |
| --- | --- |
| Avery | frame-registration, handoff-recovery, activation-watchdog, bottleneck-feedback, evidence-indexing |
| Sofia | frame-registration, evidence-audit, evidence-indexing |
| Sasha | adversary-regression, evidence-audit |
| Theo | evidence-audit, provider-parity, adversary-regression, interpreter-smoke |
| Maya | closure-discipline, evidence-audit, interpreter-smoke, clean-venv-replay |
| Quinn | adversary-regression, bottleneck-feedback |
| Rowan | evidence-audit, closure-discipline |
| Priya | evidence-audit, closure-discipline, evidence-indexing |
| Riley | evidence-audit, bottleneck-feedback, handoff-recovery, activation-watchdog, evidence-indexing |
| Grace | closure-discipline, evidence-audit, clean-venv-replay |

## Remaining Readiness Blockers

Skill installation removes the skills-not-installed blocker. It does not by
itself prove every agent has run the skills. The flywheel gate remains red until
each core agent posts current INTERPRETER_OK or INTERPRETER_BLOCKED and the Maya
activation protocol is proven.
