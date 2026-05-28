// success-flow-capture.mjs — P23: save what WORKED, replay it (the "Rote" gap).
//
// The factory logs failures richly (P20 failures→eval-cases) but saved no
// SUCCESS PLAYBOOK — so every agent run re-derives the codebase, remakes the
// same calls, re-hits the same failures ("agents learn on your dime, and
// forget"). This is the success-side complement: when a task SUCCEEDS, capture
// the reusable flow (task class, target, the approach + diff that worked, sha,
// cost) keyed by task class / target. The research packet (research-packet.mjs)
// then replays the matching flow on the next similar dispatch so the agent
// STARTS from a proven playbook instead of from scratch.
//
// Deterministic — reads the event log, writes frames/success-flows.jsonl.
// Not Rote; built on the existing event log + research packet.
//
// Usage:
//   node scripts/success-flow-capture.mjs            # capture new flows → store
//   node scripts/success-flow-capture.mjs --json
//   node scripts/success-flow-capture.mjs --lookup --target-file activegraph/core/graph.py

import { readFileSync, existsSync, appendFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const has = (n) => process.argv.includes(n);
function arg(name, fb = null) { const i = process.argv.indexOf(name); return i === -1 ? fb : process.argv[i + 1] ?? fb; }
const EVENTS_PATH = resolve(process.env.FACTORY_EVENTS_PATH || resolve(REPO, "frames/factory-events.jsonl"));
const STORE_PATH = resolve(process.env.FACTORY_SUCCESS_FLOWS || resolve(REPO, "frames/success-flows.jsonl"));

function readEvents(path = EVENTS_PATH) {
  if (!existsSync(path)) return [];
  const out = [];
  for (const l of readFileSync(path, "utf8").split(/\r?\n/)) { if (l.trim()) try { out.push(JSON.parse(l)); } catch {} }
  return out;
}
function readStore(path = STORE_PATH) {
  if (!existsSync(path)) return [];
  const out = [];
  for (const l of readFileSync(path, "utf8").split(/\r?\n/)) { if (l.trim()) try { out.push(JSON.parse(l)); } catch {} }
  return out;
}
function safeDecode(b64) { try { return b64 ? Buffer.from(b64, "base64").toString("utf8") : null; } catch { return null; } }
function filesFromDiff(diff) {
  const files = new Set();
  for (const m of String(diff || "").matchAll(/^\+\+\+ b\/(.+)$/gm)) files.add(m[1].trim());
  return [...files];
}

/** Derive success flows from the event log. A flow = a landed flywheel commit
 *  (proven outcome) + the diff that produced it + its task class + cost. */
export function captureFlows(events) {
  const diffByTodo = new Map(), createdByTodo = new Map(), costByTodo = new Map();
  for (const e of events) {
    const p = e.payload || {};
    const id = p.todo_event_id;
    if (e.type === "flywheel.diff.proposed" && id) diffByTodo.set(id, e);
    else if (e.type === "todo.created" && id) createdByTodo.set(id, e);
    else if (e.type === "llm.responded" && id && p.cost_usd != null) costByTodo.set(id, Number(p.cost_usd));
  }
  const flows = [];
  for (const e of events) {
    if (e.type !== "flywheel.commit.landed") continue;       // landed = proven success
    if (e.payload?.synthetic) continue;
    const id = e.payload?.todo_event_id;
    const diffEv = id ? diffByTodo.get(id) : null;
    const diff = diffEv ? safeDecode(diffEv.payload?.diff_b64) : null;
    const created = id ? createdByTodo.get(id) : null;
    const taskClass = created?.payload?.failure_reason || e.payload?.review_verdict || "unknown";
    const files = diff ? filesFromDiff(diff) : [];
    flows.push({
      id: `flow-${e.payload?.sha?.slice(0, 12) || (id || "x").slice(-8)}`,
      task_class: String(taskClass).split(".")[0] || "unknown",
      task_reason: taskClass,
      target_files: files,
      approach: (diffEv?.payload?.rationale || e.payload?.rationale || "").slice(0, 400),
      diff_summary: diff ? `${diff.split(/\r?\n/).filter((l) => l.startsWith("+") && !l.startsWith("+++")).length} additions across ${files.length} file(s)` : null,
      sha: e.payload?.sha || null,
      branch: e.payload?.branch || null,
      cost_usd: id && costByTodo.has(id) ? costByTodo.get(id) : null,
      evidence_event_id: e.id,
      captured_at: e.created_at,
    });
  }
  return flows;
}

/** Look up proven flows matching a target (for the research packet). */
export function lookupSuccessFlows(opts = {}, store = readStore()) {
  const tf = (opts.targetFile || "").toLowerCase();
  const sym = (opts.targetSymbol || "").toLowerCase();
  const tc = (opts.taskClass || "").toLowerCase();
  const scored = store.map((f) => {
    let score = 0;
    if (tf && f.target_files?.some((x) => x.toLowerCase() === tf)) score += 3;
    else if (tf && f.target_files?.some((x) => x.toLowerCase().includes(tf.split("/").pop()))) score += 1;
    if (sym && (f.approach || "").toLowerCase().includes(sym.split(".").slice(-1)[0])) score += 1;
    if (tc && f.task_class?.toLowerCase() === tc) score += 2;
    return { f, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  return scored.slice(0, opts.limit || 3).map((x) => x.f);
}

function writeFlows(flows) {
  const existing = new Set(readStore().map((f) => f.id));
  const fresh = flows.filter((f) => !existing.has(f.id));
  if (fresh.length) {
    mkdirSync(dirname(STORE_PATH), { recursive: true });
    for (const f of fresh) appendFileSync(STORE_PATH, JSON.stringify(f) + "\n");
  }
  return { found: flows.length, new: fresh.length };
}

// CLI
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  if (has("--lookup")) {
    const flows = lookupSuccessFlows({ targetFile: arg("--target-file"), targetSymbol: arg("--target-symbol"), taskClass: arg("--task-class") });
    console.log(has("--json") ? JSON.stringify(flows, null, 2) : flows.map((f) => `${f.id} [${f.task_class}] ${f.target_files?.join(",")} (${f.sha})`).join("\n") || "(no matching flows)");
  } else {
    const flows = captureFlows(readEvents());
    const r = writeFlows(flows);
    console.log(has("--json") ? JSON.stringify({ ...r, store: STORE_PATH }, null, 2)
      : `captured ${r.new} new / ${r.found} success flow(s) → ${STORE_PATH}`);
  }
}
