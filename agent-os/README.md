# agent-os/ — local resolver

> gbrain local-resolver pattern (P21). Master map: `../RESOLVER.md`.

## What goes here
Agent governance, contracts, and eval substrate (the data the orchestration in `scripts/` reads):
- **Org:** `AGENT_IDENTITY_MAP.md` (engineering squad + GTM squad + staffing roadmap),
  `RELIABILITY_OPERATING_CONTRACT.md`.
- **Cohort/model:** `agent-cohort.json` (canonical provider/model — currently Opus 4.8).
- **Routing:** `factory-routing-config.json` (the versioned org-chart/escalation map consumed by the
  shared `decideRoute`).
- **Eval rubrics:** `rubrics/*.yaml` (Rowan/Theo/Grace judge rubrics, model-pinned).
- **Judge ground truth:** `judges/<judge>/ground-truth.jsonl` + `harvested-candidates.jsonl`.
- **Skills (future):** per-agent skill docs (`skills/<agent>/<capability>.md`, P18).

## What does NOT go here
- Executable orchestration / daemons / tools → `scripts/`.
- Specs, proofs, goal docs, evidence → `frames/`.
- Runtime event logs → `frames/factory-events.*`.

## Conventions
- Rubrics carry `judge_model` + `judge_model_pinned_at` (replay determinism); bump `version` on
  any rule change.
- `factory-routing-config.json` is versioned; every routing decision is stamped with that version.
- Judge ground truth is operator-curated ("founders build the evals"); `eval-harvest-from-failures.mjs`
  writes CANDIDATES to `harvested-candidates.jsonl` for promotion, not straight into ground truth.
