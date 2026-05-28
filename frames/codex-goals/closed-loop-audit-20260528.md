# Closed-loop audit (P22) — where does factory state still live only in human heads?

**Date:** 2026-05-28. CS153 "open-loop vs closed-loop company": open = info in human heads (DMs,
vibes), agents see ~10% of state; closed = every workflow produces artifacts agents read full state.
This audits the dark factory for the OPEN-loop residue.

## Already closed (every workflow produces an artifact agents read)
- **Engineering work** → git commits + the verifier + proofs (closed).
- **Failures** → `behavior.failed` / `script.crash` / `flywheel.attempt.rejected` events (closed,
  this session + prior).
- **Routing decisions** → `todo.created` / `routing.skipped` with config version (closed, P-determinism).
- **Quality** → judge verdicts + `call.graded` 5-axis scorecards (closed, P19).
- **Learning** → failures→eval-cases (P20) + successes→flows (P23), both → research packet.
- **Economics** → `llm.responded` cost events + the treasury query surface (closed, P24).
- **Where docs live** → RESOLVER.md + per-dir READMEs (closed, P21-partial).
- **Priorities/backlog** → the task list + CLAUDE.md backlog (closed this session).

## OPEN-loop gaps found (state still only in a human head / unindexed)
1. **Operator decisions made in chat-with-Claude.** The big ones get written to CLAUDE.md
   "Decisions logged", but many in-conversation choices (which idea to build, scope calls) are NOT
   auto-captured as artifacts — they live in the chat transcript, which agents don't read.
   → *Remediation:* a `decision.recorded` factory event + a lightweight `/remember`-style capture so
   every load-bearing operator decision becomes a queryable artifact (feeds F4 memory).
2. **Event-emitter self-failures (H13) go to stderr, not events.** Correct by necessity (can't emit
   when the emitter is broken) but those failures live only in `~/.factory/*.err` logs.
   → *Remediation:* a periodic `scripts/factory-alert.mjs` scan of daemon stderr for
   `event emission failed` lines → emit an `infrastructure.emitter_degraded` event.
3. **Daemon stdout/stderr logs (`~/.factory/*.{out,err}.log`)** are outside the event stream.
   → *Remediation:* tail them into the event log (or a `log.scraped` event on error patterns).
4. **Agent reasoning / "why this approach"** is partially captured (ACKs, success-flow `approach`)
   but the full chain-of-thought isn't.
   → *Remediation:* already mostly acceptable; the success-flow `approach` + research packet capture
   the reusable part.
5. **The Pentagon conversation state** (multi-agent chats) is in Supabase, not the factory event log.
   → *Remediation:* the social-graph builder + ACK events partially mirror it; full mirror is F4 scope.

## Verdict
The factory is **strongly closed-loop** on the load-bearing surfaces (work, failures, decisions-as-
routing, quality, learning, economics, docs). The remaining open-loop residue is (1) ad-hoc operator
chat decisions and (2) emitter-self-failures + daemon logs living in stderr rather than events. Both
have cheap remediations (a decision-capture event + an stderr-scan alert). Neither blocks autonomy;
both narrow the "agents see ~10% of state" gap further toward full state.

Highest-value next: **`decision.recorded` capture** — it's the one with real signal that currently
evaporates into the chat transcript.
