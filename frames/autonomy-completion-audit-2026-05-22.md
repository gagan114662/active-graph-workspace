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
| Agents work fully autonomously | target handoff wakes recipient without manual/Codex intervention inside a bounded window | T5c eventually produced delayed Maya ACKs after the watchdog window; native trigger catch-up is not bounded; bridge proof produced visible Maya ACK in about 20s; supervised bridge loop then passed easy/medium/hard/extra-hard diagnostic triggers with visible ACKs and trigger completion inside the window; LaunchAgent proof processed a fresh Theo-to-Maya trigger in about 9s | green via bridge, amber native |
| Auditable and verifiable | committed or tracked logs/status/eval with literal command/API output | frame artifacts exist; bridge gauntlet and launchd proof logs capture message ids, trigger ids, ACK ids, timings, commands, and launchctl readback | green after commit |
| Model policy stable | current defaults and live per-agent readback all gpt-5.5 | default drifted to claude-opus-4-7[1m], repaired to gpt-5.5; live readback pending | amber |
| Activation primitive available | explicit target-agent turn API or equivalent visible output channel | this Codex session has no native Pentagon tools; Claude MCP tools/list has no target-turn primitive; internal agent_triggers table plus scripts/pentagon-trigger-bridge.mjs provide a bounded workspace bridge loop, installed as a persistent LaunchAgent | green via bridge, amber native |

## Prompt-To-Artifact Checklist

| Prompt item | Artifact or command checked | Result |
| --- | --- | --- |
| fully autonomous agents | frames/t5b-pentagon-handoff-activation-smoke.evaluation.log, frames/t5c-recipient-self-watchdog-smoke.evaluation.log, frames/t5d-bridge-sequential-gauntlet-2026-05-22.log, frames/t5d-launchd-bridge-proof-2026-05-22.log | achieved through persistent bridge; native app poller remains unbounded |
| easy/medium/hard/extra-hard | frames/gauntlet-completion-audit-2026-05-22.md, frames/evidence-index-2026-05-22.md | repo tasks mostly accounted; autonomy caveats remain |
| auditable/verifiable | frames/*.status, frames/*.evaluation.log, frames/bottleneck-feedback.log, git status | bridge and launchd proof are captured for commit |
| Pentagon model policy | defaults read run.pentagon.app pentagon.defaultModel; frames/pentagon-model-refresh-2026-05-22.log | repaired again to gpt-5.5, durability unproven |
| handoff activation | T5c dispatch/status/evaluation plus fresh Theo-Maya readback | delayed T5c ACKs exist, but not inside the required window; native trigger 59d84468 remained unclaimed after 110s; bridge trigger d2200d94 produced visible Maya ACK 4956fb18 and completed in about 20s; bridge loop gauntlet stamp 20260522T224124Z passed four fresh task-class triggers; launchd proof T5D_LAUNCHD_BRIDGE_CLEAN_20260522T224946Z produced exactly one Maya ACK 156c3045 and completed terminal reverse trigger 3aa8dc2d |
| live Pentagon work dispatch | MCP spawn_agent/send_message, ps, read_messages | created T5d Activation Engineer but did not prove execution; no codex exec process and no agent reply observed |
| hidden target scheduling | MCP schedule_action with agent_id/target_agent_id/conversation_id, list_scheduled_actions, ps, read_messages | action was accepted and then cleared, but produced no visible target reply or worker process |
| heartbeat catch-up / trigger catch-up | Pentagon UI active count, ps token-to-agent mapping, Theo-Maya readback, agent_triggers readback, local debug log, trigger bridge proof, bridge loop gauntlet, launchctl readback | native trigger catch-up can eventually start Maya and produce ACK but is not bounded; persistent bridge claims, runs, persists, completes, and closes terminal reverse triggers inside the watchdog window |

## Completion Decision

Operational through the persistent workspace bridge; not a native app poller
repair. T5d is reclassified: Pentagon has an internal target trigger
queue that eventually woke Maya and produced the requested ACK, but it did not
meet the declared bounded window. A fresh direct-queue probe then showed the
message-to-trigger step is immediate, while the native trigger remained
unclaimed after 110 seconds. The new workspace bridge fixes the bounded
execution path for fresh Theo-to-Maya triggers, including visible ACK and
trigger completion in about 20 seconds, and a supervised loop gauntlet passed
easy, medium, hard, and extra-hard diagnostic task classes. The bridge is now
installed as launchd service run.pentagon.trigger-bridge and a clean proof
showed a fresh trigger claimed in about 0.6 seconds, completed in about 8.8
seconds, exactly one visible Maya ACK, and terminal reverse-trigger closure.
Native product repair remains open because the public MCP/native app path still
does not expose or reliably run a bounded target-turn primitive without this
local bridge.
