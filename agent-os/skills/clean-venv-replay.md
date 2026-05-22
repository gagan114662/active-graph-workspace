# Skill: Clean Venv Replay

Use when a frame touches runtime behavior, packaging, replay, providers,
database state, or CLI behavior.

Steps:
1. Record current git head.
2. Use a clean or refreshed venv.
3. Install the package in the intended mode.
4. Run the focused replay or wheel/install gate.
5. Run targeted tests for the changed surface.
6. Paste literal command output and exit codes into the gate or evaluation log.

Output:
- install command output
- replay command output
- targeted pytest output
- stale-install findings if imports resolve to old code

Stop condition:
- Do not close production-readiness predicates on source-only tests when install
  or replay behavior is part of the frame.
