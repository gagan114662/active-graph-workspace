# CS153 "AI Native Company" eval-loop + gbrain schema — backlog (2026-05-28)

Operator shared 4 Stanford CS153 slides + the github.com/garrytan/gbrain repo. What's useful for the
dark factory, distilled into backlog tasks P19–P22.

## CS153 slides
1. **Open-loop vs closed-loop company.** Open = info lives in human heads (DMs, meetings, vibes;
   agents see ~10% of state). Closed = every workflow produces artifacts agents read the FULL state
   (tickets, commits, Slack-not-DMs, recorded calls, docs). → **P22**: audit the factory for
   open-loop gaps (operator decisions in chat that never become artifacts) and capture them.
2. **"Evals are taste made executable."** The founder's taste must become runnable evals.
3. **"Generic benchmarks won't tell you whether your product works."** MMLU ≠ "did the collections
   agent upset a customer." Grade EACH call multi-dimensionally: (1) followed instructions?
   (2) correct? (3) preserved trust? (4) hit business goal? (5) domain-compliant? → **P19**:
   multi-dimensional per-call grading (today our judges are binary PASS/FAIL).
4. **"Founders build the evals" — the production eval loop:** capture traces → **convert failures to
   eval cases** → replay regressions → improve prompts/tools → **re-test before deploy**. We have
   traces (event log), replay (factory-replay), improve (SkillOpt); MISSING the auto
   failure→eval-case conversion and the re-test-before-deploy regression gate. → **P20**.

## gbrain schema (GBRAIN_RECOMMENDED_SCHEMA.md) — reusable conventions → P21
- **Per-directory README "local resolvers"** (what goes here / what does NOT), under a master
  RESOLVER.md (we built the master in #11; add the per-dir READMEs).
- **Compiled-Truth + Timeline page format**: rewritable synthesis above `---`, append-only timeline
  below. This is exactly how to restructure the 1200-line CLAUDE.md (activity log = the timeline).
- **schema.md + index.md catalog + log.md** ingest record.
- **Epistemic discipline**: every claim cites source (observed / self-described / inferred);
  confidence = interaction count; no single-datapoint generalizations; user corrections override.
  Pairs with our "sample size 1 ≠ reliability" + Brandon-B satisfaction-of-search.
- **Dedup-before-create + aliases frontmatter** (relevant to the fixture-* row dedup).
- **Weekly lint** (dedup, contradictions, staleness, orphans, MECE violations) — a maintenance pass.
- **Wire RESOLVER as a HARD RULE** in the agent config ("before editing X → read its routed docs"),
  not a suggestion.

## New backlog tasks
- ✅ **P19 — multi-dimensional per-call grading SHIPPED.** `scripts/grade-call.mjs` aggregates the
  factory's distributed signals into ONE 5-axis scorecard per call: followed_instructions (Theo),
  correct (commit landed / Rowan / rejected), preserved_trust (Sentinel), hit_goal (todo closed + no
  recurrence), domain_compliant (Grace / operator-scoped-path scan). Emits `call.graded`. `unknown`
  (no signal) is kept distinct from `fail`. 4/4 tests (grade-call.test.mjs). Runs on real calls.
- ✅ **P20 — production eval loop SHIPPED.** `scripts/eval-harvest-from-failures.mjs` converts real
  production signals into candidate judge eval cases (review.completed×judge.error → flipped label;
  non-synthetic attempt.rejected → FAIL case) written to `agent-os/judges/<judge>/harvested
  -candidates.jsonl` for operator promotion ("founders build the evals"). Proven: harvested 7 real
  rowan cases from 2056 events. `scripts/skillopt_judge_eval.py --regression-gate --skill <candidate>`
  re-tests a candidate vs the eval set and exits non-zero on regression (the re-test-before-deploy
  gate). The full loop is now closed: traces (event log) → convert failures to eval cases (harvester)
  → replay (factory-replay) → improve (SkillOpt) → re-test before deploy (regression gate).
- **P21** — gbrain schema adoption (extends RESOLVER #11 / per-agent-skills #18 / F4 memory #17).
- **P22** — closed-loop audit: capture human-head-only state as artifacts.

## Note (live evidence, not a task)
The shared desktop screenshot showed Theo posting an "rls probe — DO NOT DISPATCH — probe id 1f8bl3"
in a Pentagon read-only conversation, resolved as "Closing this todo as blocked_synthetic_probe." That
is the **synthetic-probe short-circuit working in production** (the pt.5 contamination fix) — a probe
correctly NOT dispatched. Good signal that the guard holds live.
