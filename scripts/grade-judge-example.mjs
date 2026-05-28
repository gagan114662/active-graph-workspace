#!/usr/bin/env node
// Seed/append to a judge ground-truth dataset (Task #27).
//
// Operator-facing CLI. Adds one human-graded example to a judge's
// ground-truth file. Used to grow the dataset over time so the promotion
// gate (Task #25 / scripts/judge-promote.mjs) has more cases to grade against.
//
// Usage:
//   node scripts/grade-judge-example.mjs --judge rowan --id rowan-gt-007 \
//     --verdict PASS --rationale "..." --input-file /tmp/example.json
//
//   # or inline JSON
//   node scripts/grade-judge-example.mjs --judge theo --id theo-gt-007 \
//     --verdict FAIL --rationale "..." --input '{"test_diff":"...","target":"..."}'

import { existsSync, appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i < 0 ? fallback : process.argv[i + 1] ?? fallback;
}
function flag(name) { return process.argv.includes(name); }

const judge = arg("--judge");
const id = arg("--id");
const verdict = arg("--verdict");
const rationale = arg("--rationale");
const topFinding = arg("--top-finding") || "(none)";
const inputJson = arg("--input");
const inputFile = arg("--input-file");

if (!judge || !id || !verdict || !rationale) {
  console.error("required: --judge <name> --id <id> --verdict PASS|FAIL|OPEN|BLOCKED --rationale <text>");
  console.error("at least one of: --input <json> | --input-file <path>");
  process.exit(64);
}

let input;
if (inputJson) {
  input = JSON.parse(inputJson);
} else if (inputFile) {
  input = JSON.parse(readFileSync(inputFile, "utf-8"));
} else {
  console.error("either --input or --input-file required");
  process.exit(64);
}

const gtPath = resolve(`agent-os/judges/${judge}/ground-truth.jsonl`);
if (!existsSync(gtPath)) {
  console.error(`ground-truth file does not exist: ${gtPath}`);
  console.error(`create it first or check --judge name (expected: rowan, theo, grace, ...)`);
  process.exit(2);
}

// Verify id is unique
const existing = readFileSync(gtPath, "utf-8").split(/\r?\n/).filter(Boolean);
for (const line of existing) {
  try {
    const row = JSON.parse(line);
    if (row.id === id) {
      console.error(`id ${id} already exists in ${gtPath}`);
      process.exit(3);
    }
  } catch {}
}

const row = {
  id,
  input,
  expected_verdict: verdict,
  expected_top_finding: topFinding,
  rationale,
  graded_at: new Date().toISOString(),
};
appendFileSync(gtPath, JSON.stringify(row) + "\n");
console.log(JSON.stringify({ status: "graded", judge, id, path: gtPath, total_examples: existing.length + 1 }));
