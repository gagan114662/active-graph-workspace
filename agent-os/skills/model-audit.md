# Skill: Model Audit

Use before opening or reopening any Pentagon-autonomous frame.

Steps:
1. Read the Pentagon default model.
2. Inspect every active agent profile for the workspace.
3. Verify each active core agent is on gpt-5.5.
4. Mark legacy or retired agents separately.
5. Commit a model audit artifact with default model, per-agent model, and
   timestamp.

Output:
- MODEL_OK <agent> gpt-5.5
- MODEL_BLOCKED <agent> <literal observed model>
- committed audit path

Stop condition:
- A frame cannot claim Pentagon autonomy if any active owner lacks MODEL_OK.
