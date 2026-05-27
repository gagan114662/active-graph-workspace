# Reliability Operating Contract

Purpose: make Pentagon agents reliable for repo-specific easy, medium, hard,
and extra-hard work by turning prompt discipline, ActiveGraph event sourcing,
and continuous evaluation into explicit gates.

This contract applies to every active_graph frame and every Pentagon agent that
claims work against this repo.

## 1. Prompt And Behavior Precision

Every agent instruction packet must include these sections before the agent can
own a frame:

- Mission: the exact role and owned surface.
- Scope: files, folders, repos, and frame artifacts the agent may touch.
- Inputs: artifacts, hashes, commands, or handoffs required before starting.
- Outputs: files, commits, logs, status updates, and messages the agent must
  produce.
- Stop conditions: what forces the agent to pause and emit
  `bottleneck.detected`.
- Evidence standard: the literal command output, committed artifact, or live
  Pentagon readback needed for each claim.
- Handoff rule: a DM or group message is context only until the recipient emits
  activation proof or writes a committed artifact after the handoff timestamp.

Behavioral invariants:

- Do not claim done, ready, green, autonomous, or reviewed from chat memory.
- Do not start implementation before required spec, challenge, and red-test
  artifacts exist for the frame complexity.
- Do not touch files outside frame permissions unless the frame is amended
  first.
- Do not treat bridge-backed autonomy as native Pentagon autonomy.
- Keep direct messages short; put technical proof in files and logs.

## 2. Event-Sourced Audit Trail

Every non-trivial frame must be auditable from source events, not from summary
text alone. At minimum, the evidence chain must include:

- `frames/<frame>.yaml`: predicates, permissions, owners, and success criteria.
- `frames/<frame>.dispatch.log`: activation, handoff, and owner-routing events.
- `frames/<frame>.evaluation.log`: predicate-to-evidence table and literal
  command output.
- `frames/<frame>.review.log`: review findings or `review.clean` with readback.
- `frames/<frame>.status`: current verdict and unresolved gaps.
- `frames/bottleneck-feedback.log`: every repeated failure converted into a
  gate, skill update, purpose rule, or frame predicate.

For ActiveGraph runtime behavior, event-sourcing evidence must identify the
event boundary being asserted. Valid evidence names include:

- event type and payload field, such as `llm.responded.tool_calls`.
- graph/run id when available.
- fixture or replay command that produced the event sequence.
- before/after commit hashes when a runtime behavior changes.
- provider parity event comparison when a frame touches LLM provider behavior.

Unsupported evidence:

- chat summaries without file/log backing.
- untracked files unless the status explicitly marks them as non-proof.
- command names without exit status and output.
- message delivery without target activation proof.

## 3. Continuous Evaluation

Every autonomy claim must pass all four evaluation layers:

| Layer | Minimum proof |
| --- | --- |
| Easy | cwd/head/status proof plus one simple file-backed artifact. |
| Medium | parser/config/tooling check with command output and exit code. |
| Hard | adversary pass and regression disposition tied to a real frame. |
| Extra-hard | prompt-to-artifact checklist, event-sourced traceability, and explicit remaining gaps. |

Before closing any frame, Priya or Riley must map each predicate to one of:

- proved by committed file/hash.
- proved by literal command output.
- contradicted by current evidence.
- incomplete.
- out of scope by committed amendment.

The full user goal is complete only when the current evidence proves:

- repo-specific agents use scoped folders, own clones/branches, and current
  model settings.
- easy, medium, hard, and extra-hard tasks produce file-backed artifacts.
- ActiveGraph event/replay evidence exists where runtime behavior is involved.
- handoffs activate recipients without a human or external watchdog inside the
  declared window.
- native Pentagon behavior or a documented Pentagon target-turn primitive
  replaces the current bridge-only autonomy caveat.

## 4. Required Verifier Coverage

The repository verifier must fail if:

- this contract is missing.
- the docs activation audit is missing.
- the native autonomy boundary is omitted.
- bridge proof is counted as native completion.
- critical proof files used by the verifier are dirty.
- `--require-native` is requested while native poller evidence remains red.

Verifier success without `--require-native` means:

`bridge_autonomy_verified_native_blocked`

It does not mean the full native Pentagon autonomy goal is complete.

## 5. Satisfaction Of Search (Brandon-B, added 2026-05-27)

Borrowed from radiology: a radiologist finds *one* thing on an X-ray and
stops scanning, missing the real cause. Agents exhibit the same pattern —
they find the *first* plausible target/pattern/symbol and commit to it
without considering alternatives. Source: Brandon Walsenuk (Unblocked),
AI Engineer 2026-05-26.

How it shows up in this repo:

- T7 medium runs where Maya picks the first uncovered API symbol that
  compiles without considering whether it is the *best* target. Adds
  trivial coverage without exercising the API's real edge cases.
- T6-extra-hard 5-agent runs where Sasha-skeptic role (manually played
  by Claude) settles on the first divergence instead of cataloging.

Required by every agent before claiming a target/pattern/symbol:

1. **Record N>=3 candidates considered.** Proof files for symbol-selection
   tasks (T7 medium target picks, T7 extra-hard, Sofia spec choices)
   must include a `candidates_considered=A,B,C` field with at least
   three fully-qualified symbol/pattern/source names.
2. **Record rejection rationale per non-chosen candidate.** One
   `candidate_rejection_X=reason` line per non-chosen entry.
3. **Single-candidate runs emit `satisfaction_of_search_risk` warning.**
   The verifier WARN-tags any proof file with fewer than 3 candidates;
   does not FAIL the run (back-compat with pre-Brandon-B proofs) but
   surfaces the risk so the operator can decide whether to retry.

Verifier wiring lives in `scripts/verify-pentagon-autonomy-from-logs.mjs`
in the satisfaction_of_search_risk check function (run as part of the
default verifier pass; queryable via factory-events.jsonl events of type
`verifier.satisfaction_of_search_risk`).

Rollout: new instruction templates gain a step between "pick target"
and "write tests": *"Before committing to a target symbol, list 3+
candidates with one-line rejection rationale for each non-chosen entry.
Record in proof as `candidates_considered` + `candidate_rejection_*`."*

Existing proofs predating this gate stay valid (single-candidate warns
are recorded but do not fail).
