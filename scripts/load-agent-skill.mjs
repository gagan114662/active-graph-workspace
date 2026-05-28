// load-agent-skill.mjs — P18 skill loader.
//
// Returns the active skill document for an agent capability, preferring a
// SkillOpt-promoted best_skill.md over the baseline. The dispatch / research
// packet injects this so the agent runs its optimized capability instructions.
//
// Usage:
//   node scripts/load-agent-skill.mjs maya implement-feature
//   import { loadAgentSkill } from "./load-agent-skill.mjs";

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS_DIR = resolve(REPO, "agent-os/skills");

/** Resolve an agent capability to its active skill. best_skill.md (SkillOpt-promoted)
 *  wins over the hand-authored baseline. Returns {found, path, source, content}. */
export function loadAgentSkill(agent, capability) {
  const a = String(agent || "").toLowerCase();
  const c = String(capability || "").toLowerCase();
  const best = resolve(SKILLS_DIR, a, "best_skill.md");
  const baseline = resolve(SKILLS_DIR, a, `${c}.md`);
  if (existsSync(best)) return { found: true, path: best, source: "best_skill (SkillOpt-promoted)", content: readFileSync(best, "utf8") };
  if (existsSync(baseline)) return { found: true, path: baseline, source: "baseline", content: readFileSync(baseline, "utf8") };
  return { found: false, path: null, source: null, content: null };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const [agent, capability] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (!agent || !capability) { console.error("usage: node scripts/load-agent-skill.mjs <agent> <capability>"); process.exit(2); }
  const s = loadAgentSkill(agent, capability);
  if (!s.found) { console.error(`no skill for ${agent}/${capability}`); process.exit(1); }
  if (process.argv.includes("--json")) console.log(JSON.stringify({ path: s.path, source: s.source }, null, 2));
  else { console.log(`# skill source: ${s.source} (${s.path})\n`); console.log(s.content); }
}
