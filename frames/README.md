# frames/ — local resolver

> gbrain local-resolver pattern (P21). Master map: `../RESOLVER.md`.

## What goes here
Specs, proofs, evidence, and the runtime event substrate:
- **Specs / gauntlet definitions:** `t6-*`, `t7-*`, `t8-*` instruction + spec docs.
- **Goal docs:** `codex-goals/*.md` (long `/goal` prompts + design/backlog docs — RESOLVER, SkillOpt,
  Sentinel, CS153 eval-loop, treasury MCP, etc.). Naming: `<short-task>-<YYYYMMDD>.md`.
- **Proofs / fixtures:** `*.proof`, `*-fixture-*.txt`, `*.evidence`.
- **Runtime event substrate:** `factory-events.jsonl` (single source of truth for events),
  `factory-events.sqlite` (Honker mirror), `success-flows.jsonl`, `factory-todos.jsonl`,
  `*-actions.jsonl` (sasha/blake/sentinel action logs).
- **Migrations / status:** `migrations/*.jsonl`, `*.status`.

## What does NOT go here
- Executable code / daemons → `scripts/`.
- Contracts, rubrics, routing config, identity map → `agent-os/`.

## Conventions
- Goal docs live under `codex-goals/` with a dated slug.
- Runtime artifacts (`factory-events.*`, `*-actions.jsonl`, `factory-todos.jsonl`, `success-flows.jsonl`)
  are append-mostly state — they churn; treat them as data, not source. (See P17: gitignore candidates.)
- Frozen historical evidence files referenced by the verifier are immutable snapshots — audit for
  staleness (P8 / Brandon-D) rather than editing in place.
