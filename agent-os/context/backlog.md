# Open Backlog — active_graph dark factory

_Decided-but-not-started work. Moved out of CLAUDE.md in the P21 split (pt.19); RESOLVER-routed._

## Open backlog (incomplete todos)

Items the operator has explicitly queued but hasn't yet started. Ordered roughly by leverage, not by ease.

### Strategic / structural

- [ ] **Per-token arbitrage proof** before scaling AFK agents. Per IndyDevDan's 5-pillar framework (2026-05-27): "Buy a token for a dollar, run it through your business, sell the output for two — then scale it to the moon. Only AFTER you nail that arbitrage do you turn agents on 24/7." Currently the dark factory burns tokens with no output→revenue pipeline. Concrete first step: pick ONE output→revenue pipeline (e.g. "factory ships N activegraph issues per week for $X total compute"), measure cost-per-shipped-feature, verify the ratio. Until this number is positive, scaling agents 24/7 just compounds burn. Pre-requisite for Phase B (business validation) in the post-baseline roadmap.

- [ ] **Extensibility refactor of verifier + classifier.** Per IndyDevDan's Pillar 3 ("Open to extension, closed to modification"). Today: adding a new tier or new failure mode requires editing the central `verify-pentagon-autonomy-from-logs.mjs` (~1000 lines) or `t7-repetition-classifier.mjs` directly. Tomorrow it should be: drop a new file into `verifier/checks/<tier>.mjs` or `verifier/detectors/<mode>.mjs`, auto-discovered at import. Estimated 1-2 weeks of refactoring; worth it before T7 hard / extra-hard / T8+ to keep the friction-per-new-mode constant rather than growing.

- [ ] **Agent-first external surface (MCP exposure of dark-factory primitives).** Per IndyDevDan's Pillar 5 ("agents only command what they can programmatically reach"). Internal access is good (Pentagon→Supabase, Maya→shell, watchdog→osascript). External access is missing: the verifier isn't exposed as an MCP server, the gauntlet ledger isn't queryable via MCP, the classifier isn't a callable service. Expose these so OTHER agents (and eventually external customers) can call the dark factory's primitives. ~3-5 days Codex work per primitive. Stack-rank: verifier-as-MCP > ledger-as-MCP > classifier-as-MCP.


- [ ] **Rewrite the dark factory using activegraph itself (full dog-fooding).** Today the factory uses activegraph's **design patterns** (event sourcing, parent_id chains, replayable audit) but its actual runtime is `scripts/*.mjs` + Pentagon's Supabase tables — not the activegraph Python package. A stronger dog-food story is: rebuild the verifier + harness + audit chain ON TOP of activegraph itself, so activegraph's actual API has to handle the dark factory's real edge cases (5-agent chains, retry policies, shadow ACK resolution, worktree ground-truth checks). Surfaces every weakness in activegraph's public surface that a simulated customer wouldn't find. Decided 2026-05-26 in conversation while explaining "eats its own dog food."

