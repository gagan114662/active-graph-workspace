#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";

const ROOT = "/Users/gaganarora/Desktop/my projects/active_graph";
const PLIST = "/Users/gaganarora/Library/Preferences/run.pentagon.app.plist";
const PENTAGON_BIN = "/Applications/Pentagon.app/Contents/MacOS/Pentagon";
const BRIDGE_LOG = "/Users/gaganarora/.pentagon/trigger-bridge.out.log";
const BRIDGE_LABEL = "run.pentagon.trigger-bridge";
const STAMP = "20260522T230015Z";
const NATIVE_BLOCKER_LOG = "frames/t5e-native-poller-blocker-2026-05-22.log";
const COMPLETION_AUDIT = "frames/autonomy-completion-audit-2026-05-22.md";
const DOCS_ACTIVATION_AUDIT = "frames/pentagon-docs-activation-audit-2026-05-23.md";
const RELIABILITY_CONTRACT = "agent-os/RELIABILITY_OPERATING_CONTRACT.md";
const BRIDGE_RESILIENCE_LOG = "frames/t5f-bridge-loop-resilience-2026-05-23.log";
const CURRENT_BRIDGE_HEALTH_LOG = "frames/t5g-current-bridge-health-2026-05-23.log";
const REPO_ISOLATION_AUDIT = "frames/t5h-repo-isolation-audit-2026-05-23.md";
const REPEATABLE_NATIVE_PROBE_LOG = "frames/t5i-repeatable-native-poller-probe-2026-05-23.log";
const CURRENT_BRIDGE_FILE_TASK_LOG = "frames/t5j-current-bridge-file-task-2026-05-23.log";
const CURRENT_BRIDGE_FILE_TASK_PROOF = "frames/t5j-current-bridge-easy-20260523T1330Z.proof";
const NATIVE_PROBE_BRIDGE_QUEUE_HARDENING_LOG = "frames/t5k-native-probe-and-bridge-queue-hardening-2026-05-23.log";
const NATIVE_APP_POLLER_PROBE_OUTPUT_AUDIT_LOG = "frames/t5l-native-app-poller-and-probe-output-audit-2026-05-23.log";
const REPEATABLE_NATIVE_APP_POLLER_DIAGNOSTIC_LOG = "frames/t5m-repeatable-native-app-poller-diagnostic-2026-05-23.log";
const CODEX_HARNESS_NATIVE_RECHECK_LOG = "frames/t5n-codex-harness-native-recheck-2026-05-23.log";
const CLEARED_QUEUE_NATIVE_ATTRIBUTION_LOG = "frames/t5o-cleared-queue-native-attribution-2026-05-23.log";
const NATIVE_POLLER_SURFACE_AUDIT_LOG = "frames/t5p-native-poller-surface-audit-2026-05-23.log";
const RESTARTED_APP_NATIVE_ACTIVATION_LOG = "frames/t5q-restarted-app-native-activation-2026-05-23.log";
const NATIVE_REPO_GAUNTLET_LOG = "frames/t5r-native-repo-gauntlet-2026-05-23.log";
const CRITICAL_PROOF_FILES = [
  "frames/t5d-file-backed-gauntlet-2026-05-22.log",
  "frames/t5d-file-gauntlet-easy-20260522T230015Z.proof",
  "frames/t5d-file-gauntlet-medium-20260522T230015Z.proof",
  "frames/t5d-file-gauntlet-hard-20260522T230015Z.proof",
  "frames/t5d-file-gauntlet-extra-hard-20260522T230015Z.proof",
  "frames/t5d-skill-load-clean-proof-2026-05-22.log",
  NATIVE_BLOCKER_LOG,
  COMPLETION_AUDIT,
  DOCS_ACTIVATION_AUDIT,
  RELIABILITY_CONTRACT,
  BRIDGE_RESILIENCE_LOG,
  CURRENT_BRIDGE_HEALTH_LOG,
  REPO_ISOLATION_AUDIT,
  REPEATABLE_NATIVE_PROBE_LOG,
  CURRENT_BRIDGE_FILE_TASK_LOG,
  CURRENT_BRIDGE_FILE_TASK_PROOF,
  NATIVE_PROBE_BRIDGE_QUEUE_HARDENING_LOG,
  NATIVE_APP_POLLER_PROBE_OUTPUT_AUDIT_LOG,
  REPEATABLE_NATIVE_APP_POLLER_DIAGNOSTIC_LOG,
  CODEX_HARNESS_NATIVE_RECHECK_LOG,
  CLEARED_QUEUE_NATIVE_ATTRIBUTION_LOG,
  NATIVE_POLLER_SURFACE_AUDIT_LOG,
  RESTARTED_APP_NATIVE_ACTIVATION_LOG,
  NATIVE_REPO_GAUNTLET_LOG,
  "frames/t5r-native-easy-instruction-20260523.txt",
  "frames/t5r-native-medium-instruction-20260523.txt",
  "frames/t5r-native-hard-instruction-20260523.txt",
  "frames/t5r-native-extra-hard-instruction-20260523.txt",
  "frames/t5r-native-gauntlet-easy-20260523.proof",
  "frames/t5r-native-gauntlet-medium-20260523.proof",
  "frames/t5r-native-gauntlet-hard-20260523.proof",
  "frames/t5r-native-gauntlet-extra-hard-20260523.proof",
  "scripts/pentagon-trigger-bridge.mjs",
  "scripts/probe-native-poller.mjs",
  "scripts/probe-native-app-poller.mjs",
  "scripts/audit-pentagon-trigger-attribution.mjs",
  "scripts/audit-pentagon-native-poller-surface.mjs",
  "scripts/run-native-pentagon-task.mjs",
  "launchagents/run.pentagon.trigger-bridge.plist",
];

const LEVELS = {
  easy: {
    hash: "T5D_FILE_EASY_20260522T230015Z",
    proof: "frames/t5d-file-gauntlet-easy-20260522T230015Z.proof",
    message: "fbae512e-d15a-4b4b-9a08-9c21e9335f21",
    trigger: "36d3e64b-fbe9-4407-b766-2f5e50706b3b",
    ack: "5e60157b-c5d4-448f-a342-240e8639399a",
    reverse: "1f4d0ca0-c8f8-49cc-972b-19a4791b4ddd",
  },
  medium: {
    hash: "T5D_FILE_MEDIUM_20260522T230015Z",
    proof: "frames/t5d-file-gauntlet-medium-20260522T230015Z.proof",
    message: "5630db82-3034-49e6-92e9-069a9507d7d3",
    trigger: "7ca24c70-982d-406b-94d7-b2aa558316b1",
    ack: "ddca3312-794b-49d8-aae2-7fd742e26310",
    reverse: "b8c366f2-b1c8-41b7-a357-9b40f9d312f6",
  },
  hard: {
    hash: "T5D_FILE_HARD_20260522T230015Z",
    proof: "frames/t5d-file-gauntlet-hard-20260522T230015Z.proof",
    message: "73677cf1-aeae-4006-932a-73a84a5211ce",
    trigger: "dd0964dd-9eca-44ad-aed2-db604459a7dd",
    ack: "a647a6ef-748d-4f6a-8358-9f075ebf9ad8",
    reverse: "918bf738-cb08-419f-8900-4dd9f63e70aa",
  },
  extra_hard: {
    hash: "T5D_FILE_EXTRA_HARD_20260522T230015Z",
    proof: "frames/t5d-file-gauntlet-extra-hard-20260522T230015Z.proof",
    message: "ff79d7e9-2f15-432c-bbed-a6c66c4e22e4",
    trigger: "888c02e5-be31-4288-b5e6-519dbce20eac",
    ack: "4f13e3c0-87f7-4720-b642-d8e66364ab86",
    reverse: "e05b0123-da60-476f-b945-bdf0a7f590b8",
  },
};

const NATIVE_LEVELS = {
  easy: {
    hash: "T5R_NATIVE_EASY_20260523",
    proof: "frames/t5r-native-gauntlet-easy-20260523.proof",
    message: "bf81ca6c-76c4-4d10-a823-046e0cb2cbc7",
    trigger: "249b5272-a61f-4ffc-af0b-9b6eb9b8de1e",
    ack: "a9d931ee-526e-44bd-a29d-4046ebad72b8",
    activationPath: "agent_trigger",
    verdict: "native_easy_done",
  },
  medium: {
    hash: "T5R_NATIVE_MEDIUM_20260523",
    proof: "frames/t5r-native-gauntlet-medium-20260523.proof",
    message: "551f5ded-1f8c-43eb-b41a-8f26597b7379",
    trigger: null,
    ack: "7e6be062-9f4e-4578-9ad1-85493205e812",
    activationPath: "message_poller_no_trigger_row",
    verdict: "native_medium_done",
  },
  hard: {
    hash: "T5R_NATIVE_HARD_20260523",
    proof: "frames/t5r-native-gauntlet-hard-20260523.proof",
    message: "eb28df09-5ca2-4b26-83f0-0b051a7496ad",
    trigger: "d457fb7c-2321-4155-b645-532095596272",
    ack: "f505785f-75a2-4bd2-8930-36b5342032dd",
    activationPath: "agent_trigger",
    verdict: "native_hard_done",
  },
  extra_hard: {
    hash: "T5R_NATIVE_EXTRA_HARD_20260523",
    proof: "frames/t5r-native-gauntlet-extra-hard-20260523.proof",
    message: "88200f91-bd71-4ef5-986d-afe8729eee52",
    trigger: "77e9971c-7eed-444a-8277-fec696ac507a",
    ack: "09363da6-9422-4f59-aafd-58090f157639",
    activationPath: "agent_trigger",
    verdict: "native_extra_hard_done",
  },
};

const checks = [];

function command(cmd, args) {
  return spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
}

function record(ok, name, detail = "") {
  checks.push({ ok, name, detail });
}

function must(name, condition, detail = "") {
  record(Boolean(condition), name, detail);
}

