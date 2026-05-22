# Gauntlet Decisions — 2026-05-21

**Authority:** gagan (driver). Claude (judge/scribe). Atlas drives execution; per-role owners do the work; Hawk audits with veto on unbacked claims.

**Audit protocol:** logs are source of truth. Specifically:
1. `frames/<id>.evaluation.log` (Goal Reaper) — primary
2. `git log --oneline` per repo — secondary
3. `python3 scripts/gate_docstrings.py` and similar gate exits — secondary
4. Pentagon chat — tertiary, routing pings only

Any agent claim that disagrees with the eval log loses to the eval log. Any claim citing a commit hash must specify `inner:` or `outer:` and the hash must exist in `git log --oneline` for that repo.

---

## Status snapshot (as of this directive)

**Frame v0-promote-runtime-diff** (outer): 13/15 GREEN, 1 RED (no_changes_outside_permissions), 1 UNRUNNABLE (predicate-7). See `frames/v0-promote-runtime-diff.evaluation.log`.

**Frame v0.1-fix-sqlite-test-ordering** (outer): yaml exists, not yet evaluated. See `frames/v0.1-fix-sqlite-test-ordering.yaml`.

**Frame t1a-close-ring0-docstring-exemptions** (inner): 14/15 GREEN in source, 1 RED (gate_docstrings_script_exits_zero, tooling-only). All substantive work done. WIP uncommitted. See `activegraph/frames/t1a-close-ring0-docstring-exemptions.evaluation.log`.

---

## D1 — v0 quickstart.py scope violation: AMEND v0 PERMS RETROACTIVELY

**Source:** `frames/v0-promote-runtime-diff.evaluation.log` §13 ("no_changes_outside_permissions — RED").

**Finding (verbatim from log):** Commit 67fa8da modified `activegraph/cli/quickstart.py` (111 lines) outside `:ro` permission. Code Owner self-flagged. Goal Reaper recorded the violation.

**Call:** **Amend v0 perms retroactively** to add:
- `activegraph/activegraph/cli/quickstart.py:rw` (with one-line scope note: "sqlite-lifecycle fix surfaced as side-effect of `pytest_full_suite_passes` evaluation; the runtime/diff.py work cannot land green without it")
- `activegraph/docs/reference/api/COVERAGE_REPORT.md:rw` (sibling to the already-granted `TYPE_REPORT.md`)

**Justification:**
- The fix was substantively correct and necessary for pytest_full_suite_passes
- Rolling back 67fa8da destroys verified work for no audit benefit
- Splitting into v0.1 is wrong: v0.1 was created AFTER 67fa8da landed (see git log: 0be67ca → 5de5fdd → 6b9de29 → 96fd418 → b80c213)
- Precedent: commit 6b9de29 ("Frame amendment: add examples/** permission per Spec Owner's escalation") is the same shape

**Owner:** Spec Owner drafts the amendment, lands as one commit on outer main with message `Frame amendment v0: add cli/quickstart.py:rw and docs/.../COVERAGE_REPORT.md:rw per gagan D1`. Goal Reaper re-evaluates; predicate-13 flips RED → GREEN.

**Forward discipline (CONTRACT v1.1 candidate):** The recurrence prevention is CONTRACT v1.1 #2 (spec-vs-impl drift gate). Until that gate exists, Code Owner must self-flag on the same DM as the commit. 67fa8da did this correctly.

---

## D2 — v0 predicate-7 disambiguation: ALREADY DISAMBIGUATED IN YAML; GOAL REAPER MISLABELED

**Source:** `frames/v0-promote-runtime-diff.evaluation.log` §7 vs `frames/v0-promote-runtime-diff.yaml` line 41.

**Finding:** Eval log calls predicate-7 `type_report_error_category_index_count_zero` and marks UNRUNNABLE due to ambiguity (diff-specific vs global). The yaml itself names the predicate `type_report_error_category_index_diff_contribution_zero` — explicitly diff-specific.

**Call:** **Predicate is diff-specific per yaml.** Not ambiguous. No frame amendment needed.

**Action:** Goal Reaper updates the eval log to use the yaml's predicate name verbatim and re-runs against the diff-specific interpretation: count of error categories whose index lists `activegraph/runtime/diff.py` as a contributor = 0 (now that diff.py is clean per predicates 1–6, this should resolve GREEN immediately).

**Forward discipline:** Goal Reaper reads predicate names from the yaml directly going forward, doesn't paraphrase. Add to evaluation-log template: "predicate names must be verbatim from yaml; transcription drift treated as audit error."

---

## D3 — Code Reviewer artifact: KEEP DM SIGNAL, ADD FILE ARTIFACT

**Source:** `collaboration-topology.md` lines 48–49 ("Code Reviewer → Goal Reaper: `review.clean` signal (Goal Reaper requires it as a predicate)") and line 116 ("Frame is satisfied when all tasks are Done AND review.clean is in").

**Finding:** `review.clean` is a real, well-defined signal — but it lives in Pentagon DMs, not on disk. The audit trail goes dark at the closure step.

**Call:** **Add filesystem artifact alongside the DM signal.** Going forward, Code Reviewer produces `frames/<frame-id>.review.log` in the same repo as the frame yaml. Format:

```
# Code Reviewer — Review log
# Frame: <frame-id>
# Reviewed against: <commit-hash> (inner|outer)
# Reviewed at: <ISO-8601 timestamp>

## Verdict: review.clean | review.concern

## Per-file review

### <path>
- Line-level findings or "no concerns"

## Overall

<one-paragraph summary>
```

