"""Reference SAFE implementation of the Polsia sandboxed writer — used only to
validate that the acceptance PASSES on a correct impl (the oracle's positive
control). The blind builder must produce its own; this is not shown to it.
"""
from __future__ import annotations

import os
from pathlib import Path


class SandboxEscapeError(Exception):
    """Raised when a requested write would escape the website/ jail."""


def safe_write(workspace, rel_path: str, content: str) -> Path:
    jail = (Path(workspace) / "website").resolve()
    jail.mkdir(parents=True, exist_ok=True)

    # reject absolute paths and obvious nulls outright
    if os.path.isabs(rel_path) or "\x00" in rel_path:
        raise SandboxEscapeError(f"refused absolute/invalid path: {rel_path!r}")

    # resolve the candidate and require it to stay within the jail
    candidate = (jail / rel_path).resolve()
    if candidate != jail and jail not in candidate.parents:
        raise SandboxEscapeError(f"refused traversal outside jail: {rel_path!r} -> {candidate}")

    candidate.parent.mkdir(parents=True, exist_ok=True)
    # final guard: the real parent must also be inside the jail (symlink defense)
    if jail not in candidate.parent.resolve().parents and candidate.parent.resolve() != jail:
        raise SandboxEscapeError(f"refused symlinked parent escape: {rel_path!r}")
    candidate.write_text(content)
    return candidate
