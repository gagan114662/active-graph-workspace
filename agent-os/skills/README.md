# agent-os/skills/ — per-agent installable skills

> P18 (iii skills-as-installable-units + YC editable-instructions + "thin harness, fat skills").
> Local resolver: a skill is the agent's reusable capability instructions, versioned + optimizable.

## Layout (MECE: one home per capability)
```
skills/
  <agent>/
    <capability>.md        # the skill — what this agent does for this capability
    best_skill.md          # (optional) SkillOpt-optimized version, promoted after beating baseline
```
e.g. `skills/maya/implement-feature.md`, `skills/quinn/adversarial-tests.md`.

## What a skill is
The reusable instruction document for one agent capability — the "fat skill" the thin dispatch
harness injects. Distinct from:
- **rubrics/** (how a JUDGE grades) — skills are how an ACTOR does the work.
- **instruction templates** (`frames/templates/`) — per-run rendered prompts; a skill is the stable
  capability behind them.

## Lifecycle (closes the loop with the eval system)
1. Author `skills/<agent>/<capability>.md` (baseline).
2. SkillOpt (`scripts/skillopt_judge_eval.py` pattern, extended to actor skills) optimizes it against
   the eval set → candidate.
3. Regression gate (`--regression-gate`) — promote to `best_skill.md` ONLY if it beats baseline.
4. The research packet / dispatch loads the active skill via `scripts/load-agent-skill.mjs`.
5. Success-flow memory (P23) feeds proven approaches back into the skill over time.

## Skill file conventions (gbrain Compiled-Truth + Timeline)
Frontmatter: `agent`, `capability`, `version`, `model_pinned`, `last_optimized`. Body: the capability
instructions (Compiled Truth). A `## Changelog` timeline at the bottom (append-only).

## Proof conventions (P18 cont.)
- **Stable function identifiers** in proofs: `maya::implement_feature=<sha>` (not anonymous
  `agent_commit_sha`) — from iii Worker/Function/Trigger.
- **Explicit DRI** field in every proof: the directly-responsible agent for the artifact.