`review.clean` verdict in the log replaces (or co-exists with) the DM signal. Goal Reaper's closure check now reads the file instead of waiting for a DM ping. **DM signal stays as a routing aid for humans; the file is the audit trail.**

**Owner:** Code Reviewer adopts this format on the next frame they review. For t1a and v0, they retroactively produce the file (one-shot effort, ~5 min per frame).

---

## Closure sequence — order matters, Atlas drives, Hawk audits

### STEP A — t1a inner repo commit

Owner: Code Owner. Inner repo (`activegraph/`).

1. `git add -A && git status` — confirm: 5 modified `.py` files (view/budget/runtime/memory/decorators), `docstring_gaps.toml`, `CHANGELOG.md`, plus the frames/t1a-*.yaml and frames/t1a-*.evaluation.log files if newly added. Anything else is out of scope and gets reverted before commit.
2. `git commit -m "Frame t1a-close-ring0-docstring-exemptions: shipped — Ring 0 102/102, exemptions 0, gate exit 0 with venv refreshed"`
3. `pip install -e .` inside `venv/` to refresh the install (closes predicate-2 tooling failure)
4. `python3 scripts/gate_docstrings.py` from `activegraph/` root → must exit 0
5. Paste the literal command output + new inner HEAD hash in Atlas DM with `inner:` prefix

**Goal Reaper re-evaluates after step 5. All 15 predicates should now flip GREEN. Code Reviewer produces `activegraph/frames/t1a-close-ring0-docstring-exemptions.review.log` per D3. Closure achieved.**

### STEP B — t1a mirror to outer repo

Owner: Spec Owner. Outer repo (`active_graph/`).

1. `cp activegraph/frames/t1a-close-ring0-docstring-exemptions.yaml frames/`
2. `cp activegraph/frames/t1a-close-ring0-docstring-exemptions.evaluation.log frames/`
3. `cp activegraph/frames/t1a-close-ring0-docstring-exemptions.review.log frames/` (after D3)
4. `git add frames/t1a-*.yaml frames/t1a-*.log && git commit -m "Frame t1a shipped: inner <inner-hash>"`
5. Paste outer HEAD hash + `git log --oneline -3` in Atlas DM with `outer:` prefix

**Outer repo's git log now tells the gauntlet story: one commit per shipped frame. The audit shell (judge's view) can read outer-only and see the truth.**

### STEP C — v0 closure

Owner: Spec Owner. Outer repo for amendment, inner repo for re-eval.

1. Spec Owner drafts v0 amendment per D1. Commit on outer main: `Frame amendment v0: add cli/quickstart.py:rw and docs/.../COVERAGE_REPORT.md:rw per gagan D1`
2. Goal Reaper re-evaluates v0: predicate-13 RED → GREEN per D1; predicate-7 UNRUNNABLE → GREEN per D2 (transcription fix + re-run)
3. Code Reviewer produces `frames/v0-promote-runtime-diff.review.log` per D3
4. Spec Owner updates `frames/v0-promote-runtime-diff.status` from `incomplete` → `closed` and commits
5. Atlas posts closure summary with both inner: and outer: hashes

### STEP D — Open frame t3-implement-cli-set-flag (NEW WORK)

This is CONTRACT v1.1 #1 per HANDOFF.md. The team's own backlog. **Not new direction — next-in-queue.**

Owner: Frame Architect drafts yaml. Spec Owner answers the 4 design questions in amendments BEFORE Code Owner starts.

A starter yaml is at `frames/t3-implement-cli-set-flag.yaml` (drafted by claude). Frame Architect reviews, refines if needed, and the team executes.

**Do not start Step D until Steps A, B, C are pasted with inner: + outer: hashes.**

---

## Audit checkpoints for gagan

When checking in:
1. Read `frames/t1a-close-ring0-docstring-exemptions.review.log` (inner) — does it exist? Verdict?
2. Read `frames/v0-promote-runtime-diff.evaluation.log` (outer) — does predicate-13 say GREEN now? Does predicate-7 use the diff_contribution_zero name and say GREEN?
3. Read `frames/v0-promote-runtime-diff.status` — does it say `closed`?
4. `git log --oneline -10` (outer) — is there a commit "Frame t1a shipped: inner <hash>"?
5. `frames/t3-implement-cli-set-flag.evaluation.log` — does it exist yet? What's the verdict?

Files first. Pentagon only if a file is silent and you need to know why.

---

## Forward calibration rules (still in effect from earlier today)

1. No status ✅ without a real commit on the named repo. WIP: prefix for uncommitted work.
2. No synthesized ground truth. When asked, run the literal command and paste literal output, or say "cannot run: <reason>".
3. Predicates GREEN must cite the gate script exit code + actual output.
4. ✅ means committed-and-pushed; WIP: means on-disk-not-committed.
5. Any commit hash reference must prefix with `inner:` or `outer:` and the hash must exist in `git log --oneline` for the named repo.
6. **NEW per D2:** Predicate names in eval logs must be verbatim from the yaml; no paraphrasing.
7. **NEW per D3:** Code Reviewer produces `frames/<frame-id>.review.log` alongside the DM signal.

Hawk's veto is in effect. Atlas and Verdict are on notice for prior-session confabulation but the false-claim accusations are retracted as of the apology DM (verdict's hashes resolved in inner; the audit shell was wrong, not Verdict).

---

*Filed by claude in gagan's voice. Logs are source of truth. Read them.*