- [x] **Run activegraph end-to-end with a deliberately-failing behavior to capture the first live `behavior.failed` event in this repo.** ✅ DONE 2026-05-27. `activegraph/examples/dark_factory_failure_event_demo.py` produces `evt_007: behavior.failed, reason=llm.network_error, behavior=will_fail` with full audit chain. First real `behavior.failed` event in repo history. No API keys, no network calls — pure framework dogfooding.
- [x] **`ClaudeCodeCliProvider` for activegraph — flywheel entry condition.** ✅ DONE 2026-05-27. `activegraph/activegraph/llm/claude_code_cli.py` implements LLMProvider Protocol against the local `claude` CLI (subprocess + stream-json parser + Claude Code OAuth keychain). Demo at `activegraph/examples/dark_factory_claude_code_provider_demo.py` shows full run: `goal.created → seed → llm.requested → llm.responded (claude-opus-4-7, REAL $0.32 + 6 in/6 out tokens + 8.56s latency) → behavior.completed → runtime.idle`. No `ANTHROPIC_API_KEY` required — same auth path the bridge uses. activegraph can now BE the dark factory's runtime, not just its product. Failures (429 / session limit / network error) emit as structured `behavior.failed` events with the same reason codes as `AnthropicProvider`. v1 scope: single-turn, no tools. Tool/MCP wiring is the v2 follow-up.
- [x] **All errors as events — full unification.** ✅ DONE 2026-05-27 (extended). Every error source now writes to the same JSONL log via one of two emitters: Node `scripts/factory-events.mjs` or Python `scripts/factory_events.py`. Sources wired: (1) bridge dispatch (claude_failed/codex_failed/llm.responded/behavior.completed via factory-events.mjs); (2) runner (dispatch_incomplete, no_trigger_row, agent.* via classifier); (3) helper (proof_missing); (4) **verifier `must()` failures emit `verifier.check_failed`** with the check name + detail; (5) **uncaught exceptions in any Node script** emit `script.crash` via `scripts/factory-crash-guard.mjs` (installed in bridge, runner, sasha, helper); (6) **Python `ClaudeCodeCliProvider`** errors emit `behavior.failed` AND successes emit `llm.responded` via lazy-loaded `factory_events.py`; (7) **Python `emit_script_crash` helper** for explicit Python exception capture. Single source of truth: `frames/factory-events.jsonl`. Query: `node scripts/factory-events-list.mjs --counts | --type X | --reason Y | --behavior Z | --since ISO`. Test events tagged `test=true` in extras for easy filtering.
- [x] **Factory event log — every dispatch (success and failure) emits activegraph-shaped events.** ✅ DONE 2026-05-27 (initial). `scripts/factory-events.mjs` writes activegraph-format JSONL to `frames/factory-events.jsonl`. Wired into:
  - Bridge `processCandidates()` — emits `llm.requested` before every subprocess, `llm.responded` (with real model/tokens/cost/latency from claude stream-json) + `behavior.completed` on success, `behavior.failed` with reason code on failure. Failure reasons: `llm.rate_limited` for 429, `llm.network_error` for timeouts/auth, `llm.provider_error` for codex failures.
  - Runner `run-native-pentagon-task.mjs` — emits `infrastructure.dispatch_incomplete`, `infrastructure.no_trigger_row`, and `behavior.failed reason=agent.*` when classifier rejects.
  - Helper `t7-medium-cohortB-fire.mjs` — emits `behavior.completed` for each gauntlet PASS and `infrastructure.proof_missing` when Maya never writes a proof.
  Backfilled 4 historical failures (run 028 Claude 429 + run 015×3 Codex credit) and 15 historical T7 medium cohort-B passes. Query via `node scripts/factory-events-list.mjs [--counts|--type X|--reason Y|--behavior Z|--since ISO|--tail N|--json]`. As of 2026-05-27 close: 19 events captured (15 completed / 4 failed / 100% gauntlet pass rate on opus-4.7 cohort). Reason codes match `AnthropicProvider`/`ClaudeCodeCliProvider` so cross-provider queries are uniform. Path forward: task #28 migrates bridge to use `ClaudeCodeCliProvider` so events become first-class activegraph events (currently activegraph-shaped JSONL); task #30 (Honker) would make the same file realtime-queryable for monitoring agents.

- [ ] **Ship activegraph issue #23 — OpenTelemetry Metrics implementation.** First real user-filed engineering task (Matt Van Horn, opened against `yoheinakajima/activegraph`). Adds `OpenTelemetryMetrics` alongside the existing `NoOpMetrics` + `PrometheusMetrics`. Scoped: new module `activegraph/observability/otel.py`, lazy-imports `opentelemetry-{api,sdk}`, new `[opentelemetry]` extra. Five design questions in the issue (gauge mapping, bucket strategy, scope-trace-too-or-not, naming, conformance test shape) — most are code-judgment calls the verifier can grade; question #3 (trace export scope) needs operator or Sofia-style spec decision first. Strategically: this is the first chance to demonstrate the dark factory shipping a customer-facing feature, not a synthetic gauntlet task. Different category of evidence than T6/T7. Likely scopable as a 5-agent chain run once Sofia locks the open questions. Backlog-added 2026-05-26.

