# Pentagon Autonomy Completion Audit - 2026-05-22

Objective: fix Pentagon AI agents to work fully autonomously across easy,
medium, hard, and extra-hard tasks in an auditable, verifiable fashion.

## Success Criteria

| Requirement | Evidence required | Current evidence | Result |
| --- | --- | --- | --- |
| Easy task completed with evidence | frame status/eval/review plus test output | T1a status closed; T1b accounted as pre-satisfied in evidence index | partial, historical |
| Medium task completed with evidence | frame status/eval/review plus test output | T2 status closed, T3 status closed | green for repo tasks |
| Hard task completed with evidence | frame status/eval/review plus test output | T3 status closed with focused/full tests and gates | green for repo task |
| Extra-hard task completed with evidence | frame status/eval/review plus test output | T4/T5b repo work landed, but T4 has autonomy gap and T5b is watchdog-assisted | repo green, autonomy not green |
| Agents work fully autonomously | target handoff wakes recipient without manual/Codex intervention inside a bounded window | T5c eventually produced delayed Maya ACKs after the watchdog window; T5d internal trigger readback proves Maya was eventually claimed and ACKed, but message-to-ACK was about 6m10s and outside the 90s watchdog window | red |
| Auditable and verifiable | committed or tracked logs/status/eval with literal command/API output | frame artifacts exist; two fresh eval logs are currently untracked | amber |
| Model policy stable | current defaults and live per-agent readback all gpt-5.5 | default drifted to claude-opus-4-7[1m], repaired to gpt-5.5; live readback pending | amber |
| Activation primitive available | explicit target-agent turn API or equivalent visible output channel | this Codex session has no native Pentagon tools; Claude MCP tools/list has no target-turn primitive; spawn_agent plus send_message created a T5d agent conversation but no worker process/reply appeared; hidden schedule_action target fields fired/cleared without target output; internal agent_triggers table proves target execution exists but is not public/bounded | red |

## Prompt-To-Artifact Checklist

| Prompt item | Artifact or command checked | Result |
| --- | --- | --- |
| fully autonomous agents | frames/t5b-pentagon-handoff-activation-smoke.evaluation.log, frames/t5c-recipient-self-watchdog-smoke.evaluation.log | not achieved |
| easy/medium/hard/extra-hard | frames/gauntlet-completion-audit-2026-05-22.md, frames/evidence-index-2026-05-22.md | repo tasks mostly accounted; autonomy caveats remain |
| auditable/verifiable | frames/*.status, frames/*.evaluation.log, frames/bottleneck-feedback.log, git status | incomplete until fresh/untracked proof is committed or retired |
| Pentagon model policy | defaults read run.pentagon.app pentagon.defaultModel; frames/pentagon-model-refresh-2026-05-22.log | repaired again to gpt-5.5, durability unproven |
| handoff activation | T5c dispatch/status/evaluation plus fresh Theo-Maya readback | delayed T5c ACKs exist, but not inside the required window; T5d internal trigger 3737cf58 was created, claimed, and completed with Maya ACK, but outside the required 90s window |
| live Pentagon work dispatch | MCP spawn_agent/send_message, ps, read_messages | created T5d Activation Engineer but did not prove execution; no codex exec process and no agent reply observed |
| hidden target scheduling | MCP schedule_action with agent_id/target_agent_id/conversation_id, list_scheduled_actions, ps, read_messages | action was accepted and then cleared, but produced no visible target reply or worker process |
| heartbeat catch-up / trigger catch-up | Pentagon UI active count, ps token-to-agent mapping, Theo-Maya readback, agent_triggers readback, local debug log | trigger catch-up can eventually start Maya and produce ACK; bounded SLA and public activation primitive remain unproven |

## Completion Decision

Not complete. T5d is reclassified: Pentagon has an internal target trigger
queue that eventually woke Maya and produced the requested ACK, but it did not
meet the declared bounded window and the public MCP/tool surface still does not
expose a routed target-agent activation primitive with readback. The next
required product fix is to make that target activation public/auditable and
prove Theo can wake Maya inside the watchdog window.
