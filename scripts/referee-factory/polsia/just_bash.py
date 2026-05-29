"""Sandboxed file writer for the Open Polsia factory.

Provides `safe_write(workspace, rel_path, content)` which writes `content`
to `(workspace)/website/(rel_path)`, creating parent directories as needed,
and returns the pathlib.Path of the written file.

Security guarantee: the resolved target must stay strictly within the
resolved `(workspace)/website/` jail. Any attempt to escape -- via
parent-traversal ("../"), absolute paths, or symlinked directories that
point outside the jail -- raises an exception and writes nothing outside
the jail.

Pure Python standard library only.
"""

from pathlib import Path


class JailEscapeError(Exception):
    """Raised when a write would land outside the website jail."""


def _is_within(child: Path, parent: Path) -> bool:
    """True if `child` is `parent` or a descendant of `parent`.

    Both paths are expected to be absolute and resolved. Uses
    Path.relative_to semantics via is_relative_to (3.9+) with a manual
    fallback so the check is exact (no string-prefix sibling confusion
    like /jail-evil vs /jail).
    """
    try:
        child.relative_to(parent)
        return True
    except ValueError:
        return False


def safe_write(workspace, rel_path, content) -> Path:
    """Write `content` under `(workspace)/website/(rel_path)`.

    Returns the Path written. Raises JailEscapeError (or ValueError for
    an absolute rel_path) if the target would resolve outside the jail.
    No file is created outside the jail under any input.
    """
    workspace = Path(workspace)

    # Resolve the jail itself. strict=False so a not-yet-created website/
    # dir still resolves; resolve() collapses any symlinks in workspace.
    jail = (workspace / "website").resolve(strict=False)

    rel = Path(rel_path)

    # Reject absolute paths outright. Joining an absolute path with `/`
    # would discard the jail prefix entirely, so this must be caught.
    if rel.is_absolute():
        raise JailEscapeError(f"absolute rel_path not allowed: {rel_path!r}")

    # Compute the prospective target and fully resolve it. resolve(strict=False)
    # collapses ".." segments AND follows any symlinks present in the path,
    # so a symlinked directory pointing outside the jail is resolved to its
    # real location before the containment check.
    target = (jail / rel).resolve(strict=False)

    # Primary containment check on the fully-resolved target path.
    if not (_is_within(target, jail) and target != jail):
        raise JailEscapeError(
            f"rel_path {rel_path!r} escapes jail: resolved to {target}"
        )

    # Defense in depth against symlinked parents: walk the components
    # BETWEEN the jail and the target leaf (i.e. the parts contributed by
    # rel_path). For each component that already exists, resolve it and
    # confirm the real location is still inside the jail. We never inspect
    # ancestors at or above the jail itself -- the jail's own parents are
    # legitimately outside the jail and must not trip the check.
    try:
        rel_parts = target.relative_to(jail).parts
    except ValueError:
        # Should not happen (primary check passed), but fail closed.
        raise JailEscapeError(
            f"rel_path {rel_path!r} escapes jail: resolved to {target}"
        )

    probe = jail
    # Exclude the final component (the leaf file) from the existence walk;
    # only its directory chain matters for symlink traversal.
    for part in rel_parts[:-1]:
        probe = probe / part
        if probe.exists():
            resolved_probe = probe.resolve(strict=True)
            if not _is_within(resolved_probe, jail):
                raise JailEscapeError(
                    f"rel_path {rel_path!r} escapes jail via symlinked parent: "
                    f"{probe} -> {resolved_probe}"
                )

    # Create parent dirs and write. mkdir does not follow a final symlink
    # for creation; the checks above already validated the resolved chain.
    target.parent.mkdir(parents=True, exist_ok=True)

    # Final guard immediately before the write: re-resolve the parent now
    # that it exists and confirm containment once more. Closes the window
    # where mkdir could have traversed a symlink created concurrently.
    final_parent = target.parent.resolve(strict=True)
    if not _is_within(final_parent, jail):
        raise JailEscapeError(
            f"rel_path {rel_path!r} parent escaped jail after mkdir: {final_parent}"
        )

    final_target = final_parent / target.name
    with open(final_target, "w", encoding="utf-8") as fh:
        fh.write(content)

    return final_target


if __name__ == "__main__":
    import tempfile

    with tempfile.TemporaryDirectory() as ws:
        ok = safe_write(ws, "index.html", "<h1>hi</h1>")
        print("legit write ->", ok)
        try:
            safe_write(ws, "../../../etc/evil.txt", "pwned")
            print("FAIL: traversal did not raise")
        except Exception as exc:
            print("traversal blocked ->", type(exc).__name__, exc)
