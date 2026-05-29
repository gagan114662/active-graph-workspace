// referee-factory/grader.mjs
//
// The GRADER is deterministic code. It is the one thing in the factory that an
// LLM cannot sweet-talk. Its verdicts come from two non-negotiable sources:
//
//   1. `pytest` exit codes (the real test suite, written by people who are not
//      the builder, run in an isolated sandbox).
//   2. SHA-256 hashes of the grading test files (tamper detection — if the
//      builder edits a grading test to make it pass, the hash changes and the
//      submission is rejected).
//
// This directly kills two of the 21-session failure modes:
//   - "the T7 helper HARDCODED outcome=pass and never ran the verifier"
//        -> here the verdict IS the pytest exit code; there is nothing to hardcode.
//   - "never loosen the verifier to make a check pass"
//        -> the builder physically cannot edit a grading test undetected.
//
// Isolation mechanism (probed and confirmed before building on it):
//   git worktree of the inner repo + PYTHONPATH shadowing, so the sandbox's
//   `activegraph/` package shadows the editable install. A bug in the sandbox
//   shows up RED in pytest without touching the operator's real package.

import { spawnSync, execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export class Grader {
  constructor({ repoRoot, innerRepo, venvPython, sandboxRoot }) {
    this.repoRoot = repoRoot;
    this.innerRepo = innerRepo; // absolute path to inner git repo
    this.venvPython = venvPython; // absolute path to venv python
    this.sandboxRoot = sandboxRoot;
  }

  // Create an isolated, clean checkout of the inner repo at HEAD.
  createSandbox(taskId) {
    fs.mkdirSync(this.sandboxRoot, { recursive: true });
    const sandbox = path.join(this.sandboxRoot, `sbx-${taskId}-${process.pid}`);
    // remove a stale one if present
    this.destroySandbox(sandbox, /*quiet*/ true);
    execFileSync("git", ["-C", this.innerRepo, "worktree", "add", "--detach", sandbox, "HEAD"], {
      stdio: "pipe",
    });
    return sandbox;
  }

  destroySandbox(sandbox, quiet = false) {
    try {
      execFileSync("git", ["-C", this.innerRepo, "worktree", "remove", sandbox, "--force"], { stdio: "pipe" });
    } catch (e) {
      if (!quiet) {
        // fall back to fs removal if the worktree metadata is gone
        try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch {}
      }
    }
    try { execFileSync("git", ["-C", this.innerRepo, "worktree", "prune"], { stdio: "pipe" }); } catch {}
  }

  // Deterministic SHA-256 of a set of files (relative to sandbox). Missing files
  // hash to the sentinel "<MISSING>" so deletion is detectable, not silent.
  hashFiles(sandbox, relPaths) {
    const out = {};
    for (const rel of relPaths) {
      const abs = path.join(sandbox, rel);
      if (!fs.existsSync(abs)) { out[rel] = "<MISSING>"; continue; }
      const buf = fs.readFileSync(abs);
      out[rel] = crypto.createHash("sha256").update(buf).digest("hex");
    }
    return out;
  }

  // Run pytest against specific test paths in the sandbox. Exit code is captured
  // from spawnSync.status directly — NO pipe (per discipline rule 2, piping kills
  // the exit code). Returns { exit, passed, summary, stdout }.
  runPytest(sandbox, testPaths) {
    const res = spawnSync(
      this.venvPython,
      ["-m", "pytest", ...testPaths, "-p", "no:cacheprovider", "-q", "--no-header"],
      {
        cwd: sandbox,
        env: { ...process.env, PYTHONPATH: sandbox, PYTHONDONTWRITEBYTECODE: "1" },
        encoding: "utf8",
        timeout: 240000,
        maxBuffer: 1024 * 1024 * 16,
      }
    );
    const stdout = (res.stdout || "") + (res.stderr || "");
    const exit = res.status === null ? 124 : res.status; // null => killed/timeout
    // pull the last non-empty line as a summary (e.g. "3 passed in 0.01s")
    const lines = stdout.trim().split("\n").filter(Boolean);
    const summary = lines.length ? lines[lines.length - 1] : "(no output)";
    return { exit, passed: exit === 0, summary, stdout };
  }

  // git diff of the source files inside the sandbox vs HEAD (what the builder did).
  sandboxDiff(sandbox, relPaths) {
    try {
      return execFileSync("git", ["-C", sandbox, "diff", "--", ...relPaths], { encoding: "utf8" });
    } catch {
      return "";
    }
  }

  writeFile(sandbox, rel, content) {
    const abs = path.join(sandbox, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }

  removeFile(sandbox, rel) {
    const abs = path.join(sandbox, rel);
    try { fs.rmSync(abs, { force: true }); } catch {}
  }

  readFile(sandbox, rel) {
    return fs.readFileSync(path.join(sandbox, rel), "utf8");
  }

  // Run a Python challenge (a deterministic adversary probe) against the sandbox's
  // package. Written to a non-test path so it never trips the tamper gate, and
  // removed after. Exit code is the verdict: 0 = fix survived all challenges.
  runChallenge(sandbox, pyCode) {
    const rel = "_referee_adv_probe.py";
    this.writeFile(sandbox, rel, pyCode);
    const res = spawnSync(this.venvPython, [rel], {
      cwd: sandbox,
      env: { ...process.env, PYTHONPATH: sandbox, PYTHONDONTWRITEBYTECODE: "1" },
      encoding: "utf8",
      timeout: 60000,
    });
    this.removeFile(sandbox, rel);
    const stdout = (res.stdout || "") + (res.stderr || "");
    const exit = res.status === null ? 124 : res.status;
    return { exit, passed: exit === 0, stdout };
  }

  // SHA-256 of a file's content at the inner repo's HEAD (the immutable baseline
  // for tamper detection). Returns null if the path doesn't exist at HEAD.
  fileAtHead(rel) {
    try {
      const buf = execFileSync("git", ["-C", this.innerRepo, "show", `HEAD:${rel}`], {
        encoding: "buffer",
        maxBuffer: 1024 * 1024 * 16,
      });
      return crypto.createHash("sha256").update(buf).digest("hex");
    } catch {
      return null;
    }
  }
}
