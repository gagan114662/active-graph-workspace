# Skill: Handoff Recovery

Use when a DM/group write fails or an agent stalls.

Steps:
1. Record the exact symptom.
2. Add `bottleneck.detected` to dispatch or bottleneck log.
3. Treat a DM as context delivery only; do not count it as activation proof.
4. Relay via another route with file hashes and artifact paths.
5. Require recipient activation proof: visible turn, worker process/log, or
   committed artifact after the handoff timestamp.
6. Keep downstream owner blocked/unblocked state explicit.
7. Verify the next artifact appears in git.

Output:
- routing bottleneck
- relay path
- activation proof or activation failure
- next owner proof
