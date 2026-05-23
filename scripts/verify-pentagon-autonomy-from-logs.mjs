#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

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
  "scripts/pentagon-trigger-bridge.mjs",
  "scripts/probe-native-poller.mjs",
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

  const agents = await supabase(
    state,
    "/rest/v1/agents?select=id,name,provider,model,directory,execution_mode,base_directory,base_branch,deleted_at&deleted_at=is.null&limit=200"
  );
  const activeGraphAgents = agents.filter((agent) => agent.directory === ROOT);
  const wrongModels = activeGraphAgents.filter((agent) => agent.model !== "gpt-5.5");
  const wrongProviders = activeGraphAgents.filter((agent) => agent.provider !== "codex");
  const wrongExecutionModes = activeGraphAgents.filter((agent) => agent.execution_mode !== "local");
  const branchMetadataRows = activeGraphAgents.filter((agent) => agent.base_directory || agent.base_branch);
  must("live DB active_graph agent rows present", activeGraphAgents.length >= 20, "count=" + activeGraphAgents.length);
  must("live DB active_graph agent rows have exact repo directory", activeGraphAgents.every((agent) => agent.directory === ROOT), JSON.stringify(activeGraphAgents.map((agent) => ({ name: agent.name, directory: agent.directory }))));
  must("live DB all active_graph agents are gpt-5.5", wrongModels.length === 0, JSON.stringify(wrongModels));
  must("live DB all active_graph agents use codex provider", wrongProviders.length === 0, JSON.stringify(wrongProviders));
  must("live DB all active_graph agents use local execution", wrongExecutionModes.length === 0, JSON.stringify(wrongExecutionModes));
  record(true, "live DB active_graph clone branch metadata rows", branchMetadataRows.length ? JSON.stringify(branchMetadataRows) : "none exposed");
}

async function main() {
  const noDb = process.argv.includes("--no-db");
  const requireNative = process.argv.includes("--require-native");

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

  if (requireNative) {
    record(false, "native Pentagon autonomy completion", "native poller is still documented as blocked; rerun without --require-native to verify bridge-backed autonomy only");
  } else {
    record(true, "native Pentagon autonomy boundary", "native poller remains blocked; this run verifies bridge-backed autonomy and audit integrity");
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
  console.log("verdict: " + (failed.length ? "failed" : "bridge_autonomy_verified_native_blocked"));
  if (failed.length) process.exitCode = 1;
}

await main();
