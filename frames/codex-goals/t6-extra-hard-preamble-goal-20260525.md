# Goal: T6 Extra-Hard Preamble (2026-05-25)

**Token budget:** 400K. STOP and report if any self-test step fails. Do NOT trigger any real agent run; this is preamble only.

## Step 0 — Bootstrap

1. Read `CLAUDE.md` in full.
2. Read `frames/t6-real-autonomy-gauntlet-2026-05-23.md` — the EXTRA-HARD section is the spec.
3. Read `scripts/verify-pentagon-autonomy-from-logs.mjs` — study how `--tier=easy`, `medium`, `hard` are structured. The new `--tier=extra-hard` mirrors their pattern.
4. Read `frames/t6-native-hard-maya-instruction-20260523.txt` and `frames/t6-native-hard-quinn-instruction-20260523.txt` as the model for the new instruction templates.
5. Outer HEAD should be `af57375` (Pentagon watchdog). If anything is ahead, STOP and report.

## Context

T6-extra-hard is a 5-agent chain producing one shippable feature with a multi-link audit chain:

```
Sofia (Spec Owner) → Maya (Code Owner) → Quinn (Test Adversary) → Sam (Docs Owner) → Riley (Evidence Lead)
```

Each agent's ACK references the prior agent's ACK as causal parent in Pentagon's `messages` table. The chain is the dark factory's distinctive claim — 5 agents collaborating with audit.

**This task is ONLY the preamble:**
- Verifier mode `--t6 --tier=extra-hard`
- 5 instruction file templates (feature placeholder; the actual feature gets chosen at run time)
- Good + bad fixtures that exercise the multi-link audit chain
- Self-test that confirms the verifier discriminates correctly

DO NOT run the actual extra-hard gauntlet. DO NOT trigger any agent. The 5-agent run happens later, operator-orchestrated.

## Task

### 1. Five instruction file templates

Write at these exact paths:

- `frames/t6-native-extra-hard-1-sofia-template-20260525.txt`
- `frames/t6-native-extra-hard-2-maya-template-20260525.txt`
- `frames/t6-native-extra-hard-3-quinn-template-20260525.txt`
- `frames/t6-native-extra-hard-4-sam-template-20260525.txt`
- `frames/t6-native-extra-hard-5-riley-template-20260525.txt`

Each template:

- Has placeholders for `<FEATURE_NAME>`, `<FEATURE_SCOPE>`, `<HASH_DATE>`
- Specifies the agent's exact deliverables per the T6 spec's EXTRA-HARD section
- Specifies the exact ACK content the agent must send, including the **parent ACK id reference** (operator fills this at run time)
- References prior agents' outputs via concrete file paths (operator fills exact paths at run time)

### 2. Add `--t6 --tier=extra-hard` mode to the verifier

Required checks (in this order):

