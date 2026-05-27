# Post-Baseline Roadmap — What Comes After T6–T17 (Spec)

**Date:** 2026-05-23
**Repo:** `/Users/gaganarora/Desktop/my projects/active_graph`
**Predecessors:**
- T6 — `frames/t6-real-autonomy-gauntlet-2026-05-23.md`
- T7–T12 — `frames/t7-t12-scale-reliability-gauntlet-2026-05-23.md`
- T13–T17 — `frames/t13-and-beyond-factory-survivability-2026-05-23.md`

**Purpose:** Lock in everything that has to happen *after* all the T-baselines are honestly green. T6–T17 prove the factory can build software, do so reliably, survive attacks, survive incidents, decide what to build, make money, and stay current. **None of that adds up to a self-spinning business.** This document is the bridge from "capable, hardened, measured factory" to "compounding operating system."

## Where you'll be when all baselines are green (honestly)

A factory that has graduated T6–T17 can defensibly say:

> "Within the task families, repo shapes, and complexity envelope we measured: we produce engineering work at known pass rates, known costs, known incident rates, known regression-at-30-day rates, known adversarial detection rates, and known spec-quality scores. We re-validate continuously and publish the numbers."

That's the strongest claim almost any AI software vendor can defensibly make in 2026. **It is not yet a business.** It is the *foundation* of one.

What still doesn't exist on graduation day:

- A flywheel that keeps the numbers true without operator attention
- A queue of real customer work flowing in
- A pricing/cost model proven in market
- A moat that survives a competitor running a similar gauntlet
- A team and operating model that scales beyond the founder
- Legal/compliance posture for selling to enterprises
- An institutional memory the agents themselves consult

This document specifies how each of those gets built.

---

## Phase 0 — Validate graduation actually happened

Most autonomous-AI demos claim graduation before earning it. The first job after the last tier reports green is to **prove the claim is real**, not just the verifier ran.

Operator must produce a signed `graduation-2026-mm-dd.md` containing:

- [ ] T6 — all 4 tiers honestly green AND each tier ran ≥ 3 distinct samples (not 1)
- [ ] T7 — pass-rate table with p50/p95 cost+wall, *and* a manual spot-check of 5 random runs from the 100 confirming the agent's work was real (not just verifier-green)
- [ ] T8 — each of 6 families ≥ threshold pass-rate AND no family relies on a single suspicious pattern (e.g. all 5 passing BUGFIX runs found the same `FIXME` comment)
- [ ] T9 — discovery skill (`agent-os/skills/discover-repo-conventions.md`) was operator-reviewed AND each repo's `repo-conventions.json` matches what the maintainers would actually say
- [ ] T10 — zero silent inventions across all 30 trials, and an outside reviewer (not employed by you) audited 5 random refusals as genuine
- [ ] T11 — 20-streak no-bypass holds AND verifier's assertion count has roughly doubled vs T6 baseline
- [ ] T12 — at least 10 features tracked for 30 calendar days each, with day-30 regression rate ≤ human baseline (measured, not assumed)
- [ ] T13 — 50/50 detected AND outside security reviewer audited 10 detections as real
- [ ] T14 — three incidents passed AND postmortems became new verifier checks AND fire-drill cadence is on the calendar
- [ ] T15 — 20 specs scored ≥ 18/25 mean AND at least 3 shipped AND customers reacted positively to ≥ 2
- [ ] T16 — 30 features measured with real (stopwatch-tracked, not estimated) operator review minutes AND outside finance review of the cost model
- [ ] T17 — scheduled re-runs are landing on time AND drift signals are wired to paging AND the transparency page is current within 1 month

**Hard rule:** if you cannot tick all of the above honestly, you have not graduated. Continuing to call yourself graduated is the T5R failure mode at scale. The whole project's credibility depends on this gate.

**Defects that survived all tiers go on a permanent "known limitations" page** that customers, employees, and auditors see. There will be some. Hiding them is the failure that ends careers.

---

## Phase F — Build the flywheel (the chain on the bicycle)

