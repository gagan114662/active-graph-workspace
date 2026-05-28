# Discipline rules that NEVER bend

(Single source — moved out of CLAUDE.md per P21. RESOLVER routes here.)

1. **Verify independently before greenlighting** — never trust an agent's self-report. Re-run the verifier yourself.
2. **No-pipe exit-code capture** — `cmd > /tmp/out 2>&1; echo "exit=$?"`. Piping kills the exit code. I've been bitten by this 3+ times; don't repeat the mistake.
3. **Never loosen the verifier to make a check pass** — always either tighten the check or pivot to a principled-rule reframe. This is T5R's failure mode at scale.
4. **No destructive operations without explicit user authorization** — no `git reset --hard`, no `rm -rf`, no force-completing rows in Supabase without recording the action.
5. **Sample size 1 ≠ reliability** — never call a tier "graduated" from one passing run. T7's job is to measure variance.
6. **Activation bottleneck is systemic** — Pentagon poller desync, 4 occurrences. Fix = poller restart. Permanent fix = Phase F1 watchdog. Don't treat each occurrence as transient. (Superseded truth as of pt.13: the Pentagon native poller is **silently non-functional** for this workspace; the bridge IS the dispatch path.)
7. **`agent_runtime_events` is empty** for these workflows — audit via `messages.ACK` instead. The WARN line for runtime events is advisory.
8. **Quinn inter-agent dispatch is operator-driven** for sample 1 — Maya does not auto-trigger Quinn yet. That's T7+ work.
9. **RESOLVER-first context (P21)** — before editing a file, consult `RESOLVER.md` / run `node scripts/resolve-context.mjs <path>` and load ONLY the routed docs. Do NOT dump all ~1500 lines of CLAUDE.md into context (the open-loop anti-pattern). Each top dir has a local-resolver `README.md` (what goes here / what does NOT).
10. **Epistemic discipline (P21, from gbrain)** — every load-bearing claim cites its source as `observed` / `self-described` / `inferred`; confidence scales with interaction count (1 sample = low — pairs with rule 5); no single-datapoint generalizations; an operator correction overrides everything and is written down immediately.
