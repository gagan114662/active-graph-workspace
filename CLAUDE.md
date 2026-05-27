# Claude Context — active_graph Dark Factory

**Last updated:** 2026-05-27 (late morning, after model migration to opus-4.7/claude-code)
**Maintained by:** Claude. The user updates lightly; the agent updates after each working session.

## Active cohort

As of 2026-05-27 all 20 active_graph Pentagon agents run on the **opus-4.7-claude-code-2026-05-27** cohort:

- provider: `claude-code`
- model: `claude-opus-4-7`
- harness_id: `claude-code`
- Pentagon default model: `claude-opus-4-7[1m]` (note `[1m]` suffix for 1M-context variant)

Canonical source of truth: `agent-os/agent-cohort.json`. The verifier reads it via `loadCohortExpectations()` and checks live DB rows against it. Pre-migration snapshots: `/tmp/active-graph-agents-pre-migration.json`. Post-migration: `/tmp/active-graph-agents-post-migration.json`. Bulk migration log: `frames/migrations/bulk-20260527.jsonl`.

**Cohort separation for variance measurement:**
- T6 sample 1 (easy/medium/hard/extra-hard), T7 easy, and T7 medium runs 001-014 = **gpt-5.5-codex-2026-05-22 cohort**.
- T7 medium runs 015+ onwards, T7 hard/extra-hard, T8+ = **opus-4.7-claude-code-2026-05-27 cohort**.
- Sample sizes do not mix across cohorts.

## If you're a fresh Claude session, read this first

You're working on a "dark factory" project — autonomous, auditable software production. The user is building this seriously, not as a demo. Today's discipline has been: refuse soft-fails, verify independently, never let the verifier lie.

Before doing anything substantive in this repo:

1. Read this whole file
2. Run `git log --oneline -30` in both the outer repo (this dir) and `git -C activegraph log --oneline -10` for the inner repo
3. Read `scripts/verify-pentagon-autonomy-from-logs.mjs` — this is the heart of the system
4. Glance at `frames/t6-real-autonomy-gauntlet-2026-05-23.md` — the T6 spec
5. Check `frames/` for recent `.log` and `.proof` files to see current state
6. Update this file at the END of any working session (the bottom has an Activity Log section)

Don't trust this file as the ground truth — verify with git/file system. But use it as the bootstrap.

## What this project is

**Goal:** Prove that AI agents can produce production-ready, bug-free software autonomously with full auditability. The system is "dark factory" — agents do engineering work, a verifier independently confirms each result, an event store records every step.

**The bet:** the discipline of building real verification (not the model itself) is the moat.

## Repository layout

Two nested git repos:

- **Outer repo** (this directory, `/Users/gaganarora/Desktop/my projects/active_graph/`):
  - `scripts/` — orchestration (verifier, runner, bridge)
  - `frames/` — instruction files, proof files, evidence logs, spec docs
  - `agent-os/` — contracts and skills
  - `activegraph/` — link/dir to the inner repo (do NOT commit inner-repo files into outer)
- **Inner repo** at `activegraph/.git/`:
  - The actual Python package (`activegraph/` package source + `tests/`)
  - Maya's engineering commits live here
  - Has its own remote, distinct from outer

When using git, **always specify `-C activegraph`** for inner-repo operations. The verifier's worktree-based checks operate on the inner repo via `git -C activegraph worktree add /tmp/...`.

## The T-tier ladder

| Tier | Proves | Status |
|---|---|---|
| T6 (capability) | Factory can do real engineering once per task class | **easy ✅ medium ✅ hard ✅ extra-hard ✅ — all 4 sub-tiers cleared at sample 1** |
| T7 easy (reliability sample) | Easy tier is repeatable at scale | **measured 2026-05-26: 27 attempts (25 fresh + 2 validation retries per `a069a91`), 21 pass, 1 agent fail, 5 infra retries. Agent-attributed pass rate=95.5% (21/22). Infrastructure failure rate=18.5% (5/27). Raw 23/25 gate missed on the original 25 (19); validation retries pushed total passes to 21. Honest agent-rate gate exceeded. Production validation confirms classifier+retry integration; Pentagon's auto-recovery-on-retry path under stress is NOT yet stress-tested (today's retries passed first try).** |
| T7 medium / hard / extra-hard | Reliability at higher complexity tiers | ⏸ not started; ~75 more runs total. Pentagon ~84% infra reliability is the real ceiling. |
| T8–T12 (reliability ladder) | Generalization beyond easy tier | ⏸ not started; spec in `frames/t7-t12-scale-reliability-gauntlet-2026-05-23.md` |
| T13–T17 (survivability) | Factory survives attacks, incidents, makes money, stays current | ⏸ not started; spec in `frames/t13-and-beyond-factory-survivability-2026-05-23.md` |
| Post-baseline | Flywheel + business validation | spec in `frames/post-baseline-flywheel-roadmap-2026-05-23.md` |

**Honest sample sizes: T6-easy=1, T6-medium=1, T6-hard=1, T6-extra-hard=1.** All four sub-tiers honestly green. **T6 capability ladder is now complete at sample 1.** Sample 1 ≠ reliability — T7 is the first tier that measures variance.

## Critical files

| File | What it is |
|---|---|
| `scripts/verify-pentagon-autonomy-from-logs.mjs` | The verifier. Has modes `--t6 --tier={easy,medium,hard}`, `--t6-debug-events`. ~900+ lines. PASS/FAIL via `must()`, WARN is advisory, `--no-db` skips DB queries. |
| `scripts/run-native-pentagon-task.mjs` | Triggers an agent gauntlet task and waits for a proof file. |
| `scripts/pentagon-trigger-bridge.mjs` | The bridge between outer-repo orchestration and Pentagon desktop app. |
| `frames/t6-real-autonomy-gauntlet-2026-05-23.md` | T6 spec |
| `frames/t6-native-{easy,medium,hard}-*-instruction-20260523.txt` | Maya/Quinn instruction files used at runtime |
| `frames/t6-{easy,medium,hard}-proof-fixture-{good,bad}*.txt` | Verifier self-test fixtures |
| `activegraph/frames/t6-native-gauntlet-{tier}-20260523.proof` | Real proof files from agent runs |
| `agent-os/AGENT_IDENTITY_MAP.md` | Org chart of named agents (Maya, Quinn, Sasha, Sofia, Grace, Riley, Sam, etc.) |
| `agent-os/RELIABILITY_OPERATING_CONTRACT.md` | Operating contract the agents follow |