Five infrastructure pieces. Each is a 1–3 week build by a small team. Order matters: F1 unblocks everything else.

### F1 — Scheduled gauntlet daemon

**What:** A persistent process (or cron + queue) that re-runs T6–T17 on the cadence specified in T17, writes outcomes to the event store with `gauntlet`, `tier`, `run_idx`, `outcome`, `cost`, and `wall_seconds` columns, and triggers paging if any drift signal trips.

**Why first:** Without this, every "graduated" claim ages out within weeks. F2-F5 all depend on having a regular stream of runs to learn from.

**Concrete first build:**
- `scripts/gauntlet-daemon.mjs` running under launchd (mac) or systemd (linux)
- Reads schedule from `agent-os/gauntlet-schedule.yaml`
- Each run claims its slot via a row in `gauntlet_runs` to prevent duplicates
- Failures auto-open an incident (see F2)
- Estimated build: **5 days** for the daemon, **3 days** for the schedule + dashboards

**Done condition:** A full week passes with all scheduled re-runs landing on time, no operator intervention, and the dashboard shows pass-rate stable within ±2 percentage points.

### F2 — Defect → permanent test auto-loop

**What:** When the operator marks any finding as a defect (`scripts/mark-defect.mjs <event_id> --severity X --new-check "<assertion description>"`), the system:
1. Records the defect as an `incident` event in the event store, linked to the finding
2. Generates a draft new verifier check (LLM-assisted) that would have caught the defect
3. Routes the draft to a human reviewer for approval
4. Once approved, the new check is merged into the verifier AND added to the relevant tier's schedule
5. Re-runs all prior gauntlet runs against the new check to retroactively detect how often the defect would have been caught had this check existed

**Why:** Today's session generated ~6 defects (transcription, soft-fail, agent_edit assumption, runtime-events gap, activation bottleneck, path-resolution edge case). Each became a hand-coded fix that I/Codex/you wrote. **The factory should harden itself**, not depend on the operator's attention span.

**Concrete first build:**
- `scripts/mark-defect.mjs` CLI
- `agent-os/skills/auto-check-drafter.md` skill (LLM uses the defect description + existing verifier code to draft a new assertion)
- Reviewer UI: a simple `defects/` directory of draft `.md` files awaiting `--approve`
- Estimated build: **7 days**

**Done condition:** A defect found in a Phase 0 graduation audit gets converted into a permanent verifier check within 24 hours, without the operator touching code.

### F3 — Auditor agent (continuous T11)

**What:** A dedicated agent role — call her **Sasha (Spec Skeptic)** since she's already in the org chart — that runs continuously, NOT episodically. Her job:
- Each new gauntlet pass triggers Sasha to attempt one adversarial deviation from the spec that would still verify
- If she succeeds in passing the verifier while being wrong → it's a finding (auto-flowed through F2)
- If she fails N consecutive times → adversarial confidence increases
- The confidence number is published on the transparency page

**Why:** I played Sasha manually all day today. That's not scalable. The whole T11 design assumed continuous red-teaming; today proved it works once (good fixture vs bad fixture). Make it always-on.

**Concrete first build:**
- Sasha's role description in `agent-os/AGENT_IDENTITY_MAP.md` updated with adversarial mandate
- Trigger: each completed gauntlet run posts a `sasha_challenge` event; Sasha picks it up
- Sasha's deviations are bounded (must remain plausibly within the spec's letter, must produce a buildable artifact, no destructive operations)
- Estimated build: **5 days** of Sasha skill + 2 days for the challenge tracker

**Done condition:** Sasha runs unattended for 7 days, generates ≥ 50 challenges, ≥ 1 finding flowed into F2.

### F4 — Factory-state memory

**What:** A queryable index every agent consults before acting, containing:
- All prior gauntlet outcomes (by tier, by symbol/file/repo touched)
- All open defects + their assertion checks
- All known limitations (the "we don't do X yet" page)
- All recent incidents
- Per-file activity (last touched by whom, why, on what tier)

