# Dark Factory for `activegraph` — Team Design (v3)

> The graph is the world. Behaviors are physics. The trace is the proof.

The previous designs were too small and they trusted the agents too much.
Real-world software is shipped against adversaries — including the
adversary inside every LLM that wants to claim victory before the work
is done. A team that ships production-ready code has to be built around
that fact, not around the optimistic case where every agent does its
job honestly.

This is v3. Three architectural commitments:

1. **The team IS an activegraph runtime executed against the project
   repository.** Tasks are `Frame`s. Done is a `success_criteria`
   predicate, not an agent's word. The `Runtime.run_until(predicate)`
   loop is the literal driver. Activegraph's own primitives — `Frame`,
   `goal.created`, `runtime.idle`, `runtime.budget_exhausted`,
   `permissions` — are the dark factory's primitives.
2. **Premature victory is the failure mode that defines the design.**
   Every constructive behavior is paired with an adversarial behavior
   whose job is to find the holes. No claim of done bypasses the
   verification trinity (constructive proof + adversarial proof +
   replay proof). All three required. None sufficient on its own.
3. **The dark factory ships as a pack.** `activegraph[darkfactory]`.
   Object types, behaviors, tools, prompts — same shape as the
   Diligence pack. The framework recursive-self-applies. The team
   that builds activegraph is itself an activegraph program.

---

## Part I — The Frame is the source of truth

`activegraph/frame.py` already defines what we need:

```python
@dataclass
class Frame:
    goal: str
    id: Optional[str] = None
    constraints: list[str] = field(default_factory=list)
    success_criteria: list[str] = field(default_factory=list)
    permissions: list[str] = field(default_factory=list)
```