## Discipline rules that NEVER bend

1. **Verify independently before greenlighting** — never trust an agent's self-report. Re-run the verifier yourself.
2. **No-pipe exit-code capture** — `cmd > /tmp/out 2>&1; echo "exit=$?"`. Piping kills the exit code. I've been bitten by this 3+ times today; don't repeat the mistake.
3. **Never loosen the verifier to make a check pass** — always either tighten the check or pivot to a principled-rule reframe. This is T5R's failure mode at scale.
4. **No destructive operations without explicit user authorization** — no `git reset --hard`, no `rm -rf`, no force-completing rows in Supabase without recording the action.
5. **Sample size 1 ≠ reliability** — never call a tier "graduated" from one passing run. T7's job is to measure variance.
6. **Activation bottleneck is systemic** — Pentagon poller desync, 4 occurrences. Fix = poller restart. Permanent fix = Phase F1 watchdog. Don't treat each occurrence as transient.
7. **`agent_runtime_events` is empty** for these workflows — audit via `messages.ACK` instead. The WARN line for runtime events is advisory.
8. **Quinn inter-agent dispatch is operator-driven** for sample 1 — Maya does not auto-trigger Quinn yet. That's T7+ work.

## Verifier hardening history (today's commits, outer repo)

Read these to understand what patterns the verifier already encodes:

| Commit | What it fixed |
|---|---|
| `c4edfdc` | Initial `--t6 --tier=easy` verifier mode + fixtures |
| `186eaff` | Tightened easy: exit code, agent_commit_sha check, ruff scope, pytest non-regression |
| `fae5058` | Restored non-zero exit on FAIL (regression from 1cf98fb) |
| `1cf98fb` | Pivoted audit from nonexistent `agent_runtime_events` kind to `messages.ACK` |
| `89c3498` | Path-variants resolver: accept proof at `frames/...` OR `activegraph/frames/...` |
| `7b528d1` | T6 medium preamble: verifier mode + fixtures |
| `5b47e80` | Resolve inner test path variants after T6-medium real run |
| `e918846` | T6 hard preamble: verifier mode + worktree-based ground truth + fixtures |
| `147b042` | Activation fix: documented Pentagon poller restart |
| `c1c2603` | **Critical** — pytest worktree must use `.venv/bin/python -m pytest`, never `uv run pytest` (global-leak fix) |
| `b6c774c` | Principled retry-aware ACK rule — canonical trigger (claimed_at < completed_at + agent message in convo) + ACK-within-trigger duplication handled (identical → kept-latest + WARN; differing → FAIL "ACK contradiction") |
| `a9b6054` | **WARN labels carry `[leg="...", agent="...", agent_id=...]` for multi-leg audit clarity. Also: removed 24h rolling window from ACK + canonical-trigger queries — regrades are now reproducible across time. Optional `--since <iso>` flag for performance.** |
| `af57375` | **Phase F1.0 — Pentagon poller watchdog in pentagon-trigger-bridge.mjs. Detects unclaimed-too-long triggers (>60s) and auto-restarts Pentagon.app via osascript/kill+open. 5-minute cooldown. Activation bottleneck is now self-healing (Pentagon no longer needs manual restart on desync).** |
| `0d9a68a` | T6 extra-hard preamble — `--tier=extra-hard` verifier mode + 5-agent instruction templates (Sofia/Maya/Quinn/Sam/Riley) + 4 fixtures (good + 3 bad). Inner repo: `t6-extra-hard-fixture-branch`. |
| `7846b88` | **T6 extra-hard LIVE run (sample 1) — 5-agent chain completed end-to-end. Inner branch `t6-extra-hard-live-run-20260525` has Sofia spec → Maya impl → Quinn adversarial tests → Maya fix → Sam docs. Verifier: 15/15 + 6 documented WARNs (4 shadow triggers + 1 shadow ACK + 1 advisory). Local SQLite self-audit store emerged organically (primitive Phase F4).** |

## Known gaming holes in the verifier (T11 backlog)

