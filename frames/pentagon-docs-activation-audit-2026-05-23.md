# Pentagon docs activation audit - 2026-05-23

Purpose: compare the current active_graph autonomy blocker against the public
Pentagon documentation instead of relying only on local runtime evidence.

Docs checked:

- https://docs.pentagon.run/llms.txt
- https://docs.pentagon.run/introduction.md
- https://docs.pentagon.run/quickstart.md
- https://docs.pentagon.run/agents/creating-agents.md
- https://docs.pentagon.run/agents/runtimes.md
- https://docs.pentagon.run/agents/folder-access.md
- https://docs.pentagon.run/agents/identity.md
- https://docs.pentagon.run/agents/knowledge.md
- https://docs.pentagon.run/agents/skills.md
- https://docs.pentagon.run/agents/status.md
- https://docs.pentagon.run/communication/agent-to-agent.md
- https://docs.pentagon.run/communication/chatting.md
- https://docs.pentagon.run/communication/groups.md
- https://docs.pentagon.run/workflow/status-reports.md
- https://docs.pentagon.run/workspace/maps.md
- https://docs.pentagon.run/workspace/canvas.md
- https://docs.pentagon.run/workspace/artifacts.md
- https://docs.pentagon.run/workspace/apps.md
- https://docs.pentagon.run/reference/faq.md
- https://docs.pentagon.run/api-reference/openapi.json

Relevant documented behavior:

- Agents can message each other directly through DMs, group channels, and
  structured handoffs.
- The docs state that when one agent finishes and messages another, the
  recipient receives the context and starts working without the human relaying
  the information.
- Chat messages should start a turn: the selected agent's status ring turns
  green, the current task/sticky note updates, and responses stream in real
  time.
- Pentagon agents run through local Claude Code or Codex CLI processes. Model
  selection determines the runtime; GPT-5-family agents use Codex.
- Each repo-touching agent gets its own clone and branch. Folder access can be
  read-write or read-only per repo/folder.
- Agents maintain persistent Instructions, Knowledge, Memory, and Status
  Reports; these are part of reliability because scope, handoffs, and blockers
  should survive across sessions.
- The canvas should show active/waiting/idle state, message animations, current
  tasks, and running-elsewhere indicators for conversations not currently
  selected.

What the docs did not provide:

- No documented public target-turn API was found.
- No documented MCP schema was found for trigger_turn, target_agent_id,
  executeAgentTurn, or target-scoped scheduled actions.
- The public OpenAPI document fetched from docs.pentagon.run is a sample Plant
  Store specification, not a Pentagon control-plane API.

Comparison to current evidence:

| Requirement from user goal | Docs expectation | Current evidence | Result |
| --- | --- | --- | --- |
| Repo-specific agents | agents get folder access, own clone, own branch | active_graph evidence and local runtime readback show repo-specific agent directory/model state; inner repo has outstanding dirty work | partially met, still needs clean branch discipline |
| Easy/medium/hard/extra-hard work | agents can collaborate and use skills/apps/tools | bridge-backed file gauntlet produced all four proof classes | met through bridge |
| Auditable | chats, artifacts, status reports, local tool/file output visible | frame logs, proof files, verifier output, and git history exist | met for bridge path |
| Reliable autonomous handoff | recipient should receive context and start working without human relay | native-only poller probe left a fresh target trigger unclaimed for about 133s; bridge processed it after restoration | not met natively |
| Public repair primitive | docs/API should expose a way to force/verify target turns if native polling fails | no documented target-turn API/MCP primitive found | missing |

Implication:

The official docs strengthen the product requirement: native agent-to-agent
handoff is supposed to activate the recipient. They do not currently provide a
documented API substitute for the missing native poller behavior. Therefore the
standing completion boundary remains correct: bridge-backed autonomy is useful
and auditable, but the full goal is not complete until native handoff activation
works or Pentagon documents and exposes an equivalent target-turn primitive.

Commands run:

~~~text
curl -L --max-time 20 https://docs.pentagon.run/llms.txt
curl -L --max-time 20 https://docs.pentagon.run/<page>.md | rg -i "agent|handoff|message|dm|group|runtime|codex|claude|status|folder|branch|trigger|turn|autonom|repo|clone|api|mcp|endpoint|openapi|schedule|team|artifact|knowledge|skill"
curl -L --max-time 20 https://docs.pentagon.run/api-reference/openapi.json
~~~

Verdict: docs_aligned_native_gap_confirmed
