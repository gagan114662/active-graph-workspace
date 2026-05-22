# Skill: Interpreter Smoke

Use before an agent owns code, tests, review, gates, evaluation, or closure.

Required proof:
1. Confirm the correct repo cwd.
2. Capture the current git head.
3. Confirm git status.
4. Confirm Python is available.
5. Run one targeted command relevant to the frame.
6. Paste literal output into the dispatch, gate, evaluation, or bottleneck log.

Output:
- INTERPRETER_OK <agent> <cwd> <git-head>
- or INTERPRETER_BLOCKED <agent> <literal error>
- command output with exit code

Stop condition:
- The agent cannot own the next step until this skill produces OK or BLOCKED.
