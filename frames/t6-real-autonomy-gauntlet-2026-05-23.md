# T6 — Real Autonomy Gauntlet (Spec)

**Date:** 2026-05-23
**Repo:** `/Users/gaganarora/Desktop/my projects/active_graph`
**Target package:** `activegraph/` (Python, pytest, uv, mkdocs)
**Predecessor:** T5R proved the **activation + evidence pipeline**. T6 is designed to prove **engineering capability** in a transcription-resistant, auditable way.

## Why T6 exists

The T5R gauntlet's "easy/medium/hard/extra-hard" tasks could all be completed by an agent that can copy text from a prompt into a file. T6 changes that. Every tier here has a verifier whose pass/fail is derived from one or more of:

- `pytest` exit codes against the real test tree
- `git` history (separate commits, real diffs against `activegraph/activegraph/`)
- `coverage` deltas
- `mkdocs build --strict`
- Live rows in the event store, with required causal parents
- Cross-references between artifacts that must agree

Faking any one of these breaks at least two verifier checks.

## Hash convention

| Tier | Hash |
| --- | --- |
| Easy | `T6_NATIVE_EASY_20260523` |
| Medium | `T6_NATIVE_MEDIUM_20260523` |
| Hard | `T6_NATIVE_HARD_20260523` |
| Extra-hard | `T6_NATIVE_EXTRA_HARD_20260523` |

## Org-chart routing

| Tier | Agent(s) |
| --- | --- |
| Easy | Maya (Code Owner) |
| Medium | Maya (Code Owner) |
| Hard | Maya (Code Owner), with adversarial review by Quinn (Test Adversary) before sign-off |
| Extra-hard | **Sofia (Spec) → Maya (Code) → Quinn (Test Adversary) → Sam (Docs) → Riley (Evidence Lead)** — full dark-factory handoff chain, each step logged as an event with the prior step's ACK id as causal parent |

---

## EASY — `T6_NATIVE_EASY_20260523`

**Capability tested:** Localize a real gap in the codebase → make a minimal correct change → prove no regression.

**Instruction file:** `frames/t6-native-easy-instruction-20260523.txt`

```
NATIVE_GAUNTLET EASY T6_NATIVE_EASY_20260523

Maya, this is a native repo task for /Users/gaganarora/Desktop/my projects/active_graph/activegraph.

1. cd into activegraph/. Confirm pwd and `git rev-parse --short HEAD`.
2. Run the full pytest suite and capture the baseline summary line:
     uv run pytest -q --tb=no 2>&1 | tail -3
   Record `pytest_before` as the integer count of passing tests.
3. Pick ONE public function in activegraph/activegraph/ (not in tests/, not
   private with leading underscore) that has BOTH:
     (a) no docstring, and
     (b) at least one parameter OR the return value missing a type hint.
   Record file:line and the fully qualified symbol name.
4. Add a docstring matching activegraph/CONTRACT.md's documented format
   (Args / Returns / Raises sections as applicable) AND complete all missing
   annotations on that function. Do NOT change runtime behavior.
5. Re-run pytest. `pytest_after` MUST equal `pytest_before`.
6. Run `uv run ruff check activegraph/activegraph/` — must exit 0.
7. Create frames/t6-native-gauntlet-easy-20260523.proof with EXACTLY these
   keys, in this order:
     hash=T6_NATIVE_EASY_20260523
     pwd=<pwd output>
     head=<git short head>
     target_file=<relative path>:<line number>
     target_symbol=<fully.qualified.name>
     pytest_before=<int>
     pytest_after=<int>
     ruff_exit=0
     verdict=native_easy_done
8. Reply exactly:
   MAYA_NATIVE_GAUNTLET_ACK T6_NATIVE_EASY_20260523 EASY frames/t6-native-gauntlet-easy-20260523.proof
```

