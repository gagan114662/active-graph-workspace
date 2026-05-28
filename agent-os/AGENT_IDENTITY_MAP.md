# Pentagon Agent Identity Map - active_graph

Date: 2026-05-22
Status: active control artifact

## Rule

Legacy names may appear in old logs, but new frames must use the current names below. A legacy or generic agent cannot own code, tests, review, gates, or closure unless it has current Purpose proof and interpreter proof.

## Active Core

| Current name | Role label | Legacy / old log names | Ownership status |
| --- | --- | --- | --- |
| Avery | Frame Architect | Atlas, Frame Architect | active_core |
| Sofia | Spec Owner | Spec Owner | active_core |
| Sasha | Spec Skeptic | Skeptic | active_core |
| Theo | Test Owner | Test Owner | active_core |
| Maya | Code Owner | Forge, Nova, Code Owner | active_core_but_activation_blocked |
| Quinn | Test Adversary | Adversary | active_core |
| Rowan | Code Reviewer | Hawk, Reviewer | active_core |
| Priya | Verdict / Judge | Verdict, Goal Reaper | active_core |
| Riley | Evidence Lead | Evidence Lead, Atlas/Hawk evidence duties | active_core |
| Grace | Gate Sentinel | Gate Sentinel | active_core |

## On-Demand Specialists

Carmen, Ravi, Taylor, Blake, Sam, Finn, Casey, Parker, and Simone remain on-demand specialists until a frame assigns them a concrete evidence-producing role.

Research Analyst is retired from the active map unless a frame assigns a narrow research artifact with a path, source list, and stop condition. It cannot be a standing owner.

## Enforcement

1. New frame artifacts must use current names only.
2. Legacy names in old logs must be resolved through this map before scoring accountability.
3. Maya can be listed as Code Owner, but cannot be treated as active until Pentagon records a visible turn, worker/process/log evidence, commit, or INTERPRETER_BLOCKED line.
4. Forge/Nova silence in old judge logs is classified as the same Code Owner activation/capability failure family unless current proof shows otherwise.
5. frames/flywheel-readiness.status must be green before T5 can reopen as a Pentagon-autonomous frame.

## Gauntlet roles (added 2026-05-27)

The 20 Pentagon agents migrate from "provisioned but unused" to "active in gauntlet" by being assigned an explicit role in T-tier task chains. Operator-burden-relief priority order: Theo, Rowan, Grace first. Each role below is a one-paragraph contract that the verifier can grade.

### Theo (Test Owner)

**Role**: independent test-correctness reviewer for every Maya commit.
**Gauntlet trigger**: every `MAYA_NATIVE_GAUNTLET_ACK` message in T6/T7 medium+. Theo reads Maya's proof file + commit, asserts the test bodies prove the claimed thing (not just compile), replies with `THEO_TEST_REVIEW_PASS` or `THEO_TEST_REVIEW_FAIL <reason>`.
**Required ACK format**: `THEO_TEST_REVIEW_{PASS|FAIL} <hash> tests=<N> reasoning=<one_line>`
**Verifier coverage**: a T6/T7 run is honest-green only if a `THEO_TEST_REVIEW_PASS` exists in the conversation referencing the same hash.
**Instruction template**: `frames/templates/theo-test-review-instruction.txt`

### Rowan (Code Reviewer)

**Role**: independent diff review for every shipped commit. Catches dead code, missed error handling, contract violations.
**Gauntlet trigger**: every commit Maya pushes during T6 hard / T6 extra-hard / T7 hard. Rowan reads the diff, the surrounding modules, replies with `ROWAN_REVIEW_PASS` or `ROWAN_REVIEW_FAIL <findings>`.
**Required ACK format**: `ROWAN_REVIEW_{PASS|FAIL} <commit_sha> findings=<count> top_finding=<one_line>`
**Verifier coverage**: hard/extra-hard tiers require a `ROWAN_REVIEW_PASS` per Maya commit.
**Instruction template**: `frames/templates/rowan-code-review-instruction.txt`

### Grace (Gate Sentinel)

