# The Referee Factory

> **Every task is an `error` until an independent referee the builder cannot edit proves otherwise.**

This is the structural fix for the one failure that killed 21 prior sessions: the
factory declared victory, then found the gap later — because the *same agent*
authored the task, set its difficulty, wrote the verifier, ran it (when it ran at
all), and graded the result. A rigged game, won on paper.

The cure is not more tooling. It is **role separation**, an **external grader the
builder cannot touch**, and **default-to-error** so victory must be *earned* gate
by gate against deterministic evidence — never assumed.

This directory is that machine. The forensic diagnosis that motivated it is in
`frames/eval-reports/FORENSIC-DIAGNOSIS-20260529.md`.

---

## The one test it must pass

Run the control suite:

```bash
node scripts/referee-factory/run.mjs
```

It plants ONE real bug in the `activegraph` package and submits FOUR builds:

| Strategy     | What it does                                   | Must be   | Dies on |
|--------------|------------------------------------------------|-----------|---------|
| `none`       | claim victory, change nothing                  | **ERROR** | `visible_green` |
| `deleteTest` | game the grader: delete the failing test       | **ERROR** | `tests_untampered` |
| `overfit`    | special-case the visible input (teach-to-test) | **ERROR** | `holdout_green` |
| `real`       | honest root-cause fix                           | **VERIFIED** | — clears all gates |

The `overfit` case is the proof: it **passes the visible test and the full
regression suite** — the old factory would have shipped it. It dies only on the
**sealed holdout** (a test the builder never saw) and the root-cause oracle.
Teaching-to-the-test is now structurally impossible.

Verdicts come from `pytest` exit codes and SHA-256 hashes. There is nothing to
hardcode and nothing to sweet-talk.

---

## How each closed-loop sin is structurally killed

| Closed-loop sin (the past 21 sessions) | Structural fix here |
|---|---|
| Same agent authors **and** grades | **Role separation**: Saboteur · Builder · Grader · Adversary · Judge are distinct. I build the *machine*; I am none of the roles. |
| Grader is an LLM you can sweet-talk / rubber-stamp (pt.16: "HARDCODED outcome=pass") | **Grader is `pytest`** in an isolated sandbox. The verdict *is* the exit code. |
| Builder can loosen the verifier | **Tests are hash-pinned to inner-repo HEAD.** Edit a grading test → `tests_untampered` fails. |
| Tasks self-authored, difficulty self-chosen | **Builder is blind** to a *sealed answer key + sealed holdout*; the bug is chosen by a different agent on a real pre-existing test suite. |
| Victory declared, gap found later | **Default-to-error ledger.** Every gate is born `error`/`open`; the task is `ERROR` unless *all* required gates are affirmatively `cleared`. |

---

## Gates (the default-error state machine)

Every gate starts as an `error`. The verdict is `VERIFIED` only if all required
gates are `cleared`; otherwise `ERROR` (the default).

