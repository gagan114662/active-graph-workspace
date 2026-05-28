# Backlog: Success-flow memory — capture & replay what WORKED (P23)

**Added:** 2026-05-28 (operator shared the "Rote" framing; wants the GAP fixed in-house, NOT Rote).

## The gap (Rote's framing)
> "Agents learn on your dime. And forget. Every run, your agent figures out the same APIs, makes the
> same calls, hits the same failures. Because nothing saved what worked."

The dark factory logs **failures** richly and now converts them to eval cases (P20). But it saves no
**success playbook** — every Maya/agent dispatch re-discovers the codebase, re-derives the approach,
and re-pays the `cache_creation_input_tokens` cost. The research packet (3a, shipped) pre-supplies
recent commits + similar failures, but NOT "the exact flow that worked last time for this task class."

## What to build (in-house — do NOT adopt Rote)
The success-side complement to P20's failures→eval-cases loop:

1. **Capture the flow on success.** When a task succeeds (`behavior.completed` / gauntlet PASS /
   `flywheel.commit.landed`), record a reusable playbook keyed by task class:
   - task class + target (symbol/file), the approach, the sequence of calls/edits that worked,
     the final diff/commit sha, cost + wall.
   - Store as `success.flow_captured` events (+ a queryable store — this is F4 #17 specialized).
2. **Replay on the next similar dispatch.** Extend `scripts/research-packet.mjs` /
   `pentagon-trigger-bridge.mjs::researchPacketFor` to inject the matching success-flow ("last time a
   task like this succeeded, here's the proven approach + the diff shape") so the agent starts from a
   playbook instead of from scratch. Cuts the cache-creation cost driver further and reduces repeated
   failures.
3. **Skip Rote's "adapter from API spec" half.** The factory's APIs (Pentagon MCP, Supabase REST,
   git) are stable + already wrapped (pentagon-rest.mjs, bridge). The value is the **flow/learning**
   half, not auto-generating an API surface.

## Why it matters
This is the YC-talk **"learning" gap** made concrete: the dark factory is strong on tool + quality-gate
(verifier, judges, Sentinel) but weak on **sensor + learning**. P20 added the failure-learning loop;
P23 adds the success-learning loop. Together: the factory stops paying twice for the same work.

## Connects to
- 3a research packet (shipped — the injection point already exists).
- F4 unified factory memory (#17 — the store).
- P20 production eval loop (the failure-side twin).
