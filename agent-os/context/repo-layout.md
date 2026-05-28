# Repository layout

(Single source — moved out of CLAUDE.md per P21. RESOLVER routes here.)

Two nested git repos:

- **Outer repo** (`/Users/gaganarora/Desktop/my projects/active_graph/`):
  - `scripts/` — orchestration (verifier, runner, bridge)
  - `frames/` — instruction files, proof files, evidence logs, spec docs
  - `agent-os/` — contracts, skills, context docs (this dir), judges, rubrics
  - `activegraph/` — link/dir to the inner repo (do NOT commit inner-repo files into outer)
- **Inner repo** at `activegraph/.git/`:
  - The actual Python package (`activegraph/` package source + `tests/`)
  - Maya's engineering commits live here
  - Has its own remote, distinct from outer

When using git, **always specify `-C activegraph`** for inner-repo operations. The verifier's
worktree-based checks operate on the inner repo via `git -C activegraph worktree add /tmp/...`.
