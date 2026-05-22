# active_graph as a mini-AGI company

Source lens: Jack Dorsey / Sequoia, "Every Company Can Now Be a Mini-AGI".

## Core idea

The Pentagon workspace should not look like a hierarchy or a random swarm.
It should look like a small company wrapped around an intelligence layer:

- The intelligence layer is the repo evidence: commits, tests, logs, status files,
  eval logs, review logs, contracts, and dispatch logs.
- Humans and agents sit at the edge of that layer with clear accountability.
- Information should flow through artifacts first, then DMs/groups only for
  handoffs, blockers, and judgement calls.

## Three role types

### 1. DRI roles

These roles own outcomes. They decide whether a frame is open, blocked, green,
or closed. They do not do every task themselves.

- Avery (Frame Architect): turns ambiguous work into a testable frame.
- Priya (Goal Reaper): owns closure, predicate truth, and incomplete/blocker state.
- Blake (Budget Marshal): owns time/token/budget limits and escalation.

### 2. IC roles

These roles build or operate the system. They create concrete artifacts.

- Sofia (Spec Owner): writes frame amendments and behavioral decisions.
- Theo (Test Owner): writes failing tests first.
- Maya (Code Owner): implements code.
- Carmen (Contract Owner): updates contract and drift obligations.
- Sam (Docs Owner): updates user-facing docs and changelog.
- Grace (Gate Sentinel): runs gates and reports literal outputs.
- Finn (Fork Debugger): isolates regressions.
- Taylor (Trace Archivist): preserves evidence.
- Riley (Evidence Lead): assembles checkable proof bundles.

### 3. Player-coach roles

These roles improve quality across the IC work. They do not own the frame; they
raise the standard and catch weak work.

- Sasha (Spec Skeptic): attacks ambiguity before code starts.
- Quinn (Test Adversary): attacks the implementation after code lands.
- Rowan (Code Reviewer): reviews code and gives review.clean or review.concern.
- Ravi (Replay Validator): verifies replay/install/wheel behavior.
- Casey (Compatibility Auditor): checks backward compatibility.
- Parker (Performance Sentinel): checks performance regressions.
- Simone (Security Auditor): checks security risk.

## Canvas layout

The Pentagon canvas should be arranged as columns, not a cluster:

1. Frame control: Avery, Blake, Priya
2. Spec: Sofia, Sasha
3. Test and code: Theo, Maya
4. Contract and docs: Carmen, Sam
5. Review: Rowan, Quinn, Ravi
6. Gates and forensics: Grace, Finn, Taylor
7. Production readiness and evidence: Riley, Casey, Parker, Simone

The top row is the primary delivery path. The bottom row is the production and
evidence layer. Status cards should live near the agent that owns the status.

## Operating rules

- No green claim without a repo hash and literal command output.
- No closure without outer status/evaluation artifacts and inner repo evidence.
- DMs are for single-owner handoffs.
- Group chats are for shared context only.
- The user should be the final reviewer, not the dispatcher.
- Research Analyst is not a standing role for this repo. Riley is Evidence Lead
  because this workspace succeeds or fails on proof, not open-ended research.

## Current gap

The agents are renamed and mostly laid out as a workflow, but Pentagon still
does not enforce the canvas as a process. The durable source of truth remains
the repo artifact layer. If the canvas and logs disagree, trust the logs.
