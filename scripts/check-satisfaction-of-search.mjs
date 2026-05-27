#!/usr/bin/env node
// Check Brandon-B satisfaction_of_search_risk on a T7-style proof file.
//
// Per agent-os/RELIABILITY_OPERATING_CONTRACT.md section 5, every
// symbol-selection proof should record at least 3 candidates considered
// with rejection rationale for the non-chosen entries. Proofs that don't
// emit `satisfaction_of_search_risk` warnings (NOT failures — back-compat).
//
// Usage:
//   node scripts/check-satisfaction-of-search.mjs <proof-file>
//   node scripts/check-satisfaction-of-search.mjs frames/t7-repeat-medium-029-cohortB-instruction-20260527.txt
//
// Or bulk-scan all cohort-B proofs:
//   node scripts/check-satisfaction-of-search.mjs --bulk frames/t7-repeat-medium-*-20260527.proof
//
// Emits a verifier.satisfaction_of_search_risk event for each WARN.

import { readFileSync, existsSync } from "node:fs";
import { emitFactoryEvent } from "./factory-events.mjs";
import { installCrashGuard } from "./factory-crash-guard.mjs";

installCrashGuard("check-satisfaction-of-search");

function parseProofFields(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^(\w+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function countCandidates(fields) {
  const list = fields.candidates_considered;
  if (!list) return 0;
  return list.split(/[,;]/).map((s) => s.trim()).filter(Boolean).length;
}

function checkProof(path, { quiet = false } = {}) {
  if (!existsSync(path)) {
    return { path, ok: false, reason: "file_not_found", count: 0 };
  }
  const fields = parseProofFields(readFileSync(path, "utf8"));
  const count = countCandidates(fields);
  const has_chosen = !!(fields.uncovered_symbol || fields.target_symbol || fields.chosen_symbol);
  if (!has_chosen) {
    return { path, ok: false, reason: "no_target_symbol", count };
  }
  if (count < 3) {
    const reason = count === 0
      ? "no_candidates_considered_field"
      : "fewer_than_3_candidates";
    const result = { path, ok: false, reason, count, target: fields.uncovered_symbol || fields.target_symbol };
    try {
      emitFactoryEvent({
        type: "verifier.satisfaction_of_search_risk",
        behavior: "verifier",
        reason: "verifier.satisfaction_of_search_risk",
        message: `${path}: only ${count} candidate(s) recorded (chosen: ${result.target})`,
        extras: {
          proof_file: path,
          candidate_count: count,
          target_symbol: result.target,
          risk_reason: reason,
        },
      });
    } catch {}
    if (!quiet) {
      console.log(`WARN ${path}: ${reason} (count=${count}, target=${result.target})`);
    }
    return result;
  }
  if (!quiet) {
    console.log(`OK   ${path}: ${count} candidates considered (target=${fields.uncovered_symbol || fields.target_symbol})`);
  }
  return { path, ok: true, count, target: fields.uncovered_symbol || fields.target_symbol };
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("usage: node scripts/check-satisfaction-of-search.mjs <proof-file> [proof-file...]");
    console.error("   or: node scripts/check-satisfaction-of-search.mjs --bulk <glob-expanded-list>");
    process.exit(2);
  }
  const paths = args.filter((a) => a !== "--bulk");
  const results = paths.map((p) => checkProof(p));
  const warned = results.filter((r) => !r.ok).length;
  const ok = results.filter((r) => r.ok).length;
  console.log(`\nsummary: ${ok} ok / ${warned} satisfaction_of_search_risk warnings of ${results.length} proofs`);
  // Exit 0 — back-compat: this gate WARNs, doesn't FAIL.
  process.exit(0);
}

main();