**Role**: refuses to greenlight a tier if the operator's working tree has uncommitted load-bearing changes, OR if critical proof files are dirty per the verifier.
**Gauntlet trigger**: fires BEFORE T6 extra-hard or T7+ gauntlets start. Grace runs `git status` + verifier-pre-check, replies with `GRACE_GATE_OPEN` or `GRACE_GATE_BLOCKED <reason>`.
**Required ACK format**: `GRACE_GATE_{OPEN|BLOCKED} <tier> dirty_files=<list>`
**Verifier coverage**: no gauntlet can start at T6 extra-hard or above without a `GRACE_GATE_OPEN` for the current tier.
**Instruction template**: `frames/templates/grace-gate-instruction.txt`

### Wiring sequence

1. ✅ This identity-map section (defines roles).
2. Instruction templates at `frames/templates/{theo,rowan,grace}-*-instruction.txt`.
3. Verifier extended to fail when an ACK from one of these agents is required but missing.
4. Helper script (or runner option) to dispatch the new agents in sequence within the gauntlet flow.

The remaining 12 agents (Taylor, Simone, Parker, Casey, Carmen, Avery, Priya, T5d, Finn, Ravi — plus the script-level-only Sasha and Blake getting their Pentagon-agent role too) will be wired in subsequent passes.

---

## Staffing roadmap (2026-05-28, pt.10 — "make the team A+")

Honest staffing status after the team performance review. Of 20 agents, **5 are actively
exercised** (Maya, Quinn, Sofia, Sam, Riley); the rest are provisioned but dormant.

### Tier 1 — parser-ready, enforcement gated on Pentagon RLS (Gap A)
**Theo, Rowan, Grace.** Their ACK parsers exist and are correct
(`verify-pentagon-autonomy-from-logs.mjs:900/914/928`); templates exist (`frames/templates/`).
What blocks turning them into live gauntlet members:
- **Pentagon RLS (Gap A)** blocks REST inserts to `conversations`/`conversation_participants`,
  so dispatching a reviewer needs a pre-seeded 2-party `Theo↔<agent>` conversation via the
  Pentagon `find_conversation` MCP. Until RLS is unblocked, reviewers can't dispatch at scale.
- Adding **mandatory** `verifyT6XAck` checks before reviewers actually dispatch would FAIL every
  existing T6 green (no reviewer ACK present). Correct path: fixture-tested enforcers wired
  **WARN-only** first, then flip to `must()` (behind `--require-reviewers`) once reviewers are
  routinely dispatched — the standard "tighten, never loosen" staging.
- **Next step:** (1) operator unblocks RLS (`frames/codex-goals/pentagon-rls-investigation-20260528.md`);
  (2) build good/bad fixtures + fixture-tested `verifyT6{Theo,Rowan,Grace}Ack`; (3) chain dispatch
  after Maya's commit; (4) WARN → must once green at scale.

### Tier 2 — need a new task class first (wire when the tier arrives)
- **Simone** (Security) → T13 adversarial-input tasks.
- **Parker** (Performance) → T8 PERF family.
- **Casey** (Compatibility) → T8 DEPRECATION/REFACTOR family.

### Tier 3 — need an ACK contract + template + a gradeable artifact step
- **Sasha** (Spec Skeptic) — runs as a flywheel daemon today; a Pentagon gauntlet role needs a
  spec-review ACK contract.
- **Carmen** (Contract Owner), **Avery** (Frame Architect), **Taylor** (Trace Archivist) —
  doc/contract roles; need an ACK contract + a gauntlet step emitting a gradeable doc artifact.
- **Priya** (Goal Reaper / verdict) — needs a verdict ACK contract (overlaps the verifier's pass/fail).
- **Blake** (Budget) — runs as a daemon; a gauntlet role needs a cost-gate ACK.

### Tier 4 — no work until the relevant flows exist
- **Finn** (Fork Debugger), **Ravi** (Replay Validator) — need fork/replay flows in gauntlet runs.
- **T5d** (Activation Engineer) — largely obsoleted by the `af57375` Pentagon watchdog.

**Bottom line for "all-star team":** the active 5 do the real engineering. The fastest path to A+
team *performance* (not just headcount) is making those 5 dramatically more efficient + safe — the
research-packet 6× lever, the impl pool (remove the Maya SPOF), SkillOpt skill-optimization, and the
Sentinel harm gate — all UNBLOCKED. Reviewer headcount is real but RLS-gated, staged here rather than
forced in untested.
