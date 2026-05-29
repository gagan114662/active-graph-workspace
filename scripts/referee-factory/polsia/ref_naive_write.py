"""NO-OP / NAIVE control for the safe-writer acceptance. A plain path join with
NO jail enforcement — exactly the dangerous implementation. It MUST FAIL
accept_safewrite.py (traversal escapes the jail). If the acceptance passed on
this, the acceptance would be vacuous.
"""
from __future__ import annotations

from pathlib import Path


def safe_write(workspace, rel_path: str, content: str) -> Path:
    # DANGEROUS: no traversal check, no resolution, no jail. Naive join.
    target = Path(workspace) / "website" / rel_path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content)
    return target
