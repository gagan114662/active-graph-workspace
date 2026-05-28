#!/usr/bin/env node
// factory-mcp-server.mjs — P13: expose the dark-factory primitives as MCP tools.
//
// IndyDevDan Pillar 5 ("agents only command what they can programmatically
// reach") + the meow/MCP theme: make the factory's read surfaces callable by ANY
// MCP client (Claude Desktop, other agents, eventually external customers) —
// not just the internal scripts.
//
// Minimal, dependency-free MCP stdio server (newline-delimited JSON-RPC 2.0).
// READ-ONLY tools only — no dispatch/spend/mutation over MCP (safety: an
// external caller can observe the factory, never command it). Reuses the
// already-tested exported functions; this is just the protocol shell.
//
// Wire into an MCP client (e.g. Claude Desktop config):
//   { "mcpServers": { "dark-factory": { "command": "node",
//       "args": ["/Users/.../scripts/factory-mcp-server.mjs"] } } }
//
// Tools: factory_budget, factory_recall, factory_resolve_context,
//        factory_arbitrage, factory_success_flows.

import { createInterface } from "node:readline";
import { budgetStatus, readCostEvents, costPerFeature } from "./factory-treasury.mjs";
import { recall } from "./factory-memory.mjs";
import { resolveContext } from "./resolve-context.mjs";
import { arbitrageProof } from "./arbitrage-proof.mjs";
import { lookupSuccessFlows } from "./success-flow-capture.mjs";

const PROTOCOL_VERSION = "2024-11-05";

const TOOLS = [
  {
    name: "factory_budget",
    description: "Current factory compute spend vs Blake caps (hour/day/session) + cost-per-feature. Read-only.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: () => ({ budget: budgetStatus(readCostEvents()), cost_per_feature: costPerFeature() }),
  },
  {
    name: "factory_recall",
    description: "Unified factory memory for a target: what worked, what failed, eval cases, call grades, routed docs, economics.",
    inputSchema: {
      type: "object",
      properties: {
        target_file: { type: "string", description: "repo-relative file path" },
        target_symbol: { type: "string", description: "dotted symbol path" },
        task_class: { type: "string" },
      },
      additionalProperties: false,
    },
    handler: (a) => recall({ targetFile: a.target_file, targetSymbol: a.target_symbol, taskClass: a.task_class, limit: 3 }),
  },
  {
    name: "factory_resolve_context",
    description: "Given a file path, return the context docs the RESOLVER routes it to (where information lives).",
    inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false },
    handler: (a) => resolveContext(a.path),
  },
  {
    name: "factory_arbitrage",
    description: "Output→revenue ratio + verdict for a unit (test|feature) at a given sell price.",
    inputSchema: {
      type: "object",
      properties: { unit: { type: "string", enum: ["test", "feature"] }, sell_price: { type: "number" } },
      additionalProperties: false,
    },
    handler: (a) => arbitrageProof({ unit: a.unit || "test", sellPrice: a.sell_price }),
  },
  {
    name: "factory_success_flows",
    description: "Proven success playbooks matching a target file / symbol / task class.",
    inputSchema: {
      type: "object",
      properties: { target_file: { type: "string" }, target_symbol: { type: "string" }, task_class: { type: "string" } },
      additionalProperties: false,
    },
    handler: (a) => lookupSuccessFlows({ targetFile: a.target_file, targetSymbol: a.target_symbol, taskClass: a.task_class, limit: 5 }),
  },
];

function send(obj) { process.stdout.write(JSON.stringify(obj) + "\n"); }
function ok(id, result) { send({ jsonrpc: "2.0", id, result }); }
function err(id, code, message) { send({ jsonrpc: "2.0", id, error: { code, message } }); }

function handle(msg) {
  const { id, method, params } = msg;
  if (method === "initialize") {
    return ok(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: "dark-factory", version: "1.0.0" },
    });
  }
  if (method === "notifications/initialized" || method === "initialized") return; // notification, no reply
  if (method === "ping") return ok(id, {});
  if (method === "tools/list") {
    return ok(id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
  }
  if (method === "tools/call") {
    const tool = TOOLS.find((t) => t.name === params?.name);
    if (!tool) return err(id, -32602, `unknown tool: ${params?.name}`);
    try {
      const result = tool.handler(params.arguments || {});
      return ok(id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
    } catch (e) {
      return ok(id, { content: [{ type: "text", text: `error: ${String(e?.message || e)}` }], isError: true });
    }
  }
  if (id !== undefined) err(id, -32601, `method not found: ${method}`);
}

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const t = line.trim();
  if (!t) return;
  let msg; try { msg = JSON.parse(t); } catch { return; }
  try { handle(msg); } catch (e) {
    if (msg?.id !== undefined) err(msg.id, -32603, String(e?.message || e));
  }
});