**Why:** Today Maya picked `Behavior.run` for T6-easy and `Policy` for T6-medium without checking history. She picked well — but that was luck plus a curated repo. At scale, agents should query their own prior knowledge before duplicating work or stepping on a known landmine.

**Concrete first build:**
- `scripts/factory-memory-query.mjs` exposing a few canonical queries
- Each agent's instructions augmented with a "before acting, query: …" preamble step
- Built on top of the existing Supabase event store + a small `factory_index` materialized view
- Estimated build: **4 days**

**Done condition:** When Maya is asked to find an uncovered symbol in T6-medium #2, her trajectory shows she queried factory memory before picking. If she duplicates a prior choice without noting why, it's a finding.

### F5 — Cost meter (precondition for T16)

**What:** Per-feature cost tracking with stopwatch-recorded operator review minutes, not estimates.

**Why:** Already specified in T16, separated out because **without F5, T16 is unmeasurable**. You can graduate T6–T15 without it, but graduation Phase 0 won't tick for T16.

**Concrete first build:**
- Token + USD cost from the runtime, written to event store per gauntlet run
- Operator review time: a small `scripts/review-stopwatch.mjs` that records "start/stop" events keyed to the run hash
- Aggregator: per-feature, per-tier, per-week cost dashboards
- Estimated build: **5 days**

**Done condition:** Every feature passing through any tier has a row in `gauntlet_unit_econ` with all fields populated by real measurements, never operator estimates.

### Total Phase F effort

≈ **5–7 weeks** of engineering at one full-time engineer or two part-time. **This is the highest-leverage spend in the entire project.** Skip it and the factory remains a prototype no matter how many tiers graduate.

---

## Phase O — Open-loop hardening (the world inputs to the factory)

Until now the factory's inputs are operator-curated. Real businesses take inputs from real users, and real users are messier than operators.

**O1 — Input boundary**
- A single ingress point (`POST /v1/spec` or similar) where customers/users submit work
- Every input gets run through T10 (ambiguity) and T13 (adversarial) automatically *before* hitting any agent
- Inputs that fail those gates produce a clarification request, not a refusal — this is where the agent's product-judgment from T15 actually plays in production

**O2 — Customer-visible audit trail**
- Each shipped feature ships with a tamper-evident receipt: model versions, agent identities, gauntlet runs that signed off, the bug-source if any, the test that proves it works
- This is the customer's recourse if something breaks later — they can independently re-grade

**O3 — SLA / SLO**
- "Response time p95 < X hours" — measurable from O1's ingress timestamps
- "Pass-rate per tier ≥ Y" — measurable from F1's outcomes
- "Day-30 regression rate ≤ Z" — measurable from T12's tracking
- Publish them. Honor them. Track them per customer.

**O4 — Public transparency page**
- Lives at e.g. `your-domain.com/transparency`
- Auto-updated from F1's outputs
- Pass rates per tier (last 30 / 90 / 365 days), incidents (anonymized), known limitations, model versions in use
- Customers and prospects read this. Investors read this. So do regulators eventually.

**O5 — Legal / IP posture**
- Counsel-vetted answers to: copyright status of agent output; license inheritance from training data; indemnification terms; data residency; what happens if an agent introduces a CVE
- This is *not* optional for selling to enterprises and *not* solvable by an agent — get a lawyer

**O6 — Insurance**
- E&O or specific tech-platform coverage to cap downside on customer claims
- One bad output that costs a customer real money will not be the place to start figuring this out

**Done condition for Phase O:** A new customer can submit a real spec at O1's ingress, see it processed through the pipeline, receive output with a receipt, and would have legal recourse if it broke. None of these are properties you can claim by demoing T6 once.

Estimated wall time: **2–3 months** (most of this is legal/insurance, not engineering).

---

## Phase B — Business validation (does the factory pay for itself?)

Engineering capability is the table stakes. Unit economics are the question.

**B1 — Cohort #1: 5–10 paying customers**
- Real money, even if subsidized
- Each customer's work runs through the full T6–T17 + O1-O6 stack
- Each customer's outcomes are tracked: features shipped, incidents, churn signals, renewal intent
- 90 days minimum