Every dark factory task is a Frame, written before any work begins.
Example for the type-completeness backlog (CONTRACT v1.1 #3):

```python
Frame(
    goal="Promote activegraph/runtime/scheduler.py from dirty to "
         "clean in the mypy --strict allowlist.",
    constraints=[
        "CONTRACT v1.0 #C5 (allowlist-driven strict mode)",
        "CONTRACT v1.1 #3 (type-completeness milestone)",
        "Test discipline: no live network in CI",
        "Discipline pattern: audit-then-baseline-then-narrow",
    ],
    success_criteria=[
        # Each criterion is an executable predicate, evaluated by
        # Goal Reaper against project graph state. Not a description.
        "scheduler_in_mypy_files",          # parse pyproject.toml
        "scheduler_in_mypy_overrides",      # parse pyproject.toml
        "mypy_strict_passes_full_allowlist", # subprocess: mypy
        "docstring_coverage_ring0_ge_92",   # subprocess: audit script
        "docstring_coverage_ring1_ge_847",  # subprocess: audit script
        "pytest_full_suite_passes",         # subprocess: pytest
        "type_report_updated",              # diff TYPE_REPORT.md
        "contract_amendment_present",       # grep CONTRACT.md
        "changelog_entry_present",          # grep CHANGELOG.md
        "no_changes_outside_permissions",   # git diff vs allowlist
        "wheel_completeness_passes",        # subprocess: wheel gate
        "deploy_verification_passes",       # subprocess: deploy gate
    ],
    permissions=[
        "activegraph/runtime/scheduler.py:rw",
        "TYPE_REPORT.md:rw",
        "CONTRACT.md:rw",
        "CHANGELOG.md:rw",
        "tests/**:rw",
        "pyproject.toml:rw",  # mypy file lists live here
    ],
)
```

`Runtime.run_until(predicate)` already exists in
`activegraph/runtime/runtime.py:563` — takes a predicate over the
graph, runs the loop until true. The dark factory's main entry point
is one line.

No agent can mark a frame done. The loop terminates only when
`Runtime.run_until` sees the predicate evaluate true — which means
the project state actually matches the goal.

---

## Part II — The catalog of vibe-coded slop

Real failure modes observed in real LLM coding sessions, and the
specific behavior or policy in this design that prevents each.

1. **Self-grading** — Agent runs test, misreads output, reports passing when it failed. *Defeated by:* Goal Reaper runs criteria itself; never trusts agent self-report.
2. **Stubbing the hard part** — `raise NotImplementedError` with task marked done. *Defeated by:* `gate.stub.detected` greps diff for stub patterns.
3. **Hallucinated APIs** — References a function that doesn't exist. *Defeated by:* Replay Validator runs in fresh venv against built wheel.
4. **Test laundering** — Hardcodes the test's expected output. *Defeated by:* Test Adversary writes property-based tests; Code Reviewer reads diff without test context.
5. **Silent failure** — Wraps hard call in `try/except: pass`. *Defeated by:* lint gate fails bare except; behavior-failed events surface.
6. **Premature closure** — Declares done before edges covered. *Defeated by:* Spec Skeptic enumerates edge cases; predicates check coverage.
7. **Confident assertion without verification** — "Should work because X". *Defeated by:* claims must cite file:line; only "did" backed by trace.
8. **Skipping hard tests** — "I'll skip the integration tests for now." *Defeated by:* Goal Reaper checks specific gate predicates.
9. **Wrong-branch commit** — Commits to main accidentally. *Defeated by:* Frame.permissions locks branch identity.
10. **Drift from spec** — Spec said X, code does Y. *Defeated by:* Code Reviewer reads spec + diff with no other context.
11. **False positive review** — "Looks good" without reading. *Defeated by:* Reviewer must cite specific lines; generic "LGTM" rejected.
12. **Cargo-cult fixes** — Changes unrelated logic to make a test pass. *Defeated by:* Blast radius check by Code Reviewer.
13. **Replay non-determinism** — Passes once, fails on retry. *Defeated by:* RecordedLLMProvider; tests run 3x with different seeds.
14. **Documentation drift** — Code changes, docs don't. *Defeated by:* Docs Owner subscribes to `code.committed`.
15. **"Works on my machine"** — Code passes in dev, fails in fresh env. *Defeated by:* Replay Validator runs in clean venv every frame.
16. **Fake fix** — Edits test instead of code. *Defeated by:* Test Owner separate write scope from Code Owner.
17. **Lost context across retries** — No memory of why prior attempt failed. *Defeated by:* Frame.id persists across retries.
18. **Optimistic time estimates** — "Almost done" forever. *Defeated by:* Budget Marshal auto-escalates at 80% budget.
19. **Successful build, broken artifact** — Source passes, wheel missing data files. *Defeated by:* Wheel-completeness predicate per-frame.
20. **Backward-incompatible change shipped as patch** — *Defeated by:* Compatibility Auditor runs prior versions' tests.
21. **Performance regression unnoticed** — Passes correctness but 10x slower. *Defeated by:* Performance Sentinel + benchmark suite.
22. **Security regression unnoticed** — New dep has known CVE. *Defeated by:* Security Auditor runs `pip-audit`.
23. **Test order dependence** — Passes alone, fails together. *Defeated by:* Pytest random-order in CI.
24. **Coverage theater** — Test executes line without asserting. *Defeated by:* Test Adversary requires assertion density.
25. **The 90% problem** — 9 ships succeed, 10th breaks production. *Defeated by:* Frame budget bounds retry; over-budget escalates.

If a failure mode isn't covered, the design is wrong. Add it.

---

## Part III — The 18 behaviors, in 5 departments

### Department 1: Frame Operations (3)
- **Frame Architect** — drafts the Frame (goal, constraints, success_criteria, permissions). Refuses to start until all four present and predicates are callable.
- **Goal Reaper** — sole authority on done. Subscribes to `runtime.idle`. Evaluates every predicate. Emits `goal.satisfied` only when all true.
- **Budget Marshal** — wraps activegraph's `Budget`. Per-frame spend tracking. Warns at 80%, forces escalation at 100%.

### Department 2: Construction (5 owners — file-system-scoped)
- **Spec Owner** (`examples/*.py`) — killer-demo spec first
- **Code Owner** (`activegraph/**/*.py`) — implementation only, no tests
- **Test Owner** (`tests/**`, fixtures) — failing test from spec BEFORE code; determinism guardian
- **CONTRACT Owner** (`CONTRACT.md`, `v1.1-plan.md`, `TYPE_REPORT.md`, etc.) — numbered amendments + contradiction scans
- **Docs Owner** (`docs/**`, `CHANGELOG.md`, error reference prose) — sibling-pair cross-ref graph as data

### Department 3: Adversarial QA (4)
- **Spec Skeptic** — re-reads spec for gaps and edge cases
- **Test Adversary** — property/fuzz tests trying to break the code
- **Code Reviewer** — reads ONLY diff + spec; no prior context to be fooled by
- **Replay Validator** — fresh venv, fresh wheel install, spec end-to-end

### Department 4: Observability (3)
- **Gate Sentinel** — runs all six gates, fires per-gate events (granular)
- **Fork Debugger** — on `gate.*.red`, forks pre-change, structurally diffs
- **Trace Archivist** — every frame's event log is queryable + replayable

### Department 5: Production Readiness (3)
- **Compatibility Auditor** — prior N versions' test suites against new code
- **Performance Sentinel** — benchmark regression detection
- **Security Auditor** — pip-audit + SAST + secret scan

---

## Part IV — The Verification Trinity

Every frame closes only when all three independent proofs pass:

```
                    Frame opened
                          │
       ┌──────────────────┼──────────────────┐
       │                  │                  │
       ▼                  ▼                  ▼
  CONSTRUCTIVE       ADVERSARIAL          REPLAY
  Goal Reaper        Spec Skeptic         Replay Validator
  evaluates all      Test Adversary       wipes env,
  predicates         Code Reviewer        installs wheel,
                                          runs spec
       │                  │                  │
       └──────────────────┼──────────────────┘
                          ▼
                   goal.satisfied
                   frame.closed
                          │
                          ▼
                   you review & merge
```

Any one missing → frame not satisfied. Goal Reaper does not fire
`goal.satisfied` unless every leaf is green. This is the
architectural answer to "the model said it was done."

---

## Part V — Capability scoping (three layers stack)

- **File-system write permissions** — owners can only write their owned paths
- **`Frame.permissions` whitelist** — per-frame narrowing
- **Budget per behavior per frame** — looped > N events with no graph delta → escalate

---

## Part VI — Human-in-the-loop (event-subscribed, not coordinator-mediated)

You subscribe directly to a feed. The actual artifact shows up, not a paraphrase:

- `frame.ambiguous` (Frame Architect) — issue text doesn't yield a testable goal
- `spec.ambiguous` (Spec Owner) — spec can't be written deterministically
- `spec.gap.found` severe (Spec Skeptic)
- `public_api.change.proposed` (Code Owner)
- `test.requires_live_network` (Test Owner)
- `regression.discovered` severe (Test Adversary)
- `replay.red` (Replay Validator) — shipping artifact is broken
- `contract.contradiction.detected` (CONTRACT Owner)
- `series.proposed` (Code Owner) — split into N PRs
- `backcompat.break.detected` (Compatibility Auditor)
- `perf.regression.detected` severe (Performance Sentinel)
- `security.finding` critical (Security Auditor)
- `budget.exhausted` (Budget Marshal)
- `goal.satisfied` (Goal Reaper) — ready for your merge

While you're gated on one frame, every other frame keeps running.

---

## Part VII — The team ships as a pack

`activegraph[darkfactory]` — same shape as `activegraph.packs.diligence`:

```
activegraph/packs/darkfactory/
├── object_types.py     # Frame, ProjectArtifact, Predicate
├── behaviors.py        # 18 @behavior decorators
├── tools.py            # subprocess wrappers
├── prompts/*.md        # persona prompts
├── settings.py         # budgets, thresholds
└── fixtures/           # recorded LLM responses for the pack's tests
```

```bash
activegraph darkfactory init                  # scaffold frames/ dir
activegraph darkfactory open <frame.yaml>     # opens a frame
activegraph darkfactory status                # active/blocked/waiting
activegraph darkfactory replay --frame=<id>   # full trace replay
activegraph darkfactory fork --frame=<id> --at-event=<n>
```

The dark factory's own tests use `RecordedLLMProvider`. Recursive consistency.

---

## Part VIII — Phased rollout

Don't run 18 agents on day one.

- **Phase 1 — Anti-slop floor (6 agents):** Frame Architect, Goal Reaper, Spec Owner, Code Owner, Test Owner, Gate Sentinel. Ship one frame end-to-end before adding anything.
- **Phase 2 — Adversarial floor (10):** + Spec Skeptic, Code Reviewer, Test Adversary, Budget Marshal
- **Phase 3 — Production-readiness floor (14):** + Replay Validator, Compatibility Auditor, Fork Debugger, Trace Archivist
- **Phase 4 — Full team (18):** + CONTRACT Owner, Docs Owner, Performance Sentinel, Security Auditor
- **Phase 5 — Parallel teams:** Multiple frame queues, one team per milestone

---

## Part IX — Why this is different from earlier designs

Earlier versions tried to be elegant and trusted the agents. They were 5–7
agents in a clean architecture. They would have shipped slop.

This version is built around the assumption that **every agent will, at
some point, lie about whether it's done.** The architecture exists to make
that lie inconsequential:

- The Frame says what done means.
- Goal Reaper, independently, verifies.
- The adversarial department independently tries to break it.
- Replay Validator independently builds and runs the artifact.
- The trace independently records what happened.
- You independently approve the merge.

Six independent checks. An agent that wants to fake completion would have
to fake the file system state, the subprocess output, the adversaries'
read of the diff, the wheel install in a clean venv, the event log, and
your read of the final PR — simultaneously. That's not premature victory;
that's a coordinated lie no current model can sustain.

If a frame closes `goal.satisfied`, it's because the project state actually
matches the goal. That's what production-ready means in practice: the
system's "done" claim is backed by evidence the system cannot manufacture.

The graph is the world. Behaviors are physics. The trace is the proof.