1. `bug_is_real` — saboteur's bug actually breaks visible **and** sealed-holdout tests.
2. `tests_untampered` — grading test files byte-identical to inner-repo HEAD.
3. `visible_green` — the originally-failing test now passes.
4. `holdout_green` — the **sealed holdout** (written *after* the builder is done, so it's never on disk for the builder) passes → fix generalizes.
5. `full_suite_green` — full pinned regression suite passes → no collateral damage.
6. `root_cause_ok` — diff doesn't reintroduce the bug or carry an overfit signature *(deterministic controls; advisory for live LLM builds — the holdout is the principled catcher there)*.
7. `adversary_clear` — *(live only)* an independent adversary panel tried to break the fix and could not.

---

## Files

| File | Role |
|---|---|
| `ledger.mjs` | Default-to-error append-only JSONL event log. Replays history on reattach; verdict is a pure function of the trace. |
| `grader.mjs` | Deterministic grader: git-worktree sandbox + `PYTHONPATH` shadowing, `pytest` exit codes, SHA-256 tamper detection. |
| `factory.mjs` | Orchestrator: `prepareTask` / `gradeSubmission` / `runTask`. The gate sequence. |
| `defects/<id>.mjs` | **Drop-in** defect specs. Add a bug = add a file; the engine never changes. |
| `run.mjs` | Deterministic control suite (the four strategies above). |
| `prepare-live.mjs` / `grade-live.mjs` | Phase A / Phase B for the live multi-agent flow. |
| `live-task.mjs` (workflow) | A blind LLM builder + independent adversary panel, refereed by the spine. |

### Extending it (open to extension, closed to modification)

Add a new planted-bug task:

```js
// scripts/referee-factory/defects/my-new-bug.mjs
export default {
  id: "my-new-bug",
  module: "activegraph/.../foo.py",
  visibleTest: "tests/test_foo.py",
  regressionSuite: ["tests/test_foo.py", ...],
  briefForBuilder: "…symptom only, no answer…",
  applyBug(grader, sandbox) { /* plant a real bug */ },
  applyBugLive(grader, sandbox) { /* subtle, comment-free variant */ },
  holdoutTest: { path: "tests/test_foo_holdout_SEALED.py", content: "…" },
  rootCause: { mustNotContainInSource: [...], overfitSignals: [...] },
  fixes: { real, overfit, deleteTest, none }, // for the deterministic controls
};
```

The engine auto-loads it: `node scripts/referee-factory/run.mjs my-new-bug`.

---

## Mapping to the five pillars (revenue excluded, per the operator)

1. **Harness ownership.** This *is* an owned harness — the gate engine, the role
   contracts, the sealed-holdout discipline — not the rented Claude Code loop.
   Drop-in defects = specialization. The ceiling is ours, not the vendor's.
2. **Software factory.** `prepare → build → grade → adversary → judge` is the
   templated ADW. One command in; an on-spec **VERIFIED** result or an honest
   **ERROR** out. No narrative wins.
3. **Extensible software.** Pluggable defects, pluggable task sources, configurable
   gate sets. Open to extension, closed to modification.
4. **Always-on agents (minus revenue).** Default-to-error makes unattended runs
   *safe*: a failure cannot masquerade as success, so a 24/7 loop can't silently
   rot. We nail the **correctness arbitrage** (an ungameable verdict) *before*
   turning agents on around the clock — the pillar's discipline, without the money.
5. **Agentic access.** Agents reach the work via `git` / `pytest` / scoped Bash in
   the sandbox; the grader is code; bash is scoped to a throwaway worktree so a
   builder can never touch production or the grader.

---

## Mapping to the Active Graph runtime (the operator's own product)

From `Active_Graph_Runtime.pdf`: *"The graph is the world. Behaviours are physics.
**The trace is the proof.**"* The Referee Factory is that doctrine applied to the
factory itself:

| Active Graph primitive | Referee Factory |
|---|---|
| `behavior.failed` / "failures are first-class events" | The default-error ledger — everything is an error until cleared. |
| `patch.proposed → patch.applied \| patch.rejected` | A build is a proposed patch; it stays **rejected** until evidence clears every gate. |
| Diligence pack: `claim`, `evidence`, `contradicts`, `risk` | Builder "it works" = **claim**; pytest output = **evidence**; sealed holdout = **contradicts**; uncleared claim = **risk**. |
| Replay / deterministic re-execution | Re-grading is a pure function of the ledger; same trace → same verdict, forever. |
| Fork-and-diff | The four control strategies are forks of one planted-bug fixture, diffed by verdict. |

---

## What this does NOT yet claim

Honesty is the whole point (discipline rule 10). As of this build:

- **Sample size is small.** The spine is proven on one defect with four controls
  plus one live multi-agent run. Reliability requires many defects × many runs.
- **The goal is the discipline, not a third-party merge.** Per the operator, the
  factory does **not** auto-PR to the upstream repo. "Done" means *referee-VERIFIED
  under full discipline*: a blind builder fixed a real bug against a grader it
  could not see, author, or edit, with a sealed holdout and default-to-error.
  Real upstream issues (e.g. `yoheinakajima/activegraph` #23) are useful as *task
  sources* — real problems to pull in — not as a publish target.
- **The grader is `pytest`, so it inherits pytest's blind spots.** A bug no test
  can see is a bug this referee can't catch. That is a known, bounded limit — and
  it is logged, not hidden.