**B2 — Pricing experiments**
- At least 3 pricing models tested across cohort #1: per-feature, per-month-subscription, per-outcome
- Cost per shipped feature (from F5) must be < 50% of customer's stated willingness-to-pay across all models, or unit economics are broken

**B3 — Customer interviews**
- Every cohort #1 customer interviewed monthly: what worked, what didn't, would they pay 2× as much, what would they hire human contractors for instead
- Find the disqualifying objection. If you can't, you don't know your market yet

**B4 — Renewal signal**
- 90 days in, at least 60% of cohort #1 must renew at standard pricing (no special discount)
- Below 60% means the product isn't sticky enough; back to the drawing board

**Done condition:** Defensible answer to "is this a business" — quantitative, not anecdotal. Outside finance reviewer signs off on the unit-economics model. At least one customer says "I'd pay 2× if I had to."

Estimated wall time: **3–6 months** of customer cycles.

---

## Phase S — Scale (the factory grows without breaking)

Only enter Phase S if Phase B's renewal signal is real.

**S1 — Multi-repo expansion**
- Cohort #1 customers' repos onboarded one at a time, with full T9-style discovery
- Each new repo's onboarding produces a `repo-conventions.json` and a baseline T6 run, all auditable

**S2 — Capacity planning**
- Compute, API rate limits, queue backpressure, cost ceilings per customer
- Auto-throttling when budgets approach limits

**S3 — Human team**
- The "dark factory" still needs humans. At minimum:
  - 1 platform engineer maintaining F1–F5
  - 1 customer engineer handling ambiguous specs at O1's ingress
  - 1 reviewer for F2's defect approvals
  - Counsel on retainer
- The fact that one human runs 100× more agent work than they could do themselves is the leverage. The fact that humans are still required is the honesty.

**S4 — Public reputation hygiene**
- A communication posture for incidents (when they happen, not if)
- A pre-mortem for the "viral broken AI" tweet
- Visible postmortems on the transparency page

**Done condition:** The factory can take a 10× increase in customer volume in 30 days without a corresponding 10× increase in operator attention. If the operator's hours go up linearly with volume, it's not a factory; it's still a workshop.

---

## Phase M — Moat (the gauntlet itself becomes the asset)

A graduated factory's most valuable property is **the accumulated gauntlet**.

