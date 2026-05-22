# Skill: Bottleneck Feedback

Use whenever work stalls, a predicate fails, or a review finds a gap.

Event shape:

```yaml
event: bottleneck.detected
frame: <frame id>
complexity: easy|medium|hard|extra-hard
source: log|git|test|review|budget|routing
symptom: <literal failure or drift>
owner: <next owner>
feedback_action: <gate, test, purpose-doc change, frame amendment>
evidence:
  - <hash/file/command output>
```

Every repeated bottleneck must become a gate, skill update, or purpose-doc rule.
Before a Pentagon-autonomous gauntlet frame starts or reopens, frames/flywheel-readiness.status must be green.

Standing gates from the 2026-05-22 gauntlet audit:

- Frame permissions too narrow -> Avery must diff planned touched files against
  frame permissions before Code Owner starts.
- Green tests without adversary coverage -> Quinn must produce a breakage pass
  before Priya closes hard or extra-hard frames.
- Partial Purpose coverage -> Riley must keep a purpose-confirmation checklist
  until every core owner replies `PURPOSE_OK` or `PURPOSE_PATCHED`.
- Missing skills/interpreter -> owner cannot start work until it posts
  `INTERPRETER_OK` or a blocking bottleneck.
- Model drift -> default and per-agent model audit must be refreshed before
  opening a validation frame.
- DM without activation -> handoff is incomplete until recipient activation is
  observed.
- Active count 0 on open frame -> Avery or Riley must reactivate the owner or
  log a routing bottleneck.
- Evidence split or untracked proof -> Riley must update frames/evidence-index-2026-05-22.md and commit, retire, or supersede the artifact before it can be used as proof.
- Legacy/current name drift -> resolve the owner through agent-os/AGENT_IDENTITY_MAP.md before assigning accountability.
- Missing interpreter proof -> agent cannot own code, tests, review, gates, or closure until it logs INTERPRETER_OK or INTERPRETER_BLOCKED.
- Repeated bottleneck without a gate, skill update, Purpose rule, or frame predicate -> keep frames/flywheel-readiness.status red.