### Org-chart integration (15 agents provisioned but unused)

Pentagon has 20 named agents configured (correct provider, model, harness, execution mode per T5R verifier check). T6/T7 gauntlets only route to 5 of them: Maya, Quinn, Sofia, Sam, Riley. The other 15 are provisioned and ready but have no instruction files / no triggers / no gauntlet wiring. The dark factory is running at 25% of its designed staff. Backlog-added 2026-05-26.

**Model assignment — ✅ DONE 2026-05-27.** All 20 active_graph Pentagon agents migrated to `provider=claude-code` / `model=claude-opus-4-7` / `harness_id=claude-code`. Forcing function was Codex CLI credit exhaustion. Bridge `runClaude()` shipped; cohort separated by date (see Active cohort section at top of this file). Verifier generalized to read `agent-os/agent-cohort.json` instead of hardcoded gpt-5.5 strings. Canary (Carmen) + smoke test (Theo) both green. The 15 unused agents still need gauntlet wiring (see priority list below) but are no longer blocked by the model question.

- [ ] **Wire Sasha (Spec Skeptic) into the gauntlet** — Claude is currently playing this role manually on every "independently verify Codex's claim" turn. Highest priority because the role is real and being done by hand. Connects to F2.0 (monitoring agent) — Sasha IS the monitoring agent in the existing org chart.
- [ ] **Wire Grace (Gate Sentinel)** — should have refused the dirty-edit commits on 2026-05-26 morning that required the audit cleanup. Currently Claude + operator do this. Catches "uncommitted load-bearing state" class of defects.
- [ ] **Wire Rowan (Code Reviewer)** — would have caught the `_RETRY_` regex contradiction in the goal file before Codex aborted three times. Reviews goal files + verifier diffs before they ship. Different from Quinn (Quinn tests Maya's code; Rowan reviews operator/Claude's specs).
- [ ] **Wire Taylor (Trace Archivist)** — currently Claude writes CLAUDE.md + frames/ docs by hand. Taylor is the agent who should be appending to the audit narrative after each gauntlet run.
- [ ] **Wire Theo (Test Owner)** — partly covered by the verifier; could explicitly own "did the test prove what it claims to prove" question, which the verifier checks structurally but doesn't grade for meaningfulness.
- [ ] **Wire Simone (Security Auditor)** — needed once T13 (adversarial inputs) begins; not urgent until then. Required for T13's adversarial-input gauntlet to be auditable by a security-named agent rather than the operator.
- [ ] **Wire Parker (Performance Sentinel)** — needed for T8 PERF family of tasks. Not urgent until T8.
- [ ] **Wire Casey (Compatibility Auditor)** — needed for T8 DEPRECATION + REFACTOR families.
- [ ] **Wire Carmen (Contract Owner)** — owns `agent-os/RELIABILITY_OPERATING_CONTRACT.md`-style documents. Currently operator + Claude.
- [ ] **Wire Avery (Frame Architect)** — designs new `frames/` document patterns. Currently Claude.
- [ ] **Wire Blake (Budget Marshal)** — partial overlap with planned F5 cost meter. Owns "is this run staying within token budget."
- [ ] **Wire Priya (Goal Reaper)** — currently the operator decides when a goal is complete vs blocked. Priya should automate this.
- [ ] **Wire T5d (Activation Engineer)** — partially obsoleted by `af57375` Pentagon watchdog. May not need a dedicated agent now.
- [ ] **Wire Finn (Fork Debugger)** — needs activegraph runs with forks before there's work to do. Not urgent.
- [ ] **Wire Ravi (Replay Validator)** — needs replay flows in production gauntlet runs before there's work to do. Not urgent.