- 50+ tiers
- Thousands of permanent verifier checks (from F2's auto-loop)
- Thousands of incident postmortems baked into checks
- Decades of equivalent-engineer hours of defect-finding embedded in the code

A competitor starting from scratch has to traverse the same path. **The discipline IS the moat.** Not the model, not the prompts, not even the agents — the accumulated checks.

To deepen the moat:

- **M1 — Patent the unique verifier patterns** if they're truly novel (consult counsel; not all are)
- **M2 — Open-source the gauntlet framework, keep the checks proprietary** — same play as Red Hat, GitLab, Sentry
- **M3 — Per-customer institutional knowledge** — each customer's defect history is an asset specific to that customer; lock-in increases with tenure
- **M4 — Reputation network effect** — published transparency numbers become a recruiting and sales tool that compounds

**Done condition:** A new competitor enters the market and your transparency-page numbers are ≥ 6 months ahead of theirs across all tiers. That gap is your moat. Defend it by continuing F2 and F3.

---

## Phase ∞ — Continuous evolution (forever)

The post-baseline factory is not a finished thing. New failure modes get discovered as the world changes. New tiers get added.

**Forever-loops:**

| Loop | Cadence | Owner |
|---|---|---|
| F1's scheduled gauntlet | Per-tier, see T17 cadence table | Platform engineer |
| F2's defect → check pipeline | Continuous | Reviewer + auto-drafter |
| F3's Sasha challenges | Continuous | Sasha agent (autonomous) |
| Model-update gauntlet re-run | On every model release | Platform engineer |
| New tier addition | Quarterly | Operator + outside reviewers |
| Customer postmortems | Per incident | Customer engineer + reviewer |
| Transparency page refresh | Monthly | Platform engineer |
| Outside-reviewer audit of the gauntlet itself | Annually | Operator pays for it |

The most dangerous moment for a factory is **the quarter after it last added a tier**. Capability ossifies. Adversarial drift accumulates. Customers churn quietly. Set a recurring calendar item: "what's our next tier?"

---

## Anti-patterns to actively avoid

| Trap | What it looks like | Why it kills |
|---|---|---|
| **Claiming graduation prematurely** | Marketing page says "fully autonomous" while T11 streak is still at 3 | T5R's failure mode at scale; once customers discover the gap your credibility is gone |
| **Hiding incidents** | Postmortems not published; "small bug fix" instead of "we shipped a CVE" | One leaked Slack screenshot ends the company |
| **Loosening verifier checks to keep pass rates high** | "We changed the threshold from 90% to 80% because the new model regressed" | T5R's failure mode at scale, again — the verifier is the contract; loosening it is fraud |
| **Treating defects as one-off fixes** | Defects fixed in code but never become permanent verifier checks | Same defect reappears next quarter; you learn nothing |
| **Conflating capable agents with autonomous business** | "GPT-5.5 can build software" therefore "we have a software factory" | The model is necessary, not sufficient; the moat is the gauntlet |
| **Treating the operator's attention as infinitely scalable** | Operator is in every loop; nobody else can run the factory | When the operator is sick / hires more / gets bored, the factory stops |
| **Skipping legal/insurance because "we're early"** | First indemnification request from a customer panics the team | Settling one such claim costs more than 2 years of insurance premiums |
| **Building T18, T19, T20 without F1–F5** | Long aspirational backlog, no compounding mechanism | Bicycle frame with five wheels, no chain |

---

## Founder discipline checklist (do these every Monday)

- [ ] Open `transparency-page` and verify last 7 days of pass rates updated on time
- [ ] Open `incidents/` and confirm every incident from last week has a postmortem-as-test in F2 queue
- [ ] Open `defects/` queue and approve/reject anything ≥ 7 days old
- [ ] Read Sasha's challenge log for last week; if she found 0 → suspect she's broken, not perfect
- [ ] Spot-check 3 random gauntlet runs from last week's daemon output
- [ ] Look at p95 cost trend; if it moved > 10% in 2 weeks, find out why before it moves more
- [ ] Read 1 customer interview verbatim
- [ ] Update "known limitations" page if anything new is true

A factory whose operator does this for 90 minutes every Monday holds. A factory whose operator does this every other month loses graduation within a quarter.

---

## The single most important number to watch

Once Phase F1 is live: **percentage of weekly gauntlet runs that passed last week AND would have passed each of the previous 3 weeks at the *current* verifier strictness.**

That number is the truth-rootedness of your factory in one scalar. If it trends down, something is leaking — either capability is regressing or the verifier is being loosened to compensate. Either way, urgent.

If it stays flat or up across a quarter, you have a real factory.

---

## TL;DR — the post-baseline arc, in order

```
Phase 0 — Validate graduation honestly                (1–2 weeks)
Phase F — Build flywheel (F1 → F2 → F5 → F3 → F4)     (5–7 weeks)
Phase O — Open-loop hardening                         (2–3 months)
Phase B — Business validation                         (3–6 months)
Phase S — Scale (only if B's renewal signal is real)  (6–12 months)
Phase M — Moat building                               (continuous)
Phase ∞ — Continuous evolution                        (forever)
```

**Cumulative wall time from "T17 first graduated" to "defensible business": ~9–18 months**, assuming Phase F runs in parallel with the back end of Phase 0 and you don't skip rungs. Anyone who tells you this is faster is lying about Phase 0.

The factory's value compounds with patience. **The single discipline that determines whether you compound or collapse is refusing to claim a phase complete before it's earned.** Today's session was a demonstration that you can hold that line. Hold it for two years and you have a moat nobody can replicate without traversing the same path.

That's the road.
