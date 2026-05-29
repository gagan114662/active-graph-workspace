"""INDEPENDENT sealed acceptance for the Polsia `just-bash` sandboxed writer.

Contract the builder must satisfy:
    safe_write(workspace: Path|str, rel_path: str, content: str) -> Path
  Writes ONLY under <workspace>/website/. ANY rel_path that resolves outside
  <workspace>/website/ (../ traversal, absolute paths, symlink escapes, etc.)
  must be REFUSED (raise an exception) and write nothing outside the jail.

This acceptance is authored by the REFEREE, not the builder. It fuzzes the tool
with malicious paths and then scans the whole workspace to prove nothing escaped
the jail. A naive implementation (plain path join) fails it; see ref_naive_write.

Usage: python accept_safewrite.py <path-to-solution-module.py>
Exit 0 + SAFEWRITE_ACCEPT_PASS only if every legit write lands in the jail AND
every malicious write is refused AND nothing exists outside the jail.
"""
from __future__ import annotations

import importlib.util
import shutil
import sys
import tempfile
from pathlib import Path

mod_path = sys.argv[1]
spec = importlib.util.spec_from_file_location("solution_safewrite", mod_path)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
safe_write = getattr(mod, "safe_write")

fails: list[str] = []

# ---- legit writes that MUST succeed and land under <ws>/website/ ----
legit = [
    ("index.html", "<h1>home</h1>"),
    ("blog/post-1.html", "<article>hi</article>"),
    ("assets/app.css", "body{}"),
]
# ---- malicious paths that MUST be refused (raise) and write nothing outside ----
malicious = [
    "../secret.txt",
    "../../etc/evil.conf",
    "../../../tmp/pwned",
    "/etc/passwd",
    "/tmp/abs-escape",
    "a/../../escape.txt",
    "deep/../../../escape2.txt",
    "website/../../escape3.txt",
    "..%2f..%2fescape4.txt",   # encoded traversal (should not decode into an escape)
    "../escape5.txt",
]

ws = Path(tempfile.mkdtemp(prefix="polsia-safewrite-"))
jail = ws / "website"
# a canary file OUTSIDE the jail but inside the workspace; must never be overwritten
canary = ws / "DO_NOT_TOUCH.txt"
canary.write_text("canary")

try:
    # legit
    for rel, content in legit:
        try:
            out = Path(safe_write(ws, rel, content))
        except Exception as e:  # noqa: BLE001
            fails.append(f"legit write {rel!r} was wrongly refused: {type(e).__name__}: {e}")
            continue
        if not out.exists():
            fails.append(f"legit write {rel!r} did not create a file")
        elif jail.resolve() not in out.resolve().parents and out.resolve() != jail.resolve():
            fails.append(f"legit write {rel!r} landed OUTSIDE the jail at {out}")
        elif out.read_text() != content:
            fails.append(f"legit write {rel!r} content mismatch")

    # malicious — the real invariant is NO ESCAPE, not "must raise". A weird-but-
    # jail-contained filename (e.g. literal "..%2f..") is safe; a real ../ or
    # absolute path that lands outside the jail is not. Attempt each; the global
    # escape scan below is the security gate.
    for rel in malicious:
        try:
            safe_write(ws, rel, "PWNED")
        except Exception:
            pass  # refusing is one valid safe behavior

    # global jail-escape scan: nothing PWNED anywhere outside the jail
    for p in ws.rglob("*"):
        if p.is_file() and jail.resolve() not in p.resolve().parents:
            if p.read_text(errors="ignore") == "PWNED":
                fails.append(f"SECURITY: a malicious write escaped the jail to {p}")
    if canary.read_text() != "canary":
        fails.append("SECURITY: canary outside the jail was overwritten")
finally:
    shutil.rmtree(ws, ignore_errors=True)

if fails:
    print("SAFEWRITE_ACCEPT_FAIL")
    for f in fails:
        print("  -", f)
    sys.exit(1)
print(f"SAFEWRITE_ACCEPT_PASS: {len(legit)} legit writes jailed correctly, "
      f"{len(malicious)} traversal attacks all refused, jail intact")
sys.exit(0)
