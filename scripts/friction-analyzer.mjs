#!/usr/bin/env node
// pt.19 — FRICTION ANALYZER. Automates Lucas Meyer's manual move: "read the whole
// transcript, find where the agent went wrong, ask WHAT WOULD HAVE HELPED IT REACH
// THE GOAL FASTER, and fix the repo so the marble rolls smoothly." Instead of a human
// reading transcripts, this reads a run's factory-event trail, classifies friction,
// and proposes concrete repo/instruction improvements as `repo.friction.proposed`
// events for the operator (or a fix agent) to act on. This is the factory getting
// BETTER on its own, not just running on its own.
//
// Pure core (analyzeFriction) is unit-tested; the CLI loads events + emits.

import { readFileSync, existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

// Map a run's events -> structured friction findings + repo-improvement proposals.
// events: array of factory events (already filtered to one run). meta: {hash, tier}.
// Returns { dispatches, frictions:[{type,severity,evidence,proposal,repo_actionable}], score }.
export function analyzeFriction(events, meta = {}) {
  const ev = Array.isArray(events) ? events : [];
  const typ = (e) => e.type || "";
  const reason = (e) => (e.payload || {}).reason || "";
  const sub = (e) => typ(e).includes(".") ? typ(e).split(".").slice(1).join(".") : typ(e);
  const has = (pred) => ev.filter(pred);

  const frictions = [];
  const add = (f) => frictions.push({ severity: "medium", repo_actionable: false, ...f });

  // 1. Agent's first graded attempt was REJECTED by the verifier -> the task spec or
  //    a repo contract tripped the agent. This is the highest-value repo-actionable
  //    friction (it's exactly what bit the hard fire-helper: a bug_source format the
  //    instruction got wrong). "What would have helped": make the contract explicit.
  const rejections = has((e) => sub(e) === "verifier_rejected_proof" || reason(e).endsWith("verifier_rejected_proof"));
  if (rejections.length) {
    const summaries = rejections.map((e) => (e.payload || {}).verifier_summary || (e.payload || {}).message || "").filter(Boolean);
    add({
      type: "verifier_rejection",
      severity: rejections.length > 1 ? "high" : "medium",
      repo_actionable: true,
      evidence: `verifier rejected ${rejections.length} attempt(s): ${summaries.slice(0, 3).join(" | ").slice(0, 240)}`,
      proposal: "A verifier check failed on a first attempt — the instruction/contract or a RESOLVER doc for this target is unclear. Make the exact expected format/behavior explicit in the task template so the agent gets it right first try.",
    });
  }

  // 2. Infra retries: proof missing / ghost completion / dispatch incomplete.
  const ghosts = has((e) => ["proof_missing", "dispatch_incomplete", "no_trigger_timeout"].includes(sub(e)) || /ghost_completion/.test((e.payload || {}).message || ""));
  if (ghosts.length) {
    add({
      type: "infra_ghost", severity: ghosts.length > 2 ? "high" : "medium", repo_actionable: false,
      evidence: `${ghosts.length} ghost/proof-missing/dispatch-incomplete event(s)`,
      proposal: "Pentagon dispatch produced no work output (ghost completion). Infra, not the agent — the resilient daemon retries; if recurrent, investigate Pentagon poller / session capacity.",
    });
  }

  // 3. Timeouts: the task exceeded the dispatch window -> task too big OR timeout too short.
  const timeouts = has((e) => reason(e) === "llm.network_error" || /timed out/.test((e.payload || {}).message || ""));
  if (timeouts.length) {
    add({
      type: "timeout", severity: "high", repo_actionable: true,
      evidence: `${timeouts.length} timeout(s) (claude CLI / network)`,
      proposal: "The agent hit the dispatch timeout. Either the task is too large (split it / scope it tighter in the template) or the bridge --claude-timeout-ms is too short for this tier. Both are fixable in config.",
    });
  }

  // 4. Session/rate limit: capacity, not the agent.
  const rl = has((e) => reason(e) === "llm.rate_limited");
  if (rl.length) {
    add({
      type: "rate_limit", severity: "low", repo_actionable: false,
      evidence: `${rl.length} rate-limit/session-limit event(s)`,
      proposal: "Hit Claude session capacity. Schedule heavy grinds off-peak or stagger dispatches; the resilient daemon already auto-resumes at reset.",
    });
  }

  // 5. Many dispatches for one run = the agent needed multiple attempts (slow path).
  const dispatches = has((e) => reason(e).startsWith("llm.") && typ(e) === "llm.requested").length
    || has((e) => typ(e) === "llm.requested").length;
  if (dispatches >= 3) {
    add({
      type: "many_attempts", severity: "medium", repo_actionable: true,
      evidence: `${dispatches} LLM dispatches for one run`,
      proposal: "The agent needed several attempts. Read the transcript for the dead-end; a sharper instruction, a research-packet addition, or a RESOLVER doc for this area would likely make it one-shot.",
    });
  }

  // Friction score: weighted sum (higher = rougher run). 0 = smooth marble.
  const weight = { high: 3, medium: 2, low: 1 };
  const score = frictions.reduce((s, f) => s + (weight[f.severity] || 1), 0);

  return { hash: meta.hash || null, tier: meta.tier || null, dispatches, frictions, score };
}

// Load all factory events for a run, keyed by hash (matches payload.hash or message).
export function eventsForHash(hash, eventsPath = "frames/factory-events.jsonl") {
  if (!existsSync(eventsPath)) return [];
  const out = [];
  for (const line of readFileSync(eventsPath, "utf8").split(/\n/)) {
    if (!line.trim()) continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    const p = e.payload || {};
    if (p.hash === hash || (typeof p.message === "string" && p.message.includes(hash))) out.push(e);
  }
  return out;
}

async function main() {
  const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
  const hash = arg("--hash");
  const tier = arg("--tier");
  const emit = process.argv.includes("--emit");
  if (!hash) { console.error("usage: friction-analyzer.mjs --hash <run-hash> [--tier T] [--emit]"); process.exit(2); }

  const events = eventsForHash(hash);
  const result = analyzeFriction(events, { hash, tier });
  console.log(JSON.stringify(result, null, 2));

  if (emit && result.frictions.length) {
    const { emitInfrastructureEvent } = await import("./factory-events.mjs");
    for (const f of result.frictions.filter((x) => x.repo_actionable)) {
      emitInfrastructureEvent({
        subtype: "repo_friction_proposed",
        message: `[${f.type}] ${f.proposal}`,
        extras: { hash, tier, friction_type: f.type, severity: f.severity, evidence: f.evidence, proposal: f.proposal, score: result.score },
      });
    }
    console.log(`[friction] emitted ${result.frictions.filter((x) => x.repo_actionable).length} repo.friction.proposed event(s)`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error("[friction-analyzer] fatal", e); process.exit(70); });
}