| # | Check |
|---|---|
| a | Proof file exists, parses, `hash` matches `T6_NATIVE_EXTRA_HARD_<DATE>`, `verdict` matches `native_extra_hard_done` |
| b | Spec file path from proof exists at HEAD (Sofia's deliverable) |
| c | Implementation file paths from proof exist at HEAD (Maya's deliverable) |
| d | Test file path from proof exists at HEAD; `pytest --collect-only -q` matches it (Quinn's adversarial tests) |
| e | Docs how-to path exists at HEAD; `mkdocs build --strict` exits 0 (Sam's deliverable) |
| f | Audit chain in `messages` table: 5 ACKs found, one each from Sofia, Maya, Quinn, Sam, Riley. Each ACK's `parent_id` (or equivalent linking column — explore if needed) points to the prior agent's ACK. Use the labeled-WARN format from `a9b6054`. Apply the principled retry-aware ACK rule from `b6c774c` per leg. |
| g | Adversarial finding event from Quinn: a test that initially failed against Maya's impl and forced a fix. Verify via git log + worktree ground truth (`c1c2603` pattern): at least one Quinn commit that touched `tests/`, and at least one subsequent Maya commit that touched the inner-repo `activegraph/` source AND made the prior failing test pass when checked out in an isolated worktree venv. |
| h | `self_audit_event_id` from proof resolves to a real event proving the feature emits its own audit event when invoked (the T6 spec's `events_tail_invoked` pattern; generalize to whatever the feature is) |

Use the existing `must()` helper, the path-variants resolver, the labeled-WARN format, and the no-pipe / `.venv/bin/python -m pytest` patterns from prior commits. Exit code discipline unchanged: any FAIL → `process.exit(1)`; WARN never affects exit.

### 3. Fixtures

Create at least these four fixtures:

**`frames/t6-extra-hard-proof-fixture-good.txt`** — A complete valid proof referencing real existing artifacts in the repo. Use a synthetic feature scaffold (create a small dummy feature in a separate inner-repo branch like `t6-extra-hard-fixture-branch`, similar to how `t6-hard-fixture-branch` was constructed in `e918846`). The fixture proof should reference real commits and real files in that branch, so the verifier's checks can grade it green.

**`frames/t6-extra-hard-proof-fixture-bad-missing-spec.txt`** — Same shape as good, but `spec_path` points to a non-existent file. Expect FAIL at check (b).

**`frames/t6-extra-hard-proof-fixture-bad-broken-audit-chain.txt`** — Same shape as good, but one of the 5 ACK `parent_id` links is wrong (points to a non-prior agent). Expect FAIL at check (f). Since (f) requires DB, this fixture must ALSO have a non-DB-dependent flaw (or document that it only fails in real-DB mode and include the real-DB run command in the self-test).

**`frames/t6-extra-hard-proof-fixture-bad-quinn-found-nothing.txt`** — Same shape as good, but Quinn's commits don't include any `def test_` additions, OR no subsequent Maya fix follows. Expect FAIL at check (g).

If multiple inner-repo fixture branches are needed to exercise (g)'s worktree ground-truth check, create them. The commit message should make this clear.

### 4. Self-test (mandatory; no-pipe exit-code pattern)

For each fixture, run:

```bash
node scripts/verify-pentagon-autonomy-from-logs.mjs --t6 --tier=extra-hard \
  --proof-file frames/t6-extra-hard-proof-fixture-<NAME>.txt --no-db \
  > /tmp/t6xh-<NAME>.out 2>&1
echo "<NAME> exit=$?"
tail -5 /tmp/t6xh-<NAME>.out
```

Expected outcomes:

- `good` → exit 0, all PASS
- `bad-missing-spec` → exit 1, FAIL at check (b)
- `bad-broken-audit-chain` → exit 1, FAIL at check (f) [or note real-DB-only]
- `bad-quinn-found-nothing` → exit 1, FAIL at check (g)

If any fixture grades incorrectly, STOP and report. Do NOT commit broken verifier mode.

## Commit

Single commit, do NOT amend prior commits:

```
T6 extra-hard preamble: --tier=extra-hard verifier + 5-agent instruction templates + fixtures + 5-ACK audit chain rule
```

Push to `origin/main`.

If inner-repo fixture branches were created, push them too:

```
git -C activegraph push origin t6-extra-hard-fixture-branch
```

## Reply with

- Outer commit SHA
- All 4 fixture self-test exit codes + their summary lines
- Inner-repo fixture branch name(s) and their commit SHAs if applicable
- Confirmation that the 5-ACK audit chain logic uses the principled retry-aware rule from `b6c774c` per leg
- Confirmation that check (g)'s worktree ground truth uses the `.venv/bin/python -m pytest` pattern from `c1c2603`
- Any unexpected behavior

## Hard rules

- DO NOT trigger any real agent run.
- DO NOT modify any existing T6 tier verifier modes (easy, medium, hard).
- DO NOT modify any existing instruction files.
- DO NOT change `pentagon-trigger-bridge.mjs`.
- If any self-test fails, STOP and report rather than commit.
- If you can't cleanly discriminate good vs bad fixtures, return `RULE_INSUFFICIENT` and stop.