**Verifier requirements (post-commit):**
- `target_file:target_symbol` exists at HEAD and has a docstring + complete annotations (use `ast` to parse).
- `pytest_before == pytest_after` AND both ≥ the project's current passing-count floor (set this from a prior known-good run).
- Event store has an `agent_edit` event referencing `target_file` and authored by Maya within the last 24h.

---

## MEDIUM — `T6_NATIVE_MEDIUM_20260523`

**Capability tested:** Read → understand existing behavior → write a black-box test whose coverage delta is real.

**Instruction file:** `frames/t6-native-medium-instruction-20260523.txt`

```
NATIVE_GAUNTLET MEDIUM T6_NATIVE_MEDIUM_20260523

1. cd into activegraph/. Confirm pwd and short HEAD.
2. Capture baseline test count:
     uv run pytest --collect-only -q 2>&1 | tail -3
   Record as `pytest_collect_before`.
3. Capture baseline line coverage for activegraph/activegraph/:
     uv run coverage run -m pytest -q && uv run coverage report --include="activegraph/activegraph/*" 2>&1 | tail -1
   Record the TOTAL covered-statements count as `cov_lines_before`.
4. Pick ONE public API surface in activegraph/activegraph/ that is currently
   NOT covered by any file in activegraph/tests/. Prove the gap:
     uv run pytest --collect-only -q -k <symbol> 2>&1
   must show 0 collected tests for that symbol.
5. Write activegraph/tests/test_<feature>_coverage.py with AT LEAST 2 test
   functions exercising distinct configurations of the API (e.g. happy path
   plus one boundary or error condition). Do NOT mock the API under test.
6. Run the new test file alone — all green.
7. Run the full suite — `pytest_collect_after - pytest_collect_before` MUST
   equal the number of new test functions you added.
8. Re-run coverage. `cov_lines_after - cov_lines_before` MUST be > 0.
9. Create frames/t6-native-gauntlet-medium-20260523.proof:
     hash=T6_NATIVE_MEDIUM_20260523
     pwd=<pwd>
     head=<git short head>
     uncovered_symbol=<module.Class.method>
     test_file=activegraph/tests/test_<feature>_coverage.py
     new_test_count=<int>
     pytest_collect_before=<int>
     pytest_collect_after=<int>
     cov_lines_before=<int>
     cov_lines_after=<int>
     cov_delta=<after - before>
     verdict=native_medium_done
10. Reply exactly:
    MAYA_NATIVE_GAUNTLET_ACK T6_NATIVE_MEDIUM_20260523 MEDIUM frames/t6-native-gauntlet-medium-20260523.proof
```

**Verifier requirements:**
- `pytest --collect-only -k <uncovered_symbol>` returns ≥ 2 tests at HEAD.
- `pytest_collect_after - pytest_collect_before == new_test_count`.
- Coverage re-run by verifier reproduces `cov_delta > 0`.
- Event store has a `test_added` event with `test_file` path attached.

---

## HARD — `T6_NATIVE_HARD_20260523`

**Capability tested:** Investigate → reproduce as failing test → fix → prove fix with separate commits.

**Instruction file:** `frames/t6-native-hard-instruction-20260523.txt`