**Rough priority order:** Sasha → Grace → Rowan → Taylor first (these four cover roles Claude is currently doing manually). Then Theo. Then Simone/Parker/Casey/Carmen/Avery as the relevant gauntlet tiers come up. Then Blake. Then the conditionally-needed agents (Priya, T5d, Finn, Ravi).

### Flywheel infrastructure (Phase F from the post-baseline roadmap)

- [ ] **F2.0 — Monitoring agent** that watches gauntlet runs and proposes verifier extensions when anomalies appear. Reinforced by YC talk's concrete YC-internal example. Highest near-term leverage piece; T7+ becomes self-improving with this in place.
- [ ] **F1 full — scheduled gauntlet daemon** that re-runs T6–T17 on cadence and writes outcomes to the event store. Watchdog (F1.0) from `af57375` is the minimal version; F1 proper is the daemon.
- [ ] **F4 — unified factory memory.** Generalize the SQLite self-audit pattern from T6-extra-hard into a queryable store every agent consults before acting.
- [ ] **F5 — cost meter** per shipped feature. Required precondition for T16 (unit economics).

### Pattern adoptions (from external sources, scoped)

- [ ] **Per-agent skills structure** — `agent-os/skills/<agent>/<capability>.md`. From iii's skills-as-installable-units pattern + YC talk's editable instructions.md per agent.
- [ ] **Stable function identifiers in proof files** — e.g. `maya::implement_feature=<sha>` instead of anonymous `agent_commit_sha`. From iii's Worker/Function/Trigger primitives. Tiny refinement.
- [ ] **Explicit DRI field in every proof** — "directly responsible individual" per the YC talk's IC-only org model. Implicit today; make explicit.
- [ ] **Brandon-A: pre-flight research packet for each agent trigger** (likely highest-leverage item in the backlog). From Brandon Walsenuk (Unblocked), AI Engineer 2026-05-26. At trigger time, generate a small packet for Maya/Quinn/Sofia: recent commits touching target file, recent failures in target test area, CLAUDE.md sections relevant to this task class, related conversations from Pentagon. Inject into the instruction file before dispatch. Brandon's evidence: 6× improvement (2.5h/20.9M tokens → 25min/10.8M tokens) same prompt+model+agent just by adding a context engine. Possibly larger gain than the model migration itself. Plausibly worth implementing BEFORE T7 medium resumes.
- [ ] **Brandon-B: "satisfaction of search" failure mode** — radiology term for "find one plausible answer, stop looking." Maya runs 008/014 may have exhibited this (picked first uncovered symbol that compiled, missed better targets). Action: name in `agent-os/RELIABILITY_OPERATING_CONTRACT.md`, add verifier check requiring Maya to record N≥3 candidate targets with rejection rationale, classify single-candidate runs as `satisfaction_of_search_risk` warnings. From Brandon Walsenuk video.
- [ ] **Brandon-C: verifier check for unread-source contradictions** — when Maya cites a pattern, verifier asks "any contradicting source unread?" Adds failure class `pattern_contradicted_by_unread_source`. Depends on Brandon-A's research-packet infrastructure (substrate). Lower priority than A.
- [ ] **Brandon-D: audit frozen historical evidence files for cache staleness** — Brandon's lesson 3: "the moment you write the docs they're invalid." The verifier's `requireText` checks at lines 2166/2168/2201 of `verify-pentagon-autonomy-from-logs.mjs` treat 2026-05-23 log files as immutable truth. Some claims in those logs (e.g. about Pentagon native poller behavior) have become false — we just proved native dispatch is silently non-functional. Re-audit each frozen file: still load-bearing? Still true? Should be reframed as historical-snapshot assertion explicitly? Should be regenerated? Or removed?
- [ ] **Pullfrog-style GitHub bot with Claude Code subscription (not API key)** — from https://www.infoq.com/news/2026/05/pullfrog-ai-github/. Pullfrog is an open-source AI-powered GitHub bot that automates code review via webhook→agent dispatch. Uses GitHub Actions + BYO API keys. Operator constraint: must use Claude Code MAX subscription, not API key. Cleanest path: self-hosted GitHub Actions runner on operator's Mac that inherits local `claude` CLI keychain auth and invokes claude exactly like the bridge's `runClaude()` does. ~1-2 days: webhook handler + dispatch wrapper. 80% of the code already exists from the 2026-05-27 migration.

