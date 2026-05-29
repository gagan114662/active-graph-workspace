#!/usr/bin/env node
// referee-factory/ladder.mjs
//
// The HONEST ladder scoreboard across the framework's OWN difficulty tiers.
//
// Difficulty is NOT defined by us (that was the 21-session sin). The tiers and
// their acceptance criteria come from the Active Graph framework's own docs +
// its own test suite. This runner executes each tier's framework-authored oracle
// tests and reports the truthful pass/fail state. Default-to-error: a tier is
// GREEN only if every existing oracle test passes AND no expected oracle file is
// missing (a missing oracle is a RED, never a silent skip).
//
// Tier oracle test sets were discovered by reconnaissance against the framework
// (frames/eval-reports/, recon workflow 2026-05-29) and are verified to exist
// here before running — a hallucinated oracle path is reported, not trusted.
//
// Usage: node scripts/referee-factory/ladder.mjs [tier] [--json]

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const INNER = path.join(REPO_ROOT, "activegraph");
const VENV = path.join(INNER, ".venv", "bin", "python");

// Externally-defined tiers (framework docs) -> framework-authored oracle tests.
const LADDER = {
  easy: {
    title: "The 30-Second Setup & Tutorial (Diligence pack + quickstart, byte-deterministic)",
    oracles: ["tests/test_diligence_pack.py", "tests/test_quickstart.py", "tests/test_quickstart_snapshot.py", "tests/test_tutorial_snippets.py"],
  },
  medium: {
    title: "Customizing the World State (custom ontology + reactive behaviors -> Patches)",
    oracles: ["tests/test_graph.py", "tests/test_patch.py", "tests/test_runtime.py", "tests/test_pattern_subscriptions.py", "tests/test_llm_behavior.py", "tests/test_causal_cross_tool.py", "tests/test_v1_0_1_patches.py", "tests/test_operate_example.py", "tests/test_llm_claim_extraction.py", "tests/test_pattern_matcher.py", "tests/test_pattern_parser.py"],
  },
  hard: {
    title: "Advanced Primitives & Time Travel (relation behaviors, Cypher patterns, fork-and-diff w/ replay cache)",
    oracles: ["tests/test_replay.py", "tests/test_llm_replay.py", "tests/test_tool_replay.py", "tests/test_fork.py", "tests/test_fork_set_replay.py", "tests/test_fork_set_persistence.py", "tests/test_cli_fork_set.py", "tests/test_pattern_subscriptions.py", "tests/test_pattern_matcher.py", "tests/test_pattern_parser.py", "tests/test_diff.py", "tests/test_v0_promote_runtime_diff.py", "tests/test_resume_example.py", "tests/test_replay_trace_snapshot.py"],
  },
  "extra-hard": {
    title: "System Integration & Domain Packaging (full Pack, babyagi-as-behaviors, Postgres EventStore)",
    oracles: ["tests/test_diligence_pack.py", "tests/test_diligence_with_tools.py", "tests/test_pack_scaffold.py", "tests/test_packs.py", "tests/test_store_conformance.py", "tests/test_postgres_store.py", "tests/test_store_url.py", "tests/test_persistence.py", "tests/test_packs_prompt_manifest_t7m_025_coverage.py", "tests/test_packs_compute_hash_t7m_024_coverage.py"],
  },
};

function runTier(tier, cfg) {
  const existing = [];
  const missing = [];
  for (const o of cfg.oracles) {
    (fs.existsSync(path.join(INNER, o)) ? existing : missing).push(o);
  }
  let res = { tier, missing, existing, passed: 0, failed: 0, errors: 0, skipped: 0, exit: null, summary: "" };
  if (existing.length) {
    const r = spawnSync(VENV, ["-m", "pytest", ...existing, "-p", "no:cacheprovider", "-q", "--no-header"], {
      cwd: INNER, env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }, encoding: "utf8", timeout: 420000, maxBuffer: 1024 * 1024 * 32,
    });
    const out = (r.stdout || "") + (r.stderr || "");
    res.exit = r.status === null ? 124 : r.status;
    res.summary = out.trim().split("\n").filter(Boolean).pop() || "(no output)";
    const grab = (re) => { const m = out.match(re); return m ? parseInt(m[1], 10) : 0; };
    res.passed = grab(/(\d+) passed/);
    res.failed = grab(/(\d+) failed/);
    res.errors = grab(/(\d+) error/);
    res.skipped = grab(/(\d+) skipped/);
  }
  // Default-to-error: GREEN only if tests ran, zero failed/errored, AND no oracle missing.
  res.green = res.exit === 0 && res.failed === 0 && res.errors === 0 && missing.length === 0 && existing.length > 0;
  res.state = res.green ? "GREEN" : (missing.length ? "RED (missing oracle)" : "RED");
  return res;
}

const only = process.argv.find((a) => !a.startsWith("--") && a !== process.argv[1] && Object.keys(LADDER).includes(a));
const tiers = only ? [only] : Object.keys(LADDER);
const report = [];
for (const t of tiers) report.push(runTier(t, LADDER[t]));

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log("\n══════════════════════════════════════════════════════════════════════");
  console.log("  HONEST LADDER — framework-defined tiers, framework-authored oracles");
  console.log("══════════════════════════════════════════════════════════════════════");
  for (const r of report) {
    const icon = r.green ? "✅" : "❌";
    console.log(`\n  ${icon} ${r.tier.toUpperCase()} — ${LADDER[r.tier].title}`);
    console.log(`     ${r.summary}`);
    console.log(`     oracles: ${r.existing.length} run, ${r.passed} passed, ${r.failed} failed, ${r.errors} errors, ${r.skipped} skipped${r.missing.length ? `, ${r.missing.length} MISSING: ${r.missing.join(",")}` : ""}`);
  }
  console.log("\n  ──────────────────────────────────────────────────────────────────");
  const greens = report.filter((r) => r.green).map((r) => r.tier);
  const reds = report.filter((r) => !r.green).map((r) => r.tier);
  console.log(`  GREEN tiers: [${greens.join(", ") || "none"}]   RED tiers: [${reds.join(", ") || "none"}]`);
  console.log("  (GREEN = the framework's own acceptance tests for that tier all pass.)");
  console.log("══════════════════════════════════════════════════════════════════════\n");
}
const allGreen = report.every((r) => r.green);
process.exit(allGreen ? 0 : 1);