```
NATIVE_GAUNTLET HARD T6_NATIVE_HARD_20260523

1. cd into activegraph/. Confirm pwd and short HEAD.
2. Find a REAL bug. Acceptable sources, in priority order:
     (a) A function whose docstring promises behavior the code does not deliver.
     (b) A README/mkdocs example that does not execute cleanly verbatim.
     (c) A TODO/FIXME/XXX comment that names a concrete defect (not a wish).
     (d) An xfail/skip in tests/ whose reason is "bug" or "TODO".
   Record the source as bug_source.
3. Write a FAILING test FIRST. File: activegraph/tests/test_<bug_handle>_regression.py
   The test must have a module docstring containing:
     - Where you found the bug (file:line or doc path)
     - What correct behavior should look like
     - Why the current behavior is wrong
4. Run the new test — it MUST FAIL. Capture the failure summary line.
5. Commit the failing test as commit A:
     git add activegraph/tests/test_<bug_handle>_regression.py
     git commit -m "Reproduce bug: <one-line summary>"
   Record commit A sha.
6. Fix the underlying code in activegraph/activegraph/ with the MINIMUM diff
   that makes the test pass. Do not touch the test you just wrote.
7. Run the full suite — all green.
8. Commit the fix as commit B:
     git add activegraph/activegraph/
     git commit -m "Fix <bug_handle>: <one-line summary>"
   Record commit B sha.
9. Quinn (Test Adversary) must independently verify by checking out commit A
   and confirming the test fails, then checking out commit B and confirming
   it passes. Quinn ACKs with a separate event:
     QUINN_REGRESSION_VERIFIED T6_NATIVE_HARD_20260523 <commitA> <commitB>
10. Create frames/t6-native-gauntlet-hard-20260523.proof:
     hash=T6_NATIVE_HARD_20260523
     pwd=<pwd>
     head=<git short head>
     bug_source=<file:line OR docs path OR test marker>
     bug_summary=<one line>
     failing_test_commit=<commit A sha>
     fix_commit=<commit B sha>
     test_file=activegraph/tests/test_<bug_handle>_regression.py
     quinn_verification_event=<event id>
     verdict=native_hard_done
11. Reply exactly:
    MAYA_NATIVE_GAUNTLET_ACK T6_NATIVE_HARD_20260523 HARD frames/t6-native-gauntlet-hard-20260523.proof
```

**Verifier requirements (this is where the real work happens):**
- `git show <commit A> -- $test_file` exists.
- `git stash && git checkout <commit A> && uv run pytest $test_file` exits NON-ZERO.
- `git checkout <commit B> && uv run pytest $test_file` exits ZERO.
- Diff between A and B touches `activegraph/activegraph/`, not just `tests/`.
- Event store has BOTH `failing_test_added` (by Maya) and `bug_fixed` (by Maya) and `regression_verified` (by Quinn) events, the last with the prior two as causal parents.

---

## EXTRA-HARD — `T6_NATIVE_EXTRA_HARD_20260523`

**Capability tested:** Five-agent dark-factory handoff producing a real, shippable feature with auditable causality.

**Subject feature:** `activegraph events tail` CLI subcommand — prints the last N events from the active event store as newline-delimited JSON. Flags: `--n <int>` (default 20), `--since <iso-timestamp>`, `--filter <substring>`. Output schema: each line is a JSON object with at least `id`, `ts`, `kind`, `payload`, `parent_id`.

