# Known Defects, Gaming Holes & Verifier History — active_graph dark factory

_Reference. Moved out of CLAUDE.md in the P21 split (pt.19); RESOLVER routes here when touching the verifier / bridge / known-defect areas._

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

