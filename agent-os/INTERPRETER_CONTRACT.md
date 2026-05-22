# Interpreter Contract

An interpreter is the agent's local execution workbench. It is not a replacement
for review or evidence; it is the way agents do grounded work between model
turns.

## Required capabilities

Each core agent interpreter must provide:

- `pwd`, `ls`, `rg`, `sed`, `git`
- Python and project virtualenv access
- test runner access
- read/write access only to assigned frame paths
- command output capture
- persistent scratch file per frame
- ability to emit `bottleneck.detected` when blocked

## Evidence rules

Interpreter output is acceptable evidence only if it is copied into one of:

- `frames/<frame>.dispatch.log`
- `frames/<frame>.evaluation.log`
- `frames/<frame>.review.log`
- `frames/<frame>.status`
- `frames/bottleneck-feedback.log`
- a committed test, docs, contract, or implementation file

## Stop conditions

The interpreter must stop and log a bottleneck when:

- cwd is wrong
- repo is dirty outside the assigned scope
- a needed permission is missing
- a command fails twice with the same error
- a downstream DM/group write is blocked
- Pentagon active count hits 0 while frame status is not closed