**Handoff chain (each step is its own instruction file; each step ACKs with the prior step's ACK id as causal parent in the event store):**

### Step 1 — Sofia (Spec Owner)
**Instruction file:** `frames/t6-native-extra-hard-1-sofia-20260523.txt`
- Write `activegraph/docs/specs/events-tail.md` containing: CLI contract, exact output schema, error modes (no store / empty store / malformed flags / unknown filter), the auditability claim that the command itself emits an `events_tail_invoked` event.
- Sofia ACK: `SOFIA_SPEC_DELIVERED T6_NATIVE_EXTRA_HARD_20260523 STEP1 activegraph/docs/specs/events-tail.md`

### Step 2 — Maya (Code Owner)
**Instruction file:** `frames/t6-native-extra-hard-2-maya-20260523.txt`
- Implement in `activegraph/activegraph/cli/` following the patterns exercised by `activegraph/tests/test_cli_fork_set.py`.
- The implementation MUST emit an `events_tail_invoked` event each time the command runs.
- Maya ACK: `MAYA_IMPL_DELIVERED T6_NATIVE_EXTRA_HARD_20260523 STEP2 <impl_paths>` with causal parent = Sofia's ACK event id.

### Step 3 — Quinn (Test Adversary)
**Instruction file:** `frames/t6-native-extra-hard-3-quinn-20260523.txt`
- Write `activegraph/tests/test_cli_events_tail.py` with at least 4 tests: happy path, `--since` filter, `--filter` substring, empty-store. No mocking of the event store — use a real fixture store.
- ALSO write at least 2 adversarial tests in the same file probing the error modes Sofia specified. At least one of Quinn's adversarial tests must FAIL against Maya's current implementation, forcing a fix. (This is the point of having a Test Adversary in the chain.)
- After Maya fixes, all tests pass.
- Quinn ACK: `QUINN_TESTS_DELIVERED T6_NATIVE_EXTRA_HARD_20260523 STEP3 <test_path> <adversarial_finding_id>` with causal parent = Maya's ACK event id.

### Step 4 — Sam (Docs Owner)
**Instruction file:** `frames/t6-native-extra-hard-4-sam-20260523.txt`
- Update `activegraph/mkdocs.yml` nav to include the new spec page.
- Add a user-facing how-to page at `activegraph/docs/how-to/tail-events.md`.
- Run `uv run mkdocs build --strict` — must exit 0.
- Sam ACK: `SAM_DOCS_DELIVERED T6_NATIVE_EXTRA_HARD_20260523 STEP4 activegraph/docs/how-to/tail-events.md` with causal parent = Quinn's ACK event id.

### Step 5 — Riley (Evidence Lead)
**Instruction file:** `frames/t6-native-extra-hard-5-riley-20260523.txt`
- Run the new command live: `uv run activegraph events tail --n 5 --json`. Capture the `self_audit_event_id` from the event store.
- Run the full suite, ruff, mkdocs strict — all must pass.
- Assemble `frames/t6-native-gauntlet-extra-hard-20260523.proof`:
  ```
  hash=T6_NATIVE_EXTRA_HARD_20260523
  pwd=<pwd>
  head=<git short head>
  spec_path=activegraph/docs/specs/events-tail.md
  impl_paths=<comma-separated>
  test_path=activegraph/tests/test_cli_events_tail.py
  new_test_count=<int>
  adversarial_finding_id=<event id from Quinn>
  docs_how_to_path=activegraph/docs/how-to/tail-events.md
  mkdocs_strict_exit=0
  pytest_after=<int>
  ruff_exit=0
  self_audit_event_id=<uuid>
  causal_chain=sofia=<id>,maya=<id>,quinn=<id>,sam=<id>,riley=<id>
  verdict=native_extra_hard_done
  ```
- Riley ACK: `RILEY_EVIDENCE_DELIVERED T6_NATIVE_EXTRA_HARD_20260523 STEP5 frames/t6-native-gauntlet-extra-hard-20260523.proof` with causal parent = Sam's ACK event id.

**Verifier requirements (cross-artifact):**
- Spec, impl, tests, how-to page, mkdocs entry all present at HEAD.
- `uv run activegraph events tail --n 1 --json | head -1 | python -c "import json,sys; json.loads(sys.stdin.read())"` exits 0.
- `self_audit_event_id` resolves to a real row in the event store with `kind=events_tail_invoked`.
- `adversarial_finding_id` resolves to a real `quinn_finding` event that was later marked resolved by a Maya `bug_fixed` event.
- The five-step `causal_chain` is a valid linked list in the event store: each ACK event's `parent_id` matches the preceding step.
- `pytest_after` ≥ floor; `mkdocs_strict_exit == 0`; `ruff_exit == 0`.

---

## Verifier extensions for `scripts/verify-pentagon-autonomy-from-logs.mjs`

The existing verifier checks T5R-style ACKs and proof files. T6 needs new checks. **Two options:**

### Option A (recommended for first run): I (or you) sketch and commit the extensions
Add the following check categories to the verifier. Each is a `PASS`/`FAIL` line in the same style as the existing `PASS live DB native ...` checks.

```javascript
// New flag: --t6
// Activated by --t6, all T6 checks run in addition to existing ones.

// EASY checks
PASS T6 easy proof file exists
PASS T6 easy target_file:target_symbol is real and has docstring
PASS T6 easy target_symbol has complete type annotations (ast parse)
PASS T6 easy pytest_before == pytest_after, both >= FLOOR
PASS T6 easy event store has agent_edit event from Maya in last 24h

// MEDIUM checks
PASS T6 medium proof file exists
PASS T6 medium uncovered_symbol now has >= 2 collected tests
PASS T6 medium pytest_collect_after - before == new_test_count
PASS T6 medium re-run coverage shows cov_delta > 0
PASS T6 medium event store has test_added event with test_file

// HARD checks
PASS T6 hard proof file exists
PASS T6 hard failing_test_commit exists in git history
PASS T6 hard fix_commit exists in git history and is descendant of failing_test_commit
PASS T6 hard checkout(A) && pytest $test_file exits non-zero
PASS T6 hard checkout(B) && pytest $test_file exits zero
PASS T6 hard diff(A..B) touches activegraph/activegraph/ (not tests-only)
PASS T6 hard event store has failing_test_added, bug_fixed, regression_verified events with correct causal parents

// EXTRA-HARD checks
PASS T6 xhard all 5 instruction files exist
PASS T6 xhard spec/impl/test/how-to paths all exist at HEAD
PASS T6 xhard `activegraph events tail --n 1 --json` exits 0 and first line is valid JSON
PASS T6 xhard self_audit_event_id resolves to events_tail_invoked event
PASS T6 xhard adversarial_finding_id resolves to quinn_finding linked to a later bug_fixed
PASS T6 xhard causal_chain sofia->maya->quinn->sam->riley is a valid parent chain in event store
PASS T6 xhard pytest_after >= FLOOR, mkdocs_strict_exit == 0, ruff_exit == 0
```

Summary verdict: `t6_real_autonomy_verified`. Final pass count target: ≥ 27 new checks on top of the existing 344.

### Option B (the more honest test of the system): Make verifier extension PART of the T6 gauntlet
- Add a **T6_NATIVE_VERIFIER_GATE** sub-task that an agent (suggestion: Grace, Gate Sentinel) must complete BEFORE the T6 gauntlet itself can pass.
- Grace's task: read this spec, write the verifier additions in `scripts/verify-pentagon-autonomy-from-logs.mjs --t6` mode, write tests for the verifier itself (i.e. inject a known-bad proof and assert the verifier rejects it), and ACK.
- Only after Grace's gate ACK is in the event store can the Easy → Extra-hard chain begin.
- This is harder because it forces the system to prove it can **build its own quality gates**. It is the truer dark-factory test.

**My recommendation:** run Option A first, then once the agents pass T6 cleanly, commission Grace to redo the verifier as T7's preamble. That preserves a working baseline while still pushing toward full self-build.

---

## Failure modes this gauntlet specifically catches

- **Transcription:** verifier checks artifacts the agent must have produced from scratch (real bugs, real coverage deltas, real failing-then-passing commits).
- **Hallucinated work:** every claim in a proof file is checked against the file system or the event store.
- **Skipped steps:** event store causal-chain check catches missing handoffs.
- **Mock-only tests:** medium tier requires coverage delta to be > 0, so `assert True` won't move the needle.
- **Test-only diffs masquerading as fixes:** hard tier requires the A..B diff to touch source code, not just tests.
- **Docs drift:** extra-hard runs `mkdocs build --strict`, which fails on broken links and unreferenced pages.

## Pre-flight checklist (operator)

Before triggering the gauntlet on 2026-05-23:

- [ ] `activegraph/` working tree clean (no uncommitted changes)
- [ ] Baseline `pytest_before` count recorded as the verifier's FLOOR
- [ ] Baseline `coverage` numbers snapshotted
- [ ] Event store reachable from the agent's runtime
- [ ] Verifier extensions committed (Option A) OR Grace's gate task queued (Option B)
- [ ] All five extra-hard agents (Sofia, Maya, Quinn, Sam, Riley) configured with codex provider and local execution per the existing T5R verifier expectations