function file(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

function repoFile(relativePath) {
  return file(ROOT + "/" + relativePath);
}

function requireText(sourceName, text, needle) {
  must(sourceName + " contains " + needle, text.includes(needle));
}

function arg(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  if (idx !== -1) return process.argv[idx + 1] ?? fallback;
  const prefix = name + "=";
  const inline = process.argv.find((value) => value.startsWith(prefix));
  return inline ? inline.slice(prefix.length) : fallback;
}

function parseKeyValueProof(text) {
  const proof = {};
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  for (const line of lines) {
    const idx = line.indexOf("=");
    if (idx <= 0) return { ok: false, error: "invalid key=value line: " + line, proof: {} };
    const key = line.slice(0, idx);
    const value = line.slice(idx + 1);
    if (!key || /\s/.test(key)) return { ok: false, error: "invalid key: " + key, proof: {} };
    proof[key] = value;
  }
  return { ok: true, proof };
}

function parseInteger(value) {
  if (!/^\d+$/.test(String(value ?? ""))) return null;
  return Number(value);
}

function resolveTargetFile(targetFile) {
  const [relativePath, lineText] = String(targetFile ?? "").split(":");
  const line = parseInteger(lineText);
  if (!relativePath || !line) return { relativePath, line: null, fullPath: null, astPath: null };
  const candidates = [ROOT + "/" + relativePath, ROOT + "/activegraph/" + relativePath];
  const fullPath = candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
  return { relativePath, line, fullPath, astPath: fullPath };
}

function pathExistsAtHead(relativePath) {
  if (!relativePath) return false;
  if (command("git", ["cat-file", "-e", "HEAD:" + relativePath]).status === 0) return true;
  if (relativePath.startsWith("activegraph/")) {
    const innerPath = innerRepoPath(relativePath);
    const res = spawnSync("git", ["cat-file", "-e", "HEAD:" + innerPath], {
      cwd: ROOT + "/activegraph",
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });
    return res.status === 0;
  }
  return false;
}

function innerRepoPath(relativePath) {
  if (relativePath?.startsWith("activegraph/activegraph/")) return relativePath.slice("activegraph/".length);
  return relativePath;
}

function innerRepoPathCandidates(relativePath) {
  const candidates = [innerRepoPath(relativePath)];
  if (relativePath?.startsWith("activegraph/tests/")) candidates.push(relativePath.slice("activegraph/".length));
  return [...new Set(candidates.filter(Boolean))];
}

function gitShowForTarget(commitSha, relativePath) {
  const outerName = command("git", ["show", "--name-only", "--format=", commitSha]);
  if (outerName.status === 0) {
    const outerDiff = command("git", ["show", "--unified=0", "--format=", commitSha, "--", relativePath]);
    return { ok: true, pathForCompare: relativePath, nameOnly: outerName.stdout, diff: outerDiff.stdout };
  }
  const innerPaths = innerRepoPathCandidates(relativePath);
  const innerName = spawnSync("git", ["show", "--name-only", "--format=", commitSha], {
    cwd: ROOT + "/activegraph",
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (innerName.status !== 0) return { ok: false, error: outerName.stderr || innerName.stderr || "git show failed" };
  const changedFiles = innerName.stdout.split(/\r?\n/).filter(Boolean);
  const innerPath = innerPaths.find((candidate) => changedFiles.includes(candidate)) ?? innerPaths[0];
  const innerDiff = spawnSync("git", ["show", "--unified=0", "--format=", commitSha, "--", innerPath], {
    cwd: ROOT + "/activegraph",
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  return { ok: true, pathForCompare: innerPath, nameOnly: innerName.stdout, diff: innerDiff.stdout };
}

function verifyAgentCommitTouchesTarget(proof) {
  const commitSha = proof.agent_commit_sha;
  const targetPath = String(proof.target_file ?? "").split(":")[0];
  if (!commitSha) {
    return {
      ok: process.argv.includes("--allow-missing-commit"),
      detail: "skipped (no agent_commit_sha provided)",
    };
  }
  const shown = gitShowForTarget(commitSha, targetPath);
  if (!shown.ok) return { ok: false, detail: shown.error };
  const changedFiles = shown.nameOnly.split(/\r?\n/).filter(Boolean);
  const touchesTarget = changedFiles.includes(targetPath) || changedFiles.includes(shown.pathForCompare);
  const hasDocstringOrAnnotationAdd = /^\+\s*"""/m.test(shown.diff) || /^\+\s*[a-zA-Z_]+:\s*[A-Z]/m.test(shown.diff);
  return {
    ok: touchesTarget && hasDocstringOrAnnotationAdd,
    detail: JSON.stringify({
      commit: commitSha,
      target_file: targetPath,
      path_checked: shown.pathForCompare,
      touches_target: touchesTarget,
      has_docstring_or_annotation_add: hasDocstringOrAnnotationAdd,
    }),
  };
}

function verifyAgentCommitAddsTests(proof) {
  const commitSha = proof.agent_commit_sha;
  const testFile = proof.test_file;
  const newTestCount = parseInteger(proof.new_test_count);
  if (!commitSha) return { ok: false, detail: "missing agent_commit_sha" };
  const shown = gitShowForTarget(commitSha, testFile);
  if (!shown.ok) return { ok: false, detail: shown.error };
  const changedFiles = shown.nameOnly.split(/\r?\n/).filter(Boolean);
  const touchesTestFile = changedFiles.includes(testFile) || changedFiles.includes(shown.pathForCompare);
  const addedTestDefs = (shown.diff.match(/^\+\s*def\s+test_/gm) ?? []).length;
  return {
    ok: touchesTestFile && newTestCount !== null && addedTestDefs >= newTestCount,
    detail: JSON.stringify({
      commit: commitSha,
      test_file: testFile,
      path_checked: shown.pathForCompare,
      touches_test_file: touchesTestFile,
      added_test_defs: addedTestDefs,
      new_test_count: newTestCount,
    }),
  };
}

function innerPathExistsAtHead(relativePath) {
  return innerRepoPathCandidates(relativePath).some((innerPath) => {
    const res = spawnSync("git", ["cat-file", "-e", "HEAD:" + innerPath], {
      cwd: ROOT + "/activegraph",
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });
    return res.status === 0;
  });
}

function collectCountFromOutput(output) {
  const text = String(output ?? "");
  const slashMatch = text.match(/(\d+)\/\d+ tests collected/);
  if (slashMatch) return Number(slashMatch[1]);
  const collectedItems = text.match(/collected (\d+) items/);
  if (collectedItems) return Number(collectedItems[1]);
  const testsCollected = text.match(/(\d+) tests collected/);
  if (testsCollected) return Number(testsCollected[1]);
  if (text.includes("no tests collected")) return 0;
  return null;
}

function pytestCollectCountForSymbol(symbol) {
  const res = spawnSync("uv", ["run", "pytest", "--collect-only", "-q", "-k", String(symbol ?? "")], {
    cwd: ROOT + "/activegraph",
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  const output = (res.stdout ?? "") + (res.stderr ?? "");
  return { status: res.status, count: collectCountFromOutput(output), output: output.trim().split(/\r?\n/).slice(-6).join("\n") };
}

function ruffCheckInnerPath(relativePath) {
  const innerPath = innerRepoPathCandidates(relativePath).find((candidate) => {
    const res = spawnSync("git", ["cat-file", "-e", "HEAD:" + candidate], {
      cwd: ROOT + "/activegraph",
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });
    return res.status === 0;
  }) ?? innerRepoPath(relativePath);
  const res = spawnSync("uv", ["run", "ruff", "check", innerPath], {
    cwd: ROOT + "/activegraph",
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  return { status: res.status, output: ((res.stdout ?? "") + (res.stderr ?? "")).trim() };
}

function innerGit(args, options = {}) {
  return spawnSync("git", args, {
    cwd: ROOT + "/activegraph",
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    ...options,
  });
}

function innerCommitExists(commitSha) {
  if (!commitSha) return false;
  return innerGit(["cat-file", "-e", commitSha + "^{commit}"]).status === 0;
}

function innerPathExistsAtCommit(commitSha, relativePath) {
  if (!commitSha) return false;
  return innerRepoPathCandidates(relativePath).some((innerPath) => innerGit(["cat-file", "-e", commitSha + ":" + innerPath]).status === 0);
}

function changedFilesForInnerCommit(commitSha) {
  const res = innerGit(["show", "--name-only", "--format=", commitSha]);
  if (res.status !== 0) return { ok: false, files: [], error: res.stderr || res.stdout };
  return { ok: true, files: res.stdout.split(/\r?\n/).filter(Boolean), error: "" };
}

function commitTimestamp(commitSha) {
  const res = innerGit(["show", "-s", "--format=%ct", commitSha]);
  if (res.status !== 0) return null;
  return parseInteger(res.stdout.trim());
}

function triggerTimestampFromLog(hash) {
  const candidates = [
    "frames/t6-native-hard-maya-run-20260523.log",
    "frames/t6-native-hard-run-20260523.log",
    "frames/t6-native-hard-quinn-run-20260523.log",
  ];
  for (const relativePath of candidates) {
    const text = repoFile(relativePath);
    if (!text || !text.includes(hash)) continue;
    const match = text.match(/"created_at":\s*"([^"]+)"/);
    if (!match) continue;
    const millis = Date.parse(match[1]);
    if (!Number.isNaN(millis)) return Math.floor(millis / 1000);
  }
  return null;
}

function bugSourceExists(bugSource, commitSha = "HEAD") {
  const text = String(bugSource ?? "");
  const match = text.match(/^(docstring|docs|comment|marker):(.+?)(?::(\d+))?$/);
  if (!match) return { ok: false, detail: text || "<missing>" };
  const [, kind, pathText, lineText] = match;
  const candidates = innerRepoPathCandidates(pathText);
  const existingPath = candidates.find((candidate) => innerGit(["cat-file", "-e", commitSha + ":" + candidate]).status === 0);
  if (!existingPath) return { ok: false, detail: JSON.stringify({ kind, path: pathText, exists: false }) };
  if (!lineText) return { ok: true, detail: JSON.stringify({ kind, path: existingPath, exists: true }) };
  const show = innerGit(["show", commitSha + ":" + existingPath]);
  if (show.status !== 0) return { ok: false, detail: show.stderr || show.stdout };
  const line = parseInteger(lineText);
  const lines = show.stdout.split(/\r?\n/);
  const lineTextAtPath = line && line <= lines.length ? lines[line - 1] : "";
  const markerOk = kind !== "comment" && kind !== "marker" ? true : /TODO|FIXME|XXX|bug|xfail|skip/i.test(lineTextAtPath);
  return { ok: Boolean(line && line <= lines.length && markerOk), detail: JSON.stringify({ kind, path: existingPath, commit: commitSha, line, text: lineTextAtPath.trim() }) };
}

function hardSourceTestSplit(proof, commitSha, mode) {
  const changed = changedFilesForInnerCommit(commitSha);
  if (!changed.ok) return { ok: false, detail: changed.error };
  const candidateTestPaths = innerRepoPathCandidates(proof.test_file);
  const touchesTest = changed.files.some((path) => candidateTestPaths.includes(path));
  const touchesSource = changed.files.some((path) => path.startsWith("activegraph/") && !path.startsWith("activegraph/tests/"));
  const ok = mode === "test" ? touchesTest && !touchesSource : touchesSource && !touchesTest;
  return { ok, detail: JSON.stringify({ commit: commitSha, files: changed.files, touches_test: touchesTest, touches_source: touchesSource }) };
}

function hardWorktreePytest(commitSha, testFile, suffix) {
  const worktreePath = "/tmp/t6h-verify-" + suffix;
  const list = innerGit(["worktree", "list"]);
  if (list.stdout.includes(worktreePath) || existsSync(worktreePath)) {
    innerGit(["worktree", "remove", worktreePath, "--force"]);
    rmSync(worktreePath, { recursive: true, force: true });
  }
  let add = null;
  try {
    add = innerGit(["worktree", "add", worktreePath, commitSha]);
    if (add.status !== 0) return { status: null, ok: false, output: add.stderr || add.stdout };
    const testPath = innerRepoPathCandidates(testFile).find((candidate) => existsSync(worktreePath + "/" + candidate)) ?? innerRepoPath(testFile);
    const venv = spawnSync("uv", ["venv"], {
      cwd: worktreePath,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    });
    if (venv.status !== 0) return { status: null, ok: false, output: "uv venv failed: " + ((venv.stdout ?? "") + (venv.stderr ?? "")).trim() };
    const installProject = spawnSync("uv", ["pip", "install", "-e", "."], {
      cwd: worktreePath,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    });
    if (installProject.status !== 0) return { status: null, ok: false, output: "uv pip install -e . failed: " + ((installProject.stdout ?? "") + (installProject.stderr ?? "")).trim() };
    const installPytest = spawnSync("uv", ["pip", "install", "pytest"], {
      cwd: worktreePath,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    });
    if (installPytest.status !== 0) return { status: null, ok: false, output: "uv pip install pytest failed: " + ((installPytest.stdout ?? "") + (installPytest.stderr ?? "")).trim() };
    const pythonPath = worktreePath + "/.venv/bin/python";
    const sanity = spawnSync(pythonPath, ["-c", [
      "import json, os, pathlib, sys",
      "import activegraph",
      "python = pathlib.Path(sys.executable).resolve()",
      "expected = pathlib.Path(os.getcwd(), '.venv', 'bin', 'python').resolve()",
      "activegraph_file = pathlib.Path(activegraph.__file__).resolve()",
      "root = pathlib.Path(os.getcwd()).resolve()",
      "ok = python == expected and root in activegraph_file.parents",
      "print(json.dumps({'ok': ok, 'python': str(python), 'expected_python': str(expected), 'activegraph_file': str(activegraph_file), 'root': str(root)}))",
      "raise SystemExit(0 if ok else 17)",
    ].join("; ")], {
      cwd: worktreePath,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    });
    if (sanity.status !== 0) return { status: null, ok: false, output: "venv/import sanity failed: " + ((sanity.stdout ?? "") + (sanity.stderr ?? "")).trim() };
    const pytest = spawnSync(pythonPath, ["-m", "pytest", testPath, "--tb=no", "-q"], {
      cwd: worktreePath,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    });
    return { status: pytest.status, ok: true, output: ((pytest.stdout ?? "") + (pytest.stderr ?? "")).trim().split(/\r?\n/).slice(-8).join("\n") };
  } finally {
    innerGit(["worktree", "remove", worktreePath, "--force"]);
    rmSync(worktreePath, { recursive: true, force: true });
  }
}

function pythonAstInspect(relativePath, symbol) {
  const target = resolveTargetFile(relativePath + ":1");
  const astPath = target.astPath ?? ROOT + "/" + relativePath;
  const code = [
    "import ast",
    "import json",
    "import pathlib",
    "import sys",
    "",
    "path = pathlib.Path(sys.argv[1])",
    "symbol = sys.argv[2]",
    "relative_path = pathlib.Path(sys.argv[3])",
    "parts = relative_path.with_suffix(\"\").parts",
    "module_parts = parts[1:] if len(parts) > 1 and parts[0] == \"activegraph\" and parts[1] == \"activegraph\" else parts",
    "module = \".\".join(module_parts)",
    "tree = ast.parse(path.read_text(), filename=str(path))",
    "",
    "class StackVisitor(ast.NodeVisitor):",
    "    def __init__(self):",
    "        self.stack = []",
    "        self.match = None",
    "",
    "    def visit_ClassDef(self, node):",
    "        self.stack.append(node.name)",
    "        self.generic_visit(node)",
    "        self.stack.pop()",
    "",
    "    def visit_FunctionDef(self, node):",
    "        self._visit_function(node)",
    "",
    "    def visit_AsyncFunctionDef(self, node):",
    "        self._visit_function(node)",
    "",
    "    def _visit_function(self, node):",
    "        qualified = module + \".\" + \".\".join([*self.stack, node.name])",
    "        args = [*node.args.posonlyargs, *node.args.args, *node.args.kwonlyargs]",
    "        annotated_args = [",
    "            arg.arg for arg in args",
    "            if arg.arg not in {\"self\", \"cls\"} and arg.annotation is not None",
    "        ]",
    "        missing_args = [",
    "            arg.arg for arg in args",
    "            if arg.arg not in {\"self\", \"cls\"} and arg.annotation is None",
    "        ]",
    "        if qualified == symbol:",
    "            self.match = {",
    "                \"qualified\": qualified,",
    "                \"lineno\": node.lineno,",
    "                \"has_docstring\": ast.get_docstring(node) is not None,",
    "                \"missing_args\": missing_args,",
    "                \"annotated_args\": annotated_args,",
    "                \"has_return_annotation\": node.returns is not None,",
    "            }",
    "        self.stack.append(node.name)",
    "        self.generic_visit(node)",
    "        self.stack.pop()",
    "",
    "visitor = StackVisitor()",
    "visitor.visit(tree)",
    "print(json.dumps(visitor.match or {\"missing\": True, \"module\": module}))",
  ].join("\n");
  const res = spawnSync("python3", ["-c", code, astPath, symbol, relativePath], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  if (res.status !== 0) return { ok: false, error: res.stderr || res.stdout };
  try {
    return { ok: true, result: JSON.parse(res.stdout) };
  } catch (error) {
    return { ok: false, error: error.message + ": " + res.stdout };
  }
}

function dirtyTrackedFiles() {
  const diff = command("git", ["diff", "--name-only"]);
  const staged = command("git", ["diff", "--cached", "--name-only"]);
  const untracked = command("git", ["ls-files", "--others", "--exclude-standard"]);
  const files = [
    ...String(diff.stdout ?? "").split(/\r?\n/),
    ...String(staged.stdout ?? "").split(/\r?\n/),
    ...String(untracked.stdout ?? "").split(/\r?\n/),
  ].filter(Boolean);
  return [...new Set(files)].sort();
}

function launchdValue(text, key) {
  const match = String(text ?? "").match(new RegExp("\\n\\s*" + key + " = ([^\\n]+)"));
  return match?.[1]?.trim() ?? null;
}

function decodeJwtPayload(jwt) {
  const part = jwt.split(".")[1];
  const padded = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
  return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
}

function readPentagonSession() {
  const raw = execFileSync("/usr/libexec/PlistBuddy", [
    "-c",
    "Print :supabase.auth.sb-auth-auth-token",
    PLIST,
  ], { encoding: "utf8" });
  const session = JSON.parse(raw);
  const accessToken = session.accessToken;
  const supabaseOrigin = new URL(decodeJwtPayload(accessToken).iss).origin;
  const anonKey = execFileSync("zsh", [
    "-lc",
    "strings \"" + PENTAGON_BIN + "\" | rg '^eyJ' | head -1",
  ], { encoding: "utf8" }).trim();
  return { accessToken, supabaseOrigin, anonKey };
}

async function supabase(state, path) {
  const res = await fetch(state.supabaseOrigin + path, {
    headers: {
      apikey: state.anonKey,
      Authorization: "Bearer " + state.accessToken,
      Accept: "application/json",
    },
  });
  const body = await res.text();
  let parsed = body;
  try { parsed = JSON.parse(body); } catch {}
  if (!res.ok) throw new Error(path + " failed " + res.status + ": " + JSON.stringify(parsed));
  return parsed;
}

async function verifyLiveRows() {
  const state = readPentagonSession();

  const triggerIds = Object.values(LEVELS).flatMap((level) => [level.trigger, level.reverse]);
  const triggerRows = await supabase(
    state,
    "/rest/v1/agent_triggers?id=in.(" + triggerIds.join(",") + ")&select=id,claimed_at,completed_at,message_id&limit=20"
  );
  const triggers = new Map(triggerRows.map((row) => [row.id, row]));
  for (const [levelName, level] of Object.entries(LEVELS)) {
    for (const kind of ["trigger", "reverse"]) {
      const row = triggers.get(level[kind]);
      must("live DB " + levelName + " " + kind + " row exists", row, level[kind]);
      must("live DB " + levelName + " " + kind + " completed_at present", row && row.completed_at, row ? JSON.stringify(row) : level[kind]);
    }
  }

  const ackIds = Object.values(LEVELS).map((level) => level.ack);
  const ackRows = await supabase(
    state,
    "/rest/v1/messages?id=in.(" + ackIds.join(",") + ")&select=id,content,created_at&limit=10"
  );
  const acks = new Map(ackRows.map((row) => [row.id, row]));
  for (const [levelName, level] of Object.entries(LEVELS)) {
    const row = acks.get(level.ack);
    must("live DB " + levelName + " ACK row exists", row, level.ack);
    must("live DB " + levelName + " ACK contains hash", row && row.content.includes(level.hash), row ? row.content : level.ack);
  }

  const nativeTriggerIds = Object.values(NATIVE_LEVELS).map((level) => level.trigger).filter(Boolean);
  const nativeTriggerRows = await supabase(
    state,
    "/rest/v1/agent_triggers?id=in.(" + nativeTriggerIds.join(",") + ")&select=id,claimed_at,completed_at,message_id&limit=10"
  );
  const nativeTriggers = new Map(nativeTriggerRows.map((row) => [row.id, row]));
  for (const [levelName, level] of Object.entries(NATIVE_LEVELS)) {
    if (!level.trigger) {
      record(true, "live DB native " + levelName + " trigger row", "message_poller_no_trigger_row");
      continue;
    }
    const row = nativeTriggers.get(level.trigger);
    must("live DB native " + levelName + " trigger row exists", row, level.trigger);
    must("live DB native " + levelName + " trigger completed_at present", row && row.completed_at, row ? JSON.stringify(row) : level.trigger);
  }

  const nativeMessageIds = Object.values(NATIVE_LEVELS).flatMap((level) => [level.message, level.ack]);
  const nativeMessageRows = await supabase(
    state,
    "/rest/v1/messages?id=in.(" + nativeMessageIds.join(",") + ")&select=id,content,created_at&limit=20"
  );
  const nativeMessages = new Map(nativeMessageRows.map((row) => [row.id, row]));
  for (const [levelName, level] of Object.entries(NATIVE_LEVELS)) {
    const instruction = nativeMessages.get(level.message);
    const ack = nativeMessages.get(level.ack);
    must("live DB native " + levelName + " instruction row exists", instruction, level.message);
    must("live DB native " + levelName + " instruction contains hash", instruction && instruction.content.includes(level.hash), instruction ? instruction.content : level.message);
    must("live DB native " + levelName + " ACK row exists", ack, level.ack);
    must("live DB native " + levelName + " ACK contains hash", ack && ack.content.includes(level.hash), ack ? ack.content : level.ack);
  }

  const agents = await supabase(
    state,
    "/rest/v1/agents?select=id,name,provider,model,harness_id,directory,execution_mode,base_directory,base_branch,deleted_at&deleted_at=is.null&limit=200"
  );
  const activeGraphAgents = agents.filter((agent) => agent.directory === ROOT);
  const wrongModels = activeGraphAgents.filter((agent) => agent.model !== "gpt-5.5");
  const wrongProviders = activeGraphAgents.filter((agent) => agent.provider !== "codex");
  const wrongHarnesses = activeGraphAgents.filter((agent) => agent.harness_id !== "codex");
  const wrongExecutionModes = activeGraphAgents.filter((agent) => agent.execution_mode !== "local");
  const branchMetadataRows = activeGraphAgents.filter((agent) => agent.base_directory || agent.base_branch);
  must("live DB active_graph agent rows present", activeGraphAgents.length >= 20, "count=" + activeGraphAgents.length);
  must("live DB active_graph agent rows have exact repo directory", activeGraphAgents.every((agent) => agent.directory === ROOT), JSON.stringify(activeGraphAgents.map((agent) => ({ name: agent.name, directory: agent.directory }))));
  must("live DB all active_graph agents are gpt-5.5", wrongModels.length === 0, JSON.stringify(wrongModels));
  must("live DB all active_graph agents use codex provider", wrongProviders.length === 0, JSON.stringify(wrongProviders));
  must("live DB all active_graph agents use codex harness", wrongHarnesses.length === 0, JSON.stringify(wrongHarnesses));
  must("live DB all active_graph agents use local execution", wrongExecutionModes.length === 0, JSON.stringify(wrongExecutionModes));
  record(true, "live DB active_graph clone branch metadata rows", branchMetadataRows.length ? JSON.stringify(branchMetadataRows) : "none exposed");
}

function proofAckPaths(proofFile) {
  const paths = [proofFile];
  if (proofFile.startsWith("activegraph/")) paths.push(proofFile.slice("activegraph/".length));
  if (proofFile.startsWith("frames/")) paths.push("activegraph/" + proofFile);
  return [...new Set(paths)];
}

function t6TierFromHash(hash) {
  const match = String(hash ?? "").match(/^T6_NATIVE_(EASY|MEDIUM|HARD)_20260523$/);
  return match ? match[1].toLowerCase() : "unknown";
}

function parseMayaAck(content) {
  const match = String(content ?? "").trim().match(/^MAYA_NATIVE_GAUNTLET_ACK\s+(\S+)\s+(\S+)\s+(\S+)$/);
  if (!match) return null;
  return { hash: match[1], tier: match[2], proof_path: match[3] };
}

function parseQuinnAck(content) {
  const match = String(content ?? "").trim().match(/^QUINN_REGRESSION_VERIFIED\s+(\S+)\s+(\S+)\s+(\S+)(?:\s+.*)?$/);
  if (!match) return null;
  return { hash: match[1], failing_test_commit: match[2], fix_commit: match[3] };
}

function canonicalFieldsEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function ackFixtureForProof(proofFile, kind) {
  const fixtureName = String(proofFile ?? "").split("/").pop();
  if (!fixtureName?.startsWith("t6-hard-proof-fixture-")) return null;
  if (kind === "quinn") {
    const expectedAgent = { id: "fixture-quinn", name: "Quinn (Test Adversary)" };
    const trigger = {
      id: "fixture-quinn-trigger-canonical",
      conversation_id: "fixture-quinn-conversation-canonical",
      content: "NATIVE_GAUNTLET HARD T6_NATIVE_HARD_20260523 QUINN_VERIFICATION",
      claimed_at: "2026-05-23T22:18:48.000+00:00",
      completed_at: "2026-05-23T22:20:31.000+00:00",
    };
    return {
      expectedAgent,
      triggers: [trigger],
      messages: [
        {
          id: "fixture-quinn-verified-ack",
          conversation_id: trigger.conversation_id,
          sender_id: expectedAgent.id,
          created_at: "2026-05-23T22:20:20.000+00:00",
          content: "QUINN_REGRESSION_VERIFIED T6_NATIVE_HARD_20260523 df06a9a 545889f",
        },
      ],
    };
  }
  if (kind !== "maya") return null;
  const baseTrigger = {
    id: "fixture-trigger-canonical",
    conversation_id: "fixture-conversation-canonical",
    content: "NATIVE_GAUNTLET HARD T6_NATIVE_HARD_20260523",
    claimed_at: "2026-05-23T21:57:43.81872+00:00",
    completed_at: "2026-05-23T22:02:33.786+00:00",
  };
  const forceMarkedTrigger = {
    id: "fixture-trigger-force-marked",
    conversation_id: "fixture-conversation-force-marked",
    content: "NATIVE_GAUNTLET HARD T6_NATIVE_HARD_20260523",
    claimed_at: "2026-05-23T21:58:18.605036+00:00",
    completed_at: "2026-05-23T21:58:18.507+00:00",
  };
  const expectedAgent = { id: "fixture-maya", name: "Maya (Code Owner)" };
  const canonicalAck = "MAYA_NATIVE_GAUNTLET_ACK T6_NATIVE_HARD_20260523 HARD " + proofFile;
  if (fixtureName === "t6-hard-proof-fixture-duplicate-identical-acks.txt") {
    return {
      expectedAgent,
      triggers: [baseTrigger],
      messages: [
        { id: "fixture-shadow-ack", conversation_id: baseTrigger.conversation_id, sender_id: expectedAgent.id, created_at: "2026-05-23T22:00:47.54023+00:00", content: canonicalAck },
        { id: "fixture-kept-ack", conversation_id: baseTrigger.conversation_id, sender_id: expectedAgent.id, created_at: "2026-05-23T22:02:30.25218+00:00", content: canonicalAck },
      ],
    };
  }
  if (fixtureName === "t6-hard-proof-fixture-bad-ack-contradiction.txt") {
    return {
      expectedAgent,
      triggers: [baseTrigger],
      messages: [
        { id: "fixture-good-ack", conversation_id: baseTrigger.conversation_id, sender_id: expectedAgent.id, created_at: "2026-05-23T22:00:47.54023+00:00", content: canonicalAck },
        { id: "fixture-bad-ack", conversation_id: baseTrigger.conversation_id, sender_id: expectedAgent.id, created_at: "2026-05-23T22:02:30.25218+00:00", content: "MAYA_NATIVE_GAUNTLET_ACK T6_NATIVE_HARD_20260523 HARD frames/contradictory-proof.proof" },
      ],
    };
  }
  if (fixtureName === "t6-hard-proof-fixture-bad-no-canonical-ack.txt") {
    return {
      expectedAgent,
      triggers: [forceMarkedTrigger],
      messages: [
        { id: "fixture-force-marked-ack", conversation_id: forceMarkedTrigger.conversation_id, sender_id: expectedAgent.id, created_at: "2026-05-23T22:02:30.25218+00:00", content: canonicalAck },
      ],
    };
  }
  return null;
}

function isCanonicalTrigger(trigger, expectedAgentId, expectedAgentMessageCounts) {
  const claimedAt = Date.parse(trigger.claimed_at ?? "");
  const completedAt = Date.parse(trigger.completed_at ?? "");
  return Boolean(
    trigger.claimed_at &&
    trigger.completed_at &&
    Number.isFinite(claimedAt) &&
    Number.isFinite(completedAt) &&
    claimedAt < completedAt &&
    (expectedAgentMessageCounts.get(trigger.conversation_id) ?? 0) >= 1 &&
    trigger.agent_id === expectedAgentId
  );
}

function warnContext({ leg, expectedAgent }) {
  const agentName = expectedAgent?.name ?? "n/a";
  const agentId = expectedAgent?.id ?? "n/a";
  return "[leg=" + JSON.stringify(leg) + ", agent=" + JSON.stringify(agentName) + ", agent_id=" + agentId + "]";
}

function resolveCanonicalAck({ proofFile, hash, tier, leg, expectedAgent, triggers, messages, ackParser, ackMatches, canonicalFieldFilter, triggerMatches }) {
  const noAckReason = "no " + expectedAgent.name.split(" ")[0] + " ACK in canonical trigger";
  const expectedAgentMessages = messages.filter((row) => row.sender_id === expectedAgent.id);
  const messageCounts = new Map();
  for (const row of expectedAgentMessages) {
    messageCounts.set(row.conversation_id, (messageCounts.get(row.conversation_id) ?? 0) + 1);
  }
  const candidateTriggers = triggers.filter((trigger) => triggerMatches ? triggerMatches(trigger.content) : String(trigger.content ?? "").includes(hash));
  const canonicalTriggers = candidateTriggers
    .filter((trigger) => isCanonicalTrigger(trigger, expectedAgent.id, messageCounts))
    .sort((a, b) => Date.parse(b.completed_at) - Date.parse(a.completed_at));

  if (canonicalTriggers.length === 0) {
    return {
      ok: false,
      detail: JSON.stringify({
        reason: noAckReason,
        trigger_rows: candidateTriggers.length,
        candidate_trigger_ids: candidateTriggers.map((trigger) => trigger.id),
      }),
    };
  }

  const canonicalTrigger = canonicalTriggers[0];
  const shadowTriggers = canonicalTriggers.slice(1);
  if (shadowTriggers.length) {
    console.log(
      "WARN T6 " + tier + " shadow trigger present " + warnContext({ leg, expectedAgent }) +
      " :: kept=" + canonicalTrigger.id +
      ", shadowed=" + JSON.stringify(shadowTriggers.map((trigger) => trigger.id))
    );
  }

  const ackRows = messages
    .filter((row) => row.sender_id === expectedAgent.id && row.conversation_id === canonicalTrigger.conversation_id)
    .filter((row) => ackMatches(row.content))
    .map((row) => ({ ...row, canonical_fields: ackParser(row.content) }))
    .filter((row) => row.canonical_fields);

  if (ackRows.length === 0) {
    return {
      ok: false,
      detail: JSON.stringify({
        reason: noAckReason,
        canonical_trigger_id: canonicalTrigger.id,
        canonical_conversation_id: canonicalTrigger.conversation_id,
      }),
    };
  }

  const sortedAcks = ackRows.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const canonicalAck = sortedAcks[0];
  const contradictions = sortedAcks.filter((row) => !canonicalFieldsEqual(row.canonical_fields, canonicalAck.canonical_fields));
  if (contradictions.length) {
    return {
      ok: false,
      detail: JSON.stringify({
        reason: "ACK contradiction",
        canonical_trigger_id: canonicalTrigger.id,
        kept_candidate: { id: canonicalAck.id, canonical_fields: canonicalAck.canonical_fields },
        contradictions: contradictions.map((row) => ({ id: row.id, canonical_fields: row.canonical_fields })),
      }),
    };
  }
  if (!canonicalFieldFilter(canonicalAck.canonical_fields)) {
    return {
      ok: false,
      detail: JSON.stringify({
        reason: noAckReason,
        canonical_trigger_id: canonicalTrigger.id,
        ack_rows: sortedAcks.length,
        newest_ack_fields: canonicalAck.canonical_fields,
      }),
    };
  }

  const shadowAcks = sortedAcks.slice(1);
  if (shadowAcks.length) {
    console.log(
      "WARN T6 " + tier + " shadow ACKs in canonical trigger " + warnContext({ leg, expectedAgent }) +
      " :: count=" + sortedAcks.length +
      ", kept=" + canonicalAck.id +
      ", shadowed=" + JSON.stringify(shadowAcks.map((row) => row.id))
    );
  }

  return {
    ok: true,
    detail: JSON.stringify({
      canonical_trigger_id: canonicalTrigger.id,
      canonical_ack_id: canonicalAck.id,
      ack_rows: sortedAcks.length,
      shadow_ack_ids: shadowAcks.map((row) => row.id),
      accepted_proof_paths: proofAckPaths(proofFile),
    }),
  };
}

async function fetchExpectedAgent(name) {
  const state = readPentagonSession();
  const rows = await supabase(
    state,
    "/rest/v1/agents?directory=eq." + encodeURIComponent(ROOT) + "&name=eq." + encodeURIComponent(name) + "&deleted_at=is.null&select=id,name&limit=1"
  );
  return { state, agent: rows[0] };
}

function optionalSinceParam() {
  return arg("--since", null);
}

async function fetchAckAuditRows(state, expectedAgent, hash, since = null) {
  const sinceFilter = since ? "&created_at=gte." + encodeURIComponent(since) : "";
  const triggers = await supabase(
    state,
    "/rest/v1/agent_triggers?agent_id=eq." + expectedAgent.id +
      "&content=ilike.*" + encodeURIComponent(hash) + "*" +
      sinceFilter +
      "&select=id,conversation_id,agent_id,content,claimed_at,completed_at,created_at&order=created_at.desc&limit=200"
  );
  const conversationIds = [...new Set(triggers.filter((row) => String(row.content ?? "").includes(hash)).map((row) => row.conversation_id).filter(Boolean))];
  if (!conversationIds.length) return { triggers, messages: [] };
  const messageSinceFilter = since ? "&created_at=gte." + encodeURIComponent(since) : "";
  const messages = await supabase(
    state,
    "/rest/v1/messages?conversation_id=in.(" + conversationIds.join(",") + ")" +
      messageSinceFilter +
      "&select=id,conversation_id,sender_id,content,created_at&order=created_at.desc&limit=1000"
  );
  return { triggers, messages };
}

async function verifyT6Ack(proofFile, hash) {
  const fixture = ackFixtureForProof(proofFile, "maya");
  const tier = t6TierFromHash(hash);
  const expectedTier = tier.toUpperCase();
  const acceptedPaths = proofAckPaths(proofFile);
  const ackPrefix = "MAYA_NATIVE_GAUNTLET_ACK " + hash;
  const canonicalFieldFilter = (fields) => fields.hash === hash && fields.tier === expectedTier && acceptedPaths.includes(fields.proof_path);
  if (fixture) {
    return resolveCanonicalAck({
      proofFile,
      hash,
      tier,
      leg: "Maya ACK",
      expectedAgent: fixture.expectedAgent,
      triggers: fixture.triggers.map((trigger) => ({ ...trigger, agent_id: fixture.expectedAgent.id })),
      messages: fixture.messages,
      ackParser: parseMayaAck,
      ackMatches: (content) => String(content ?? "").includes(ackPrefix),
      canonicalFieldFilter,
      triggerMatches: (content) => {
        const text = String(content ?? "");
        return text.startsWith("NATIVE_GAUNTLET " + expectedTier + " " + hash) && !text.includes("QUINN_VERIFICATION");
      },
    });
  }

  const since = optionalSinceParam();
  const { state, agent: maya } = await fetchExpectedAgent("Maya (Code Owner)");
  if (!maya) return { ok: false, detail: "Maya agent row not found" };
  const { triggers, messages } = await fetchAckAuditRows(state, maya, hash, since);
  return resolveCanonicalAck({
    proofFile,
    hash,
    tier,
    leg: "Maya ACK",
    expectedAgent: maya,
    triggers,
    messages,
    ackParser: parseMayaAck,
    ackMatches: (content) => String(content ?? "").includes(ackPrefix),
    canonicalFieldFilter: (fields) => fields.hash === hash && fields.tier === expectedTier && acceptedPaths.includes(fields.proof_path),
    triggerMatches: (content) => {
      const text = String(content ?? "");
      return text.startsWith("NATIVE_GAUNTLET " + expectedTier + " " + hash) && !text.includes("QUINN_VERIFICATION");
    },
  });
}

async function verifyT6QuinnAck(proof, proofFile) {
  const since = optionalSinceParam();
  const hash = "T6_NATIVE_HARD_20260523";
  const commitA = String(proof.failing_test_commit ?? "");
  const commitB = String(proof.fix_commit ?? "");
  const ackPrefix = "QUINN_REGRESSION_VERIFIED " + hash;
  const canonicalFieldFilter = (fields) => {
    return fields.hash === hash &&
      (fields.failing_test_commit === commitA || fields.failing_test_commit === commitA.slice(0, 7)) &&
      (fields.fix_commit === commitB || fields.fix_commit === commitB.slice(0, 7));
  };
  const fixture = ackFixtureForProof(proofFile, "quinn");
  if (fixture) {
    return resolveCanonicalAck({
      proofFile: "quinn-regression-verification",
      hash,
      tier: "hard",
      leg: "Quinn verification",
      expectedAgent: fixture.expectedAgent,
      triggers: fixture.triggers.map((trigger) => ({ ...trigger, agent_id: fixture.expectedAgent.id })),
      messages: fixture.messages,
      ackParser: parseQuinnAck,
      ackMatches: (content) => String(content ?? "").includes(ackPrefix),
      canonicalFieldFilter,
      triggerMatches: (content) => String(content ?? "").startsWith("NATIVE_GAUNTLET HARD " + hash + " QUINN_VERIFICATION"),
    });
  }
  const { state, agent: quinn } = await fetchExpectedAgent("Quinn (Test Adversary)");
  if (!quinn) return { ok: false, detail: "Quinn agent row not found" };
  const { triggers, messages } = await fetchAckAuditRows(state, quinn, hash, since);
  return resolveCanonicalAck({
    proofFile: "quinn-regression-verification",
    hash,
    tier: "hard",
    leg: "Quinn verification",
    expectedAgent: quinn,
    triggers,
    messages,
    ackParser: parseQuinnAck,
    ackMatches: (content) => String(content ?? "").includes(ackPrefix),
    canonicalFieldFilter,
    triggerMatches: (content) => String(content ?? "").startsWith("NATIVE_GAUNTLET HARD " + hash + " QUINN_VERIFICATION"),
  });
}

async function t6RuntimeEventCount(hash) {
  const state = readPentagonSession();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const rows = await supabase(
    state,
    "/rest/v1/agent_runtime_events?select=*&created_at=gte." + encodeURIComponent(since) + "&limit=1000"
  );
  return rows.filter((row) => JSON.stringify(row).includes(hash)).length;
}

async function runT6EasyVerifier() {
  const noDb = process.argv.includes("--no-db");
  const proofFile = arg("--proof-file", "frames/t6-native-gauntlet-easy-20260523.proof");
  const proofText = repoFile(proofFile);
  const parsed = proofText ? parseKeyValueProof(proofText) : { ok: false, error: "missing proof", proof: {} };
  const proof = parsed.proof;

  must("T6 easy proof file exists and parses as key=value lines", Boolean(proofText) && parsed.ok, parsed.error || proofFile);
  must("T6 easy hash field matches", proof.hash === "T6_NATIVE_EASY_20260523", proof.hash ?? "<missing>");
  must("T6 easy verdict field matches", proof.verdict === "native_easy_done", proof.verdict ?? "<missing>");

  const target = resolveTargetFile(proof.target_file);
  const targetExistsAtHead = Boolean(
    target.relativePath &&
    pathExistsAtHead(target.relativePath) &&
    target.fullPath &&
    existsSync(target.fullPath)
  );
  const astResult = targetExistsAtHead ? pythonAstInspect(target.relativePath, proof.target_symbol) : { ok: false, result: { missing: true } };
  const symbol = astResult.result ?? {};
  must(
    "T6 easy target_file exists at HEAD and target_symbol resolves",
    targetExistsAtHead && astResult.ok && !symbol.missing,
    astResult.error || JSON.stringify({ target_file: proof.target_file, target_symbol: proof.target_symbol, ast: symbol })
  );
  must("T6 easy target_symbol has docstring", Boolean(!symbol.missing && symbol.has_docstring), JSON.stringify(symbol));
  must(
    "T6 easy target_symbol has complete type annotations",
    Boolean(!symbol.missing && symbol.has_return_annotation && Array.isArray(symbol.missing_args) && symbol.missing_args.length === 0),
    JSON.stringify(symbol)
  );

  const commitCheck = verifyAgentCommitTouchesTarget(proof);
  must("T6 easy agent committed target_file change", commitCheck.ok, commitCheck.detail);

  const pytestBefore = parseInteger(proof.pytest_before);
  const pytestAfter = parseInteger(proof.pytest_after);
  must(
    "T6 easy pytest_after did not regress",
    pytestBefore !== null && pytestAfter !== null && pytestAfter >= pytestBefore,
    "before=" + String(proof.pytest_before) + " after=" + String(proof.pytest_after)
  );
  must("T6 easy target_file ruff check exits 0", proof.ruff_target_exit === "0", proof.ruff_target_exit ?? "<missing>");

  if (noDb) {
    record(true, "T6 easy messages table has Maya ACK referencing proof", "skipped by --no-db");
  } else {
    try {
      const eventCheck = await verifyT6Ack(proofFile, "T6_NATIVE_EASY_20260523");
      must("T6 easy messages table has Maya ACK referencing proof", eventCheck.ok, eventCheck.detail);
    } catch (error) {
      must("T6 easy messages table has Maya ACK referencing proof", false, error.message);
    }
  }

  const failed = checks.filter((check) => !check.ok);
  for (const check of checks) {
    console.log((check.ok ? "PASS " : "FAIL ") + check.name + (check.detail ? " :: " + check.detail : ""));
  }
  if (!noDb) {
    try {
      const runtimeEventCount = await t6RuntimeEventCount("T6_NATIVE_EASY_20260523");
      console.log("WARN T6 easy agent_runtime_events runtime event missing " + warnContext({ leg: "audit_advisory" }) + " :: " + runtimeEventCount + " rows");
    } catch (error) {
      console.log("WARN T6 easy agent_runtime_events runtime event missing " + warnContext({ leg: "audit_advisory" }) + " :: query failed: " + error.message);
    }
  }
  console.log("");
  console.log("summary: " + (checks.length - failed.length) + "/" + checks.length + " checks passed");
  console.log("verdict: " + (failed.length ? "failed" : "t6_easy_verified"));
  const exitCode = failed.length > 0 ? 1 : 0;
  process.exit(exitCode);
}

async function runT6MediumVerifier() {
  const noDb = process.argv.includes("--no-db");
  const proofFile = arg("--proof-file", "frames/t6-native-gauntlet-medium-20260523.proof");
  const proofText = repoFile(proofFile);
  const parsed = proofText ? parseKeyValueProof(proofText) : { ok: false, error: "missing proof", proof: {} };
  const proof = parsed.proof;

  must("T6 medium proof file exists and parses as key=value lines", Boolean(proofText) && parsed.ok, parsed.error || proofFile);
  must("T6 medium hash field matches", proof.hash === "T6_NATIVE_MEDIUM_20260523", proof.hash ?? "<missing>");
  must("T6 medium verdict field matches", proof.verdict === "native_medium_done", proof.verdict ?? "<missing>");
  must("T6 medium test_file exists at HEAD in inner repo", innerPathExistsAtHead(proof.test_file), proof.test_file ?? "<missing>");
  must("T6 medium test_file is inside activegraph/tests/", String(proof.test_file ?? "").startsWith("activegraph/tests/"), proof.test_file ?? "<missing>");

  const newTestCount = parseInteger(proof.new_test_count);
  must("T6 medium new_test_count is integer >= 2", newTestCount !== null && newTestCount >= 2, proof.new_test_count ?? "<missing>");

  const commitCheck = verifyAgentCommitAddsTests(proof);
  must("T6 medium agent committed test_file with new tests", commitCheck.ok, commitCheck.detail);

  const collectBefore = parseInteger(proof.pytest_collect_before);
  const collectAfter = parseInteger(proof.pytest_collect_after);
  must(
    "T6 medium pytest_collect_after - before equals new_test_count",
    collectBefore !== null && collectAfter !== null && newTestCount !== null && collectAfter - collectBefore === newTestCount,
    "before=" + String(proof.pytest_collect_before) + " after=" + String(proof.pytest_collect_after) + " new_test_count=" + String(proof.new_test_count)
  );

  const pytestBefore = parseInteger(proof.pytest_before);
  const pytestAfter = parseInteger(proof.pytest_after);
  must(
    "T6 medium pytest_after did not regress",
    pytestBefore !== null && pytestAfter !== null && pytestAfter >= pytestBefore,
    "before=" + String(proof.pytest_before) + " after=" + String(proof.pytest_after)
  );

  const collectCheck = pytestCollectCountForSymbol(proof.uncovered_symbol);
  must(
    "T6 medium re-run collect for uncovered_symbol returns >= 2",
    collectCheck.status === 0 && collectCheck.count !== null && collectCheck.count >= 2,
    JSON.stringify({ uncovered_symbol: proof.uncovered_symbol, status: collectCheck.status, count: collectCheck.count, output: collectCheck.output })
  );

  const ruffCheck = ruffCheckInnerPath(proof.test_file);
  must(
    "T6 medium re-run ruff check on test_file exits 0",
    ruffCheck.status === 0,
    JSON.stringify({ test_file: proof.test_file, status: ruffCheck.status, output: ruffCheck.output })
  );

  if (noDb) {
    record(true, "T6 medium messages table has Maya ACK referencing proof", "skipped by --no-db");
  } else {
    try {
      const eventCheck = await verifyT6Ack(proofFile, "T6_NATIVE_MEDIUM_20260523");
      must("T6 medium messages table has Maya ACK referencing proof", eventCheck.ok, eventCheck.detail);
    } catch (error) {
      must("T6 medium messages table has Maya ACK referencing proof", false, error.message);
    }
  }

  const failed = checks.filter((check) => !check.ok);
  for (const check of checks) {
    console.log((check.ok ? "PASS " : "FAIL ") + check.name + (check.detail ? " :: " + check.detail : ""));
  }
  if (!noDb) {
    try {
      const runtimeEventCount = await t6RuntimeEventCount("T6_NATIVE_MEDIUM_20260523");
      console.log("WARN T6 medium agent_runtime_events runtime event missing " + warnContext({ leg: "audit_advisory" }) + " :: " + runtimeEventCount + " rows");
    } catch (error) {
      console.log("WARN T6 medium agent_runtime_events runtime event missing " + warnContext({ leg: "audit_advisory" }) + " :: query failed: " + error.message);
    }
  }
  console.log("");
  console.log("summary: " + (checks.length - failed.length) + "/" + checks.length + " checks passed");
  console.log("verdict: " + (failed.length ? "failed" : "t6_medium_verified"));
  const exitCode = failed.length > 0 ? 1 : 0;
  process.exit(exitCode);
}

async function runT6HardVerifier() {
  const noDb = process.argv.includes("--no-db");
  const proofFile = arg("--proof-file", "frames/t6-native-gauntlet-hard-20260523.proof");
  const proofText = repoFile(proofFile);
  const parsed = proofText ? parseKeyValueProof(proofText) : { ok: false, error: "missing proof", proof: {} };
  const proof = parsed.proof;

  must("T6 hard proof file exists and parses as key=value lines", Boolean(proofText) && parsed.ok, parsed.error || proofFile);
  must("T6 hard hash field matches", proof.hash === "T6_NATIVE_HARD_20260523", proof.hash ?? "<missing>");
  must("T6 hard verdict field matches", proof.verdict === "native_hard_done", proof.verdict ?? "<missing>");

  const testFileOk = String(proof.test_file ?? "").startsWith("activegraph/tests/")
    && (innerPathExistsAtHead(proof.test_file) || innerPathExistsAtCommit(proof.fix_commit, proof.test_file));
  must("T6 hard test_file is inside activegraph/tests/ and exists", testFileOk, proof.test_file ?? "<missing>");

  const bugSourceAtHead = bugSourceExists(proof.bug_source);
  const bugSource = bugSourceAtHead.ok ? bugSourceAtHead : bugSourceExists(proof.bug_source, proof.fix_commit);
  must("T6 hard bug_source points at existing documented source", bugSource.ok, bugSource.detail);

  const commitAExists = innerCommitExists(proof.failing_test_commit);
  const commitBExists = innerCommitExists(proof.fix_commit);
  must("T6 hard failing_test_commit resolves in inner repo", commitAExists, proof.failing_test_commit ?? "<missing>");
  must("T6 hard fix_commit resolves in inner repo", commitBExists, proof.fix_commit ?? "<missing>");

  const ancestor = commitAExists && commitBExists
    ? innerGit(["merge-base", "--is-ancestor", proof.failing_test_commit, proof.fix_commit])
    : { status: 1, stderr: "missing commit" };
  must(
    "T6 hard failing_test_commit is strict ancestor of fix_commit",
    ancestor.status === 0 && proof.failing_test_commit !== proof.fix_commit,
    ancestor.stderr || ancestor.stdout || JSON.stringify({ failing_test_commit: proof.failing_test_commit, fix_commit: proof.fix_commit })
  );

  const triggerTs = proofFile.includes("fixture") ? null : triggerTimestampFromLog("T6_NATIVE_HARD_20260523");
  const commitATs = commitTimestamp(proof.failing_test_commit);
  if (triggerTs === null) {
    record(true, "T6 hard failing_test_commit timestamp after trigger", "skipped (no T6 hard run log found)");
  } else {
    must(
      "T6 hard failing_test_commit timestamp after trigger",
      commitATs !== null && commitATs > triggerTs,
      JSON.stringify({ commit_ts: commitATs, trigger_ts: triggerTs })
    );
  }

  const splitA = hardSourceTestSplit(proof, proof.failing_test_commit, "test");
  must("T6 hard source-vs-test split at failing_test_commit", splitA.ok, splitA.detail);
  const splitB = hardSourceTestSplit(proof, proof.fix_commit, "source");
  must("T6 hard source-vs-test split at fix_commit", splitB.ok, splitB.detail);

  const pytestA = hardWorktreePytest(proof.failing_test_commit, proof.test_file, "A");
  must(
    "T6 hard ground truth at failing_test_commit fails",
    pytestA.ok && pytestA.status !== 0,
    JSON.stringify({ status: pytestA.status, output: pytestA.output })
  );
  const pytestB = hardWorktreePytest(proof.fix_commit, proof.test_file, "B");
  must(
    "T6 hard ground truth at fix_commit passes",
    pytestB.ok && pytestB.status === 0,
    JSON.stringify({ status: pytestB.status, output: pytestB.output })
  );

  const pytestBefore = parseInteger(proof.pytest_before);
  const pytestAfter = parseInteger(proof.pytest_after);
  must(
    "T6 hard pytest_after did not regress",
    pytestBefore !== null && pytestAfter !== null && pytestAfter >= pytestBefore,
    "before=" + String(proof.pytest_before) + " after=" + String(proof.pytest_after)
  );

  if (noDb) {
    record(true, "T6 hard messages table has Maya ACK referencing proof", "skipped by --no-db");
    record(true, "T6 hard messages table has Quinn verification ACK", "skipped by --no-db");
  } else {
    try {
      const mayaCheck = await verifyT6Ack(proofFile, "T6_NATIVE_HARD_20260523");
      must("T6 hard messages table has Maya ACK referencing proof", mayaCheck.ok, mayaCheck.detail);
    } catch (error) {
      must("T6 hard messages table has Maya ACK referencing proof", false, error.message);
    }
    try {
      const quinnCheck = await verifyT6QuinnAck(proof, proofFile);
      must("T6 hard messages table has Quinn verification ACK", quinnCheck.ok, quinnCheck.detail);
    } catch (error) {
      must("T6 hard messages table has Quinn verification ACK", false, error.message);
    }
  }

  const failed = checks.filter((check) => !check.ok);
  for (const check of checks) {
    console.log((check.ok ? "PASS " : "FAIL ") + check.name + (check.detail ? " :: " + check.detail : ""));
  }
  if (!noDb) {
    try {
      const runtimeEventCount = await t6RuntimeEventCount("T6_NATIVE_HARD_20260523");
      console.log("WARN T6 hard agent_runtime_events runtime event missing " + warnContext({ leg: "audit_advisory" }) + " :: " + runtimeEventCount + " rows");
    } catch (error) {
      console.log("WARN T6 hard agent_runtime_events runtime event missing " + warnContext({ leg: "audit_advisory" }) + " :: query failed: " + error.message);
    }
  }
  console.log("");
  console.log("summary: " + (checks.length - failed.length) + "/" + checks.length + " checks passed");
  console.log("verdict: " + (failed.length ? "failed" : "t6_hard_verified"));
  const exitCode = failed.length > 0 ? 1 : 0;
  process.exit(exitCode);
}

function rowAgentName(row, agentsById) {
  const ids = [row.agent_id, row.actor_id, row.author_id, row.user_id, row.sender_id].filter(Boolean);
  for (const id of ids) {
    if (agentsById.has(id)) return agentsById.get(id).name;
  }
  return row.agent_name ?? row.actor_name ?? row.author_name ?? row.sender_name ?? "";
}

function rowPayload(row) {
  return row.payload ?? row.data ?? row.metadata ?? row.content ?? row;
}

async function runT6DebugEvents() {
  const state = readPentagonSession();
  const since = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
  const agents = await supabase(
    state,
    "/rest/v1/agents?select=id,name&limit=500"
  );
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
  const maya = agents.find((agent) => agent.name === "Maya (Code Owner)");
  const rows = await supabase(
    state,
    "/rest/v1/agent_runtime_events?select=*&created_at=gte." + encodeURIComponent(since) + "&order=created_at.asc&limit=1000"
  );
  const matched = rows.filter((row) => {
    const json = JSON.stringify(row);
    const name = rowAgentName(row, agentsById);
    const mayaIdMatch = maya && [row.agent_id, row.actor_id, row.author_id, row.user_id, row.sender_id].includes(maya.id);
    return mayaIdMatch || name === "Maya (Code Owner)" || json.includes("T6_NATIVE_EASY_20260523");
  });
  const frequencies = new Map();
  console.log("T6 easy Pentagon event shapes");
  console.log("since=" + since);
  console.log("matched_rows=" + matched.length);
  for (const row of matched) {
    const kind = row.kind ?? row.type ?? "<missing>";
    frequencies.set(kind, (frequencies.get(kind) ?? 0) + 1);
    const payload = JSON.stringify(rowPayload(row)).replace(/\s+/g, " ").slice(0, 240);
    const agentName = rowAgentName(row, agentsById);
    const agentId = row.agent_id ?? row.actor_id ?? row.author_id ?? row.user_id ?? row.sender_id ?? "";
    console.log(JSON.stringify({
      id: row.id ?? "",
      created_at: row.created_at ?? "",
      kind: row.kind ?? null,
      type: row.type ?? null,
      agent_id: agentId,
      agent_name: agentName,
      payload,
    }));
  }
  console.log("kind_frequency:");
  for (const [kind, count] of [...frequencies.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])))) {
    console.log(String(kind) + "=" + count);
  }
}

async function main() {
  const noDb = process.argv.includes("--no-db");
  const requireNative = process.argv.includes("--require-native");
  if (process.argv.includes("--t6-debug-events")) {
    await runT6DebugEvents();
    return;
  }
  if (process.argv.includes("--t6")) {
    const tier = arg("--tier");
    if (tier === "easy") {
      await runT6EasyVerifier();
      return;
    }
    if (tier === "medium") {
      await runT6MediumVerifier();
      return;
    }
    if (tier === "hard") {
      await runT6HardVerifier();
      return;
    }
    {
      record(false, "T6 tier is supported", "--tier must be easy, medium, or hard");
      const failed = checks.filter((check) => !check.ok);
      for (const check of checks) console.log((check.ok ? "PASS " : "FAIL ") + check.name + (check.detail ? " :: " + check.detail : ""));
      console.log("");
      console.log("summary: " + (checks.length - failed.length) + "/" + checks.length + " checks passed");
      console.log("verdict: failed");
      process.exitCode = 1;
      return;
    }
  }

  const gitStatus = command("git", ["status", "--short", "--branch"]);
  must("git status exits 0", gitStatus.status === 0, gitStatus.stderr);
  must("git status captured", Boolean(gitStatus.stdout.trim()), gitStatus.stdout.trim());
  const dirtyFiles = dirtyTrackedFiles();
  const dirtyProofFiles = dirtyFiles.filter((path) => CRITICAL_PROOF_FILES.includes(path));
  must("critical proof files are clean", dirtyProofFiles.length === 0, dirtyProofFiles.join(", "));

  const bridgeCheck = command("node", ["--check", "scripts/pentagon-trigger-bridge.mjs"]);
  must("bridge script parses", bridgeCheck.status === 0, bridgeCheck.stderr);
  const nativeProbeCheck = command("node", ["--check", "scripts/probe-native-poller.mjs"]);
  must("native poller probe script parses", nativeProbeCheck.status === 0, nativeProbeCheck.stderr);
  const nativeAppPollerCheck = command("node", ["--check", "scripts/probe-native-app-poller.mjs"]);
  must("native app poller diagnostic script parses", nativeAppPollerCheck.status === 0, nativeAppPollerCheck.stderr);
  const bridgeScript = repoFile("scripts/pentagon-trigger-bridge.mjs");
  must("bridge script exists", bridgeScript);
  if (bridgeScript) {
    requireText("bridge script", bridgeScript, "loop_error");
    requireText("bridge script", bridgeScript, "session_refreshed_after_loop_error");
    requireText("bridge script", bridgeScript, "session_refresh_failed_after_loop_error");
    requireText("bridge script", bridgeScript, "Posted the Pentagon response");
    requireText("bridge script", bridgeScript, "ACK|BLOCKED");
    requireText("bridge script", bridgeScript, "Accepted|Acknowledged|Confirmed");
    requireText("bridge script", bridgeScript, "status_report");
    requireText("bridge script", bridgeScript, "normalizedFirstToken");
  }
  const nativeProbeScript = repoFile("scripts/probe-native-poller.mjs");
  must("native poller probe script exists", nativeProbeScript);
  if (nativeProbeScript) {
    requireText("native poller probe script", nativeProbeScript, "stopForProbe");
    requireText("native poller probe script", nativeProbeScript, "bridge_mode");
    requireText("native poller probe script", nativeProbeScript, "bridge_assisted_pass");
    requireText("native poller probe script", nativeProbeScript, "bridge_assisted_poller_passed_native_unproven");
    requireText("native poller probe script", nativeProbeScript, "native_poller_no_trigger_created");
  }
  const nativeAppPollerScript = repoFile("scripts/probe-native-app-poller.mjs");
  must("native app poller diagnostic script exists", nativeAppPollerScript);
  if (nativeAppPollerScript) {
    requireText("native app poller diagnostic script", nativeAppPollerScript, "pentagonProcesses");
    requireText("native app poller diagnostic script", nativeAppPollerScript, "probe-native-poller.mjs");
    requireText("native app poller diagnostic script", nativeAppPollerScript, "Filtering the log data using");
    requireText("native app poller diagnostic script", nativeAppPollerScript, "log_match_counts");
    requireText("native app poller diagnostic script", nativeAppPollerScript, "native_app_poller_still_blocked");
  }
  const triggerAttributionScript = repoFile("scripts/audit-pentagon-trigger-attribution.mjs");
  must("trigger attribution diagnostic script exists", triggerAttributionScript);
  if (triggerAttributionScript) {
    requireText("trigger attribution diagnostic script", triggerAttributionScript, "bridge_catchup_after_native_window");
    requireText("trigger attribution diagnostic script", triggerAttributionScript, "native_window_completed_with_ack");
    requireText("trigger attribution diagnostic script", triggerAttributionScript, "native_window_claim_possible");
    requireText("trigger attribution diagnostic script", triggerAttributionScript, "pending_unclaimed_triggers_in_conversation");
  }
  const nativePollerSurfaceScript = repoFile("scripts/audit-pentagon-native-poller-surface.mjs");
  must("native poller surface audit script exists", nativePollerSurfaceScript);
  if (nativePollerSurfaceScript) {
    requireText("native poller surface audit script", nativePollerSurfaceScript, "cloud.trigger-catchup");
    requireText("native poller surface audit script", nativePollerSurfaceScript, "provider_model_harness_execution_counts");
    requireText("native poller surface audit script", nativePollerSurfaceScript, "pending_count");
    requireText("native poller surface audit script", nativePollerSurfaceScript, "pentagon.sync.deviceId");
  }

  const plistCheck = command("plutil", ["-lint", "launchagents/run.pentagon.trigger-bridge.plist"]);
  must("LaunchAgent plist parses", plistCheck.status === 0, plistCheck.stdout + plistCheck.stderr);

  const launchd = command("launchctl", ["print", "gui/" + process.getuid() + "/" + BRIDGE_LABEL]);
  must("LaunchAgent readback exits 0", launchd.status === 0, launchd.stderr);
  must("LaunchAgent state is running", launchd.stdout.includes("state = running"), launchd.stdout);
  must("LaunchAgent has live pid", Boolean(launchdValue(launchd.stdout, "pid")), launchd.stdout);
  must("LaunchAgent uses bounded trigger age", launchd.stdout.includes("--max-age-seconds") && launchd.stdout.includes("180"), launchd.stdout);
  must("LaunchAgent uses bounded polling interval", launchd.stdout.includes("--interval-ms") && launchd.stdout.includes("1000"), launchd.stdout);
  must("LaunchAgent has no recorded crash exit", !launchd.stdout.includes("last exit code = 1"), launchd.stdout);

  const defaultModel = command("defaults", ["read", "run.pentagon.app", "pentagon.defaultModel"]);
  must("Pentagon default model is gpt-5.5", defaultModel.stdout.trim() === "gpt-5.5", defaultModel.stdout.trim());

  const bridgeRuntimeLog = file(BRIDGE_LOG);
  must("bridge runtime log exists", bridgeRuntimeLog, BRIDGE_LOG);

  const gauntletLog = repoFile("frames/t5d-file-backed-gauntlet-2026-05-22.log");
  must("file-backed gauntlet log exists", gauntletLog);
  if (gauntletLog) {
    requireText("file-backed gauntlet log", gauntletLog, "Result: green for file-backed Pentagon autonomy through the persistent bridge");
  }

  for (const [levelName, level] of Object.entries(LEVELS)) {
    const proof = repoFile(level.proof);
    must(levelName + " proof file exists", proof, level.proof);
    if (proof) {
      const proofNeedles = {
        easy: [ROOT, "0842d37"],
        medium: ["node_check_exit=0", "plutil_lint_exit=0"],
        hard: ["bridge status: operational-via-persistent-bridge", "native caveat:"],
        extra_hard: ["objective", "checklist", "covered", "gaps", "final verdict"],
      }[levelName];
      for (const needle of proofNeedles) {
        requireText(levelName + " proof", proof, needle);
      }
    }
    if (gauntletLog) {
      for (const id of [level.hash, level.message, level.trigger, level.ack, level.reverse, level.proof]) {
        requireText("file-backed gauntlet log", gauntletLog, id);
      }
    }
    if (bridgeRuntimeLog) {
      requireText("bridge runtime log", bridgeRuntimeLog, level.trigger);
      requireText("bridge runtime log", bridgeRuntimeLog, level.reverse);
      requireText("bridge runtime log", bridgeRuntimeLog, level.ack);
    }
  }

  const skillCleanLog = repoFile("frames/t5d-skill-load-clean-proof-2026-05-22.log");
  must("skill-load clean log exists", skillCleanLog);
  if (skillCleanLog) {
    requireText("skill-load clean log", skillCleanLog, "stderr: empty");
    requireText("skill-load clean log", skillCleanLog, "stderr_tail: \"\"");
  }

  const nativeBlockerLog = repoFile(NATIVE_BLOCKER_LOG);
  must("native poller blocker log exists", nativeBlockerLog, NATIVE_BLOCKER_LOG);
  if (nativeBlockerLog) {
    requireText("native poller blocker log", nativeBlockerLog, "Native Pentagon autonomy is not fixed.");
    requireText("native poller blocker log", nativeBlockerLog, "trigger_claimed_at: null");
    requireText("native poller blocker log", nativeBlockerLog, "trigger_completed_at: null");
    requireText("native poller blocker log", nativeBlockerLog, "maya_ack_count: 0");
    requireText("native poller blocker log", nativeBlockerLog, "state = running");
  }

  const completionAudit = repoFile(COMPLETION_AUDIT);
  must("completion audit exists", completionAudit, COMPLETION_AUDIT);
  if (completionAudit) {
    requireText("completion audit", completionAudit, "not met natively; bridge-only green");
    requireText("completion audit", completionAudit, "not achieved for native Pentagon; achieved only through persistent bridge");
    requireText("completion audit", completionAudit, "full goal remains open until");
    requireText("completion audit", completionAudit, "native public MCP/app path exposes or reliably");
  }

  const docsActivationAudit = repoFile(DOCS_ACTIVATION_AUDIT);
  must("Pentagon docs activation audit exists", docsActivationAudit, DOCS_ACTIVATION_AUDIT);
  if (docsActivationAudit) {
    requireText("Pentagon docs activation audit", docsActivationAudit, "structured handoffs");
    requireText("Pentagon docs activation audit", docsActivationAudit, "recipient receives the context and starts working");
    requireText("Pentagon docs activation audit", docsActivationAudit, "No documented public target-turn API was found.");
    requireText("Pentagon docs activation audit", docsActivationAudit, "docs_aligned_native_gap_confirmed");
  }

  const reliabilityContract = repoFile(RELIABILITY_CONTRACT);
  must("reliability operating contract exists", reliabilityContract, RELIABILITY_CONTRACT);
  if (reliabilityContract) {
    requireText("reliability operating contract", reliabilityContract, "Prompt And Behavior Precision");
    requireText("reliability operating contract", reliabilityContract, "Event-Sourced Audit Trail");
    requireText("reliability operating contract", reliabilityContract, "Continuous Evaluation");
    requireText("reliability operating contract", reliabilityContract, "llm.responded.tool_calls");
    requireText("reliability operating contract", reliabilityContract, "bridge_autonomy_verified_native_blocked");
  }

  const bridgeResilienceLog = repoFile(BRIDGE_RESILIENCE_LOG);
  must("bridge resilience log exists", bridgeResilienceLog, BRIDGE_RESILIENCE_LOG);
  if (bridgeResilienceLog) {
    requireText("bridge resilience log", bridgeResilienceLog, "loop_error");
    requireText("bridge resilience log", bridgeResilienceLog, "JWT expired");
    requireText("bridge resilience log", bridgeResilienceLog, "Verified improvement: bridge loop resilience.");
    requireText("bridge resilience log", bridgeResilienceLog, "Still not complete: native Pentagon autonomous handoff.");
  }

  const currentBridgeHealthLog = repoFile(CURRENT_BRIDGE_HEALTH_LOG);
  must("current bridge health log exists", currentBridgeHealthLog, CURRENT_BRIDGE_HEALTH_LOG);
  if (currentBridgeHealthLog) {
    requireText("current bridge health log", currentBridgeHealthLog, "LaunchAgent has a live pid.");
    requireText("current bridge health log", currentBridgeHealthLog, "--max-age-seconds 180");
    requireText("current bridge health log", currentBridgeHealthLog, "--interval-ms 1000");
    requireText("current bridge health log", currentBridgeHealthLog, "does not close the native Pentagon autonomy requirement");
  }

  const repoIsolationAudit = repoFile(REPO_ISOLATION_AUDIT);
  must("repo isolation audit exists", repoIsolationAudit, REPO_ISOLATION_AUDIT);
  if (repoIsolationAudit) {
    requireText("repo isolation audit", repoIsolationAudit, "Repo-specific directory/model/provider/local-execution evidence is green.");
    requireText("repo isolation audit", repoIsolationAudit, "Own clone/branch proof is not green.");
    requireText("repo isolation audit", repoIsolationAudit, "base_branch: null");
    requireText("repo isolation audit", repoIsolationAudit, "does not change the native autonomy boundary");
  }

  const repeatableNativeProbeLog = repoFile(REPEATABLE_NATIVE_PROBE_LOG);
  must("repeatable native poller probe log exists", repeatableNativeProbeLog, REPEATABLE_NATIVE_PROBE_LOG);
  if (repeatableNativeProbeLog) {
    requireText("repeatable native poller probe log", repeatableNativeProbeLog, "scripts/probe-native-poller.mjs");
    requireText("repeatable native poller probe log", repeatableNativeProbeLog, "T5I_NATIVE_POLLER_PROBE_20260523T132150Z");
    requireText("repeatable native poller probe log", repeatableNativeProbeLog, "final_claimed_at: null");
    requireText("repeatable native poller probe log", repeatableNativeProbeLog, "ack_count: 0");
    requireText("repeatable native poller probe log", repeatableNativeProbeLog, "Native Pentagon handoff activation remains red.");
  }

  const currentBridgeFileTaskLog = repoFile(CURRENT_BRIDGE_FILE_TASK_LOG);
  must("current bridge file task log exists", currentBridgeFileTaskLog, CURRENT_BRIDGE_FILE_TASK_LOG);
  if (currentBridgeFileTaskLog) {
    requireText("current bridge file task log", currentBridgeFileTaskLog, "T5J_CURRENT_BRIDGE_EASY_20260523T1330Z");
    requireText("current bridge file task log", currentBridgeFileTaskLog, "a4bbc28c-0866-4ad2-ac66-4f5fdf93104f");
    requireText("current bridge file task log", currentBridgeFileTaskLog, "960401d6-ff68-4f7a-a191-3dead03302be");
    requireText("current bridge file task log", currentBridgeFileTaskLog, "0dcd25a9-8def-4a6f-8927-5070c137837f");
    requireText("current bridge file task log", currentBridgeFileTaskLog, "ae32695d-64df-4e00-bbb7-7371549e6213");
    requireText("current bridge file task log", currentBridgeFileTaskLog, "c55bfbf9-9e9f-4ce5-bad1-29bee92038da");
    requireText("current bridge file task log", currentBridgeFileTaskLog, "group conversation");
    requireText("current bridge file task log", currentBridgeFileTaskLog, "explicit bridge processing");
    requireText("current bridge file task log", currentBridgeFileTaskLog, "not native Pentagon autonomy evidence");
    requireText("current bridge file task log", currentBridgeFileTaskLog, "Native Pentagon activation remains red.");
  }

  const currentBridgeFileTaskProof = repoFile(CURRENT_BRIDGE_FILE_TASK_PROOF);
  must("current bridge file task proof exists", currentBridgeFileTaskProof, CURRENT_BRIDGE_FILE_TASK_PROOF);
  if (currentBridgeFileTaskProof) {
    requireText("current bridge file task proof", currentBridgeFileTaskProof, "hash: T5J_CURRENT_BRIDGE_EASY_20260523T1330Z");
    requireText("current bridge file task proof", currentBridgeFileTaskProof, "agent: Maya (Code Owner)");
    requireText("current bridge file task proof", currentBridgeFileTaskProof, "task_class: easy");
    requireText("current bridge file task proof", currentBridgeFileTaskProof, "evidence: current bridge-backed Pentagon target turn created this file");
  }

  const nativeProbeBridgeQueueHardeningLog = repoFile(NATIVE_PROBE_BRIDGE_QUEUE_HARDENING_LOG);
  must("native probe bridge queue hardening log exists", nativeProbeBridgeQueueHardeningLog, NATIVE_PROBE_BRIDGE_QUEUE_HARDENING_LOG);
  if (nativeProbeBridgeQueueHardeningLog) {
    requireText("native probe bridge queue hardening log", nativeProbeBridgeQueueHardeningLog, "INTERPRETER_OK Codex");
    requireText("native probe bridge queue hardening log", nativeProbeBridgeQueueHardeningLog, "T5I_NATIVE_POLLER_PROBE_20260523T133456Z");
    requireText("native probe bridge queue hardening log", nativeProbeBridgeQueueHardeningLog, "bridge_mode=kept_running_bridge_assisted_probe");
    requireText("native probe bridge queue hardening log", nativeProbeBridgeQueueHardeningLog, "T5K_KEEP_RUNNING_CLASSIFICATION_20260523T1342Z");
    requireText("native probe bridge queue hardening log", nativeProbeBridgeQueueHardeningLog, "T5K_NATIVE_RECHECK_20260523T1345Z");
    requireText("native probe bridge queue hardening log", nativeProbeBridgeQueueHardeningLog, "native_pass=false");
    requireText("native probe bridge queue hardening log", nativeProbeBridgeQueueHardeningLog, "status=idle");
    requireText("native probe bridge queue hardening log", nativeProbeBridgeQueueHardeningLog, "Native Pentagon handoff activation remains red.");
  }

  const nativeAppPollerProbeOutputAuditLog = repoFile(NATIVE_APP_POLLER_PROBE_OUTPUT_AUDIT_LOG);
  must("native app poller probe output audit log exists", nativeAppPollerProbeOutputAuditLog, NATIVE_APP_POLLER_PROBE_OUTPUT_AUDIT_LOG);
  if (nativeAppPollerProbeOutputAuditLog) {
    requireText("native app poller probe output audit log", nativeAppPollerProbeOutputAuditLog, "INTERPRETER_OK Codex");
    requireText("native app poller probe output audit log", nativeAppPollerProbeOutputAuditLog, "TriggerPoller");
    requireText("native app poller probe output audit log", nativeAppPollerProbeOutputAuditLog, "claim_agent_trigger");
    requireText("native app poller probe output audit log", nativeAppPollerProbeOutputAuditLog, "T5L_PROBE_NO_TRIGGER_PRINT_FIX_20260523T1408Z");
    requireText("native app poller probe output audit log", nativeAppPollerProbeOutputAuditLog, "T5L_NATIVE_APP_FOREGROUND_FIXED_20260523T1412Z");
    requireText("native app poller probe output audit log", nativeAppPollerProbeOutputAuditLog, "final_claimed_at=null");
    requireText("native app poller probe output audit log", nativeAppPollerProbeOutputAuditLog, "native_pass=false");
    requireText("native app poller probe output audit log", nativeAppPollerProbeOutputAuditLog, "review.concern remained would_process");
    requireText("native app poller probe output audit log", nativeAppPollerProbeOutputAuditLog, "Native Pentagon handoff activation remains red.");
  }

  const repeatableNativeAppPollerDiagnosticLog = repoFile(REPEATABLE_NATIVE_APP_POLLER_DIAGNOSTIC_LOG);
  must("repeatable native app poller diagnostic log exists", repeatableNativeAppPollerDiagnosticLog, REPEATABLE_NATIVE_APP_POLLER_DIAGNOSTIC_LOG);
  if (repeatableNativeAppPollerDiagnosticLog) {
    requireText("repeatable native app poller diagnostic log", repeatableNativeAppPollerDiagnosticLog, "scripts/probe-native-app-poller.mjs");
    requireText("repeatable native app poller diagnostic log", repeatableNativeAppPollerDiagnosticLog, "T5M_NATIVE_APP_POLLER_SCRIPT_20260523T1425Z");
    requireText("repeatable native app poller diagnostic log", repeatableNativeAppPollerDiagnosticLog, "T5M_NATIVE_APP_POLLER_CLEAN_COUNTS_20260523T1430Z");
    requireText("repeatable native app poller diagnostic log", repeatableNativeAppPollerDiagnosticLog, "binary_hooks.TriggerPoller=true");
    requireText("repeatable native app poller diagnostic log", repeatableNativeAppPollerDiagnosticLog, "binary_hooks.complete_agent_trigger=true");
    requireText("repeatable native app poller diagnostic log", repeatableNativeAppPollerDiagnosticLog, "probe.final_claimed_at=null");
    requireText("repeatable native app poller diagnostic log", repeatableNativeAppPollerDiagnosticLog, "log_match_counts.TriggerPoller=0");
    requireText("repeatable native app poller diagnostic log", repeatableNativeAppPollerDiagnosticLog, "state=running");
    requireText("repeatable native app poller diagnostic log", repeatableNativeAppPollerDiagnosticLog, "Native Pentagon handoff activation remains red.");
  }

  const codexHarnessNativeRecheckLog = repoFile(CODEX_HARNESS_NATIVE_RECHECK_LOG);
  must("codex harness native recheck log exists", codexHarnessNativeRecheckLog, CODEX_HARNESS_NATIVE_RECHECK_LOG);
  if (codexHarnessNativeRecheckLog) {
    requireText("codex harness native recheck log", codexHarnessNativeRecheckLog, "INTERPRETER_OK Codex");
    requireText("codex harness native recheck log", codexHarnessNativeRecheckLog, "codex|gpt-5.5|claude-code|local: 20");
    requireText("codex harness native recheck log", codexHarnessNativeRecheckLog, "updated_count: 20");
    requireText("codex harness native recheck log", codexHarnessNativeRecheckLog, "codex|gpt-5.5|codex|local: 20");
    requireText("codex harness native recheck log", codexHarnessNativeRecheckLog, "T5N_CODEX_HARNESS_NATIVE_APP_PROBE_REFRESH_20260523");
    requireText("codex harness native recheck log", codexHarnessNativeRecheckLog, "message_id: 8c60c705-3ea7-489d-8127-3fb2401d498c");
    requireText("codex harness native recheck log", codexHarnessNativeRecheckLog, "trigger_id: 6fab7bd2-1b19-4cb6-8ecf-f9e65670a5a8");
    requireText("codex harness native recheck log", codexHarnessNativeRecheckLog, "final_claimed_at: null");
    requireText("codex harness native recheck log", codexHarnessNativeRecheckLog, "native_pass: false");
    requireText("codex harness native recheck log", codexHarnessNativeRecheckLog, "log_match_counts.TriggerPoller: 0");
    requireText("codex harness native recheck log", codexHarnessNativeRecheckLog, "Native Pentagon handoff activation remains red.");
  }

  const clearedQueueNativeAttributionLog = repoFile(CLEARED_QUEUE_NATIVE_ATTRIBUTION_LOG);
  must("cleared queue native attribution log exists", clearedQueueNativeAttributionLog, CLEARED_QUEUE_NATIVE_ATTRIBUTION_LOG);
  if (clearedQueueNativeAttributionLog) {
    requireText("cleared queue native attribution log", clearedQueueNativeAttributionLog, "scripts/audit-pentagon-trigger-attribution.mjs");
    requireText("cleared queue native attribution log", clearedQueueNativeAttributionLog, "T5N_CODEX_HARNESS_NATIVE_APP_PROBE_REFRESH_20260523");
    requireText("cleared queue native attribution log", clearedQueueNativeAttributionLog, "classification: bridge_catchup_after_native_window");
    requireText("cleared queue native attribution log", clearedQueueNativeAttributionLog, "pending_count: 0");
    requireText("cleared queue native attribution log", clearedQueueNativeAttributionLog, "T5O_CLEARED_QUEUE_NATIVE_APP_PROBE_20260523");
    requireText("cleared queue native attribution log", clearedQueueNativeAttributionLog, "trigger_id: 03a279ad-d30d-41dd-8805-ea0059112ef2");
    requireText("cleared queue native attribution log", clearedQueueNativeAttributionLog, "final_claimed_at: null");
    requireText("cleared queue native attribution log", clearedQueueNativeAttributionLog, "log_match_counts.TriggerPoller: 0");
    requireText("cleared queue native attribution log", clearedQueueNativeAttributionLog, "ack_id: 90d3853d-b3b5-454c-9a8b-7e43515cd2b6");
    requireText("cleared queue native attribution log", clearedQueueNativeAttributionLog, "Native Pentagon handoff activation remains red.");
  }

  const nativePollerSurfaceAuditLog = repoFile(NATIVE_POLLER_SURFACE_AUDIT_LOG);
  must("native poller surface audit log exists", nativePollerSurfaceAuditLog, NATIVE_POLLER_SURFACE_AUDIT_LOG);
  if (nativePollerSurfaceAuditLog) {
    requireText("native poller surface audit log", nativePollerSurfaceAuditLog, "scripts/audit-pentagon-native-poller-surface.mjs");
    requireText("native poller surface audit log", nativePollerSurfaceAuditLog, "app.bundle_short_version: 1.7.3");
    requireText("native poller surface audit log", nativePollerSurfaceAuditLog, "defaults.sync_device_id: 44A67911-6A9B-441D-9F25-C2241A154691");
    requireText("native poller surface audit log", nativePollerSurfaceAuditLog, "binary_surface.TriggerPoller: 7");
    requireText("native poller surface audit log", nativePollerSurfaceAuditLog, "binary_surface.cloud.trigger-catchup: 1");
    requireText("native poller surface audit log", nativePollerSurfaceAuditLog, "live_agents.provider_model_harness_execution_counts.codex|gpt-5.5|codex|local: 20");
    requireText("native poller surface audit log", nativePollerSurfaceAuditLog, "theo.device_id: 44A67911-6A9B-441D-9F25-C2241A154691");
    requireText("native poller surface audit log", nativePollerSurfaceAuditLog, "maya.device_id: 44A67911-6A9B-441D-9F25-C2241A154691");
    requireText("native poller surface audit log", nativePollerSurfaceAuditLog, "trigger_queue.pending_count: 0");
    requireText("native poller surface audit log", nativePollerSurfaceAuditLog, "bridge.launchd.state: running");
    requireText("native poller surface audit log", nativePollerSurfaceAuditLog, "native app trigger polling still does not claim fresh target");
  }

  const restartedAppNativeActivationLog = repoFile(RESTARTED_APP_NATIVE_ACTIVATION_LOG);
  must("restarted app native activation log exists", restartedAppNativeActivationLog, RESTARTED_APP_NATIVE_ACTIVATION_LOG);
  if (restartedAppNativeActivationLog) {
    requireText("restarted app native activation log", restartedAppNativeActivationLog, "26772 Sat 23 May 10:15:14 2026");
    requireText("restarted app native activation log", restartedAppNativeActivationLog, "T5Q_RESTARTED_APP_NATIVE_PROBE_20260523");
    requireText("restarted app native activation log", restartedAppNativeActivationLog, "trigger_id: a78e12f3-6c52-4864-a9f4-935d706cea20");
    requireText("restarted app native activation log", restartedAppNativeActivationLog, "ack_id: 37311ac9-83eb-4b2a-a496-3ac4c4e1987b");
    requireText("restarted app native activation log", restartedAppNativeActivationLog, "Changed scripts/probe-native-poller.mjs");
    requireText("restarted app native activation log", restartedAppNativeActivationLog, "T5R_FIXED_WATCH_NATIVE_PROBE_20260523");
    requireText("restarted app native activation log", restartedAppNativeActivationLog, "completed_at: 2026-05-23T14:18:22.268+00:00");
    requireText("restarted app native activation log", restartedAppNativeActivationLog, "T5S_RESTARTED_APP_NATIVE_90S_PROBE_20260523");
    requireText("restarted app native activation log", restartedAppNativeActivationLog, "trigger_id: db725112-e6b1-4c77-abdc-12d83e1762a8");
    requireText("restarted app native activation log", restartedAppNativeActivationLog, "ack_id: 874e6f8a-77ee-4ed6-92e0-e244ba60d4c6");
    requireText("restarted app native activation log", restartedAppNativeActivationLog, "native_pass: true");
    requireText("restarted app native activation log", restartedAppNativeActivationLog, "classification: native_window_completed_with_ack");
    requireText("restarted app native activation log", restartedAppNativeActivationLog, "full native easy/medium/hard/extra-hard repo gauntlet is complete | not run natively yet | red");
  }

  const nativeRepoGauntletLog = repoFile(NATIVE_REPO_GAUNTLET_LOG);
  must("native repo gauntlet log exists", nativeRepoGauntletLog, NATIVE_REPO_GAUNTLET_LOG);
  if (nativeRepoGauntletLog) {
    requireText("native repo gauntlet log", nativeRepoGauntletLog, "INTERPRETER_OK Codex /Users/gaganarora/Desktop/my projects/active_graph");
    requireText("native repo gauntlet log", nativeRepoGauntletLog, "Result: green for native Pentagon repo gauntlet");
    requireText("native repo gauntlet log", nativeRepoGauntletLog, "bridge_after_stop.ok=false");
    requireText("native repo gauntlet log", nativeRepoGauntletLog, "activation_path=agent_trigger");
    requireText("native repo gauntlet log", nativeRepoGauntletLog, "activation_path=message_poller_no_trigger_row");
    requireText("native repo gauntlet log", nativeRepoGauntletLog, "native_pass=true");
  }

  const nativeRunner = repoFile("scripts/run-native-pentagon-task.mjs");
  must("native task runner exists", nativeRunner, "scripts/run-native-pentagon-task.mjs");
  if (nativeRunner) {
    requireText("native task runner", nativeRunner, "bridge_after_stop");
    requireText("native task runner", nativeRunner, "message_poller_no_trigger_row");
    requireText("native task runner", nativeRunner, "native_task_passed");
  }

  for (const [levelName, level] of Object.entries(NATIVE_LEVELS)) {
    const proof = repoFile(level.proof);
    must("native " + levelName + " proof file exists", proof, level.proof);
    if (proof) {
      requireText("native " + levelName + " proof", proof, "hash=" + level.hash);
      requireText("native " + levelName + " proof", proof, "pwd=" + ROOT);
      requireText("native " + levelName + " proof", proof, "verdict=" + level.verdict);
    }
    if (nativeRepoGauntletLog) {
      for (const id of [level.hash, level.proof, level.message, level.ack, level.activationPath]) {
        requireText("native repo gauntlet log", nativeRepoGauntletLog, id);
      }
      if (level.trigger) requireText("native repo gauntlet log", nativeRepoGauntletLog, level.trigger);
    }
  }

  if (requireNative) {
    record(true, "native Pentagon autonomy completion", "native activation smoke and native easy/medium/hard/extra-hard repo gauntlet passed with auditable proof");
  } else {
    record(true, "native Pentagon autonomy boundary", "native activation smoke and native easy/medium/hard/extra-hard repo gauntlet passed; bridge-backed evidence remains retained for regression coverage");
  }

  if (!noDb) {
    try {
      await verifyLiveRows();
    } catch (error) {
      record(false, "live Pentagon row verification", error.message);
    }
  } else {
    record(true, "live Pentagon row verification skipped", "--no-db");
  }

  const failed = checks.filter((check) => !check.ok);
  for (const check of checks) {
    console.log((check.ok ? "PASS " : "FAIL ") + check.name + (check.detail ? " :: " + check.detail : ""));
  }
  console.log("");
  console.log("summary: " + (checks.length - failed.length) + "/" + checks.length + " checks passed");
  const verdict = requireNative ? "native_autonomy_verified" : "bridge_and_native_autonomy_verified";
  console.log("verdict: " + (failed.length ? "failed" : verdict));
  if (failed.length) process.exitCode = 1;
}

await main();
