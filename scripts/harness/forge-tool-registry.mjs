// Forge tool REGISTRY — auto-discovers forge-tools/*.mjs at import time (plugin
// architecture: drop a file in, it's available; no central edit). Validates each
// against the contract and filters by role for the permission model.
import { readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateToolModule } from "./forge-tools/_contract.mjs";

const TOOLS_DIR = join(dirname(fileURLToPath(import.meta.url)), "forge-tools");

export async function loadTools() {
  const files = readdirSync(TOOLS_DIR)
    .filter((f) => f.endsWith(".mjs") && !f.startsWith("_") && !f.endsWith(".test.mjs"))
    .sort();
  const tools = [];
  for (const f of files) {
    const mod = await import(pathToFileURL(join(TOOLS_DIR, f)).href);
    const v = validateToolModule(mod, f);
    if (!v.ok) throw new Error(`invalid Forge tool module: ${v.errors.join("; ")}`);
    if (tools.some((t) => t.name === v.tool.name)) throw new Error(`duplicate Forge tool name "${v.tool.name}" (in ${f})`);
    tools.push(v.tool);
  }
  return tools;
}

export async function toolsForRole(role) {
  const all = await loadTools();
  return all.filter((t) => t.allowedRoles.includes("*") || t.allowedRoles.includes(role));
}
