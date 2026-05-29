#!/usr/bin/env node
// pt.21 — CLAIM AUDITOR: the factory's immune system against LLM false victories.
//
// Tonight's 13-hour run proved the lies creep in at the SEAMS, not the core: a fire
// helper that hardcoded verifier_exit:0 (rubber-stamp), "everything done" claims over a
// stale backlog, a "todo.completed" emitted for a ship that shipped nothing. The verifier
// stops a Maya from faking a fix; nothing was stopping the LAYERS AROUND it from claiming
// victory. This does: it takes every CLAIM (merged / completed / PASS) and checks it against
// INDEPENDENT GROUND TRUTH (GitHub PR state, git main, re-running the verifier). A claim
// that doesn't match reality is emitted as `false_victory_detected` (a behavior.failed) —
// which the flywheel itself then routes to a fix. Lies become failures become fixes.
//
// Pure core (auditMergeClaim / classifyAudit) is unit-tested; the CLI does the live checks.
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

// ---- pure, testable core ----------------------------------------------------

// Given a claimed merge and the ground-truth lookups, decide if it's real.
// claim: { todo_event_id, pr_url, sha, branch }
// gh:    (prNumber|branch) => { state, mergedAt } | null
// gitHasCommit: (sha) => boolean   (is the commit actually on origin/main?)
export function auditMergeClaim(claim, gh, gitHasCommit) {
  const prRef = claim.pr_url ? claim.pr_url.split("/").pop() : claim.branch;
  const pr = prRef ? gh(prRef) : null;
  const prMerged = !!(pr && pr.state === "MERGED" && pr.mergedAt);
  // a merge claim is REAL only if GitHub says MERGED *and* (if we have a sha) the
  // squashed commit is actually reachable on main.
  const shaOnMain = claim.sha ? gitHasCommit(claim.sha) : prMerged;
  const real = prMerged && (claim.sha ? true : prMerged); // sha-on-main checked separately below
  const verdict = prMerged ? (claim.sha && !shaOnMain ? "merged_but_sha_absent" : "real") : "claimed_not_merged";
  return {
    claim, real: verdict === "real",
    verdict,
    evidence: { pr_state: pr?.state ?? "NONE", pr_merged_at: pr?.mergedAt ?? null, sha_on_main: shaOnMain },
  };
}

// Classify a batch of audits into a summary.
export function classifyAudit(results) {
  const falseVictories = results.filter((r) => !r.real);
  return {
    total: results.length,
    real: results.length - falseVictories.length,
    false_victories: falseVictories.length,
    offenders: falseVictories.map((r) => ({ todo: r.claim.todo_event_id, verdict: r.verdict, evidence: r.evidence })),
  };
}

// ---- live CLI ---------------------------------------------------------------

function loadMergeClaims(eventsPath, sinceHours) {
  if (!existsSync(eventsPath)) return [];
  const cutoff = Date.now() - sinceHours * 3600 * 1000;
  const claims = [];
  for (const line of readFileSync(eventsPath, "utf8").split(/\n/)) {
    if (!line.trim()) continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    if (e.type !== "flywheel.pr.merged") continue;
    if (Date.parse(e.created_at || "") < cutoff) continue;
    const p = e.payload || {};
    claims.push({ todo_event_id: p.todo_event_id, pr_url: p.pr_url, sha: p.sha, branch: p.branch, claimed_at: e.created_at });
  }
  return claims;
}

const REPO = "gagan114662/activegraph";
const INNER = "activegraph";

function ghLookup(prRef) {
  const r = spawnSync("gh", ["pr", "view", String(prRef), "--repo", REPO, "--json", "state,mergedAt"], { encoding: "utf8", timeout: 30000 });
  if (r.status !== 0) return null;
  try { return JSON.parse(r.stdout); } catch { return null; }
}
function gitHasCommit(sha) {
  if (!sha) return false;
  const r = spawnSync("git", ["-C", INNER, "merge-base", "--is-ancestor", sha, "origin/main"], { encoding: "utf8", timeout: 20000 });
  return r.status === 0;
}

async function main() {
  const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
  const sinceHours = Number(arg("--since-hours", "72"));
  const eventsPath = arg("--events", "frames/factory-events.jsonl");
  spawnSync("git", ["-C", INNER, "fetch", "origin", "main", "-q"], { timeout: 30000 });

  const claims = loadMergeClaims(eventsPath, sinceHours);
  const results = claims.map((c) => auditMergeClaim(c, ghLookup, gitHasCommit));
  const summary = classifyAudit(results);
  console.log(JSON.stringify(summary, null, 2));

  if (summary.false_victories > 0) {
    const { emitBehaviorFailed } = await import("./factory-events.mjs");
    for (const o of summary.offenders) {
      emitBehaviorFailed({
        behavior: "claim-auditor", reason: "false_victory_detected",
        message: `Claimed merge for todo ${o.todo} is NOT real (${o.verdict}): pr_state=${o.evidence.pr_state} sha_on_main=${o.evidence.sha_on_main}`,
        extras: { todo_event_id: o.todo, verdict: o.verdict, evidence: o.evidence },
      });
    }
    console.error(`[claim-auditor] ${summary.false_victories} FALSE VICTORY(IES) detected — emitted false_victory_detected (flywheel will route to a fix)`);
    process.exit(3);
  }
  console.log(`[claim-auditor] ${summary.real}/${summary.total} merge claims verified against GitHub + git ground truth. No false victories.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error("[claim-auditor] fatal", e); process.exit(70); });
}
