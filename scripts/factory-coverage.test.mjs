// pt.18 — THE ENFORCEMENT TEST. Makes "every failure is an event" a permanent,
// regression-proof invariant instead of a hope. This is what would have caught the
// grind-daemon gap (S2) the night it was introduced.
//
// Run: node --test scripts/factory-coverage.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const PLISTS = join(SCRIPTS, "launch-agents");

const read = (p) => readFileSync(p, "utf8");

// --- Check 1: every daemon/entry Node script referenced by a LaunchAgent plist
//     calls installCrashGuard so a crash → script.crash event. ---------------
test("every plist-referenced Node script installs the crash guard", () => {
  const plists = existsSync(PLISTS) ? readdirSync(PLISTS).filter((f) => f.endsWith(".plist")) : [];
  const offenders = [];
  for (const pl of plists) {
    const body = read(join(PLISTS, pl));
    // pull the .mjs path(s) referenced in ProgramArguments
    for (const m of body.matchAll(/scripts\/([A-Za-z0-9._-]+\.mjs)/g)) {
      const rel = m[1];
      const abs = join(SCRIPTS, rel);
      if (!existsSync(abs)) continue;
      const src = read(abs);
      if (!/installCrashGuard\s*\(/.test(src)) offenders.push(`${rel} (via ${pl})`);
    }
  }
  assert.deepEqual(offenders, [], `Node daemons missing installCrashGuard(): ${offenders.join(", ")}`);
});

// --- Check 2: Python entry points install the Python crash guard. -----------
test("Python entry points install the crash guard", () => {
  const pythonEntryPoints = ["bridge_dispatch.py"];
  const offenders = [];
  for (const f of pythonEntryPoints) {
    const abs = join(SCRIPTS, f);
    if (!existsSync(abs)) continue;
    if (!/install_crash_guard\s*\(/.test(read(abs))) offenders.push(f);
  }
  assert.deepEqual(offenders, [], `Python entry points missing install_crash_guard(): ${offenders.join(", ")}`);
});

// --- Check 3: no empty catch SWALLOWING A HIGH-RISK FACTORY ACTION. ---------
// The crash guard (Check 1) already guarantees uncaught failures become events.
// The remaining risk is a CAUGHT-and-swallowed failure of a real factory ACTION
// (agent dispatch, trigger mutation, git push/merge, DB write). A `JSON.parse`
// fallback or optional-cleanup empty catch is control flow, not a swallowed
// failure, and is intentionally NOT flagged (flagging it would force noise-emits).
const FAILURE_CRITICAL = [
  "pentagon-trigger-bridge.mjs", "phoenix-todo-keeper.mjs", "sasha-skeptic.mjs",
  "t7-grind-daemon.mjs", "run-native-pentagon-task.mjs", "blake-budget-marshal.mjs",
  "t7-medium-cohortC-opus48-fire.mjs", "t7-hard-cohortC-opus48-fire.mjs",
  "harness/forge.mjs", "harness/forge-permission.mjs",
];
const EMPTY_CATCH_ALLOWLIST = []; // high-risk swallows that are reviewed-safe (none yet)
test("no empty catch swallows a high-risk factory action", () => {
  // Match `try { <body> } catch {}` precisely (single-level body, no nested braces)
  // so we inspect EXACTLY what the empty catch guards — not nearby code.
  const tryEmptyCatch = /try\s*\{([^{}]*)\}\s*catch\s*(?:\([^)]*\))?\s*\{\s*\}/g;
  const emit = /emit[A-Za-z]*\s*\(|emit_[a-z_]+\s*\(|lastDitchEmitFailure\s*\(/;
  // Operations whose silent failure is a real factory failure (not control flow).
  const highRisk = /spawnSync\s*\(|[^.\w]spawn\s*\(|completeTrigger\s*\(|claimTrigger\s*\(|insertMessage\s*\(|dispatchTodo\s*\(|dispatchReviewer\s*\(/;
  const offenders = [];
  for (const rel of FAILURE_CRITICAL) {
    const abs = join(SCRIPTS, rel);
    if (!existsSync(abs)) continue;
    const src = read(abs);
    for (const m of src.matchAll(tryEmptyCatch)) {
      const body = m[1];
      if (emit.test(body)) continue;        // emitter-guard: sanctioned best-effort
      if (!highRisk.test(body)) continue;   // control flow (parse/cleanup): not a swallow
      const line = src.slice(0, m.index).split("\n").length;
      const key = `${rel}:${line}`;
      if (!EMPTY_CATCH_ALLOWLIST.some((a) => key.startsWith(a))) offenders.push(key);
    }
  }
  assert.deepEqual(offenders, [], `empty catch swallowing a high-risk factory action: ${offenders.join(", ")}`);
});

// --- Check 4: the review/PR gate decisions in Phoenix each name a distinct
//     event, so a gate decision is never silent. (Merge-path events asserted
//     in Phase 3 once auto-merge lands.) ------------------------------------
test("Phoenix review/PR gate decisions emit named events", () => {
  const src = read(join(SCRIPTS, "phoenix-todo-keeper.mjs"));
  for (const ev of [
    "flywheel.review.bypassed", "flywheel.pr.create_failed",
    // Phase 3 auto-merge: every merge-path decision must name a distinct event.
    "flywheel.pr.merged", "flywheel.merge.failed", "flywheel.merge.skipped",
  ]) {
    assert.ok(src.includes(ev), `phoenix-todo-keeper.mjs should reference event "${ev}"`);
  }
});
