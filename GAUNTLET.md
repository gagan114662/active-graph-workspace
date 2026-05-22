# Dark Factory Gauntlet — 2026-05-20

Five sequential tasks dispatched by gagan via the assistant. The assistant is the judge: each frame must pass independent verification (mypy --strict, pytest, contract-anchored tests) before the team unlocks the next task.

**Code lives in `activegraph/`** (the inner subdirectory). All file paths below are relative to that subdirectory.

## Rules

- **Sequential**, not parallel. T1b does not start until T1a's frame is verified shipped. Same for T2 → T3 → T4.
- Each task ships as a regular frame: YAML spec in `activegraph/frames/`, evaluation log, status file, commits on `main` with a `Frame <id>:` prefix.
- **Model policy.** All Pentagon agents for this gauntlet must run `gpt-5.5`. This includes reviewers, adversarial agents, producers, coordinators, renamed canvas agents, and any newly created agents.
- **Honest evaluation.** If a predicate fails, it fails. Don't game the evaluator.
- **Stop on failure.** If a task's frame doesn't pass judge verification, halt the gauntlet, file an evaluation log entry explaining why, and wait for gagan's direction.
- **Continuous bottleneck feedback.** Every stalled agent, red predicate,
  unowned handoff, missing gate, permission mismatch, or review finding creates
  a `bottleneck.detected` entry in the frame logs before the next task opens.
  The entry must name the complexity level, source evidence, owner, and the
  feedback action that prevents recurrence. Repeated bottlenecks become either
  a new gate, a Purpose-doc routing rule, or a frame-yaml amendment.
- **Interpreter-backed work.** Core agents use the contract in
  `agent-os/INTERPRETER_CONTRACT.md`: shell, Python, git, test execution,
  scratch state, and literal-output capture. Interpreter output becomes trusted
  only after it is committed or copied into frame logs.
- **Skill-backed work.** Core agents use the runbooks in `agent-os/skills/`.
  Missing or skipped skill usage is itself a `bottleneck.detected` event.
- **Flywheel readiness.** A frame cannot be reopened as Pentagon-autonomous
  while `frames/flywheel-readiness.status` is red. The readiness gate must
  prove evidence indexing, clean proof status, Purpose coverage, interpreter
  proof, model audit, and activation protocol before the next handoff frame
  begins.

---

## T1a — Close Ring 0 docstring exemptions  *(easy)*

**Source**: `activegraph/docstring_gaps.toml` + CONTRACT v1.1 #4 Wave 1 / `activegraph/v1.1-plan.md` E-3.

Write real docstrings (Args / Returns / Raises / Examples — one-liner minimum, full preferred) for every symbol in the `[[exemptions]]` list in `activegraph/docstring_gaps.toml`. Remove each closed entry from that file as you close it.

**Acceptance (judge-verified)**:
- `activegraph/docstring_gaps.toml`'s `[[exemptions]]` list is empty.
- `python activegraph/scripts/gate_docstrings.py` exits 0.
- `pytest activegraph/tests/` fully green.
- CHANGELOG entry under a new patch heading.

---

## T1b — Close the `graph.relations()` doc-vs-impl gap  *(easy-medium)*

**Source**: `activegraph/CONTRACT-review-findings.md` Section 2 Finding A / Section 5 v1.0.4 #1.

`activegraph/docs/concepts/graph.md:43` shows `graph.relations(source=claim_id)` — a method that does not exist on `Graph`. Users hit `AttributeError` on first try. Two valid fixes; pick one and document the design rationale:

