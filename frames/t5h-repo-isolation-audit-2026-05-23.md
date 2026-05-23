# T5h repo isolation audit - 2026-05-23

Purpose: verify the repo-specific part of the autonomy goal against current
Pentagon state.

## Requirement

The user goal requires agents to do repo-specific easy, medium, hard, and
extra-hard work reliably and autonomously. Pentagon docs say repo-touching
agents should have scoped folder access and their own clone/branch.

## Current live evidence

Live Pentagon DB rows for active_graph agents expose:

- directory
- provider
- model
- execution_mode
- base_directory
- base_branch

Sampled active_graph rows show:

- directory: /Users/gaganarora/Desktop/my projects/active_graph
- provider: codex
- model: gpt-5.5
- execution_mode: local
- base_directory: null
- base_branch: null

## Provider drift repair

The first live verifier run found one contradictory row:

~~~text
id: 9dfa236a-e370-418a-be1c-32bb3026d1af
name: T5d Activation Engineer
before_provider: claude-code
model: gpt-5.5
directory: /Users/gaganarora/Desktop/my projects/active_graph
execution_mode: local
~~~

This contradicted the runtime policy: GPT-5-family agents should run through
Codex. The row was patched through the authenticated Pentagon/Supabase session:

~~~text
after_provider: codex
model: gpt-5.5
execution_mode: local
base_branch: null
base_directory: null
~~~

The repository verifier now treats these as live requirements:

- at least 20 active_graph agent rows exist.
- every active_graph agent row uses model gpt-5.5.
- every active_graph agent row uses provider codex.
- every active_graph agent row uses execution_mode local.
- every active_graph agent row has exact directory
  /Users/gaganarora/Desktop/my projects/active_graph.

## Local clone/branch scan

Command:

~~~text
find /Users/gaganarora -maxdepth 4 \( -path '*/.git' -o -name '.git' \) -type d |
  rg -i 'Pentagon|active_graph|activegraph|agent|sao-paulo|workspace'
~~~

Relevant results:

~~~text
/Users/gaganarora/Desktop/my projects/active_graph/.git
/Users/gaganarora/conductor/repos/active-graph-workspace/.git
~~~

No local per-agent active_graph clone/branch directory was found in the scanned
paths, and the live DB rows do not currently provide a populated branch field.

## Verdict

Repo-specific directory/model/provider/local-execution evidence is green.

Own clone/branch proof is not green. The docs describe this behavior, but the
current DB/local filesystem evidence does not expose enough branch/clone
metadata to prove it for the active_graph Pentagon agents. Until Pentagon
exposes branch metadata or the agents produce branch-specific artifacts, this
requirement remains a documented gap rather than a completed proof.

This does not change the native autonomy boundary: native Pentagon trigger
polling remains blocked; bridge-backed autonomy remains the verified mitigation.
