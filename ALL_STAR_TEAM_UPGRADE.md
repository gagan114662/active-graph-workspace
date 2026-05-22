# Active Graph All-Star Team Upgrade

Purpose: turn the Pentagon team from a prompt-routed group into a production-grade,
evidence-backed infra team.

This is not a hiring plan first. It is an execution-system upgrade.

## Verdict

- Add interpreters for the core agents.
- Add repo-backed skills/runbooks.
- Tighten purpose docs around evidence, handoff, and escalation.
- Hire more agents only after the current core loop proves it can run T4 without
  Atlas/Codex relaying every step.

## Core all-star loop

These agents are the always-on production loop:

| Agent | Role | Interpreter? | Must produce |
|---|---|---:|---|
| Avery (Frame Architect) | frame/router | yes | frame yaml, permissions, dispatch log |
| Sofia (Spec Owner) | design/spec | yes | design amendments |
| Sasha (Spec Skeptic) | spec adversary | yes | challenge files |
| Theo (Test Owner) | tests | yes | failing tests first |
| Maya (Code Owner) | implementation | yes | implementation commit |
| Quinn (Test Adversary) | breakage finder | yes | adversary report + regressions |
| Rowan (Code Reviewer) | code review | yes | review.log |
| Priya (Goal Reaper) | predicate evaluator | yes | evaluation.log + status |
| Riley (Evidence Lead) | source of truth | yes | evidence map and bottleneck ledger |
| Grace (Gate Sentinel) | gates | yes | literal gate outputs |

Specialists stay on demand: Carmen, Ravi, Taylor, Blake, Sam, Casey, Parker,
Simone, Finn. They become active only when a frame predicate names their surface.

## Interpreter requirement

An interpreter is a small, stateful execution workbench between model calls. It
must let an agent inspect files, run commands, keep scratch state, and decide
what evidence should enter model context.

Minimum interpreter capabilities:

- shell in the correct repo
- Python
- git
- file read/write inside assigned scope
- test execution
- persistent scratch notes per frame
- command-output capture for logs
- safe refusal when permissions are missing

Interpreter outputs are not trusted by themselves. They become evidence only
when copied into a committed frame artifact or cited by hash.

## Required skills

The skill pack lives in `agent-os/skills/`:

1. `frame-registration.md`
2. `evidence-audit.md`
3. `adversary-regression.md`
4. `provider-parity.md`
5. `closure-discipline.md`
6. `handoff-recovery.md`
7. `bottleneck-feedback.md`
8. `interpreter-smoke.md`
9. `activation-watchdog.md`
10. `evidence-indexing.md`
11. `model-audit.md`
12. `clean-venv-replay.md`

Each core agent's Purpose doc should name the skills they must use.

## Non-negotiable gates

- No frame starts without a frame yaml, permission list, owner map, and
  bottleneck seeds.
- No tests start until spec amendments and skeptic challenges exist.
- No implementation starts until failing tests are committed.
- No closure starts until review, adversary, gates, and evidence map exist.
- If Pentagon hits 0 active while a frame is incomplete, Avery or Riley must
  create `bottleneck.detected` and reactivate the owner.
- Chat is not evidence. Files, hashes, logs, and literal command outputs are.

## Hiring rule

Do not add more agents until the current core loop proves T4 through closure.

Add a new agent only when a repeated bottleneck cannot be fixed by:
1. a skill,
2. a gate,
3. a purpose-doc change,
4. a better interpreter,
5. or a tighter handoff.

## Current target

T4 is the proof frame.

If this team becomes all-star, T4 should move through:

Avery -> Sofia -> Sasha -> Theo -> Maya -> Quinn -> Rowan/Grace -> Priya/Riley

with every bottleneck captured as an event and every claim backed by git/log
evidence.
