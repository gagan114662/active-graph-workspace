import { test } from "node:test";
import assert from "node:assert/strict";
import { validateToolModule, validateInput } from "./forge-tools/_contract.mjs";
import { loadTools, toolsForRole } from "./forge-tool-registry.mjs";

test("registry loads all forge-tools and they satisfy the contract", async () => {
  const tools = await loadTools();
  assert.ok(tools.length >= 3, `expected >=3 tools, got ${tools.length}`);
  for (const t of tools) {
    assert.ok(validateToolModule({ default: t }).ok, `tool ${t.name} invalid`);
  }
  const names = tools.map((t) => t.name);
  assert.ok(names.includes("factory_events_query"));
  assert.ok(names.includes("run_verifier"));
  assert.ok(names.includes("resolve_context"));
});

test("role filtering: run_verifier is builder/tester/verifier only", async () => {
  const builder = (await toolsForRole("builder")).map((t) => t.name);
  const reviewer = (await toolsForRole("reviewer")).map((t) => t.name);
  assert.ok(builder.includes("run_verifier"), "builder should get run_verifier");
  assert.ok(!reviewer.includes("run_verifier"), "reviewer must NOT get run_verifier");
  // "*" tools reach every role
  assert.ok(reviewer.includes("factory_events_query"));
  assert.ok(reviewer.includes("resolve_context"));
});

test("contract rejects malformed modules", () => {
  assert.equal(validateToolModule({ default: {} }).ok, false);
  assert.equal(validateToolModule({ default: { name: "Bad Name", description: "x", inputSchema: { type: "object" }, allowedRoles: ["*"], execute() {} } }).ok, false); // bad name
  assert.equal(validateToolModule({ default: { name: "good", description: "x", inputSchema: { type: "object" }, allowedRoles: [], execute() {} } }).ok, false); // empty roles
  assert.equal(validateToolModule({ default: { name: "good", description: "x", inputSchema: { type: "object" }, allowedRoles: ["*"] } }).ok, false); // no execute
  assert.equal(validateToolModule({ default: { name: "good", description: "x", inputSchema: { type: "object" }, allowedRoles: ["*"], execute() {} } }).ok, true);
});

test("input validation: required + types", () => {
  const schema = { type: "object", properties: { proof_file: { type: "string" }, tier: { type: "string" }, n: { type: "number" } }, required: ["proof_file", "tier"] };
  assert.equal(validateInput(schema, { proof_file: "p", tier: "hard" }).ok, true);
  assert.equal(validateInput(schema, { tier: "hard" }).ok, false); // missing proof_file
  assert.equal(validateInput(schema, { proof_file: "p", tier: "hard", n: "x" }).ok, false); // n wrong type
});

test("factory_events_query executes and returns a shape", async () => {
  const tools = await loadTools();
  const q = tools.find((t) => t.name === "factory_events_query");
  const r = await q.execute({ limit: 3 });
  assert.ok(typeof r.count === "number");
  assert.ok(Array.isArray(r.events));
});

test("run_verifier rejects a bad tier without spawning", async () => {
  const tools = await loadTools();
  const v = tools.find((t) => t.name === "run_verifier");
  const r = await v.execute({ proof_file: "x", tier: "bogus" });
  assert.match(r.error || "", /tier must be one of/);
});
