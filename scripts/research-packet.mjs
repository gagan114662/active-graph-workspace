#!/usr/bin/env node
// Brandon-A: pre-flight research packet generator.
//
// Source: Brandon Walsenuk (Unblocked), "Stop babysitting your agents",
// AI Engineer 2026-05-26. His headline evidence: same prompt + same
// model + same agent produced a 6× improvement (2.5h/20.9M tokens vs
// 25min/10.8M tokens) when a context engine built a research packet
// before the agent started writing. The dark factory has activegraph,
// frames/, CLAUDE.md, Pentagon conversations, git history — plenty of
// context that today is NOT pre-fed to Maya/Quinn/Sofia. This tool
// gathers it and emits a markdown packet ready to inject into an
// instruction file.
//
// Two surfaces:
//
//   1. CLI (legacy): node scripts/research-packet.mjs --target-symbol X ...
//   2. Module: import { generateResearchPacket } from "./research-packet.mjs"
//      Phoenix's pentagon-rest.mjs::dispatchTodo calls this per FLYWHEEL_TODO
//      dispatch to inline context into the prompt.
//
// What goes in the packet (v1):
//   1. Recent commits touching target file or symbol (git log).
//   2. Recent failures in target area (query factory-events.jsonl for
//      behavior.failed + agent.* with target_symbol matching).
//   3. CLAUDE.md sections relevant to this task class (heuristic match
//      by header text).
//   4. Past gauntlet runs that targeted this area (T7 ledger lookup).
//
// v2 (deferred): Pentagon Supabase conversations referencing the symbol.

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { lookupSuccessFlows } from "./success-flow-capture.mjs";

const ROOT = process.env.FACTORY_REPO || "/Users/gaganarora/Desktop/my projects/active_graph";
const EVENTS_PATH = resolve(process.env.FACTORY_EVENTS_PATH || `${ROOT}/frames/factory-events.jsonl`);
const T7_LEDGER = resolve(`${ROOT}/frames/t7-native-repetition-progress-medium-cohortB-20260527.jsonl`);
const CLAUDE_MD = resolve(`${ROOT}/CLAUDE.md`);
const FLYWHEEL_PACKET_MAX_CHARS = 4000;

// ---------- helpers --------------------------------------------------------

function git(cwd, args) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  } catch {
    return "";
  }
}

function resolveTargetFile(opts) {
  if (opts.targetFile) return opts.targetFile;
  if (!opts.targetSymbol) return null;
  // Heuristic: activegraph.core.graph.Graph.foo -> activegraph/activegraph/core/graph.py
  const parts = opts.targetSymbol.split(".");
  if (parts[0] === "activegraph") {
    const candidates = [];
    for (let cut = parts.length - 1; cut >= 1; cut--) {
      candidates.push("activegraph/" + parts.slice(0, cut).join("/") + ".py");
    }
    for (const cand of candidates) {
      if (existsSync(resolve(ROOT, cand))) return cand;
    }
  }
  return null;
}

function gatherCommits(opts) {
  const file = resolveTargetFile(opts);
  if (!file) return { file: null, lines: [] };
  const cwd = file.startsWith("activegraph/") ? resolve(ROOT, "activegraph") : ROOT;
  const relFile = file.startsWith("activegraph/") ? file.slice("activegraph/".length) : file;
  const out = git(cwd, ["log", "--oneline", "-n", String(opts.limit), "--", relFile]);
  return { file, relative: relFile, cwd, lines: out.trim().split(/\r?\n/).filter(Boolean) };
}

function gatherFailures(opts) {
  if (!existsSync(EVENTS_PATH)) return [];
  const lines = readFileSync(EVENTS_PATH, "utf8").trim().split(/\r?\n/).filter(Boolean);
  const matches = [];
  const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
  for (const line of lines) {
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    if (Date.parse(ev.created_at) < cutoff) continue;
    if (ev.type !== "behavior.failed") continue;
    const text = JSON.stringify(ev).toLowerCase();
    if (opts.targetSymbol && text.includes(opts.targetSymbol.toLowerCase())) {
      matches.push(ev);
    } else if (opts.targetFile && text.includes(opts.targetFile.toLowerCase())) {
      matches.push(ev);
    } else if (opts.matchReason && ev.payload?.reason === opts.matchReason) {
      matches.push(ev);
    } else if (opts.matchBehavior && ev.payload?.behavior === opts.matchBehavior) {
      matches.push(ev);
    }
  }
  return matches.slice(-opts.limit);
}

