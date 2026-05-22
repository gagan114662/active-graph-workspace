# Skill: Activation Watchdog

Use for every handoff between Pentagon agents.

Rule:
A DM or group message is context delivery only. It is not activation proof.

Steps:
1. Record sender, recipient, artifact path, artifact hash, and handoff time.
2. Watch for recipient activation within five minutes.
3. Accept activation only as a visible turn, worker/process/log evidence,
   committed artifact after the handoff timestamp, or INTERPRETER_BLOCKED.
4. If no activation appears, log bottleneck.detected with source=routing.
5. Avery or Riley must explicitly reactivate the owner or mark the frame
   blocked on pentagon.activation_bug.

Output:
- handoff.sent
- handoff.activation_proven
- or bottleneck.detected / pentagon.activation_bug
