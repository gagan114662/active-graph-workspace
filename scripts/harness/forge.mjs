#!/usr/bin/env node
// Forge harness — LAUNCHER (the pi-coding-agent layer).
//
// Owns the wrapper around the rented engine. Given a ROLE + prompt it:
//   1. resolves the role profile (forge-profiles)
//   2. generates a scoped Claude Code settings.json that wires the Forge permission
//      gate as a PreToolUse hook + a per-role allowedTools list + permission-mode
//      "default" (NOT --dangerously-skip-permissions)
//   3. launches the INSTALLED `claude` CLI headless (stream-json) — no raw API, no
//      leaked code — and parses its stream, emitting a factory event per tool-use /
//      turn / result, and writing a replayable invocation record.
//
// Layering mirrors Pi (earendil-works/pi): backend (installed claude) ← core (this
// loop + the gate) ← role profiles. The factory already owns the bottom layer via
// activegraph's LLMProvider; this owns the orchestration + safety layer on top.
//
// Usage:
//   node scripts/harness/forge.mjs run --role builder --prompt "..." [--cwd DIR] [--print]
//   --print  : show the exact invocation + generated settings, do NOT spawn (verifiable, no spend)

import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getProfile } from "./forge-profiles.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE_BIN = process.env.FORGE_CLAUDE_BIN || `${process.env.HOME}/.local/bin/claude`;

function arg(name, def) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : def; }
const has = (n) => process.argv.includes(n);

// Build the scoped Claude Code settings for a role: the Forge gate as a PreToolUse
// hook + the role's allowedTools. permission-mode stays "default" so the hook is
// authoritative (the opposite of bypassPermissions).
export function buildSettings(role) {
  const gate = join(HERE, "forge-permission.mjs");
  return {
    permissions: { defaultMode: "default" },
    hooks: {
      PreToolUse: [
        { matcher: "*", hooks: [{ type: "command", command: `node ${JSON.stringify(gate)} --hook --role ${role}` }] },
      ],
    },
  };
}

// Build the exact `claude` argv for a role + prompt.
export function buildInvocation(role, prompt, settingsPath) {
  const profile = getProfile(role);
  return [
    "-p", prompt,
    "--output-format", "stream-json",
    "--verbose",
    "--allowedTools", profile.allowedTools.join(","),
    "--settings", settingsPath,
    "--permission-mode", "default",
  ];
}

async function main() {
  const sub = process.argv[2];
  if (sub !== "run") {
    console.error("usage: forge.mjs run --role <role> --prompt <text> [--cwd DIR] [--print]");
    process.exit(2);
  }
  const role = arg("--role", "builder");
  const prompt = arg("--prompt", "");
  const cwd = resolve(arg("--cwd", process.cwd()));
  const profile = getProfile(role); // throws on unknown role
  const settings = buildSettings(role);

  if (has("--print")) {
    const settingsPath = "<tempfile>/settings.json";
    console.log("# Forge invocation (role=%s, profile=%s)", role, profile.description);
    console.log("#", CLAUDE_BIN, buildInvocation(role, prompt || "<PROMPT>", settingsPath).map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(" "));
    console.log("# allowedTools:", profile.allowedTools.join(", "), "| bashMode:", profile.bashMode, "| canWrite:", profile.canWrite);
    console.log("# generated settings.json:");
    console.log(JSON.stringify(settings, null, 2));
    console.log("# cwd:", cwd);
    process.exit(0);
  }

  if (!prompt) { console.error("--prompt required"); process.exit(2); }

  const dir = mkdtempSync(join(tmpdir(), "forge-"));
  const settingsPath = join(dir, "settings.json");
  writeFileSync(settingsPath, JSON.stringify(settings));
  const invocation = buildInvocation(role, prompt, settingsPath);

  const { emitInfrastructureEvent, emitBehaviorCompleted } = await import("../factory-events.mjs");
  emitInfrastructureEvent({ subtype: "forge_dispatch", message: `Forge run role=${role}`, extras: { role, cwd, allowed_tools: profile.allowedTools } });

  const child = spawn(CLAUDE_BIN, invocation, { cwd, env: { ...process.env }, stdio: ["ignore", "pipe", "pipe"] });
  let buf = "";
  child.stdout.on("data", (d) => {
    buf += d.toString();
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      let ev; try { ev = JSON.parse(line); } catch { continue; }
      // Instrument tool uses + final result as factory events.
      if (ev.type === "assistant" && Array.isArray(ev.message?.content)) {
        for (const c of ev.message.content) {
          if (c.type === "tool_use") emitInfrastructureEvent({ subtype: "forge_tool_use", message: `${role} -> ${c.name}`, extras: { role, tool: c.name } });
        }
      }
      if (ev.type === "result") {
        emitBehaviorCompleted({ behavior: "forge_run", message: `Forge role=${role} ${ev.is_error ? "ERROR" : "done"}`, extras: { role, is_error: !!ev.is_error, cost_usd: ev.total_cost_usd, session_id: ev.session_id } });
      }
      process.stdout.write(line + "\n");
    }
  });
  child.stderr.on("data", (d) => process.stderr.write(d));
  child.on("close", (code) => process.exit(code ?? 0));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error("[forge] fatal", e); process.exit(70); });
}