- **Doc-only**: change the doc to use `graph.get_relations(object_id=..., direction="outgoing")`.
- **Code-symmetric** (matches v1.0.3 #1 pattern): add `Graph.relations(type=None)` mirroring `View.relations(type=None)`, keep `get_relations` working, update the doc page.

**Acceptance (judge-verified)**:
- Picked fix lands.
- A new contract-anchored test verifies the documented example runs without `AttributeError`.
- Design rationale in the frame's spec yaml (Spec Skeptic signs off in writing).
- CHANGELOG entry.

---

## T2 — CLI-flag drift gate  *(medium)*

**Source**: `activegraph/v1.1-plan.md` D-1 (must-have).

Build a CI gate that catches CLI flag references in markdown docs that don't resolve to real flags in `activegraph/activegraph/cli/`. Today `--set`, `--memo`, `--search` appear in 8 markdown files but are absent from the CLI — this gate is what would have caught that drift before it shipped.

**Acceptance (judge-verified)**:
- `activegraph/tests/test_cli_flag_drift.py` exists and is parameterized over scanned docs.
- Detects a synthetic injected drift (test fixture: a doc that names a fake flag → test fails as expected).
- Passes against current `main` with an explicit allowlist for the F-1-pending flags (`--set`, `--memo`, `--search`).
- Wired into the same workflow file the wheel-completeness gate uses.

---

## T3 — `activegraph fork --set <pack>.<key>=<value>`  *(hard)*

**Source**: `activegraph/v1.1-plan.md` F-1 (must-have, medium-large).

Implement the CLI flag the docs already promise. Open design questions per CONTRACT v1.1 #1 — each must be answered in writing in the frame's spec yaml:

1. **Replay semantics for overridden forks.** Does replaying an overridden fork use the override or the original pack default?
2. **Error timing.** Fork-time validation vs. load-time vs. first-use?
3. **Type coercion failure.** `--set foo.threshold=hello` when threshold expects float — when and how does this fail?
4. **Schema migration on the `runs` row.** What column / where, and how does it stay backwards-compatible with existing run records?

Spec Skeptic signs off on each design call in writing before Code Owner implements.

**Acceptance (judge-verified)**:
- `activegraph/docs/cookbook/common-patterns.md#fork-with-a-pack-setting-override` example runs end-to-end via the CLI (no Python-API workaround needed).
- Replay-strict tests cover the overridden-fork case.
- Schema migration is reversible (downgrade script exists and tested).
- T2's drift gate goes green for `--set` (no longer drift).
- `pytest activegraph/tests/` fully green.
- CHANGELOG entry under v1.1 candidate heading.

---

## T4 — OpenAI tool-shape translation  *(very hard)*

**Source**: `activegraph/v1.1-plan.md` B-1 (must-have, large — "biggest item").

`Tool.to_definition()` currently emits Anthropic shape `{name, description, input_schema}` only. `OpenAIProvider.complete()` at `activegraph/activegraph/llm/openai.py:154` raises `LLMBehaviorError(reason="llm.network_error")` when `tools=` is non-empty. Close the gap.

Required work:
- Provider-aware tool-shape translation. Pick one shape and document the rationale: either parameterize `Tool.to_definition(provider="anthropic"|"openai")` or push shape conversion into the provider's `complete()`.
- `OpenAIProvider` tool_calls extraction path (OpenAI returns `tool_calls`, not `tool_use` content blocks).
- Parity test infrastructure: a fixture that runs the SAME `@tool`-using behavior against both providers and asserts identical event sequences.
- Error-semantics alignment with v0.6 #11 reason taxonomy.

**Acceptance (judge-verified)**:
- Parity test suite: identical `@behavior` runs identically across `AnthropicProvider` and `OpenAIProvider` (event types, ordering, terminal state).
- `pytest activegraph/tests/` fully green including new parity tests.
- mypy --strict clean on every modified module.
- Design rationale doc in `activegraph/docs/concepts/` or the frame's spec yaml.
- `OpenAIProvider.complete()` no longer raises the v1.1-pointer error for tool-using cases.
- CHANGELOG entry under v1.1 candidate heading.

---

## Judge protocol

After each task ships:

1. Goal Reaper posts the evaluation log + status file as the team's claim.
2. The assistant pulls the commit(s), runs the listed verifications in a clean shell, reads the diff.
3. If pass: assistant posts a one-line confirmation. Team unlocks the next task.
4. If partial pass (e.g., 12/15 predicates green): assistant posts the gap analysis and either accepts with caveats or kicks back for revision. Team decides whether to revise or proceed.
5. If failure: assistant posts the failing predicates with output. Team revises. Repeat verification.
6. Riley/Priya/Taylor append bottleneck learnings to the frame evidence so
   easy, medium, hard, and very-hard tasks form one continuous improvement loop.

Stop after T4. The gauntlet exists to measure end-to-end autonomy across difficulty levels, not to ship all of v1.1.
