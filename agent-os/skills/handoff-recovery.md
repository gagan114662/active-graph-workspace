# Skill: Handoff Recovery

Use when a DM/group write fails or an agent stalls.

Steps:
1. Record the exact symptom.
2. Add `bottleneck.detected` to dispatch or bottleneck log.
3. Relay via another route with file hashes and artifact paths.
4. Keep downstream owner blocked/unblocked state explicit.
5. Verify the next artifact appears in git.

Output:
- routing bottleneck
- relay path
- next owner proof

