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

