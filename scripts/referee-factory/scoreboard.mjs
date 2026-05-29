#!/usr/bin/env node
// referee-factory/scoreboard.mjs
//
// The HONEST scoreboard.
//
// The North Star is NOT "merged a PR into someone else's repo" (the operator does
// not want auto-PRs upstream). It is: how many real bugs did a BLIND builder fix
// under FULL DISCIPLINE — i.e. graded by tests the builder could not see, author,
// or edit, with a sealed holdout to catch teach-to-the-test, default-to-error so
// nothing passes by assumption.
//
// A referee-VERIFIED count is only meaningful if the discipline conditions hold.
// They are listed in every report so the number cannot be inflated by quietly
// dropping a condition (the exact failure mode of the prior 21 sessions, where the
// grader was loosened or rubber-stamped).
//
// Upstream issues are shown as context only: real external tasks that COULD be
// pulled in as task sources — not as a shaming "0 shipped" metric.
//
// Usage: node scripts/referee-factory/scoreboard.mjs [--json]

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const UPSTREAM = "yoheinakajima/activegraph";
const refereeDir = path.join(REPO_ROOT, "frames", "referee");

function gh(args) {
  try {
    return execFileSync("gh", args, { encoding: "utf8", timeout: 30000 });
  } catch (e) {
    return null; // network/auth failure => unknown, never assume success
  }
}

function ghJson(args) {
  const out = gh(args);
  if (out == null) return null;
  try { return JSON.parse(out); } catch { return null; }
}

// ---- EXTERNAL (the only thing that counts as "shipped") ----
// CRITICAL honesty fix: "shipped" means a PR WE authored, merged upstream — NOT
// the upstream repo's own development. Counting all merged PRs would be a false
// victory (the exact failure mode this whole project exists to kill).
const me = (gh(["api", "user", "--jq", ".login"]) || "").trim() || "gagan114662";
const mergedPRs = ghJson(["pr", "list", "--repo", UPSTREAM, "--state", "merged", "--json", "number,title,author,mergedAt", "--limit", "200"]);
const ourMerged = mergedPRs == null
  ? null
  : mergedPRs.filter((p) => p.author && (p.author.login === me));
const openIssues = ghJson(["issue", "list", "--repo", UPSTREAM, "--state", "open", "--json", "number,title", "--limit", "100"]);

const externalShipped = ourMerged == null ? null : ourMerged.length; // OURS only
const upstreamTotalMerged = mergedPRs == null ? null : mergedPRs.length; // context only
const openExternalTasks = openIssues == null ? null : openIssues.length;

// ---- INTERNAL referee results (NOT shipping; progress only) ----
let internalVerified = 0, internalError = 0, internalRuns = 0;
const ledgers = fs.existsSync(refereeDir)
  ? fs.readdirSync(refereeDir).filter((f) => f.endsWith(".proof.jsonl"))
  : [];
for (const f of ledgers) {
  const lines = fs.readFileSync(path.join(refereeDir, f), "utf8").split("\n").filter(Boolean);
  for (const line of lines) {
    let ev; try { ev = JSON.parse(line); } catch { continue; }
    if (ev.stage === "verdict") {
      internalRuns++;
      if (ev.status === "VERIFIED") internalVerified++;
      else internalError++;
    }
  }
}

// The discipline conditions that make a VERIFIED count mean something. These are
// ENFORCED in code (grader.mjs / factory.mjs); listed here so the metric can't be
// silently inflated by dropping one.
const DISCIPLINE = [
  "grader is pytest exit code, not an LLM judgement (cannot be sweet-talked)",
  "grading tests are external to the builder: pre-existing, blind, hash-pinned to HEAD",
  "a sealed holdout (never on disk for the builder) catches teach-to-the-test",
  "default-to-error: VERIFIED only if EVERY required gate is cleared with evidence",
  "role separation: saboteur / builder / grader / adversary / judge are distinct",
];

const report = {
  northStar: "bugs fixed by a BLIND builder under full discipline (referee-VERIFIED)",
  discipline_conditions: DISCIPLINE,
  referee: {
    runs: internalRuns,
    verified: internalVerified,
    error: internalError,
    meaning: "VERIFIED = a blind builder's fix cleared an ungameable, builder-external grader. Honest as long as the discipline conditions above hold.",
  },
  context_only: {
    note: "Operator does NOT auto-PR upstream. These are real external tasks that COULD seed task sources.",
    upstream_repo: UPSTREAM,
    open_external_tasks: openExternalTasks,
    our_merged_upstream_prs: externalShipped, // informational, not the goal
    upstream_total_merged: upstreamTotalMerged,
  },
};

if (process.argv.includes("--json")) {
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
} else {
  console.log("\n══════════════════════════════════════════════════════════════");
  console.log("  HONEST SCOREBOARD — active_graph dark factory");
  console.log("══════════════════════════════════════════════════════════════");
  console.log("  NORTH STAR: bugs fixed by a BLIND builder under FULL DISCIPLINE");
  console.log(`    referee-VERIFIED : ${internalVerified}   (errors/rejections: ${internalError}, total runs: ${internalRuns})`);
  console.log("    discipline that makes this count (all enforced in code):");
  for (const d of DISCIPLINE) console.log(`      • ${d}`);
  console.log("");
  console.log("  CONTEXT ONLY (not the goal — operator does NOT auto-PR upstream)");
  console.log(`    upstream repo      : ${UPSTREAM}`);
  console.log(`    open external tasks: ${openExternalTasks === null ? "UNKNOWN" : openExternalTasks}  (could seed real task sources)`);
  console.log(`    our merged upstream: ${externalShipped === null ? "UNKNOWN" : externalShipped}  (informational)`);
  console.log("══════════════════════════════════════════════════════════════\n");
}
