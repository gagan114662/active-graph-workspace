# Per-token arbitrage proof — pipeline pick + first measurement

**Status:** active (not closed)
**Created:** 2026-05-28
**Owner:** operator + Claude
**Backlog item:** CLAUDE.md "Per-token arbitrage proof before scaling AFK agents" + goal-doc task #24

## North star

> Buy a token for $1. Run it through the dark factory. Sell the output for $2. Scale to the moon. Without that ratio, scaling agents 24/7 just compounds burn.

## The bet (one pipeline only)

The dark factory currently produces several artifact classes. To prove arbitrage we need ONE pipeline where:
- input cost is measurable (claude tokens)
- output is shippable to someone who pays
- revenue per output is measurable

### Candidate pipelines

| Pipeline | Input (claude $) | Output | Revenue source | Why it could work | Risk |
|---|---|---|---|---|---|
| **A. activegraph issue → PR** | $3-15 per issue (T6 medium = ~$5, T6 hard = ~$10) | A landed PR closing an inbound GitHub issue | activegraph's commercial adopters paying for support contracts | Real demand (Issue #23 OTel from Matt Van Horn shows external users) | Maintaining a paid relationship is operator-heavy |
| **B. Dark factory-as-a-service** | $5-30 per dispatched task | Bug-fix PRs against a customer's repo | Per-PR retainer ($500-2000/mo) | Bridge + Phoenix + verifier already work end-to-end | Onboarding friction per customer |
| **C. Bug-bounty automation** | $3-10 per attempt | Verified vulnerability submission | Bug-bounty payouts ($100-10000) | Verifier substrate already grades work | Most bounty programs ban automation |
| **D. Test-coverage outsourcing** | $1-5 per added test | New test files in a customer repo, lifting % coverage | Per-test rate or coverage SLA | T7 medium proved Maya can sustain "+3 new tests, 200s wall, $0.30-2.00 per run" | Less differentiated; lots of competitors |

### Pick: D (test-coverage outsourcing) is the cleanest first proof

**Reasoning:**
- D's cost+output is the BEST-MEASURED pipeline today. T7 medium cohort-B has 12 datapoints (frames/t7-native-repetition-progress-medium-cohortB-20260527.jsonl) with per-run cost + per-run "+N tests" delta.
- Output is hostile-to-fake: pytest passes are objective, coverage % is a single number.
- Customer can self-verify: they merge the PR and watch their coverage % go up.
- Minimum viable price discovery: $5/test would yield $5×3=$15 per Maya run on $2 input → 7.5× arbitrage. $2/test still works at 3×.

**Anti-reasoning:**
- D doesn't differentiate the factory on quality. We're just an autonomous Maya.
- True moat would be Pipeline B (factory-as-a-service). But B requires customer onboarding before any token spend justifies; D can be sold from a one-page form.

## First measurement (no customer required)

Compute the dark factory's CURRENT cost-per-shipped-feature using existing data:

```bash
node scripts/factory-arbitrage-meter.mjs --since 2026-05-27T00:00:00Z
```

What we already know (rough numbers from CLAUDE.md activity log + Blake's totals this week):
- T7 medium cohort-B mean wall: 222s
- 12 passes in cohort-B totaling ~$30-60 in claude burn (Theo auto-respond doubled this)
- Median +3 tests per run
- = $1.40 per test landed (low estimate) or $3.30 per test (high estimate, includes Theo overhead)

**Implied arbitrage:**
- @ $5/test sale price: 1.5× to 3.5× arbitrage (POSITIVE)
- @ $2/test sale price: 0.6× to 1.4× arbitrage (uncertain — depends on Theo overhead reduction)
- Sub-$2/test: negative

**Reducing Theo overhead** (already known fix): Theo auto-responds to every Maya ack which doubles per-run cost. Cleanest path: remove Theo from Maya's conversation participants in the cohort-B path. That drops cost by ~50% → makes $2/test pricing profitable.

## Definition of done (Phase 1)

Pipeline D becomes "validated" when ALL of:

1. **Cost meter live**: `factory-arbitrage-meter.mjs --since <T7 start>` shows cost-per-test that is stable across 25+ runs (within ±20% of median).
2. **Output landed externally**: at least ONE PR on a non-dark-factory repo with "+N tests" added by Maya, merged by the upstream owner. Doesn't need to be paid yet — proves the work travels.
3. **Theo overhead removed**: cost-per-test drops by ≥40% vs cohort-B baseline. Verified via meter.
4. **Pricing experiment**: post a "test coverage for Python repos — $X/test, $Y minimum" on at least one channel (HN Show, Twitter, GitHub Discussions in activegraph itself). One inbound inquiry = signal.
5. **First paid run**: one customer pays for one batch of N tests. Revenue ratio recorded.

## Phase 2 (after Phase 1 validates)

- Productize: customer drops a `.factory.yml` in their repo describing target modules + max budget. Phoenix dispatches Maya runs against the listed modules. PR opens automatically.
- Pricing v2: tiered (single-test / weekly batch / monthly retainer).
- Risk gate: per-customer Blake (budget marshal) instance with hard caps so a runaway never burns customer budget.

## Anti-goals

- DO NOT pick the "ship features end-to-end for a customer" pipeline first (pipeline B). It has more variables and customer-onboarding friction; arbitrage cannot be measured cleanly.
- DO NOT pick bug-bounty automation (C). Most programs ban automation and the payoff distribution is heavy-tailed in ways that break unit economics.
- DO NOT scale Pentagon dispatch beyond Blake's hard caps. The arbitrage proof is a Phase-1 thing; scaling without the proof is the exact failure mode this doc exists to prevent.

## Pointers

- Cost meter: `scripts/factory-arbitrage-meter.mjs`
- Cohort ledger: `frames/t7-native-repetition-progress-medium-cohortB-20260527.jsonl`
- Blake caps: `scripts/launch-agents/run.factory.blake-budget-marshal.plist` (cap-per-day, cap-per-hour, cap-per-session)
- Phoenix dispatch surface (where customer integration would attach): `scripts/pentagon-rest.mjs::dispatchTodo`
