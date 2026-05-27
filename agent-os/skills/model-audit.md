# Skill: Model Audit

Use before opening or reopening any Pentagon-autonomous frame.

The expected cohort is canonicalized in `agent-os/agent-cohort.json`. As of
2026-05-27 the active cohort is `opus-4.7-claude-code-2026-05-27`:

- provider: `claude-code`
- model: `claude-opus-4-7`
- harness_id: `claude-code`
- execution_mode: `local`
- Pentagon default model: `claude-opus-4-7`

Steps:
1. Read `agent-os/agent-cohort.json` for the expected (provider, model, harness_id).
2. Read the Pentagon default model from `defaults read run.pentagon.app pentagon.defaultModel`.
3. Inspect every active agent profile for the workspace via the Supabase `agents` table.
4. Verify each active core agent matches the expected cohort exactly.
5. Mark legacy or retired agents separately.
6. Commit a model audit artifact with default model, per-agent (provider/model/harness_id), and timestamp.

Output:
- `MODEL_OK <agent> <provider>|<model>|<harness_id>` (must match expected cohort)
- `MODEL_BLOCKED <agent> <literal observed provider|model|harness_id>`
- committed audit path

Stop condition:
- A frame cannot claim Pentagon autonomy if any active owner lacks MODEL_OK.
- The cohort config is the source of truth; do not hardcode model strings in checks.
- Historical evidence files (e.g. `frames/t5n-codex-harness-native-recheck-2026-05-23.log`)
  retain the prior cohort's snapshot and are NOT updated by migration. They pin history.
