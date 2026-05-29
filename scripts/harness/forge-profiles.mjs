// Forge harness — ROLE PROFILES (Pillar-1 specialization, config-driven).
//
// Inspired by Pi's (earendil-works/pi) modular, config-driven design: rather than
// one general-purpose agent, the Forge harness specializes by ROLE. Each profile is
// plain data describing which tools a role may use and how its shell access is gated.
// Same underlying engine (the installed Claude Code CLI) — different OWNED wrappers.
//
// This is the opposite of Claude Code's `--dangerously-skip-permissions`: every role
// is least-privilege by default. A verifier can READ the repo but never mutate it; a
// builder can write inside the workspace but never run a catastrophic shell command.

// bashMode: "none"      -> no Bash tool at all
//           "readonly"  -> Bash allowed only for an allowlist of read-only commands
//           "guarded"   -> Bash allowed except the always-deny catastrophic patterns
//           "open"      -> Bash allowed except catastrophic patterns (alias of guarded;
//                          explicit so an "unrestricted" escape hatch reads intentionally)
export const PROFILES = {
  // Independent grader. Reads code + runs the deterministic verifier; never mutates.
  verifier: {
    description: "Read-only grader. Inspects code, never writes or runs mutating shell.",
    canWrite: false,
    allowedTools: ["Read", "Grep", "Glob"],
    bashMode: "none",
  },
  // Code owner (Maya). Writes inside the workspace; shell is guarded against disasters.
  builder: {
    description: "Implements features/fixes. Writes in-workspace; shell guarded.",
    canWrite: true,
    allowedTools: ["Read", "Grep", "Glob", "Edit", "Write", "NotebookEdit", "Bash"],
    bashMode: "guarded",
  },
  // Adversarial tester (Quinn). Writes tests; runs the suite; no destructive shell.
  tester: {
    description: "Writes/runs adversarial tests. Guarded shell for pytest etc.",
    canWrite: true,
    allowedTools: ["Read", "Grep", "Glob", "Edit", "Write", "Bash"],
    bashMode: "guarded",
  },
  // Reviewer (Rowan/Theo/Grace). Reads + comments; never writes, never shells.
  reviewer: {
    description: "Reviews diffs and reports a verdict. No writes, no shell.",
    canWrite: false,
    allowedTools: ["Read", "Grep", "Glob"],
    bashMode: "none",
  },
  // Explicit escape hatch — still blocked from CATASTROPHIC commands. Opt-in only.
  unrestricted: {
    description: "Full toolset; only catastrophic/irreversible commands are blocked.",
    canWrite: true,
    allowedTools: ["Read", "Grep", "Glob", "Edit", "Write", "NotebookEdit", "Bash"],
    bashMode: "open",
  },
};

export function getProfile(role) {
  const p = PROFILES[role];
  if (!p) throw new Error(`unknown forge role "${role}". known: ${Object.keys(PROFILES).join(", ")}`);
  return p;
}

// Read-only command allowlist for bashMode "readonly" (leaf command names).
export const READONLY_BASH = new Set([
  "ls", "cat", "head", "tail", "wc", "grep", "rg", "find", "stat", "file", "echo",
  "pwd", "which", "env", "date", "tree", "du", "df", "sort", "uniq", "cut", "awk", "sed",
]);
