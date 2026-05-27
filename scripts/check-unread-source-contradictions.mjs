#!/usr/bin/env node
// Brandon-C: verifier check for unread-source contradictions.
//
// Source: Brandon Walsenuk's lesson 2 ("surface conflicts, don't hide
// them"). When an agent cites a pattern/claim, the verifier should ask
// "any contradicting source unread?" v1 catches the most concrete case:
// an agent claims a symbol was uncovered but a past proof file already
// claimed coverage for the same symbol — that contradiction would have
// been caught if the agent had read its own factory history before
// committing.
//
// Usage:
//   node scripts/check-unread-source-contradictions.mjs <proof-file> [...]
//   node scripts/check-unread-source-contradictions.mjs --bulk activegraph/frames/t7-repeat-medium-*-20260527.proof
//
// Emits verifier.pattern_contradicted_by_unread_source events for each
// detection. Back-compat: WARN-only (does not fail).

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { emitFactoryEvent } from "./factory-events.mjs";
import { installCrashGuard } from "./factory-crash-guard.mjs";

installCrashGuard("check-unread-source-contradictions");

function parseProof(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^(\w+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

// Build an index of every past proof file's uncovered_symbol claim, plus
// the file the claim came from + the new_test_count it brought.
function buildHistoricalCoverageIndex(currentPath) {
  const proofs = [];
  const seedDirs = [
    "activegraph/frames",
    "frames",
  ];
  for (const dir of seedDirs) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!/\.proof$/.test(name)) continue;
      const path = resolve(dir, name);
      if (resolve(path) === resolve(currentPath)) continue;
      try {
        const fields = parseProof(readFileSync(path, "utf8"));
        if (!fields.uncovered_symbol) continue;
        proofs.push({
          path,
          symbol: fields.uncovered_symbol.trim(),
          test_file: fields.test_file || null,
          new_test_count: Number(fields.new_test_count || 0),
          run_seed: fields.run_seed || null,
          hash: fields.hash || null,
        });
      } catch {}
    }
  }
  return proofs;
}

function check(path, { quiet = false } = {}) {
  if (!existsSync(path)) {
    return { path, ok: false, reason: "file_not_found" };
  }
  const proof = parseProof(readFileSync(path, "utf8"));
  if (!proof.uncovered_symbol) {
    return { path, ok: true, reason: "no_uncovered_symbol_claim" };
  }
  const claim = proof.uncovered_symbol.trim();
  const history = buildHistoricalCoverageIndex(path);
  const contradictions = history.filter((h) => h.symbol === claim);
  if (contradictions.length === 0) {
    if (!quiet) console.log(`OK   ${path}: ${claim} — no contradicting past claim`);
    return { path, ok: true, claim };
  }
  // Contradiction found: this proof claims uncovered but past proof(s)
  // already claimed coverage for the same symbol.
  for (const c of contradictions) {
    try {
      emitFactoryEvent({
        type: "verifier.pattern_contradicted_by_unread_source",
        behavior: "verifier",
        reason: "verifier.pattern_contradicted_by_unread_source",
        message: `${path}: claims ${claim} is uncovered, but ${c.path} already claimed coverage for the same symbol`,
        extras: {
          proof_file: path,
          claimed_symbol: claim,
          contradicting_proof: c.path,
          contradicting_hash: c.hash,
          contradicting_test_file: c.test_file,
          contradicting_new_test_count: c.new_test_count,
        },
      });
    } catch {}
    if (!quiet) {
      console.log(`WARN ${path}: ${claim} was already claimed covered by ${basename(c.path)} (${c.new_test_count} tests in ${c.test_file})`);
    }
  }
  return { path, ok: false, claim, contradictions };
}

function main() {
  const args = process.argv.slice(2).filter((a) => a !== "--bulk");
  if (args.length === 0) {
    console.error("usage: node scripts/check-unread-source-contradictions.mjs <proof-file> [proof-file...]");
    process.exit(2);
  }
  const results = args.map((p) => check(p));
  const ok = results.filter((r) => r.ok).length;
  const warned = results.length - ok;
  console.log(`\nsummary: ${ok} ok / ${warned} pattern_contradicted_by_unread_source warnings of ${results.length} proofs`);
  process.exit(0);
}

main();
