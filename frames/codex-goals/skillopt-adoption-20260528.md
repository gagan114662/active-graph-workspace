# SkillOpt adoption — Claude Code auth, no API keys (2026-05-28)

Operator question: "https://github.com/microsoft/SkillOpt CAN THIS HELP?" → "yea" (adopt it),
with the hard constraint: **must work with Claude Code auth, NOT API keys.**

## What SkillOpt is
Microsoft, MIT. Optimizes an agent's *skill document* (natural-language instructions) against a
train/val/test eval set with a validation gate — "trains skills like neural nets without touching
weights," producing a deployable `best_skill.md`. Supports Azure OpenAI / OpenAI / **Claude** / Qwen.

## The key finding: the Claude-Code-auth adapter ALREADY EXISTS
SkillOpt ships `skillopt/model/claude_backend.py` — a **Claude CLI** backend that shells out to
`claude -p --output-format json --permission-mode dontAsk` (selected via
`REFLACT_MODEL_BACKEND=claude`, binary via `CLAUDE_CLI_BIN`). It uses the **local Claude Code keychain
auth — no `ANTHROPIC_API_KEY`** — the exact path the bridge uses. So the operator's locked constraint
is satisfied by SkillOpt's own design; no adapter had to be built.

**Proven:** a smoke call through `claude_backend.chat_target` returned "42" with
`api_key_used=False`. Every eval/optimize call below scrubs `ANTHROPIC_API_KEY` +
`CLAUDECODE`/`CLAUDE_CODE_*`/`AI_AGENT` and routes through the CLI.

Vendored at `~/.factory/SkillOpt` (outside the repo, not committed).

## What we built (in-repo, runnable)
`scripts/skillopt_judge_eval.py` — uses SkillOpt's Claude CLI backend to:
- `--harvest` — write a judge's ground-truth into SkillOpt split-dir format
  (`data/judge_<name>_split/{train,val,test}/items.json`).
- `--baseline` — score the CURRENT rubric against the ground truth (the number to beat).
- `--optimize` — a faithful minimal SkillOpt loop: eval baseline → **reflect** on failures via the
  OPTIMIZER backend (`chat_optimizer`) → re-eval candidate → **validation gate** (keep only if it
  beats baseline on val AND doesn't regress train) → write `best_skill.md` if improved.

All on Claude Code auth. Models pinned to `claude-opus-4-8` (cohort).

## Baselines measured (Claude Code auth, zero API keys)
| Judge | Accuracy on ground truth | Read |
|---|---|---|
| Rowan (code review) | **5/5 (100%)** | rubric already saturates its 5 cases |
| Theo (test review)  | **5/5 (100%)** | same |
| Grace (gate)        | **2/5 (40%)**  | **underperforming — a real defect the eval surfaced** |

This is the CS153 "AI Native Company" lesson in action: evals reveal *which* skill needs work. Grace's
gate rubric mis-judges 3/5 ground-truth cases.

## The optimization spike (Grace)
Ran `--optimize` on Grace (the 40% skill). The loop executed end-to-end on Claude Code auth:
- baseline train=0.33, val=1.0, test=0.0
- optimizer proposed a rewritten rubric
- candidate train=0.0 (REGRESSED), val=1.0
- **validation gate REJECTED the candidate** (regressed train) → kept the current rubric. No
  `best_skill.md` written.

This is the *correct* behavior — the gate refused to ship a worse skill. But the deeper, honest
finding: **5 examples (3 train / 1 val / 1 test) is far too small** — the optimizer overfits and the
val/test signal is 1-example noise. The mechanism + auth are proven; the limiting factor is dataset
size, not the loop.

## Status & next steps
- ✅ SkillOpt adopted on Claude Code auth (no API keys) — proven end to end (eval + optimize).
- ✅ Eval-the-eval baseline tooling shipped + run; surfaced a real defect (Grace 40%).
- ⏳ **Grow the judge ground-truth to ~20-50 examples/judge** (especially Grace's failing edge cases)
  before the optimizer can reliably ship an improved `best_skill.md`. Harvest source: real gauntlet
  `flywheel.review.completed` verdicts cross-referenced with downstream outcomes (committed-and-not-
  reverted = correct; reverted/regressed = the judge was wrong) + `scripts/grade-judge-example.mjs`.
- ⏳ Grace's rubric needs improvement regardless (40% is shippable-blocking for a gate). Either grow
  the dataset + let SkillOpt optimize it, or revise `agent-os/rubrics/grace-gate.yaml` by hand and
  re-baseline.
- ⏳ Full SkillOpt `scripts/train.py` env (`judgeopt`) — a richer multi-epoch optimizer than the
  minimal loop here — is worth building once the dataset is large enough to justify it.

## Commands
```
python3 scripts/skillopt_judge_eval.py --judge grace --baseline   # measure
python3 scripts/skillopt_judge_eval.py --judge grace --harvest    # write SkillOpt splits
python3 scripts/skillopt_judge_eval.py --judge grace --optimize   # eval->reflect->gate
```
