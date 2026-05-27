# Goal: Allow `_RETRY_<N>` suffix in T7 hash regex

**Token budget:** 80K. Tiny additive patch. STOP if scope grows beyond the regex/helper updates described below.

## Why

The operator's resume goal for T7 easy specifies retry hashes of the form `T7_REPEAT_EASY_20260525_014_RETRY_1`. The classifier from `83f9344` generates these. The verifier regex from `95d6b31` only accepts `T7_REPEAT_<TIER>_<DATE>(_<NNN>)?` and rejects the retry form. This is a contradiction in the resume policy. Three goal continuations have aborted at this exact blocker.

Fix: extend the verifier's hash patterns to accept an OPTIONAL `_RETRY_<digits>` suffix. Strictly additive. No existing pattern stops matching.

## Bootstrap

1. Read `CLAUDE.md` in full.
2. Read `frames/dirty-edits-audit-20260526.md` — the audit that captured the current regex.
3. Outer HEAD should be `95d6b31`. If ahead, tell me before proceeding.

## Required changes

In `scripts/verify-pentagon-autonomy-from-logs.mjs`:

### Change 1 — `t6TierFromHash`

Current:
```js
const match = String(hash ?? "").match(/^(?:T6_NATIVE|T7_REPEAT)_(EASY|MEDIUM|HARD|EXTRA_HARD)_\d{8}(?:_\d{3})?$/);
```

Updated:
```js
const match = String(hash ?? "").match(/^(?:T6_NATIVE|T7_REPEAT)_(EASY|MEDIUM|HARD|EXTRA_HARD)_\d{8}(?:_\d{3})?(?:_RETRY_\d+)?$/);
```

### Change 2 — `t7RepeatHashPattern`

Current:
```js
return new RegExp("^T7_REPEAT_" + token + "_\\d{8}_\\d{3}$");
```

Updated:
```js
return new RegExp("^T7_REPEAT_" + token + "_\\d{8}_\\d{3}(?:_RETRY_\\d+)?$");
```

### Change 3 — `acceptedHashDescription`

Update the help-text string to include the optional retry suffix so downstream error messages stay informative. Match the format Codex chose for the existing description.

## Hard rules

- **Do NOT change** any other verifier logic — no canonical-trigger rule changes, no ACK rule changes, no fixture changes, no instruction-template changes
- **Do NOT change** the runner, bridge, or classifier
- **Do NOT loosen** any existing pattern — the new suffix MUST be optional, existing hashes must still match
- The fix is regex extension only

## Self-test (mandatory)

Write a small inline self-test that calls `t6TierFromHash` and confirms:

| Input | Expected output |
|---|---|
| `T6_NATIVE_EASY_20260523` | `"easy"` |
| `T6_NATIVE_HARD_20260523` | `"hard"` |
| `T6_NATIVE_EXTRA_HARD_20260525` | `"extra-hard"` |
| `T7_REPEAT_EASY_20260525_014` | `"easy"` |
| `T7_REPEAT_EASY_20260525_014_RETRY_1` | `"easy"` ← NEW |
| `T7_REPEAT_EASY_20260525_014_RETRY_3` | `"easy"` ← NEW |
| `T7_REPEAT_MEDIUM_20260525_001_RETRY_1` | `"medium"` ← NEW |
| `T7_REPEAT_EASY_20260525_014_BOGUS_1` | `"unknown"` (still rejected) |
| `T7_REPEAT_EASY_20260525_014_RETRY_xyz` | `"unknown"` (non-digit retry index rejected) |
| `not_a_hash` | `"unknown"` |

Run the 4 T6 regrades as a regression check:

```bash
for tier in easy medium hard extra-hard; do
  case "$tier" in
    easy) proof=activegraph/frames/t6-native-gauntlet-easy-20260523.proof ;;
    medium) proof=activegraph/frames/t6-native-gauntlet-medium-20260523.proof ;;
    hard) proof=activegraph/frames/t6-native-gauntlet-hard-20260523.proof ;;
    extra-hard) proof=frames/t6-native-gauntlet-extra-hard-20260525.proof ;;
  esac
  node scripts/verify-pentagon-autonomy-from-logs.mjs --t6 --tier=$tier --proof-file "$proof" > /tmp/r-$tier.out 2>&1
  echo "$tier exit=$?"
done
```

All 4 must exit 0 with their original verdict.

Re-run the bad fixtures to confirm none accidentally start passing:

```bash
for f in t6-easy-proof-fixture-bad t6-hard-proof-fixture-bad t6-hard-proof-fixture-bad-ack-contradiction t6-hard-proof-fixture-bad-no-canonical-ack; do
  [ -f "frames/${f}.txt" ] && (node scripts/verify-pentagon-autonomy-from-logs.mjs --t6 --tier=hard --proof-file "frames/${f}.txt" > /tmp/bf.out 2>&1; echo "$f exit=$?")
done
```

All bad fixtures must still exit 1.

## Commit

Single commit (do NOT amend):

```
T7 verifier: accept optional _RETRY_<N> hash suffix (additive, no rule changes)
```

Push to `origin/main`.

## Reply with

- Commit SHA
- The 10 self-test cases above with actual vs expected results
- All 4 T6 regrade exit codes
- All 4 bad-fixture exit codes
- Confirmation that no logic outside the regex/help-text helpers was modified (`git diff 95d6b31..HEAD -- scripts/verify-pentagon-autonomy-from-logs.mjs` shows only the regex helpers)