function gatherClaudeSections(opts) {
  if (!existsSync(CLAUDE_MD)) return [];
  const text = readFileSync(CLAUDE_MD, "utf8");
  const sections = [];
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    if (/^## /.test(line)) {
      if (current) sections.push(current);
      current = { header: line.replace(/^## /, "").trim(), body: [] };
    } else if (current) {
      current.body.push(line);
    }
  }
  if (current) sections.push(current);
  const needle = (opts.taskClass || "").toLowerCase();
  const tail = opts.targetSymbol ? opts.targetSymbol.split(".").slice(-2).join(".").toLowerCase() : "";
  const reasonNeedle = (opts.matchReason || "").toLowerCase();
  return sections
    .filter((s) => {
      const blob = (s.header + "\n" + s.body.join("\n")).toLowerCase();
      return (needle && blob.includes(needle)) ||
             (tail && blob.includes(tail)) ||
             (reasonNeedle && blob.includes(reasonNeedle.split(".")[0]));
    })
    .slice(0, 3);
}

function gatherPastRuns(opts) {
  if (!existsSync(T7_LEDGER)) return [];
  const lines = readFileSync(T7_LEDGER, "utf8").trim().split(/\r?\n/).filter(Boolean);
  const runs = [];
  for (const line of lines) {
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    const sym = String(row.target_symbol || "").toLowerCase();
    if (opts.targetSymbol && sym.includes(opts.targetSymbol.toLowerCase())) {
      runs.push(row);
      continue;
    }
    if (opts.targetSymbol) {
      const parent = opts.targetSymbol.split(".").slice(0, -1).join(".").toLowerCase();
      if (parent && sym.startsWith(parent + ".")) runs.push(row);
    }
  }
  return runs.slice(-opts.limit);
}

// ---------- core export ----------------------------------------------------

/**
 * Generate a markdown research packet. Returns a string suitable for
 * inlining into an agent prompt.
 *
 * @param {object} opts
 * @param {string} [opts.targetSymbol] dotted symbol path (preferred)
 * @param {string} [opts.targetFile]   file path relative to repo root
 * @param {string} [opts.taskClass]    e.g. "t6_easy", "t7_medium"
 * @param {string} [opts.matchReason]  failure reason code to match in event log
 * @param {string} [opts.matchBehavior] failure behavior to match in event log
 * @param {number} [opts.limit=5]      per-section result cap
 * @param {boolean} [opts.compact]     when true, packet is capped to FLYWHEEL_PACKET_MAX_CHARS
 */
export function generateResearchPacket(opts = {}) {
  const o = { limit: 5, ...opts };
  if (!o.targetSymbol && !o.targetFile && !o.matchReason && !o.matchBehavior) {
    return "(no research-packet inputs supplied; nothing to gather)";
  }
  const commits = gatherCommits(o);
  const failures = gatherFailures(o);
  const sections = gatherClaudeSections(o);
  const runs = gatherPastRuns(o);

  const out = [];
  out.push("## Research Packet (auto-generated, Brandon-A pattern)");
  out.push("");
  out.push(`- Target symbol: \`${o.targetSymbol || "(none)"}\``);
  out.push(`- Target file:   \`${commits.file || o.targetFile || "(unresolved)"}\``);
  if (o.matchReason)   out.push(`- Match reason:  \`${o.matchReason}\``);
  if (o.matchBehavior) out.push(`- Match behavior: \`${o.matchBehavior}\``);
  if (o.taskClass)     out.push(`- Task class:    \`${o.taskClass}\``);
  out.push(`- Generated at:  ${new Date().toISOString()}`);
  out.push("");

  out.push("### Recent commits touching this file");
  if (commits.lines.length) {
    for (const line of commits.lines) out.push(`- ${line}`);
  } else {
    out.push("- _(no commits found)_");
  }
  out.push("");

  out.push("### Recent factory-event failures in this area (last 7 days)");
  if (failures.length) {
    for (const f of failures) {
      out.push(`- ${f.id} @ ${f.created_at}: ${f.payload?.reason || ""} — ${(f.payload?.message || "").slice(0, 160)}`);
    }
  } else {
    out.push("- _(no recent failures)_");
  }
  out.push("");

  out.push("### Relevant CLAUDE.md sections");
  if (sections.length) {
    for (const s of sections) {
      out.push(`#### ${s.header}`);
      out.push("");
      const body = s.body.join("\n").trim();
      const cap = o.compact ? 800 : 1500;
      out.push(body.length > cap ? body.slice(0, cap) + "\n\n_(...truncated)_" : body);
      out.push("");
    }
  } else {
    out.push("- _(no CLAUDE.md sections matched)_");
    out.push("");
  }

  out.push("### Past gauntlet runs in this area");
  if (runs.length) {
    for (const r of runs) {
      out.push(`- run ${r.run_idx} (${r.hash}): target=${r.target_symbol} outcome=${r.outcome} new_tests=${r.new_test_count} wall=${r.harness_wall_seconds?.toFixed?.(1) ?? "?"}s`);
    }
  } else {
    out.push("- _(no prior gauntlet runs in this area)_");
  }
  out.push("");

  // P23 success-flow memory: replay what WORKED on a past similar task so the
  // agent starts from a proven playbook instead of re-deriving from scratch.
  out.push("");
  out.push("### Proven approach (success flows — what worked before)");
  let flows = [];
  try { flows = lookupSuccessFlows({ targetFile: o.targetFile, targetSymbol: o.targetSymbol, taskClass: o.taskClass, limit: 2 }); } catch {}
  if (flows.length) {
    for (const f of flows) {
      out.push(`- [${f.task_class}] commit ${f.sha || "?"}: ${f.approach || "(no rationale)"}${f.diff_summary ? ` — ${f.diff_summary}` : ""}`);
    }
    out.push("Reuse the proven approach above where it fits; deviate only with a reason.");
  } else {
    out.push("- _(no prior success flow for this target — you are the first; if you succeed it becomes the playbook)_");
  }
  out.push("");

  out.push("> Read-only context. If you decide differently from past patterns above, surface the reasoning in your reply.");

  const result = out.join("\n");
  if (o.compact && result.length > FLYWHEEL_PACKET_MAX_CHARS) {
    return result.slice(0, FLYWHEEL_PACKET_MAX_CHARS) + "\n... (research packet truncated to fit prompt budget)";
  }
  return result;
}

// ---------- inject (CLI helper) --------------------------------------------

export function injectIntoInstruction(packet, instructionPath) {
  const original = readFileSync(instructionPath, "utf8");
  const marker = "## RESEARCH_PACKET_AUTO_GENERATED";
  if (original.includes(marker)) {
    console.error(`[research-packet] ${instructionPath} already contains an injected packet; skipping`);
    return original;
  }
  const block = "\n\n" + marker + "\n\n" + packet + "\n\n## END_RESEARCH_PACKET\n";
  let injected = original;
  if (/^Task:/m.test(original)) {
    injected = original.replace(/^Task:/m, block + "\n\nTask:");
  } else {
    injected = original + block;
  }
  writeFileSync(instructionPath, injected);
  return injected;
}

// ---------- CLI entrypoint -------------------------------------------------

// Only run the CLI when invoked as a script, NOT when imported as a module.
const isMain = (() => {
  try {
    return import.meta.url === pathToFileURL(process.argv[1] || "").href;
  } catch { return false; }
})();

if (isMain) {
  const args = process.argv.slice(2);
  function arg(name, fallback = null) {
    const idx = args.indexOf(name);
    return idx === -1 ? fallback : args[idx + 1] ?? fallback;
  }
  const targetSymbol = arg("--target-symbol");
  const targetFile = arg("--target-file");
  const taskClass = arg("--task-class", "");
  const matchReason = arg("--match-reason");
  const matchBehavior = arg("--match-behavior");
  const injectInto = arg("--inject");
  const limit = Number(arg("--limit", "5"));

  if (!targetSymbol && !targetFile && !matchReason && !matchBehavior) {
    console.error("usage: --target-symbol <symbol> AND/OR --target-file <path> AND/OR --match-reason <code>  [--task-class <X>] [--inject <file>] [--limit N]");
    process.exit(2);
  }

  const packet = generateResearchPacket({
    targetSymbol, targetFile, taskClass, matchReason, matchBehavior, limit,
  });

  if (injectInto) {
    injectIntoInstruction(packet, injectInto);
    console.log(`Research packet injected into ${injectInto}`);
  } else {
    console.log(packet);
  }
}
