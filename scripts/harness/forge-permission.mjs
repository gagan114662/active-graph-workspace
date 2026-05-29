#!/usr/bin/env node
// Forge harness — PERMISSION GATE (Pillar-5: lock the bash tool, least-privilege roles).
//
// This is the layer Claude Code's `--dangerously-skip-permissions` throws away. The
// Forge harness keeps the rented engine but OWNS the tool-permission decision: every
// tool call a role makes is gated here. Two integration modes:
//   1. pure decide() — unit-testable, the single source of truth.
//   2. `--hook --role <role>` — a Claude Code PreToolUse hook. Reads the tool-call
//      JSON on stdin, allows (exit 0) or BLOCKS (exit 2 + reason on stderr, per the
//      Claude Code hook contract) — and emits a factory event on every block, so a
//      blocked dangerous command is a first-class event, not a silent near-miss.
//
// CATASTROPHIC patterns are denied for EVERY role, including `unrestricted`.

import { getProfile, READONLY_BASH } from "./forge-profiles.mjs";

// Irreversible / system-destroying / factory-destroying commands. Denied always.
const CATASTROPHIC = [
  { re: /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, why: "fork bomb" },
  { re: /\bmkfs\b/i, why: "filesystem format" },
  { re: /\bdd\b[^|]*\bof=\/dev\//i, why: "dd to a device" },
  { re: />\s*\/dev\/(sd|disk|nvme)/i, why: "write to raw device" },
  { re: /\bchmod\s+-R\s+777\s+\/(?:\s|$)/i, why: "chmod -R 777 /" },
  { re: /\b(shutdown|reboot|halt|poweroff)\b/i, why: "power/state command" },
  { re: /\bkill\s+-9\s+-?1\b/i, why: "kill all processes" },
  { re: /\bsudo\b/i, why: "privilege escalation (sudo)" },
  { re: /\b(curl|wget)\b[^\n]*\|\s*(sudo\s+)?(sh|bash|zsh)\b/i, why: "pipe-to-shell remote exec" },
  { re: /\bgit\b[^\n]*\bpush\b[^\n]*(--force\b|--force-with-lease\b|\s-f\b)/i, why: "git force-push" },
  { re: /\bgit\b[^\n]*\breset\b[^\n]*--hard\b/i, why: "git reset --hard (destroys work)" },
  { re: /\b(DROP\s+(TABLE|DATABASE|SCHEMA)|TRUNCATE\s+TABLE)\b/i, why: "destructive SQL DDL" },
  { re: /\blaunchctl\s+bootout\b/i, why: "bootout a LaunchAgent (could kill the factory)" },
  { re: /\s>\s*\/etc\//i, why: "write into /etc" },
];

// Recursive-force `rm` analysis: block deletes of root/home/parent or any absolute
// path outside a temp root. Allow relative paths (build/, node_modules/) and /tmp —
// those are legitimate builder cleanup. Returns a reason string if dangerous, else null.
const TEMP_ROOTS = ["/tmp/", "/private/tmp/", "/var/folders/", "/private/var/folders/"];
export function dangerousRm(cmd) {
  const m = String(cmd || "").match(/\brm\b([^\n|;&]*)/);
  if (!m) return null;
  const rest = m[1];
  const recursive = /(^|\s)-[a-z]*r/i.test(rest) || /--recursive/i.test(rest);
  const force = /(^|\s)-[a-z]*f/i.test(rest) || /--force/i.test(rest);
  if (!(recursive && force)) return null;
  const targets = rest.split(/\s+/).filter((t) => t && !t.startsWith("-"));
  for (const t of targets) {
    if (t === "/" || t === "/*") return "rm -rf /";
    if (t.startsWith("~") || t.includes("$HOME")) return "rm -rf of home directory";
    if (t === ".." || t.startsWith("../") || t.includes("/..")) return "rm -rf with parent-traversal";
    if (t.startsWith("/") && !TEMP_ROOTS.some((r) => t.startsWith(r))) {
      return `rm -rf of absolute path outside temp (${t})`;
    }
  }
  return null;
}

function leafCommand(cmd) {
  // first token of the (possibly piped) command, stripped of path
  const first = String(cmd || "").trim().split(/[|;&]/)[0].trim().split(/\s+/)[0] || "";
  return first.split("/").pop();
}

// Pure decision. toolName + toolInput (Claude Code shapes) + role -> {allow, reason, severity}.
export function decide(toolName, toolInput = {}, role = "builder") {
  const profile = getProfile(role);

  // 1. Tool must be in the role's allowlist.
  if (!profile.allowedTools.includes(toolName)) {
    return { allow: false, severity: "role", reason: `role "${role}" may not use tool "${toolName}" (allowed: ${profile.allowedTools.join(", ")})` };
  }

  // 2. Write-class tools require canWrite.
  if (["Edit", "Write", "NotebookEdit"].includes(toolName) && !profile.canWrite) {
    return { allow: false, severity: "role", reason: `role "${role}" is read-only; "${toolName}" denied` };
  }

  // 3. Bash gating.
  if (toolName === "Bash") {
    const cmd = String(toolInput.command ?? "");
    if (profile.bashMode === "none") {
      return { allow: false, severity: "role", reason: `role "${role}" has no shell access` };
    }
    // Catastrophic: denied for ALL roles/modes (incl. unrestricted).
    const rmWhy = dangerousRm(cmd);
    if (rmWhy) return { allow: false, severity: "catastrophic", reason: `blocked: ${rmWhy}` };
    for (const p of CATASTROPHIC) {
      if (p.re.test(cmd)) return { allow: false, severity: "catastrophic", reason: `blocked: ${p.why}` };
    }
    if (profile.bashMode === "readonly") {
      const leaf = leafCommand(cmd);
      // any redirection / mutation operators disqualify a "readonly" command
      if (/[>]|>>|\bmv\b|\bcp\b|\brm\b|\btouch\b|\bmkdir\b|\binstall\b/i.test(cmd) || !READONLY_BASH.has(leaf)) {
        return { allow: false, severity: "role", reason: `role "${role}" readonly shell: "${leaf || cmd}" not in read-only allowlist` };
      }
    }
    return { allow: true, severity: "ok", reason: "bash permitted" };
  }

  return { allow: true, severity: "ok", reason: "permitted" };
}

// ---- Hook mode (Claude Code PreToolUse) -----------------------------------
function argv(name, def) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : def; }

async function runHook() {
  const role = argv("--role", "builder");
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  let payload = {};
  try { payload = JSON.parse(raw || "{}"); } catch { /* fall through with empty */ }
  // Claude Code PreToolUse payload: { tool_name, tool_input, ... }
  const toolName = payload.tool_name ?? payload.toolName ?? "";
  const toolInput = payload.tool_input ?? payload.toolInput ?? {};
  const d = decide(toolName, toolInput, role);
  if (d.allow) process.exit(0);
  // Blocked: log it as a factory event (best-effort), then block per hook contract.
  try {
    const { emitInfrastructureEvent } = await import("../factory-events.mjs");
    emitInfrastructureEvent({
      subtype: "forge_permission_blocked",
      message: `Forge blocked ${toolName} for role=${role}: ${d.reason}`,
      extras: { role, tool: toolName, severity: d.severity, reason: d.reason,
        command: String(toolInput.command ?? "").slice(0, 200) },
    });
  } catch { /* event log is best-effort; the block still happens */ }
  process.stderr.write(`Forge permission gate: ${d.reason}\n`);
  process.exit(2); // exit 2 = block + show stderr to the model (Claude Code hook contract)
}

import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.argv.includes("--hook")) {
  runHook();
}
