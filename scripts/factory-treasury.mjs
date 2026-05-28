// factory-treasury.mjs — P24: the factory's economic surface (the "meow" gap, in-house).
//
// meow.com/mcp gives agents BANKING (balances, transactions, payments). The
// in-house analog: a queryable COMPUTE-economics surface so the operator AND the
// agents can ask "what's my budget / spend / burn / cost-per-feature" instead of
// that state living only in Blake's head + scattered cost events.
//
// Data source: factory-events.jsonl `llm.responded` events, filtered to
// behavior=bridge.runClaude (the de-duped OUTER emit — the inner dispatcher +
// provider re-emit the same cost; counting all three triples spend). Same filter
// Blake uses (blake-budget-marshal.mjs::computeWindows).
//
// Exported functions are MCP-ready (P13/P24): wrap them as MCP tools later.
//
// Usage:
//   node scripts/factory-treasury.mjs                 # full status
//   node scripts/factory-treasury.mjs --budget        # spend vs caps
//   node scripts/factory-treasury.mjs --recent 10     # last N dispatches
//   node scripts/factory-treasury.mjs --json

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const has = (n) => process.argv.includes(n);
function arg(name, fb = null) { const i = process.argv.indexOf(name); return i === -1 ? fb : process.argv[i + 1] ?? fb; }
const EVENTS_PATH = resolve(process.env.FACTORY_EVENTS_PATH || resolve(REPO, "frames/factory-events.jsonl"));

// Caps default off (match Blake's defaults); override via flags or env.
const CAPS = {
  hour: Number(process.env.FACTORY_CAP_HOUR ?? arg("--cap-per-hour", "25")),
  day: Number(process.env.FACTORY_CAP_DAY ?? arg("--cap-per-day", "100")),
  session: Number(process.env.FACTORY_CAP_SESSION ?? arg("--cap-per-session", "50")),
};

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

export function readCostEvents(path = EVENTS_PATH, nowMs = Date.now()) {
  if (!existsSync(path)) return [];
  const out = [];
  for (const l of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!l.trim()) continue;
    let e; try { e = JSON.parse(l); } catch { continue; }
    // De-dup: only the outer bridge.runClaude emit (avoids triple-count).
    if (e.type === "llm.responded" && e.payload?.behavior === "bridge.runClaude") {
      out.push({ at: Date.parse(e.created_at || 0) || 0, cost: num(e.payload.cost_usd),
        agent: e.payload.agent_name || null, model: e.payload.model || null,
        input: num(e.payload.input_tokens), output: num(e.payload.output_tokens) });
    }
  }
  return out;
}

export function budgetStatus(events, nowMs = Date.now(), caps = CAPS) {
  const sum = (sinceMs) => events.filter((e) => e.at >= sinceMs).reduce((a, e) => a + e.cost, 0);
  const hour = sum(nowMs - 3600_000), day = sum(nowMs - 86_400_000), total = events.reduce((a, e) => a + e.cost, 0);
  const status = (spent, cap) => ({ spent: round(spent), cap, remaining: round(Math.max(0, cap - spent)),
    pct: cap ? Math.round((spent / cap) * 100) : 0, over: spent >= cap });
  return { hour: status(hour, caps.hour), day: status(day, caps.day), session: status(total, caps.session),
    total_spent: round(total), dispatches: events.length };
}

export function sessionBurn(events, nowMs = Date.now()) {
  const last = events.filter((e) => e.at >= nowMs - 3600_000);
  const cost = last.reduce((a, e) => a + e.cost, 0);
  return { window: "1h", spend: round(cost), dispatches: last.length,
    rate_per_hour: round(cost), avg_per_dispatch: last.length ? round(cost / last.length) : 0 };
}

export function costPerFeature(eventsPath = EVENTS_PATH) {
  // cost-per-shipped-feature = total bridge spend / landed flywheel commits.
  let landed = 0;
  if (existsSync(eventsPath)) {
    for (const l of readFileSync(eventsPath, "utf8").split(/\r?\n/)) {
      if (!l.trim()) continue;
      try { if (JSON.parse(l).type === "flywheel.commit.landed") landed++; } catch {}
    }
  }
  const total = readCostEvents(eventsPath).reduce((a, e) => a + e.cost, 0);
  return { total_spend: round(total), features_landed: landed,
    cost_per_feature: landed ? round(total / landed) : null,
    note: landed ? null : "no landed flywheel commits yet — cost-per-feature undefined (see arbitrage P5/P12)" };
}

export function recentSpend(events, n = 10) {
  return [...events].sort((a, b) => b.at - a.at).slice(0, n)
    .map((e) => ({ at: new Date(e.at).toISOString(), agent: e.agent, model: e.model, cost: round(e.cost) }));
}

function round(n) { return Math.round(n * 100) / 100; }

// CLI
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const events = readCostEvents();
  const report = { budget: budgetStatus(events), burn: sessionBurn(events),
    cost_per_feature: costPerFeature(), recent: recentSpend(events, Number(arg("--recent", "5"))) };
  if (has("--json")) { console.log(JSON.stringify(report, null, 2)); }
  else {
    const b = report.budget;
    console.log("FACTORY TREASURY  (de-duped bridge.runClaude spend)");
    console.log(`  hour:    $${b.hour.spent} / $${b.hour.cap}  (${b.hour.pct}%${b.hour.over ? " ⚠OVER" : ""})`);
    console.log(`  day:     $${b.day.spent} / $${b.day.cap}  (${b.day.pct}%${b.day.over ? " ⚠OVER" : ""})`);
    console.log(`  total:   $${b.total_spent} across ${b.dispatches} dispatches`);
    console.log(`  burn:    $${report.burn.rate_per_hour}/hr, avg $${report.burn.avg_per_dispatch}/dispatch`);
    const cf = report.cost_per_feature;
    console.log(`  cost/feature: ${cf.cost_per_feature != null ? "$" + cf.cost_per_feature : cf.note}`);
    if (report.recent.length) { console.log("  recent:"); for (const r of report.recent) console.log(`    ${r.at}  ${r.agent || "?"}  $${r.cost}`); }
  }
}
