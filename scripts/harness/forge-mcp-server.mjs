#!/usr/bin/env node
// Forge MCP server — exposes the role's permitted forge-tools to the installed
// Claude Code CLI over MCP stdio (dependency-free JSON-RPC, mirroring
// scripts/factory-mcp-server.mjs). Launched by forge.mjs with --role; only tools
// whose allowedRoles include that role are served (per-tool permission, enforced
// at the server boundary, not just advertised).
import { createInterface } from "node:readline";
import { toolsForRole } from "./forge-tool-registry.mjs";
import { validateInput } from "./forge-tools/_contract.mjs";

const PROTOCOL_VERSION = "2024-11-05";
function arg(n, d) { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; }
const role = arg("--role", "builder");

function send(o) { process.stdout.write(JSON.stringify(o) + "\n"); }
function ok(id, r) { send({ jsonrpc: "2.0", id, result: r }); }
function err(id, c, m) { send({ jsonrpc: "2.0", id, error: { code: c, message: m } }); }

let TOOLS = [];

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === "initialize") return ok(id, { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: `forge-tools(${role})`, version: "1.0.0" } });
  if (method === "notifications/initialized" || method === "initialized") return;
  if (method === "ping") return ok(id, {});
  if (method === "tools/list") return ok(id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
  if (method === "tools/call") {
    const tool = TOOLS.find((t) => t.name === params?.name);
    if (!tool) return err(id, -32602, `tool not available for role "${role}": ${params?.name}`);
    const v = validateInput(tool.inputSchema, params.arguments || {});
    if (!v.ok) return ok(id, { content: [{ type: "text", text: `input error: ${v.errors.join("; ")}` }], isError: true });
    try {
      const result = await tool.execute(params.arguments || {});
      return ok(id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
    } catch (e) {
      return ok(id, { content: [{ type: "text", text: `error: ${String(e?.message || e)}` }], isError: true });
    }
  }
  if (id !== undefined) err(id, -32601, `method not found: ${method}`);
}

TOOLS = await toolsForRole(role);
const rl = createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  const t = line.trim();
  if (!t) return;
  let msg; try { msg = JSON.parse(t); } catch { return; }
  try { await handle(msg); } catch (e) { if (msg?.id !== undefined) err(msg.id, -32603, String(e?.message || e)); }
});
