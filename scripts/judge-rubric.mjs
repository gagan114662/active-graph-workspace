// Shared judge-rubric reader — the single place that resolves a judge name to
// its currently-pinned model. Used by the bridge (to stamp judge_model +
// judge_model_pinned_at on flywheel.review.completed), by emitJudgeError
// callers, and by factory-replay.mjs::judgeReplay. Without these fields on the
// verdict events, promoting a judge model silently re-interprets every
// historical verdict and `factory-replay --mode judge-replay` reads fields that
// were never written (audit C5 / H3).

import { existsSync, readFileSync } from "node:fs";

const RUBRIC_DIR =
  process.env.FACTORY_RUBRIC_DIR ||
  "/Users/gaganarora/Desktop/my projects/active_graph/agent-os/rubrics";

// A judge's rubric file isn't named uniformly (rowan-code-review / theo-test-review
// / grace-gate), so try the known suffixes in order.
const RUBRIC_SUFFIXES = ["code-review", "test-review", "gate"];

/**
 * Resolve a judge name to its pinned model + pin date from its rubric YAML.
 * @returns {{judge_model:(string|null), judge_model_pinned_at:(string|null), rubric_path:(string|null)}}
 */
export function judgePinnedModel(judgeName) {
  const empty = { judge_model: null, judge_model_pinned_at: null, rubric_path: null };
  if (!judgeName) return empty;
  const name = String(judgeName).toLowerCase().trim();
  for (const suffix of RUBRIC_SUFFIXES) {
    const path = `${RUBRIC_DIR}/${name}-${suffix}.yaml`;
    if (!existsSync(path)) continue;
    try {
      const yaml = readFileSync(path, "utf8");
      const model = (yaml.match(/^judge_model:\s*['"]?([^'"\n]+?)['"]?\s*$/m) || [])[1] || null;
      const pinnedAt = (yaml.match(/^judge_model_pinned_at:\s*['"]?([^'"\n]+?)['"]?\s*$/m) || [])[1] || null;
      return { judge_model: model, judge_model_pinned_at: pinnedAt, rubric_path: path };
    } catch {
      return empty;
    }
  }
  return empty;
}
