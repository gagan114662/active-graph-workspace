# Open Backlog — active_graph dark factory

_Reconciled 2026-05-29 (pt.20) against reality — the old list predated pt.7–19 and was
~60% stale. Status tags: [DONE] · [CHEAP] (solo, small) · [MULTI-WEEK] (solo, large) ·
[OPERATOR] (needs a human decision / external party) · [LIVE-$] (needs many paid runs)._

## Done since this list was written (pt.7–pt.20) — no longer open

- [DONE] **Phase F flywheel infra** — F1 scheduled-gauntlet daemon (`f1-gauntlet-scheduler.mjs`),
  F2 monitoring agent (`friction-analyzer.mjs` — watches runs, proposes repo fixes),
  F4 unified memory (`factory-memory.mjs`), F5 cost meter (`factory-treasury.mjs` + Blake).
- [DONE] **Agent-first MCP surface** — `factory-mcp-server.mjs` (budget/recall/resolve/arbitrage)
  + `forge-mcp-server.mjs` (role-scoped tools). (Verifier-as-MCP still open — see MULTI-WEEK.)
- [DONE] **OTel issue #23** — first customer feature shipped (`activegraph/observability/otel.py`, 652f07c).
- [DONE] **Brandon-A research packet** — on the dispatch hot path (`researchPacketFor`).
- [DONE] **Pullfrog self-hosted runner** — auth fixed (pt.13).
- [DONE] **Pancake gaps** — F1 daemon, Slack notifier (`factory-slack.mjs`), spend gates (Blake).
- [DONE] **Per-agent skills structure** — `agent-os/skills/` + `load-agent-skill.mjs`.
- [DONE] **T7 medium gate** — 25/25 honest. **T7 hard** — 20/25 (80% first-attempt, gate met).
- [DONE] **Reviewer dispatch (Theo/Rowan/Grace)** — parsers + Priya-MCP RLS unblock + tier wiring (pt.13-14).
- [DONE] **Autonomous-ship loop** — failure→todo→dispatch→fix→review→commit→PR→auto-merge (pt.18);
  merge path proven by a real merged PR (pt.20). Every failure is an event, CI-enforced (pt.18).
- [DONE] **Forge harness** — owned role profiles + permission gate + plugin tools (self-extending).
- [DONE] **Automated eval loop** — `auto-eval.mjs` + `friction-analyzer.mjs` (Lucas-style, automated).
- [DONE] **CLAUDE.md lean-rulebook split** (P21, pt.19). **Opus 4.8 effort routing** (pt.20, default-off).

## Genuinely remaining

### ⭐ The Referee Factory ladder (pt.22, 2026-05-29) — the priority track
The structural fix is built and proven ungameable (`scripts/referee-factory/`,
`frames/eval-reports/REFEREE-FACTORY-20260529.md`). Remaining toward "factory builds
net-new features autonomously across the WHOLE externally-defined ladder, not gamed":
- **Net-new builds under the referee at every tier.** Proven so far: easy (refereed snapshot fix) + a live blind-builder bug fix (medium-ish). Still to prove: a BLIND builder producing net-new medium/hard/extra-hard FEATURES (custom ontology+behaviors; relation behaviors + Cypher patterns + fork-and-diff; full Pack + babyagi-as-behaviors + Postgres EventStore) graded by the framework's own oracles + sealed holdouts.
- **More defect specs per tier** (drop-in `defects/*.mjs`) to get sample size > 1 per tier.
- **Adversary = challenge-test arbiter**: adversary proposes a test that must PASS on HEAD and FAIL on the fix to count (deterministic dominates LLM).
- **⭐ NORTH STAR (gated): Polsia-style autonomous agent company (https://polsia.com/).** Operator's ultimate dream — pursue ONLY after the ungameable ladder runs autonomously across all tiers. See memory [[polsia-north-star]]. Do NOT jump ahead.

### [OPERATOR] needs a human decision or external party — cannot finish solo
- **Per-token arbitrage SALE.** Cost side measured (2.28× cost-vs-price); a real *sale* needs a customer.
- **Grow judge ground-truth datasets** — needs operator-labeled examples (me grading my own work = anti-pattern).
- **Slack inbound one-tap approval** — needs a hosted webhook endpoint.
- **GTM / business validation** — revenue-gated.
- **`fixture-*` Supabase triage** + **`pentagon_watchdog_error` investigation** — need live DB/log + SQL/RPC.

### [LIVE-$] built + ready; just needs many paid runs
- **T7 hard → full 25** (20/25 now); **T7 extra-hard 25-run gate** (needs the 5-agent fire helper built first); **T8–T17** (task breadth + survivability — hundreds of runs).
- **Full 15-agent gauntlet wiring at scale** (Theo/Rowan/Grace dispatch-proven; the rest need ACK contracts + live runs).
- **Supervised `--effort max` hard dispatch** — the one test to flip pt.20 routing live.
- **First agent-driven autonomous ship** — the failure→fix half feeding the (now-proven) auto-merge.

### [MULTI-WEEK] solo-doable, dedicated runs
- **Extensibility refactor** — verifier/classifier monolith → drop-in `verifier/checks/<tier>.mjs`.
- **Dogfood rewrite** — rebuild the factory runtime on the activegraph package itself.
- **Verifier-as-MCP / ledger-as-MCP** — expose the remaining primitives externally.

### [CHEAP] small, no $ — next-session candidates
- **Brandon-B**: verifier check that the proof records ≥3 `candidates_considered` (template already collects it; add the gate + `satisfaction_of_search_risk` warning).
- **Brandon-D**: re-audit the verifier's frozen-evidence `requireText` checks (~lines 2166/2168/2201) for staleness.
- **Stable function ids** in proofs (`maya::implement_feature=<sha>`) + **explicit DRI field**.
- **`ghost_completion` lifecycle timing fields** in the classifier (`created_to_claim_seconds`, etc.).
- **Commit the lean CLAUDE.md** to git (now ~120 lines; journal/backlog/defects already tracked under agent-os/context/).
- **Codex TUI log rotation** (low priority — codex no longer load-bearing).

## Done items are NOT re-tracked here
If shipped (commit on a main + audit), it lives in `activity-log.md`, not here. This file is
decided-but-not-started only.
