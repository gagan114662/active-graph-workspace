# Backlog: Safety Monitor Agent (a second AI that watches the first)

**Added:** 2026-05-28 (operator request)
**Source:** OpenAI / Codex lead Thibault Sottiaux — OpenAI built a second AI that monitors the
first AI to ensure it doesn't do anything harmful. "This changes everything about trusting agents."

## The idea

Today the dark factory has a **quality** gate (Rowan code-review, Theo test-review, Grace gate) and
an **independent verifier** (Sasha-by-proxy / verify-pentagon-autonomy-from-logs.mjs). What it does
NOT have is a dedicated **safety/harm monitor** — a second model whose only job is to watch what an
agent is about to do and block harmful actions *before they take effect*, independent of whether the
work is "correct."

This is distinct from the existing gates:
- **Rowan/Theo/Grace** judge *quality* ("is this a good fix?").
- **The verifier** judges *truth* ("did the claimed work actually happen?").
- **The safety monitor** judges *harm* ("could this action damage the repo, leak a secret, run a
  destructive command, exfiltrate data, or escape its sandbox?") — and can VETO.

## Where it plugs into the existing architecture

The factory already routes every action through choke points where a monitor can sit:
1. **Bridge dispatch** (`pentagon-trigger-bridge.mjs::processCandidates`) — before an agent's reply
   is persisted / a flywheel diff is emitted.
2. **Phoenix action layer** (`phoenix-todo-keeper.mjs::commitAndPushFromWorktree`) — before a commit
   is pushed / a PR is opened. This is the highest-leverage veto point: it's the last gate before
   code leaves the machine.
3. **The diff itself** (`flywheel.diff.proposed`) — scan the proposed patch for harmful patterns
   (secret material, `rm -rf`, network calls, eval of untrusted input, sandbox-escape attempts).

## Concrete first build (scoped)

- New agent role **"Sentinel" (Safety Monitor)** in `agent-os/AGENT_IDENTITY_MAP.md`, distinct from
  Grace (gate sentinel = process gate) — this one is a *harm* gate. (Simone the Security Auditor is
  the closest existing role; Sentinel is the always-on realtime version of Simone.)
- A `safety-monitor.mjs` daemon (mirrors `sasha-skeptic.mjs`) that honker-subscribes to
  `flywheel.diff.proposed` events and, for each, asks a second model (opus-4.8) one question:
  "Does this diff do anything harmful — secrets, destructive shell, exfiltration, sandbox escape,
  prod mutation? Answer ALLOW or BLOCK with a reason." Emits `safety.allowed` / `safety.blocked`.
- Phoenix's `commitAndPushFromWorktree` waits for a `safety.allowed` verdict (fail-closed, like the
  review gate C3/C4 just shipped) before pushing. A `safety.blocked` parks the todo in a terminal
  `blocked_by_safety` state and emits `behavior.failed reason=safety.blocked` so it enters the
  flywheel for operator review.
- Make it **independent**: the monitor model gets ONLY the diff + a fixed harm rubric, never the
  task context that might rationalize a harmful action. (This is the OpenAI insight — the monitor
  must not share the actor's goal, or it inherits the actor's blind spots.)

## Why it matters for "dependable production-ready code for the real world"

The factory can now dispatch fixes autonomously (flywheel) and land them via PR. The moment that
loop runs unattended, a single harmful diff (a leaked key, a destructive migration, a backdoor) is
a real-world liability. The safety monitor is the harm-veto that makes 24/7 autonomy defensible —
it's the precondition for turning the flywheel's `--autodispatch` on without an operator watching.

## Relationship to existing backlog

- Supersedes the vague "F2.0 monitoring agent" framing with a concrete *safety* mandate.
- Pairs with: the review-gate fail-closed work (C3/C4, shipped 2026-05-28), the panic kill switch,
  and Blake's budget caps. Together: quality gate + safety gate + cost gate + kill switch = the
  four guardrails an unattended factory needs.
- Eval-the-eval applies here too: the safety monitor itself needs a ground-truth set of
  known-harmful and known-benign diffs (extend `agent-os/judges/`) and a promotion gate.
