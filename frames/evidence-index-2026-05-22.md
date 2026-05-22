# active_graph Pentagon Evidence Index - 2026-05-22

Status: authoritative evidence map
Owner: Riley / Evidence Lead
Scope: outer workspace plus inner activegraph repo

## Evidence Rules

1. Committed artifacts, commit history, and literal command output are proof.
2. Untracked files can explain what happened, but are not closure proof until committed or explicitly retired.
3. Inner repo product correctness and outer Pentagon autonomy are scored separately.
4. A successful Pentagon MCP send_message call proves delivery only. It does not prove executeAgentTurn, recipient activation, or autonomous work.
5. T5 cannot reopen until frames/flywheel-readiness.status is green.

## Repository Boundaries

| Repo | Path | Remote | Role |
| --- | --- | --- | --- |
| outer workspace | /Users/gaganarora/Desktop/my projects/active_graph | https://github.com/gagan114662/active-graph-workspace.git | Pentagon frames, logs, repair controls |
| inner repo | /Users/gaganarora/Desktop/my projects/active_graph/activegraph | https://github.com/gagan114662/activegraph.git | product code, tests, implementation commits |

## Frame Index

| Frame | Authoritative repo | Status | Eval / review / dispatch | Related commits | Open debt | Autonomy verdict | Stale or untracked source note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| v0 | outer + inner | closed | outer frame logs plus v0 amendment | inner D1/D2 commits, outer later audit commits | none blocking | not independently scored | sqlite ordering was folded into amended v0 closure |
| v0.1-fix-sqlite-test-ordering | outer | superseded_by_v0_amendment | no separate eval/review/status | covered by v0 D1 permission amendment | not counted as standalone frame | not applicable | orphan resolved by this index |
| t1a | outer + inner | closed | outer closure artifacts are authoritative | inner ebe0506 and related t1a commits | inner-only files may be stale | fallback-assisted / coordination friction | use outer audit over stale inner copies |
| t1b graph.relations | inner product, outer accounting | pre_satisfied_without_frame | no Pentagon frame/eval/review/status found | historical inner ffbf98a and current Graph.relations tests | should not count as completed Pentagon frame | not a Pentagon frame | explicitly accounted here; create frame only if user wants retroactive scoring |
| t2 | outer + inner | closed_with_partial_debt | outer 2764dc0 and frame logs | inner 83000f5 | path/line output and real PR synthetic drift tracked as follow-up predicates | direct-fallback-assisted | partials must not disappear from future scoring |
| t3 | outer + inner | closed | outer 5df81d9 and inner 745e6d7 | adversary fixes included | none blocking | fallback-assisted in tests/amendment path | repo green, autonomy not pure Pentagon |
| t4 | outer + inner | closed_with_autonomy_gap | outer b3d0456 plus inner 7c319cf/b8eb508/612ac0a/4604f0e | see focused T4 tests below | no product blocker; autonomy gap remains | Codex fallback completed implementation | untracked adversary log is now committed as historical context, not final closure proof |
| t5-pentagon-handoff-activation-smoke | outer + inner | blocked | outer a129103 and inner ab05ed0 red-test commit | inner ab05ed0 | Maya activation not proven | Pentagon autonomy failed; no Codex implementation fallback allowed | red test intentionally remains failing |
| pentagon-reliability-repair | outer | blocked_on_flywheel_readiness | frames/pentagon-reliability-repair.status and this index | current repair commit | Purpose/interpreter/capability/activation proof still missing | not yet autonomous | flywheel-readiness.status is source of truth |

## T1b Accounting

Decision: T1b is pre_satisfied_without_frame, not a completed Pentagon gauntlet frame.

Reason: GAUNTLET.md names T1b graph.relations as easy-medium, and the inner repo currently passes the relations-focused test surface. No T1b frame/evaluation/review/status artifacts were found, so it cannot be counted as a Pentagon autonomy proof.

Literal check:

~~~text
$ ../venv/bin/pytest -q tests/test_graph.py -k relations
10 passed, 11 deselected in 0.01s
~~~

## T4 Adversary Accounting

The previously untracked frames/t4-openai-tool-shape-translation.adversary.log is committed as historical context. It is not the final source of truth for T4 closure. Current focused T4 verification is:

~~~text
$ ../venv/bin/pytest -q tests/test_openai_tool_shape.py tests/test_provider_tool_parity.py tests/test_llm_failure.py::test_provider_kwargs_are_threaded_through
13 passed in 0.03s
~~~

## T5 Red State

T5 remains red by design until Maya activates in Pentagon and commits implementation after activation proof.

~~~text
$ ../venv/bin/pytest -q tests/test_llm_openai.py::test_count_tokens_heuristic_includes_assistant_tool_calls
FAILED tests/test_llm_openai.py::test_count_tokens_heuristic_includes_assistant_tool_calls - assert 1 > 1
1 failed in 0.03s
~~~

## Proof-Like Files Reclassified

These files were previously untracked and are now committed as historical context or current control-plane context:

- GAGAN_DECISIONS_2026-05-21.md
- JUDGE_LOG_2026-05-21.md
- MINI_AGI_COMPANY_MODEL.md
- PENTAGON_MODEL_AUDIT_2026-05-22.md
- PENTAGON_ORG_CHART.md
- frames/t4-openai-tool-shape-translation.adversary.log