### Pancake gaps (from getpancake.ai analysis 2026-05-27)

| # | What Pancake has, we don't | Backlog task | Effort |
|---|---|---|---|
| #21 | 24/7 daemon ("agent org runs 24/7 — no sick days") | F1 scheduled gauntlet daemon | Multi-week |
| #22 | Slack-native UI ("agents operate within Slack channels") | Slack webhook integration for ledger events + approvals | 1-2 days |
| #23 | Spend/scope approval gates ("one-tap human approval") | Wire Blake (Budget Marshal) to monitor costUSD aggregates and pause LaunchAgent at threshold | 1 day |

What the dark factory has that Pancake doesn't (worth keeping):
- T-tier verification ladder with statistical variance measurement
- Independent verifier grading agent outputs (Sasha-skeptic role)
- Multi-agent engineering workflow (Maya/Quinn/Sofia/Sam/Riley)
- Git/test-based proof artifacts

### Operational hygiene

- [ ] **Triage the `fixture-*` Supabase rows** from Codex's `b6c774c` self-test. REST queries can't search them due to UUID column constraints; needs SQL/RPC access.
- [ ] **Codex TUI log rotation.** `~/.codex/log/codex-tui.log` grew to 1.03 GB in 4 hours on 2026-05-25. Same failure-mode shape as the SQLite `logs_2.sqlite` blow-up before that.
- [ ] **Commit CLAUDE.md to git** so it survives across machines (currently untracked).
- [ ] **Annotate `ghost_completion` ledger entries with lifecycle timing fields** — `created_to_claim_seconds`, `claim_to_complete_seconds`, `watchdog_restart_during` (bool). The T7-medium-run-008 diagnostic (2026-05-27) showed that ghost_completion currently conflates two sub-patterns: (a) fast claim+complete without dispatch (12-17s wall) and (b) Pentagon stall → watchdog restart → claim+complete without dispatch (93-94s wall). They share post-claim DB shape but diverge in lifecycle timing. Recording these fields would let future diagnostics discriminate sub-patterns automatically without operator investigation. ~2h Codex work to extend the classifier output schema + harness retry annotation. Backlog-added 2026-05-27.
- [ ] **Investigate `pentagon_watchdog_error` events.** The Pentagon poller watchdog from `af57375` is itself throwing errors during its restart attempts (multiple `pentagon_watchdog_error` rows in `~/.pentagon/trigger-bridge.err.log`). This is a meta-defect: the recovery mechanism has its own failure mode. The watchdog still "completes" the restart sometimes (Pentagon eventually gets back to claiming triggers), but the failures suggest the watchdog isn't fully recovering Pentagon state in some cases — directly relevant to the T7-medium-run-008 ghost_completion exhaustion where watchdog auto-restart didn't unblock the target. Pre-requisite for relying on the watchdog at higher T7 tiers. Diagnostic-first goal: read all `pentagon_watchdog_error` entries, categorize, hypothesize root cause, propose remediation. Backlog-added 2026-05-27.

### Capability ladder (sequenced after current T7 easy)

- [ ] T7 medium (25 runs)
- [ ] T7 hard (25 runs, dual-agent with Quinn at scale)
- [ ] T7 extra-hard (25 runs, 5-agent chain at scale)
- [ ] T8 (task breadth: bugfix/perf/security/dep/refactor/feature × 5 each)
- [ ] T9, T10, T11, T12 per the reliability spec
- [ ] T13–T17 per the survivability spec

### Done items are NOT tracked here

If it's already shipped (commit on origin/main with audit), it lives in "Verifier hardening history" or the Activity Log, not in this list. This section is for things that have been DECIDED to do but not yet STARTED.

