# Dark Factory — Agent Collaboration Topology

> How the 18 agents talk to each other in Pentagon. Each agent's Purpose
> doc names who they DM and which Group Conversations they live in.
> Pentagon handles the routing automatically.

## The two primitives

Pentagon supports two communication modes:

- **Direct messages (DMs)** — 1:1 handoffs between exactly two agents. Used for "you finished X, I need it." Asynchronous; receiver picks up next time it's active.
- **Group Conversations** — multi-agent threads where every participant sees every message. Used for "team has shared context." Pentagon shows them in the sidebar alongside DMs.

**You configure collaboration by writing it into each agent's Purpose document.** Telling agent A "when you finish X, message agent B" is sufficient. No channel wiring.

2026-05-22 repair rule: a message is not activation proof. A handoff is only
complete when the recipient produces a visible turn, worker/process/log
evidence, or a committed artifact after the handoff timestamp.

## Direct-message edges (who → who)

Each arrow below corresponds to a sentence we add to the sender's Purpose doc.

### Frame Operations
- **Frame Architect → Spec Owner**: "Frame opened with `example_runs_clean` in success_criteria — please draft the killer-demo spec."
- **Frame Architect → Goal Reaper**: "New frame opened — start watching its predicates every 5 min."
- **Frame Architect → Budget Marshal**: "Budget set for this frame — track it."
- **Frame Architect → user**: `frame.ambiguous` (issue text doesn't yield a testable goal).
- **Goal Reaper → user**: `goal.satisfied` (all predicates green) OR `goal.incomplete` (which predicate failed + actual vs. expected).
- **Goal Reaper → Code Owner**: When `goal.incomplete` and the failing predicate is in code scope.
- **Budget Marshal → user**: At 80% and 100% of any dimension.

### Construction (the build chain)
- **Spec Owner → Test Owner**: "Spec drafted at `examples/<id>.py` — write the failing test first."
- **Spec Owner → Spec Skeptic**: "Spec drafted — find the gaps before Code Owner starts."
- **Spec Owner → user**: `spec.ambiguous`.
- **Test Owner → Code Owner**: "Test is failing at `tests/<id>.py` — time to implement."
- **Test Owner → user**: `test.requires_live_network` (determinism gate would break).
- **Code Owner → Test Adversary**: "Code committed — try to break it."
- **Code Owner → Code Reviewer**: "Code committed — please review."
- **Code Owner → CONTRACT Owner**: "Code committed — draft the numbered amendment."
- **Code Owner → Docs Owner**: "Code committed — sync the docs."
- **Code Owner → user**: `public_api.change.proposed` OR `series.proposed`.
- **CONTRACT Owner → user**: `contract.contradiction.detected`.
- **Docs Owner → user**: `docs.build.broken` OR drift in sibling-pair cross-refs.

### Adversarial QA (the four verification channels)
- **Spec Skeptic → Spec Owner**: "Gap found at line N — patch the spec or note as out-of-scope."
- **Spec Skeptic → user**: Severe `spec.gap.found` requiring product judgment.
- **Test Adversary → Fork Debugger**: "Regression discovered — fork pre-change for the diff."
- **Test Adversary → user**: Severe `regression.discovered`.
- **Code Reviewer → Code Owner**: `review.concern` with line-level citations (or `review.clean`).
- **Code Reviewer → Goal Reaper**: `review.clean` signal (Goal Reaper requires it as a predicate).
- **Replay Validator → user**: `replay.red` (FATAL — shipping artifact is broken).

### Observability (the witnesses)
- **Gate Sentinel → Code Owner**: `gate.mypy.red` on Code Owner's commits.
- **Gate Sentinel → Docs Owner**: `gate.broken_link.red`.
- **Gate Sentinel → Test Owner**: `gate.wheel_completeness.red`.
- **Gate Sentinel → Code Owner**: `gate.docstrings.red`.
- **Fork Debugger → Code Owner**: "Here's the diff that introduced regression X — minimal reproducer attached."
- **Trace Archivist → no one (write-only)**: Archives frames to disk.

### Production Readiness
- **Compatibility Auditor → user**: `backcompat.break.detected` with specific failing test from version vN.M.
- **Performance Sentinel → user**: `perf.regression.detected` with ns/op baseline vs current.
- **Performance Sentinel → user**: `perf.benchmarks.missing` (first run surfaces the missing tooling gap).
- **Security Auditor → user**: `security.finding` HIGH/CRITICAL only.
- **Security Auditor → no one (silent)**: LOW/INFO findings logged but not sent.

## Group Conversations (multi-agent threads)

Seven groups, organized around the work shape (not just by department):

### 1. `#frame-lifecycle` — Frame Architect, Goal Reaper, Budget Marshal, user
The lifecycle of each frame from open to close. Goal Reaper announces predicate state changes here. Budget Marshal posts spend snapshots. Frame Architect lurks for new tasks.

### 2. `#construction-sync` — Spec Owner, Test Owner, Code Owner, CONTRACT Owner, Docs Owner
The spec→test→code→contract→docs cycle for the current frame. Every Owner can see the others' progress. Replaces DMs when context is shared.

### 3. `#verification-trinity` — Spec Skeptic, Code Reviewer, Test Adversary, Replay Validator, Goal Reaper
The four verification channels that Goal Reaper aggregates from. When one finds an issue, the others see it before they fire — avoids duplicate findings.

### 4. `#gates-and-forensics` — Gate Sentinel, Fork Debugger, Trace Archivist
The observability layer. Gate Sentinel posts per-gate results. Fork Debugger posts diffs for any red gate. Trace Archivist captures everything.

### 5. `#production-readiness` — Compatibility Auditor, Performance Sentinel, Security Auditor, Replay Validator
The cross-cutting concerns that block release. Each posts its scan results. Replay Validator participates because clean-venv install is a production-readiness check.

### 6. `#drift-detection` — CONTRACT Owner, Code Reviewer, Code Owner
Catch drift before it ships. CONTRACT Owner posts hourly contradiction scans. Code Reviewer posts diffs that change CONTRACT-referenced files. Code Owner sees both.

### 7. `#anti-slop-council` — Spec Skeptic, Code Reviewer, Test Adversary
The dedicated adversarial layer. These three never collaborate with the constructive department but talk to each other to align on what they're each looking for. Avoid duplicate concerns; cover holes.

### 8. `#bottleneck-feedback` — Riley (Evidence Lead), Priya (Goal Reaper), Avery (Frame Architect), Blake (Budget Marshal), Grace (Gate Sentinel), Taylor (Trace Archivist)
The continuous-improvement loop. Every frame emits bottleneck events here,
not just final pass/fail summaries. Riley owns the evidence, Priya owns the
predicate impact, Avery changes routing/spec permissions, Blake tracks
capacity/cost bottlenecks, Grace ties bottlenecks to gates, and Taylor archives
the final pattern so the next easy/medium/hard/extra-hard task starts smarter.

Required event shape:

```
bottleneck.detected:
  frame: <frame id>
  complexity: easy|medium|hard|extra-hard
  source: log|git|test|review|budget|routing
  symptom: <literal failure, stall, or drift>
  owner: <agent responsible for next action>
  feedback_action: <purpose update, frame amendment, new gate, test, or docs change>
  evidence: <commit hash, file path, command output, or Pentagon log line>
```

Any repeated bottleneck across two frames becomes a standing gate or Purpose
document rule before the next frame opens. This is the active_graph event-log
feedback loop: the system improves from observed bottlenecks rather than from
after-the-fact chat interpretation.

Handoff event addendum:

```yaml
handoff.activation:
  frame: <frame id>
  sender: <agent>
  recipient: <agent>
  sender_artifact: <hash/path>
  recipient_activation: <visible turn|worker process|commit|BLOCKED>
  next_artifact_or_blocker: <hash/path/error>
```

If active count reaches 0 while a frame status is not closed, Avery or Riley
must create a bottleneck entry and reactivate the current owner. Silent idle is
a failed gate.

## Status reports

Each agent maintains a live status report Pentagon surfaces on the canvas
(below the agent's name) and in the sidebar. Format per design doc:

```
Summary: <one-line current activity>
Current task: <what right now>
Progress: <% or milestone>
Notes: <blockers, decisions, questions>
```

Owners post their current artifact (the file path being touched).
Reactive agents (Gate Sentinel, Fork Debugger) post the event being processed.
Goal Reaper posts the predicate count: "12/15 green, 3 pending."
Riley posts the current bottleneck count: "2 bottlenecks open, 1 converted to
gate, 1 routed to Frame Architect."

## All-Star Operating Layer

The production-grade operating layer is repo-backed in `agent-os/`.

- `agent-os/INTERPRETER_CONTRACT.md` defines what "give agents an interpreter"
  means for this workspace.
- `agent-os/CORE_PURPOSE_DOCS.md` contains the Purpose document inserts for
  the core all-star loop.
- `agent-os/skills/` contains the reusable skills that agents must apply
  before opening, testing, implementing, reviewing, or closing a frame.

Core agents with interpreter priority:

`Avery, Sofia, Sasha, Theo, Maya, Quinn, Rowan, Priya, Riley, Grace`.

Specialists stay on demand unless a frame predicate names them.

## Tasks & Progress

Pentagon's built-in task system, NOT a separate spreadsheet. Each agent
breaks its frame-assigned work into Backlog / In Progress / Review / Done.
The canvas shows progress as "3/7" on the agent's node.

For the dark factory: Goal Reaper's success_criteria predicates map 1:1 to
tasks. When a predicate flips green, the corresponding task moves to Done.
Frame is satisfied when all tasks are Done AND review.clean is in.

## Where to set this up in Pentagon

For each of the 18 agents:

1. Open agent → Settings tab → Purpose document
2. Append a "Coordination" section listing:
   - DM partners (who I message, when)
   - Groups I'm in (named #channel above)
   - When I escalate to gagan
3. Save

For each Group Conversation:

1. From the canvas, create a new Group Conversation
2. Add the listed participants
3. Pin to top with the # name (e.g., #frame-lifecycle)

## Workspace-level setup (one-time)

0. **Set every agent model to `gpt-5.5`.** Pentagon's workspace default
   model and each existing agent profile must be `gpt-5.5`, including
   renamed canvas agents such as Atlas, Verdict, Hawk, Forge, and Nova. New
   agents inherit the same model policy; do not split producers and reviewers
   across different model families for this project.

1. **Enable "Isolate new agents"** in Settings. Without this, agents share a working
   directory and can't reliably push their own branches. Existing 18 agents stay
   shared; new agents (e.g., a Manager if we spawn one) get isolated.

2. **Add `dark-factory-design.md` to the workspace Knowledge Base at Map scope.**
   Every agent can then search it on demand instead of needing it in their
   context window.

3. **Add `frames/v0-promote-runtime-diff.yaml` as a Knowledge Base article**
   so agents searching for "frame" find it.

## Anti-pattern: don't route everything through groups

Pentagon explicitly warns: agent communication should be "concise and direct
— like colleagues on Slack." Not every message is a group post.

Rule: use DM when one specific receiver. Use Group when the context is
shared and others need to see it without being asked. Goal Reaper's verdict
goes in #frame-lifecycle (everyone cares); a Spec Skeptic gap finding goes
in DM to Spec Owner (only they own the fix).

## Test for whether the topology is right

After setup, watch the canvas for ~10 minutes when the next frame opens.
The flight animations (Pentagon's visual indicator for agent messages)
should fire between the edges drawn above. If you see flight animations
between agents NOT on the edge list, the topology is leaking. If you see
no flight animations at all, the agents don't know about each other —
their Purpose docs need updating.
