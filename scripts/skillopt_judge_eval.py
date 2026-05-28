#!/usr/bin/env python3
"""SkillOpt judge-skill eval + eval-set harvester (Claude Code auth, NO API key).

This is the dark factory's "set up evals to baseline" capability (Stanford CS153
"AI Native Company" lesson: evals drive model/prompt selection). It reuses the
vendored SkillOpt's *Claude CLI backend* (REFLACT_MODEL_BACKEND=claude →
skillopt.model.claude_backend, which shells out to `claude -p`) so every model
call goes through the same Claude Code keychain auth the agents use — never an
ANTHROPIC_API_KEY.

Two functions:
  --harvest        Write the judge ground-truth into SkillOpt split-dir format
                   (data/judge_<name>_split/{train,val,test}/items.json) so the
                   SkillOpt optimizer (scripts/train.py) can consume it.
  --baseline       Run the CURRENT rubric (or a candidate --skill file) against
                   the ground-truth via the Claude CLI backend and report
                   accuracy (verdict matches the human label). This is the
                   number a skill optimization must beat.

Usage:
  python3 scripts/skillopt_judge_eval.py --judge rowan --baseline
  python3 scripts/skillopt_judge_eval.py --judge rowan --harvest
  python3 scripts/skillopt_judge_eval.py --judge rowan --baseline --skill /path/to/candidate_skill.md
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SKILLOPT = Path(os.environ.get("SKILLOPT_DIR", str(Path.home() / ".factory" / "SkillOpt")))
GT_DIR = REPO / "agent-os" / "judges"
RUBRIC_DIR = REPO / "agent-os" / "rubrics"

# Which rubric file + ACK verb each judge uses.
JUDGES = {
    "rowan": {"rubric": "rowan-code-review.yaml", "ack": r"ROWAN_REVIEW_(PASS|FAIL)", "verdicts": ("PASS", "FAIL")},
    "theo": {"rubric": "theo-test-review.yaml", "ack": r"THEO_TEST_REVIEW_(PASS|FAIL)", "verdicts": ("PASS", "FAIL")},
    "grace": {"rubric": "grace-gate.yaml", "ack": r"GRACE_GATE_(OPEN|BLOCKED)", "verdicts": ("OPEN", "BLOCKED")},
}


def load_ground_truth(judge: str) -> list[dict]:
    path = GT_DIR / judge / "ground-truth.jsonl"
    items = []
    for line in path.read_text().splitlines():
        line = line.strip()
        if line:
            items.append(json.loads(line))
    return items


def harvest(judge: str) -> Path:
    """Write the ground-truth into SkillOpt split-dir format (3:1:1 train/val/test)."""
    items = load_ground_truth(judge)
    # Deterministic split by index (stable across runs).
    n = len(items)
    n_test = max(1, n // 5)
    n_val = max(1, n // 5)
    test, val, train = items[:n_test], items[n_test:n_test + n_val], items[n_test + n_val:]
    out = REPO / "data" / f"judge_{judge}_split"
    for split, rows in (("train", train), ("val", val), ("test", test)):
        d = out / split
        d.mkdir(parents=True, exist_ok=True)
        # SkillOpt's dataloader reads a JSON array of items.
        (d / "items.json").write_text(json.dumps(rows, indent=2))
    print(json.dumps({"judge": judge, "total": n, "train": len(train), "val": len(val), "test": len(test), "out": str(out)}))
    return out


def rubric_system(judge: str, skill_path: str | None) -> str:
    """The skill/system prompt the judge runs under (a candidate skill OR the live rubric)."""
    if skill_path:
        return Path(skill_path).read_text()
    return (RUBRIC_DIR / JUDGES[judge]["rubric"]).read_text()


def build_user(judge: str, item: dict) -> str:
    inp = item.get("input", {})
    body = json.dumps(inp, indent=2)
    verbs = "/".join(JUDGES[judge]["verdicts"])
    ack = JUDGES[judge]["ack"].replace(r"(", "").replace(r")", "").replace("|", "{" + "|".join(JUDGES[judge]["verdicts"]) + "}")
    return (
        f"Review the following and reply with your verdict line ONLY.\n"
        f"The verdict line must start with one of: {ack}\n\n"
        f"INPUT:\n{body}\n\n"
        f"Reply with the single verdict line (one of {verbs})."
    )


def parse_verdict(judge: str, text: str) -> str | None:
    m = re.search(JUDGES[judge]["ack"], text or "")
    return m.group(1) if m else None


def expected_verdict(item: dict) -> str:
    return item.get("expected_verdict") or item.get("expected") or ""


def baseline(judge: str, skill_path: str | None, split: str | None) -> dict:
    # Import SkillOpt's Claude CLI backend (Claude Code auth, no API key).
    sys.path.insert(0, str(SKILLOPT))
    for k in ("CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_EXECPATH", "AI_AGENT", "ANTHROPIC_API_KEY"):
        os.environ.pop(k, None)
    os.environ.setdefault("REFLACT_MODEL_BACKEND", "claude")
    os.environ.setdefault("CLAUDE_CLI_BIN", str(Path.home() / ".local" / "bin" / "claude"))
    os.environ.setdefault("TARGET_DEPLOYMENT", "claude-opus-4-8")
    from skillopt.model import claude_backend as cb

    items = load_ground_truth(judge)
    system = rubric_system(judge, skill_path)
    results = []
    correct = 0
    api_key_used = bool(os.environ.get("ANTHROPIC_API_KEY"))
    for item in items:
        user = build_user(judge, item)
        try:
            text, _toks = cb.chat_target(system=system, user=user, max_completion_tokens=512, timeout=120)
        except Exception as e:  # noqa: BLE001
            text = f"(error: {e})"
        got = parse_verdict(judge, text)
        exp = expected_verdict(item)
        ok = (got == exp)
        correct += int(ok)
        results.append({"id": item.get("id"), "expected": exp, "got": got, "match": ok})
    acc = correct / len(items) if items else 0.0
    return {
        "judge": judge,
        "skill": skill_path or f"(live rubric: {JUDGES[judge]['rubric']})",
        "n": len(items),
        "correct": correct,
        "accuracy": round(acc, 3),
        "api_key_used": api_key_used,
        "auth": "claude-code-cli (no api key)" if not api_key_used else "API KEY (unexpected!)",
        "results": results,
    }


def _eval_skill_on(judge: str, system: str, items: list[dict], cb) -> tuple[float, list[dict]]:
    """Run a candidate skill (system prompt) over items; return (accuracy, per-item)."""
    rows, correct = [], 0
    for item in items:
        user = build_user(judge, item)
        try:
            text, _ = cb.chat_target(system=system, user=user, max_completion_tokens=512, timeout=120)
        except Exception as e:  # noqa: BLE001
            text = f"(error: {e})"
        got = parse_verdict(judge, text)
        exp = expected_verdict(item)
        ok = got == exp
        correct += int(ok)
        rows.append({"id": item.get("id"), "expected": exp, "got": got, "match": ok})
    return (correct / len(items) if items else 0.0), rows


def optimize(judge: str) -> dict:
    """Minimal faithful SkillOpt loop on Claude Code auth: eval baseline ->
    reflect on failures via the OPTIMIZER backend -> validation gate -> write
    best_skill.md if the candidate beats baseline on val. No API key."""
    sys.path.insert(0, str(SKILLOPT))
    for k in ("CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_EXECPATH", "AI_AGENT", "ANTHROPIC_API_KEY"):
        os.environ.pop(k, None)
    os.environ.setdefault("REFLACT_MODEL_BACKEND", "claude")
    os.environ.setdefault("CLAUDE_CLI_BIN", str(Path.home() / ".local" / "bin" / "claude"))
    os.environ.setdefault("OPTIMIZER_DEPLOYMENT", "claude-opus-4-8")
    os.environ.setdefault("TARGET_DEPLOYMENT", "claude-opus-4-8")
    from skillopt.model import claude_backend as cb

    items = load_ground_truth(judge)
    n_test = max(1, len(items) // 5)
    n_val = max(1, len(items) // 5)
    test, val, train = items[:n_test], items[n_test:n_test + n_val], items[n_test + n_val:]
    current = rubric_system(judge, None)

    base_train_acc, train_rows = _eval_skill_on(judge, current, train, cb)
    base_val_acc, _ = _eval_skill_on(judge, current, val, cb)

    failures = [r for r in train_rows if not r["match"]]
    fail_detail = []
    for f in failures:
        item = next(i for i in items if i.get("id") == f["id"])
        fail_detail.append(f"- id={f['id']} expected={f['expected']} got={f['got']}\n  input={json.dumps(item.get('input', {}))[:600]}\n  human_rationale={item.get('rationale', '')[:300]}")

    # REFLECT: ask the optimizer model to rewrite the rubric to fix the failures.
    opt_system = (
        "You optimize a JUDGE's rubric/instructions (a skill document). You are given the current "
        "skill and cases it judged WRONG. Rewrite the skill so it would judge those cases correctly "
        "WITHOUT breaking the ones it already gets right. Keep the exact required verdict ACK format. "
        "Output ONLY the rewritten skill document, no preamble."
    )
    opt_user = (
        f"CURRENT SKILL:\n{current}\n\n"
        f"CASES IT GOT WRONG (fix these):\n" + ("\n".join(fail_detail) if fail_detail else "(none)") +
        "\n\nRewrite the skill now. Output only the new skill document."
    )
    candidate = current
    if failures:
        cand_text, _ = cb.chat_optimizer(system=opt_system, user=opt_user, max_completion_tokens=4096, timeout=180)
        candidate = cand_text.strip()

    cand_train_acc, _ = _eval_skill_on(judge, candidate, train, cb)
    cand_val_acc, _ = _eval_skill_on(judge, candidate, val, cb)

    # VALIDATION GATE: keep the candidate only if it beats baseline on val
    # (and doesn't regress train). Then report held-out test.
    improved = (cand_val_acc > base_val_acc) and (cand_train_acc >= base_train_acc)
    out_dir = REPO / "data" / f"judge_{judge}_split"
    best_path = out_dir / "best_skill.md"
    chosen = candidate if improved else current
    base_test_acc, _ = _eval_skill_on(judge, current, test, cb)
    chosen_test_acc, _ = _eval_skill_on(judge, chosen, test, cb)
    if improved:
        best_path.write_text(candidate)
    return {
        "judge": judge,
        "auth": "claude-code-cli (no api key)",
        "api_key_used": bool(os.environ.get("ANTHROPIC_API_KEY")),
        "baseline": {"train": base_train_acc, "val": base_val_acc, "test": base_test_acc},
        "candidate": {"train": cand_train_acc, "val": cand_val_acc},
        "improved": improved,
        "chosen": "candidate" if improved else "current",
        "chosen_test_acc": chosen_test_acc,
        "best_skill_written": str(best_path) if improved else None,
        "failures_seen": len(failures),
    }


def regression_gate(judge: str, skill_path: str) -> dict:
    """CS153 're-test before deploy': run the eval set against BOTH the current
    rubric and a candidate skill; the gate PASSES only if the candidate does not
    regress accuracy. Returns a dict; the CLI exits non-zero on a regression so
    this can gate a deploy/apply step. Claude Code auth, no API key."""
    if not skill_path:
        return {"error": "--skill <candidate> required for --regression-gate", "passed": False}
    sys.path.insert(0, str(SKILLOPT))
    for k in ("CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_EXECPATH", "AI_AGENT", "ANTHROPIC_API_KEY"):
        os.environ.pop(k, None)
    os.environ.setdefault("REFLACT_MODEL_BACKEND", "claude")
    os.environ.setdefault("CLAUDE_CLI_BIN", str(Path.home() / ".local" / "bin" / "claude"))
    os.environ.setdefault("TARGET_DEPLOYMENT", "claude-opus-4-8")
    from skillopt.model import claude_backend as cb
    items = load_ground_truth(judge)
    cur_acc, _ = _eval_skill_on(judge, rubric_system(judge, None), items, cb)
    cand_acc, _ = _eval_skill_on(judge, rubric_system(judge, skill_path), items, cb)
    passed = cand_acc >= cur_acc
    return {
        "judge": judge, "skill": skill_path, "n": len(items),
        "current_accuracy": round(cur_acc, 3), "candidate_accuracy": round(cand_acc, 3),
        "delta": round(cand_acc - cur_acc, 3), "passed": passed,
        "verdict": "DEPLOY OK — no regression" if passed else "BLOCKED — candidate regresses accuracy",
        "auth": "claude-code-cli (no api key)",
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--judge", default="rowan", choices=list(JUDGES))
    ap.add_argument("--harvest", action="store_true")
    ap.add_argument("--baseline", action="store_true")
    ap.add_argument("--optimize", action="store_true", help="run the SkillOpt-style optimization loop (eval->reflect->validation gate)")
    ap.add_argument("--regression-gate", action="store_true", help="re-test a candidate --skill against the eval set; exit non-zero if it regresses (deploy gate)")
    ap.add_argument("--skill", default=None, help="candidate skill .md to evaluate instead of the live rubric")
    ap.add_argument("--split", default=None)
    args = ap.parse_args()
    if args.harvest:
        harvest(args.judge)
    if args.baseline:
        print(json.dumps(baseline(args.judge, args.skill, args.split), indent=2))
    if args.optimize:
        print(json.dumps(optimize(args.judge), indent=2))
    if args.regression_gate:
        r = regression_gate(args.judge, args.skill)
        print(json.dumps(r, indent=2))
        return 0 if r.get("passed") else 1  # non-zero blocks the deploy
    if not (args.harvest or args.baseline or args.optimize or args.regression_gate):
        ap.print_help()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
