# Backlog: Factory treasury/economics MCP (P24) — the "meow" gap, in-house

**Added:** 2026-05-28 (operator shared meow.com/mcp; wants the pattern built in-house, NOT the service).

## What meow.com/mcp is
An MCP server giving AI agents **banking**: `get_account_balances`, `list_account_transactions`,
`validate_routing_number`, payment networks (ACH/wire/USDC/USDT), invoicing — so agents manage real
business finances conversationally ("things that used to take 20 clicks").

## The gap it names for the dark factory
The factory's agents have **no queryable economic surface**. Blake (`blake-budget-marshal.mjs`)
watches `llm.responded` cost and can pause the bridge; the global expense framework logs to
`~/.clawd/expenses.jsonl`; `factory-arbitrage-meter.mjs` computes cost-per-test — but an agent (or
the operator, conversationally) cannot ASK the factory about its own economics.

## What to build (in-house, NOT meow)
A factory **treasury/economics surface** — CLI + MCP server (reuse the verifier-as-MCP pattern from
P13) — exposing tools:
- `get_budget_status` — spent vs remaining against Blake's hour/day/session caps.
- `get_session_burn` — current spend rate.
- `cost_per_shipped_feature` — from `factory-arbitrage-meter.mjs`.
- `get_arbitrage_ratio` — the P5/P12 output→revenue ratio.
- `list_recent_spend` — from `factory-events` (filter `behavior=bridge.runClaude` cost, de-duped).
- (later) `request_spend_approval` — a gate feeding the Slack approval UI (P16).

So Blake/Phoenix/operator AND the agents reason about cost; feeds the arbitrage proof (P5/P12) + the
Slack approval UI (P16). Data sources already exist (cost events, Blake, expenses.jsonl, arbitrage
meter) — this is the queryable surface on top.

## Scope note
This is **compute-economics**, not real business banking. Real agent-banking (agents moving money /
making payments) is a separate, later question — and the global "Autonomous Operation Mode" expense
rules (auto-approve <$100, log to expenses.jsonl) are the policy layer it would build on.

## Connects to
- P13 MCP exposure of factory primitives (same MCP pattern).
- P5/P12 per-token arbitrage (the economic metrics).
- P16 Slack approval UI (the approval gate surface).
