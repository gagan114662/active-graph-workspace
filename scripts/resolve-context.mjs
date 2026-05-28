// resolve-context.mjs — the RESOLVER routing engine.
//
// Parses RESOLVER.md's RULES table and, given a file path, returns the context
// docs that path maps to (first matching row wins; most-specific rows first).
// This is the deterministic "where information lives" lookup (Garry Tan / gbrain
// resolver pattern; CS153 "Agentic Company" filing-rules primitive) that lets an
// agent load the exact context for a task instead of dumping all of CLAUDE.md or
// crawling the repo.
//
// Usage:
//   node scripts/resolve-context.mjs scripts/factory-routing.mjs
//   node scripts/resolve-context.mjs agent-os/rubrics/rowan-code-review.yaml --json
//
// Module:
//   import { resolveContext, loadResolverRules } from "./resolve-context.mjs";
//   resolveContext("scripts/pentagon-trigger-bridge.mjs") -> { matched, globs, docs, why }

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RESOLVER_PATH = process.env.FACTORY_RESOLVER || resolve(REPO, "RESOLVER.md");

function stripCell(s) {
  return s.replace(/`/g, "").trim();
}

// Convert a glob (path-style, supports * and **) to an anchored RegExp.
function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") { re += ".*"; i++; }  // ** → any incl /
      else re += "[^/]*";                              // *  → any except /
    } else if ("\\^$+?.()|[]{}".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  return new RegExp("^" + re + "$");
}

let _cache = null;
let _cacheKey = 0;

/** Parse the RULES table in RESOLVER.md into [{globs[], docs[], why}]. */
export function loadResolverRules(path = RESOLVER_PATH) {
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, "utf8");
  if (_cache && raw.length === _cacheKey) return _cache;
  const rules = [];
  let inRules = false;
  for (const line of raw.split(/\r?\n/)) {
    if (line.trim().startsWith("## RULES")) { inRules = true; continue; }
    if (inRules && line.startsWith("## ")) break;  // end of RULES section
    if (!inRules) continue;
    const t = line.trim();
    if (!t.startsWith("|")) continue;
    const cells = t.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 3) continue;
    if (/^-+$/.test(cells[0].replace(/\s/g, "")) || cells[0].toLowerCase() === "glob") continue; // sep/header
    const globs = cells[0].split(",").map(stripCell).filter(Boolean);
    const docs = cells[1].split(",").map(stripCell).filter(Boolean);
    if (!globs.length) continue;
    rules.push({ globs, docs, why: stripCell(cells[2] || ""), regexes: globs.map(globToRegExp) });
  }
  _cache = rules;
  _cacheKey = raw.length;
  return rules;
}

/** Resolve a path to its context docs. First matching rule wins. */
export function resolveContext(path, rulesPath = RESOLVER_PATH) {
  // Normalize to a repo-relative POSIX path.
  let p = String(path || "").replace(/\\/g, "/");
  const abs = resolve(REPO) + "/";
  if (p.startsWith(abs)) p = p.slice(abs.length);
  p = p.replace(/^\.\//, "");
  const rules = loadResolverRules(rulesPath);
  for (const rule of rules) {
    if (rule.regexes.some((re) => re.test(p))) {
      return { matched: true, path: p, globs: rule.globs, docs: rule.docs, why: rule.why };
    }
  }
  return { matched: false, path: p, globs: [], docs: [], why: null };
}

// CLI
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const args = process.argv.slice(2);
  const asJson = args.includes("--json");
  const target = args.find((a) => !a.startsWith("--"));
  if (!target) {
    console.error("usage: node scripts/resolve-context.mjs <path> [--json]");
    process.exit(2);
  }
  const r = resolveContext(target);
  if (asJson) {
    console.log(JSON.stringify(r, null, 2));
  } else if (r.matched) {
    console.log(`# context for ${r.path} (rule: ${r.globs.join(", ")})`);
    for (const d of r.docs) console.log(d);
  } else {
    console.log(`# no resolver rule matched ${r.path} — consider adding a RULES row (or route to inbox/)`);
  }
}
