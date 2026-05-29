// Forge tool-module CONTRACT (the "self-contained module: schema + permission + execution" pattern).
//
// Every file in forge-tools/ (except _contract.mjs and *.test.mjs) is a self-contained
// tool that default-exports an object with EXACTLY this shape:
//   {
//     name:        snake_case string (becomes mcp__forge__<name>)
//     description: one-line string shown to the model
//     inputSchema: JSON-Schema object ({ type:"object", properties, required })
//     allowedRoles: non-empty array of Forge roles (or ["*"] for all)
//     execute(input): sync or async -> JSON-serializable result
//   }
// The registry auto-discovers these; the MCP server exposes only the ones whose
// allowedRoles include the caller's role (permission model is per-tool, not global).

const ROLE_RE = /^[a-z][a-z0-9_]*$/;

export function validateToolModule(mod, file = "<module>") {
  const t = mod?.default ?? mod;
  const errors = [];
  if (!t || typeof t !== "object") {
    return { ok: false, errors: [`${file}: no default export object`], tool: null };
  }
  if (typeof t.name !== "string" || !/^[a-z][a-z0-9_]*$/.test(t.name)) errors.push(`${file}: name must be a snake_case string`);
  if (typeof t.description !== "string" || !t.description.trim()) errors.push(`${file}: description required`);
  if (!t.inputSchema || t.inputSchema.type !== "object" || typeof t.inputSchema !== "object") errors.push(`${file}: inputSchema must be a JSON-schema object ({type:"object",...})`);
  if (!Array.isArray(t.allowedRoles) || t.allowedRoles.length === 0) errors.push(`${file}: allowedRoles must be a non-empty array`);
  else for (const r of t.allowedRoles) if (r !== "*" && !ROLE_RE.test(r)) errors.push(`${file}: bad role "${r}"`);
  if (typeof t.execute !== "function") errors.push(`${file}: execute must be a function`);
  return { ok: errors.length === 0, errors, tool: errors.length === 0 ? t : null };
}

// Minimal JSON-schema input validation: required presence + primitive types.
export function validateInput(schema, input = {}) {
  const errors = [];
  const props = schema?.properties || {};
  for (const req of schema?.required || []) if (input[req] === undefined) errors.push(`missing required field "${req}"`);
  for (const [k, v] of Object.entries(input)) {
    const p = props[k];
    if (!p || !p.type) continue;
    const t = p.type;
    if (t === "string" && typeof v !== "string") errors.push(`"${k}" must be string`);
    else if (t === "number" && typeof v !== "number") errors.push(`"${k}" must be number`);
    else if (t === "boolean" && typeof v !== "boolean") errors.push(`"${k}" must be boolean`);
    else if (t === "array" && !Array.isArray(v)) errors.push(`"${k}" must be array`);
  }
  return { ok: errors.length === 0, errors };
}