1. `agent_commit_sha` can be any pre-existing commit (medium hole — *partly* mitigated by hard's timestamp-after-trigger check; not yet mitigated for medium)
2. `uncovered_symbol` could be a substring of test names rather than a real Python symbol (medium hole — *partly* mitigated by hard's AST resolution; not yet in medium)
3. `pytest_collect_before` trusted blindly (medium hole — verifier doesn't re-checkout parent commit)
4. `bug_source` checked at fix_commit / HEAD, not at parent of failing_test_commit (hard hole — agent could add the bug source in the fix commit itself)

These do **not** block T6 graduation but **must** be closed before T7 scale (25× per tier).

## Known factory defects

| Defect | Recurrences | Workaround | Real fix |
|---|---|---|---|
| **Pentagon native trigger poller is silently non-functional** for active_graph workspace | Always — **architectural truth, not intermittent defect** | Bridge IS the dispatch path. When bridge dies, all agents stop being dispatchable. | Bridge LaunchAgent + watchdog already handle this; native poller appears to be dead code path for this workspace. F1 daemon (backlog) should pre-empt bridge death. |
| Codex CLI credit exhaustion masquerading as `ghost_completion` | T7 medium run 015 ×3 attempts (2026-05-27) | Buy credits OR migrate cohort off codex (done 2026-05-27 — claude-opus-4-7) | Cohort migrated to claude-code; codex billing no longer load-bearing for active_graph |
| **Claude Code MAX session limit** (HTTP 429 "You've hit your session limit · resets HH:MM (America/Toronto)") | T7 medium cohort-B run 028 (2026-05-27 ~18:11Z, after ~12 prior Maya dispatches + this session's chat) | Wait for reset window (~3h cycle on MAX), OR temporarily route triggers through a separate Anthropic account, OR use Codex CLI if credits available, OR use API key with usage-based billing | Long-term: per-token arbitrage proof (backlog) before scaling AFK agents. Brandon-A research packet would also stretch budget further. |
| **Bridge orphans trigger rows on `claude_failed`** (rate limit, auth fail, timeout) — claimed_at=set, completed_at=null forever | Run 028 trigger 7da34d4a (2026-05-27) | Manually mark completed via complete_agent_trigger RPC, OR ignore (no harm to other runs) | Task #25 backlog: on claude_failed, either complete the row with `bridge_failure_reason` or release the claim so retry works |
| Pentagon poller desync (legacy entry — superseded by row above) | 4+ (Sat–Mon), but **now auto-healing** | Watchdog auto-restarts Pentagon when triggers go unclaimed > 60s | ✅ **Built in `af57375`** — Phase F1.0 watchdog |
| Pentagon `message_poller_no_trigger_row` (silent trigger-row skip) | T7 easy runs 014, 016 — ~8% of native instructions | Runner classifier converts to `infrastructure_retry`; harness retries with fresh hash/seed | Pentagon-side; not yet investigated |
| Pentagon "ghost completion" (claim+complete recorded, no work output) | T7 easy run 017 (10.6s claim window, no proof, no hash-bearing responses) | ✅ Now classified per `856692b` — `outcome_class=infrastructure_retry`, `infrastructure_failure_root_cause=ghost_completion`. Retried by harness. | Pentagon-side root cause still upstream work |
| Pentagon "no-trigger timeout" (no trigger row registered before runner deadline) | T7 easy run 022 | ✅ Now classified per `856692b` — `outcome_class=infrastructure_retry`, `infrastructure_failure_root_cause=no_trigger_timeout`. Retried by harness. | Pentagon-side root cause still upstream work |
| Runner deadline shorter than Pentagon work window | T7 easy run 019 (transport timeout reported, but Pentagon completed and verifier found ACK) | Verifier still passes if work landed; runner just reports false transport error | Increase runner deadline / make it adaptive; needs `scripts/run-native-pentagon-task.mjs` config bump |
| `agent_runtime_events` empty for gauntlet runs | Every run | Audit via `messages.ACK` | Phase F1 instrumentation work (not built) |
| Pentagon long-running sessions silently degrade (39h stale → bottleneck) | 1 confirmed (2026-05-25) | Force-quit + relaunch (+ archive bloated logs) | Watchdog from `af57375` should pre-empt this; verify under load during T7 |
| Codex TUI log lacks rotation (`~/.codex/log/codex-tui.log` grew to 1 GB in 4h) | 1 confirmed | Manual archive at threshold; replace with rotated path in Codex config | Configure log rotation in Codex CLI; file upstream issue |
| Codex auth refresh-token reuse trap (rotating tokens; parallel sessions kill each other) | 1 confirmed | `codex logout` + `codex login` to re-issue; run only one Codex CLI at a time | Use a single active Codex session per account; consider running Codex behind a session lock |
| `/tmp/` worktree leaks (≈12 lingering) | Accumulating from prior sessions | One-liner cleanup: `git -C activegraph worktree list --porcelain \| awk '/^worktree \/private\/tmp\// {print $2}' \| xargs -I{} git -C activegraph worktree remove {} --force` | Verifier already cleans its own new worktrees |
| Inner repo modified files (CHANGELOG, CONTRACT, README) + unpushed commits | Pre-existing state | Operator hygiene | Periodic sync |
| Supabase has `fixture-*` ID rows from Codex's b6c774c self-tests | Permanent | Ignore in queries by filtering name LIKE 'fixture-%' | Add a fixture marker column and operator-driven cleanup |
| Second canonical T6-hard trigger (`048c4bb6`) exists beyond the f106eabf we worked on | Unknown | Verifier handles via shadow-trigger WARN | Investigate origin in next session |

## The user

- **Email:** gagan@getfoolish.com
- **Building:** the dark factory described above
- **Working style:** long sessions (12+ hours), heads-down, demands real verification not narrative wins
- **Demonstrated behavior:** repeatedly catches soft-fails, refuses to push through, treats each defect as a real finding
- **Tool stack:** Codex CLI is the agent runtime; Pentagon.app is the desktop orchestrator; Supabase is the event store
- **Other personal config:** uses `but` (GitButler CLI) instead of raw `git` for commits (per global memory); uses gstack workflow tools (separate from this project)
- **Note:** the user does NOT want `git commit` to be invoked manually by Claude after a task — GitButler hooks handle commits. Per global instructions.

## Decisions logged

- **2026-05-23**: Chose principled retry-aware ACK rule over either strict-but-failing or loose. (See verifier hardening history for the in-progress commit.)
- **2026-05-23**: Chose Operator-driven Quinn dispatch for sample 1; agent-to-agent auto-dispatch deferred to T7+.
- **2026-05-23**: Chose to STOP after T6-hard if activation bottleneck recurs a 5th time (rule applied selectively).
- **2026-05-23**: Path-resolution layout differs by perspective — verifier uses inner-repo-relative paths (`activegraph/...`) when running `git -C activegraph`. Codex's adjustment in `89c3498` was correct.
- **2026-05-25**: Bundled WARN polish + 24h-window removal into one commit (`a9b6054`) — same lookup helper, splitting would leave a broken intermediate HEAD.
- **2026-05-25**: Adopted `/goal` mode for goal-shaped Codex tasks (preamble, watchdog, well-bounded infrastructure). NOT for multi-agent gauntlet runs (those stay operator-orchestrated).
- **2026-05-25**: Established `frames/codex-goals/` convention for long `/goal` prompts that exceed Codex's 4K inline limit. Naming: `<short-task-name>-goal-<YYYYMMDD>.md`.
- **2026-05-25**: Accepted Pentagon poller watchdog (Phase F1.0) as a prerequisite to T7 scale — running 25× per tier without auto-recovery would be punishing.
- **2026-05-25**: Identified per-agent standing-instructions pattern (slide from external talk) as worth adopting; queued behind T7 prep work. Not urgent.
- **2026-05-25**: Watched YC partner talk "How to Build a Self-Improving Company with AI" (https://www.youtube.com/watch?v=t-G67yKAHBQ). Adopted 4 ideas as backlog: (1) "monitoring agent watches gauntlet runs and proposes verifier extensions" = F2.0 made concrete; (2) per-agent diarization of learnings into standing instructions; (3) record-everything-that-the-AI-must-learn-from (extends SQLite self-audit pattern that emerged in T6-extra-hard); (4) explicit DRI field in every proof. **Rejected:** burn-tokens-not-headcount (operator is one-person), middle-management-gone (N/A), user-manual-auto-regen (not the bottleneck). Talk frames the 5-layer AI loop: sensor / policy / tool / quality gate / learning. Dark factory is strong on tool+quality gate, weak on sensor+learning. Learning is the flywheel gap.
- **2026-05-25**: Reviewed github.com/iii-hq/iii (Worker/Function/Trigger runtime). Decided NOT to adopt the engine (re-platforming cost, Pentagon works). Adopted 4 conceptual patterns: (1) stable function identifiers in proof files (e.g. `maya::implement_feature=<sha>` vs anonymous `agent_commit_sha`); (2) skills-as-installable-units in `agent-os/skills/<agent>/<capability>.md` structure; (3) "workers can spawn workers" reinforces F2.0 (monitoring agent should be able to request new tools when agents hit gaps); (4) trace-everything-by-default reinforces F4 — current audit lives in 5 silos (Supabase messages, agent_triggers, git outer, git inner, local SQLite); the SQLite pattern from T6-extra-hard is the right shape, generalize it to capture every gauntlet run's full trace.
- **2026-05-27**: **Cohort migration to opus-4.7/claude-code.** Forcing function: Codex CLI account credit exhaustion blocked T7 medium runs 015+, masquerading as Pentagon `ghost_completion`. Operator chose Option 3 (full migration now) over Option A (buy credits + defer). Canary first: Carmen migrated; v1 trigger sat unclaimed (proving Pentagon native dispatch silently non-functional); v2 with bridge `runClaude()` succeeded. Bulk migrated remaining 19 agents. Smoke test on Theo confirmed. Cohort sample sizes do NOT mix across the boundary — T6 sample 1 / T7 easy / T7 medium runs 001-014 remain pinned to the gpt-5.5-codex-2026-05-22 cohort; T7 medium 015+ / T7 hard / etc. start measuring on opus-4.7-claude-code-2026-05-27.
- **2026-05-27**: Watched Brandon Walsenuk (Unblocked) — "Stop babysitting your agents..." (AI Engineer, 18:54). Adopted 4 backlog items: (A) pre-flight research packet for each agent trigger — Brandon's 6× improvement evidence (same model + same prompt) is the strongest leverage finding in any external video we've reviewed; possibly larger gain than the model migration itself. (B) "satisfaction of search" as a named failure mode (radiology term: stop searching after first plausible find). (C) conflict-resolution verifier check for unread-source contradictions. (D) audit the verifier's frozen historical evidence files for cache staleness — Brandon's lesson 3 says cached "correct" answers go stale, and we just proved Pentagon-native-poller assertions in those frozen logs are no longer true.

## What I (Claude) commit to

- Play **Sasha-skeptic by proxy** when adversarial agents aren't yet integrated. Read the diff. Read the test bodies. Don't just trust the verifier output.
- **Re-verify everything** the user reports back from Codex, using independent commands.
- **Update this file** at the end of every working session — append to the Activity Log, update the T-tier scoreboard, add new gaming holes to the backlog.
- **Flag any backsliding** toward T5R-style "passing through transcription" — the whole point of this project is to not do that.

## Open backlog (incomplete todos)

Items the operator has explicitly queued but hasn't yet started. Ordered roughly by leverage, not by ease.

### Strategic / structural

- [ ] **Per-token arbitrage proof** before scaling AFK agents. Per IndyDevDan's 5-pillar framework (2026-05-27): "Buy a token for a dollar, run it through your business, sell the output for two — then scale it to the moon. Only AFTER you nail that arbitrage do you turn agents on 24/7." Currently the dark factory burns tokens with no output→revenue pipeline. Concrete first step: pick ONE output→revenue pipeline (e.g. "factory ships N activegraph issues per week for $X total compute"), measure cost-per-shipped-feature, verify the ratio. Until this number is positive, scaling agents 24/7 just compounds burn. Pre-requisite for Phase B (business validation) in the post-baseline roadmap.

- [ ] **Extensibility refactor of verifier + classifier.** Per IndyDevDan's Pillar 3 ("Open to extension, closed to modification"). Today: adding a new tier or new failure mode requires editing the central `verify-pentagon-autonomy-from-logs.mjs` (~1000 lines) or `t7-repetition-classifier.mjs` directly. Tomorrow it should be: drop a new file into `verifier/checks/<tier>.mjs` or `verifier/detectors/<mode>.mjs`, auto-discovered at import. Estimated 1-2 weeks of refactoring; worth it before T7 hard / extra-hard / T8+ to keep the friction-per-new-mode constant rather than growing.

- [ ] **Agent-first external surface (MCP exposure of dark-factory primitives).** Per IndyDevDan's Pillar 5 ("agents only command what they can programmatically reach"). Internal access is good (Pentagon→Supabase, Maya→shell, watchdog→osascript). External access is missing: the verifier isn't exposed as an MCP server, the gauntlet ledger isn't queryable via MCP, the classifier isn't a callable service. Expose these so OTHER agents (and eventually external customers) can call the dark factory's primitives. ~3-5 days Codex work per primitive. Stack-rank: verifier-as-MCP > ledger-as-MCP > classifier-as-MCP.


- [ ] **Rewrite the dark factory using activegraph itself (full dog-fooding).** Today the factory uses activegraph's **design patterns** (event sourcing, parent_id chains, replayable audit) but its actual runtime is `scripts/*.mjs` + Pentagon's Supabase tables — not the activegraph Python package. A stronger dog-food story is: rebuild the verifier + harness + audit chain ON TOP of activegraph itself, so activegraph's actual API has to handle the dark factory's real edge cases (5-agent chains, retry policies, shadow ACK resolution, worktree ground-truth checks). Surfaces every weakness in activegraph's public surface that a simulated customer wouldn't find. Decided 2026-05-26 in conversation while explaining "eats its own dog food."

- [x] **Run activegraph end-to-end with a deliberately-failing behavior to capture the first live `behavior.failed` event in this repo.** ✅ DONE 2026-05-27. `activegraph/examples/dark_factory_failure_event_demo.py` produces `evt_007: behavior.failed, reason=llm.network_error, behavior=will_fail` with full audit chain. First real `behavior.failed` event in repo history. No API keys, no network calls — pure framework dogfooding.
- [x] **`ClaudeCodeCliProvider` for activegraph — flywheel entry condition.** ✅ DONE 2026-05-27. `activegraph/activegraph/llm/claude_code_cli.py` implements LLMProvider Protocol against the local `claude` CLI (subprocess + stream-json parser + Claude Code OAuth keychain). Demo at `activegraph/examples/dark_factory_claude_code_provider_demo.py` shows full run: `goal.created → seed → llm.requested → llm.responded (claude-opus-4-7, REAL $0.32 + 6 in/6 out tokens + 8.56s latency) → behavior.completed → runtime.idle`. No `ANTHROPIC_API_KEY` required — same auth path the bridge uses. activegraph can now BE the dark factory's runtime, not just its product. Failures (429 / session limit / network error) emit as structured `behavior.failed` events with the same reason codes as `AnthropicProvider`. v1 scope: single-turn, no tools. Tool/MCP wiring is the v2 follow-up.
- [x] **Factory event log — every dispatch (success and failure) emits activegraph-shaped events.** ✅ DONE 2026-05-27. `scripts/factory-events.mjs` writes activegraph-format JSONL to `frames/factory-events.jsonl`. Wired into:
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

## Activity log

### 2026-05-23 — Marathon session (~16 hours)

**Started with:** T5R passed 344/344 with transcription-grade tasks. User asked for honest engineering tests.

**Built:**
- 4 spec docs (T6, T7–T12, T13–T17, post-baseline roadmap)
- T6 verifier modes for easy, medium, hard
- 2 instruction files for hard (Maya + Quinn) — first multi-agent flow
- Hardened the verifier 4 times (see commit table)

**Surfaced 6 real defects:**
1. T5R was transcription dressed as engineering
2. Bad fixtures exited 0 (soft-fail)
3. Audit was looking for nonexistent `agent_edit` event kind
4. Activation bottleneck (4 recurrences, degrading)
5. `agent_runtime_events` empty (known gap)
6. Pytest worktree leaking to global Python install (critical — invalidated T6-hard's first signal)

**Proved (sample size 1 each):**
- T6-easy honestly green
- T6-medium honestly green
- T6-hard engineering green + Quinn verified green; audit pending principled retry rule

**Open at end of session:**
- T6-extra-hard not started (5-agent chain: Sofia → Maya → Quinn → Sam → Riley)
- Maya double-ACKed in one turn — root cause not investigated
- Supabase `fixture-*` rows from b6c774c need cleanup or tagging
- Second canonical T6-hard trigger `048c4bb6` not yet traced

**Next session opens with:**
1. Trace the `048c4bb6` canonical trigger — confirm no surprise re-runs
2. Decide whether to clean up `fixture-*` Supabase rows from b6c774c
3. Begin T6-extra-hard preamble OR pause for Phase F1 (activation watchdog) work first

---

### 2026-05-24 — Closing T6-hard (post-sleep, hour 17ish)

**Built:**
- Principled retry-aware ACK rule (commit `b6c774c`) — splits trigger-level retries (`shadow trigger present` WARN) from ACK-level duplication within one trigger (`shadow ACKs in canonical trigger` WARN). Catches: ACK contradiction (different canonical fields → FAIL), no canonical ACK (FAIL).
- 3 new fixtures: `duplicate-identical-acks`, `bad-ack-contradiction`, `bad-no-canonical-ack`.

**Surfaced:**
- Codex's `RULE_INSUFFICIENT` response — exemplary discipline; refused to implement a rule that didn't cleanly discriminate on real data, returned the live DB shape for re-reasoning.
- Reframing: the "stuck" trigger `f106eabf` was actually the real-work trigger (4m50s work window); the "retry" `845ee943` was force-marked completed before Maya could pick it up.
- Maya double-ACKed in one turn: 22:00:47Z and 22:02:30Z, same conversation, identical content — root cause unknown (Pentagon resend? agent self-retry?).
- Codex's fixtures inserted `fixture-*` ID rows directly into production Supabase tables — works for testing but creates audit-trail noise.

**Closed:**
- T6-hard final grade: 16/16, exit 0, verdict `t6_hard_verified`, with shadow ACK + shadow trigger WARNs recording the pollution honestly.
- T6 capability ladder: 3 of 4 sub-tiers honestly green at sample 1.

---

### 2026-05-25 — T6 capability ladder complete + activation bottleneck self-healing (longest day yet, ~10h)

**Built:**
- **WARN label polish + 24h window removal** (`a9b6054`) — every WARN now carries `[leg="...", agent="...", agent_id=...]`. ACK + canonical-trigger queries no longer use a rolling time window — grades are reproducible across time (T7's required invariant).
- **Pentagon poller watchdog** (`af57375`) — bridge auto-detects unclaimed-too-long triggers (>60s), force-quits Pentagon, relaunches, enforces 5-min cooldown. Activation bottleneck is now self-healing. Production log shows watchdog has already auto-restarted Pentagon 5+ times during Codex's own self-test rounds. Constants: `PENTAGON_WATCHDOG_STUCK_AGE_SECONDS=60`, `PENTAGON_WATCHDOG_COOLDOWN_SECONDS=300`.
- **T6 extra-hard preamble** (`0d9a68a`) — `--tier=extra-hard` verifier mode + 5 instruction templates + 4 fixtures + inner-repo `t6-extra-hard-fixture-branch` with synthetic 5-stage chain. 430-line verifier addition.
- **T6 extra-hard LIVE run** (`7846b88`) — 5 real agents (Sofia → Maya → Quinn → Maya-fix → Sam) shipped a real feature (`activegraph events tail` CLI) in inner branch `t6-extra-hard-live-run-20260525`. Maya wrote 7 tests, mkdocs strict 0, ruff 0. Local SQLite self-audit store (`frames/t6-extra-hard-self-audit-20260525.sqlite`) emerged organically with proper schema (events / runs / meta tables + indexes) — primitive Phase F4 in the wild.

**Surfaced (defects):**
- **Pentagon ran 39h stale.** Caused Codex MCP handshake failures + JWT-expired errors flooding bridge logs. Cleanup: force-quit Pentagon + archive 1 GB stale TUI log + LaunchAgent auto-respawned bridge cleanly. Future watchdog should pre-empt the 39h-stale pattern under load.
- **Codex TUI log lacks rotation** — `~/.codex/log/codex-tui.log` grew to 1.03 GB in 4 hours. Same failure-mode shape as the SQLite `logs_2.sqlite` blow-up from session 1. Manual archive used as workaround.
- **Codex OAuth refresh-token reuse trap** — parallel Codex CLI sessions race on token refresh; whoever loses gets permanently rejected. Fixed by `codex logout` + `codex login`; lesson is "one Codex session per account."
- **Bridge `uv run pytest` global-leak** carried through to Quinn's instruction file — would have produced false QUINN_REJECT signals. Patched Quinn's instruction in place to use `.venv/bin/python -m pytest` per `c1c2603`.
- **Heavy activation retries during the live extra-hard run** — Sofia had 3 triggers, Maya impl had 5, Quinn had 2, Sam had 2 + 2 ACKs. All absorbed by the principled retry rule as documented shadow WARNs. Real test of the rule under load; passed.

**Closed:**
- T6-extra-hard final grade: 15/15, exit 0, verdict `t6_extra_hard_verified`, with 6 documented WARN lines (audit-correct under pollution).
- **T6 capability ladder: all 4 sub-tiers honestly green at sample 1.** First ever end-to-end multi-agent dark-factory run with audit chain on this project.
- Activation bottleneck closed at the infrastructure level (watchdog auto-recovers).
- Verifier graded against time drift (24h window removed).

**Goal-mode adoption:**
- Established `/goal` as the default for goal-shaped tasks (verifier hardening, infrastructure builds). NOT for multi-agent gauntlet runs (operator orchestrates).
- Created `frames/codex-goals/` convention for prompts that exceed Codex's 4K inline `/goal` limit. First example: `frames/codex-goals/t6-extra-hard-preamble-goal-20260525.md`.

**Open at end of session:**
- T7 not started. Sample 1 is "capability exists"; T7's job is "capability is repeatable across 25 runs per tier."
- Per-agent standing-instructions pattern (from external slide) backlogged — not urgent.
- `fixture-*` Supabase rows from `b6c774c` self-test still untriaged (Codex's REST-based search couldn't find them due to UUID id-column constraints; investigation inconclusive).
- Codex TUI log rotation not configured.
- Two autonomous T4 heartbeat commits showed up mid-session (`6fcc85e`, `034ff68`) — known pattern of background T4 audit cycles. Documented.

**Next session opens with:**
1. Decide between **Phase F1 proper** (scheduled gauntlet daemon — multi-week) vs **per-agent standing-instructions** (half-day) vs **starting T7** prep
2. Sleep first — this session covered the largest engineering surface yet

---

### 2026-05-27 — Model migration to opus-4.7/claude-code (mid-session, after Codex credit exhaustion forced the question early)

**Context this session opened with:** T7 medium runs 015+ kept producing `ghost_completion` errors per the classifier. Investigation revealed those were not Pentagon defects — they were Codex CLI account credit exhaustion (`"You've hit your usage limit. Visit chatgpt.com/codex/settings/usage to purchase more credits or try again at May 30th, 2026 4:15 PM"`). The bridge logged completions as `exit_status=1` in 2 seconds; the classifier saw claim+complete with no Maya output and called it ghost_completion. **Functional classification correct; inferred cause wrong.** This conflation must be documented.

**Forcing function decision:** rather than buy more Codex credits + resume T7 medium on gpt-5.5 → migrate later, the operator chose to migrate the cohort now (Option 3 of the resume-or-migrate decision). Migration is a planned item in the backlog anyway; Codex billing was the natural forcing function.

**Built (engineering):**
- `agent-os/agent-cohort.json` — canonical cohort config (provider/model/harness_id + Pentagon default model). Single source of truth for the verifier + audit skill.
- `scripts/migrate-agent-cohort.mjs` — generic migration script with `--all` / `--agent-name` / `--dry-run` / `--log` flags. Records before+after to JSONL for reversibility. Reuses bridge's Supabase auth helpers (PlistBuddy session + binary-embedded anon key).
- `scripts/read-active-graph-agents.mjs` — read-only snapshot tool. Captures all 20 agents with provider/model/harness_id/execution_mode.
- `scripts/probe-canary-trigger.mjs` and `scripts/probe-all-recent-triggers.mjs` — investigation tools. Used during the canary to isolate "is this Carmen-specific or system-wide?"
- **Bridge `runClaude()` + harness dispatcher** in `scripts/pentagon-trigger-bridge.mjs` — major addition. Extended `activeGraphAgentIds()` → `activeGraphAgents()` returning rows with name+provider+model+harness_id. Added `agentById()` lookup. New `runClaude(trigger, token)` spawns `claude -p --output-format=stream-json --dangerously-skip-permissions --strict-mcp-config --mcp-config <inline JSON>` with `CLAUDECODE`/`CLAUDE_CODE_*`/`AI_AGENT` env vars scrubbed. New `finalClaudeMessage()` parses the stream-json event format (assistant.message.content[].text + result fields, captures is_error/api_error_status). New `runByHarness(agent, trigger, token)` dispatcher selects codex vs claude based on `agent.harness_id`. `processCandidates()` updated to route, separate `claude_failed` from `codex_failed`.
- **Verifier generalization** in `scripts/verify-pentagon-autonomy-from-logs.mjs` — added `loadCohortExpectations()` reading the JSON cohort config. Lines 764-774 (live DB checks) and line 1978 (Pentagon default model) now dynamic. **Historical evidence files at lines 2166/2168/2201 NOT touched** — those pin the 2026-05-23 cohort state and are immutable per design (Brandon-D backlog item flagged for audit).
- **Model audit skill** updated to reference the cohort config + explicitly note that historical evidence files are NOT updated.

**Migrated (DB mutation):**
- Carmen (Contract Owner) — canary, migrated then reverted then migrated again. End-to-end success.
- All 20 active_graph Pentagon agents — bulk migration to claude-code/claude-opus-4-7/claude-code in one command. Pre/post snapshots captured.

**Smoke tests passed:**
- Carmen canary v1 (Pentagon native dispatcher only, no bridge): **UNCLAIMED after 6+ minutes**. Exposed that Pentagon's native trigger poller is silently non-functional for active_graph workspace.
- Carmen canary v2 (bridge with new runClaude(), one-shot mode): **PASS**. Exact ACK text, $0.27, 7.3s wall, terminal_reason=completed.
- Theo smoke test (bulk migration verification, different agent than canary): **PASS**. Exact ACK text, ~25s wall.

**Surfaced (defects + architectural truths):**
- **Pentagon's native trigger poller has been silently non-functional for active_graph workspace.** The "activation bottleneck" entries in this file (4+ recurrences) were not "intermittent native poller desync" — they were "native poller never works; bridge is THE dispatch path." Confirmed by Carmen v1 canary: Pentagon alive, bridge dead, trigger sat unclaimed forever. **Implication:** when bridge dies, ALL agents silently stop being dispatchable; nothing in the dark factory currently auto-restarts the bridge if it dies (LaunchAgent should but didn't this session).
- **Codex CLI credit exhaustion masquerades as Pentagon `ghost_completion`** with claim+complete in ~2 seconds, stderr empty in the bridge log but stdout contains the Codex CLI's usage-limit error message buried inside a `turn.failed` event. Classifier's ghost_completion shape is correct; root cause was upstream billing. Add to "Known factory defects" as a distinct upstream cause that conflates with the Pentagon defect of the same shape.
- **Pentagon was already pre-configured for claude-code.** `pentagon.claudeCliPath = /Users/gaganarora/.local/bin/claude`, `pentagon.defaultModel = claude-opus-4-7[1m]`. Pentagon's Swift binary has `ClaudeCodeProvider`, `ClaudeStreamParserAdapter`, `ClaudeLaunchBuilder` classes. **The only thing stuck on the old cohort was the agent rows themselves.** The migration aligned the agent rows with Pentagon's pre-existing config, not the other way around.
- **`claude` CLI auth path**: vanilla bash subprocess returns HTTP 401 even when `claude auth status` reports `loggedIn:true` — because the keychain entry is scoped to the Claude Code app process. Fix is `claude auth login` from a fresh terminal, which creates a CLI-accessible keychain entry. Pentagon's `ClaudeLaunchBuilder` does `unset CLAUDECODE; exec` to clear inherited Claude Code env state; that's the right pattern for the bridge's `runClaude()` too.

**Watched and decided (external source):**
- Brandon Walsenuk (Unblocked) — "Stop babysitting your agents..." (AI Engineer, 18:54, uploaded 2026-05-26). Brought 4 candidate items to backlog (tasks #14-17 in this session's task list): **(A)** pre-flight research packet for each agent trigger (Brandon's headline finding — 6× improvement same prompt/model just by adding context engine; possibly larger gain than the model migration we just did), **(B)** detect "satisfaction of search" as named failure mode (radiology term: stop searching after first plausible find — Maya runs 008/014 may have exhibited this), **(C)** verifier check for unread-source pattern contradictions (depends on A's infrastructure), **(D)** audit verifier's frozen historical evidence files for cache staleness (Brandon's lesson 3 says "correct" cached answers go stale; lines 2166/2168/2201 of the verifier deserve a re-audit, especially the Pentagon-native-poller claims given that we just proved native dispatch is silently non-functional). **Decided to keep migration on track for this session, queue Brandon's 4 items for follow-up.**

**Closed (cohort-level):**
- All 20 active_graph agents on opus-4.7/claude-code cohort.
- Bridge can dispatch via claude-code harness end-to-end.
- Verifier generalized to read cohort config (no longer hardcoded gpt-5.5/codex).

**Open at end of session:**
- Two unclaimed triggers from before bulk migrate: Carmen v1 (old canary, 16:16:26Z) and Priya (16:22:42Z, likely autonomous T4 heartbeat). Will resolve on next bridge loop start.
- Bridge process is NOT currently running. LaunchAgent should auto-restart it; verify before T7 medium resumes.
- T7 medium runs 015+ deferred. New cohort starts T7 medium from scratch (cohort sample size resets — see ladder note above) OR resumes 015+ in the new cohort (operator decision).
- `pentagon_watchdog_error` events still happening in bridge err log, never investigated. Likely Pentagon-native-poller-related and now lower priority since native dispatch is confirmed broken and the bridge is the dispatcher.
- Brandon-A (research packet) may be higher-leverage than continuing T7 medium. Open question.

**Next session opens with:**
1. Restart bridge LaunchAgent (or `node scripts/pentagon-trigger-bridge.mjs --loop --interval-ms 1000 --max-age-seconds 180` manually) and verify it stays up.
2. Either: (a) resume T7 medium on new cohort (runs 015-025 on opus-4.7), measure variance fresh, OR (b) start Brandon-A (research packet) — possibly larger quality gain than the model upgrade alone.
3. The full verifier run hasn't been executed end-to-end on the new cohort yet. Run it before any T-tier graduation claim.

---

### 2026-05-27 (afternoon continuation) — T7 medium cohort-B (12/12 PASS) + Claude Code session limit discovered

**Operator decision:** Resume T7 medium 015-025 on opus-4.7. Then continue to 026-039 toward the 22/25 reliability gate.

**Pre-flight:**
- Loaded the bridge LaunchAgent (`launchctl bootstrap`) — was not running. PID 21210.
- Bumped `--codex-timeout-ms` and added `--claude-timeout-ms` to 540000 (9 min) in the plist. Default 180s was too short for Maya's full task.
- Full verifier run: **342/344 PASS**. Live-DB cohort checks ALL GREEN. 2 unrelated FAILs (bridge dirty, native_task_passed drift — both addressed this continuation).

**Built (engineering):**
- `scripts/t7-medium-cohortB-fire.mjs` — helper: build instruction file (substitute hash + seed + accumulate exclusion list from prior cohort-B proofs), fire runner, parse runner JSON + proof file, append ledger entry.
- Patched runner with `expectFileVariants()` + `findExpectFileMatch()` mirroring verifier's `proofAckPaths()`. Both `frames/...` and `activegraph/frames/...` accepted (task #19 closed).
- Added `native_task_passed` comment-token to runner (task #18 closed).

**Surfaced (defects):**
- **Maya's `frames/...` cwd drift** — runs 015-020, 023, 027 wrote proof to inner (`activegraph/frames/`); runs 021, 022, 024, 025, 026 wrote to outer (`frames/`). Both valid per literal instruction. Helper handles both. Worth standardizing in a future instruction-template revision.
- **Claude Code MAX session limit at run 028** — `apiErrorStatus: 429`, "You've hit your session limit · resets 4:50pm (America/Toronto)". Maya's quality was 12/12 PASS where dispatched — failure was external, not agent-side.
- **Bridge orphans trigger row on `claude_failed`** — trigger 7da34d4a left with claimed_at=set, completed_at=null. Task #25 backlog'd.

**T7 medium cohort-B results (12/12 = 100% PASS where dispatched):**

| Run | Target symbol | New tests | Wall (s) |
|---|---|---|---|
| 015 | activegraph.core.graph.Graph.all_objects | +3 | 206 |
| 016 | activegraph.runtime.diff.DivergentObject.summary | +4 | 314 |
| 017 | activegraph.core.graph.Graph.all_relations | +3 | 202 |
| 018 | activegraph.core.graph.Graph.get_patch | +3 | 209 |
| 019 | activegraph.core.graph.Graph.get_relation | +2 | 190 |
| 020 | activegraph.core.patch.Patch.to_dict | +3 | 205 |
| 021 | activegraph.core.ids.IDGen.reseed_from_events | +4 | 188 |
| 022 | activegraph.runtime.queue.EventQueue | +3 | 249 |
| 023 | activegraph.core.ids.IDGen.run | +3 | 213 |
| 024 | activegraph.store.url.open_store | +3 | 230 |
| 025 | activegraph.core.graph.Object.to_dict | +3 | 264 |
| 026 | activegraph.runtime.diff.DivergentRelation.summary | +4 | 201 |
| 027 | activegraph.runtime.budget.Budget.cost_remaining_amount | +3 | 226 |
| 028 | (session limit hit) — Maya never dispatched | — | — |

**Mean wall:** 222s. **Range:** 188-314s. **34 new tests** committed to inner repo across 7 modules (core.graph, core.patch, core.ids, runtime.diff, runtime.queue, runtime.budget, store.url). Maya genuinely searched fresh each run.

**Honest gate math:** 12/12 PASS where dispatched. 0 agent-side failures. Sample size = 12 (NOT 25). The remaining runs 028-040 are blocked on Claude Code session limit (resets ~21:00Z), not on agent quality.

**Watched and decided (external sources):**
- **Pancake (getpancake.ai)** — autonomous agent org platform with markdown config, Slack-native, audit logs. 3 gaps queued as tasks #21-23: F1 daemon, Slack integration, spend/scope gates (Blake unwired). Dark factory is further on engineering-verification axis, Pancake further on ops-Slack-approval axis.
- **Pullfrog (https://www.infoq.com/news/2026/05/pullfrog-ai-github/)** — open-source GitHub bot, BYO API keys. Operator constraint: must use Claude Code MAX subscription, not API key. Cleanest path: self-hosted GitHub Actions runner on operator's Mac inheriting local `claude` CLI auth. Queued as task #20.

**Bonus emergent observation:** Theo (Test Owner) auto-responded to Maya's `MAYA_NATIVE_GAUNTLET_ACK` messages throughout the batch — Pentagon's conversation participants triggered Theo's own bridge dispatch on each Maya ack. The 5-agent gauntlet is partially emerging without explicit wiring. Cost: 2× Maya's per-run cost (Maya + Theo both burn claude tokens). Contributing factor to hitting session limit at run 028.

**Open at end of session:**
- Cohort-B run 028 trigger 7da34d4a orphaned (claimed_at=set, completed_at=null). Bridge won't auto-recover.
- Claude Code MAX session limit resets ~4:50pm Toronto. Runs 028-039 (12 more for 22/25 gate) blocked until then.
- Per-token-arbitrage proof (CLAUDE.md backlog item) is now most strategically urgent — session limits validate the concern empirically.
- Brandon-A research packet remains the highest-leverage non-built item. With session limits real, context efficiency matters as much as model quality.

**Next session opens with:**
1. Verify session has reset (`claude auth status` + a small dispatch test).
2. Decide: resume runs 028-039 to complete the formal 22/25 gate, OR pause T7 medium and pivot to F1 daemon / Brandon-A / Pullfrog work given session limit demonstrates burn-rate problem.
3. Cleanup: complete orphaned trigger 7da34d4a via RPC OR ignore.

---

_This file is updated by Claude at the end of each working session. If you're picking up cold, the bottom of the Activity Log is the most recent state._
