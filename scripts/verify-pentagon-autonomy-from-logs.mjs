#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const ROOT = "/Users/gaganarora/Desktop/my projects/active_graph";
const PLIST = "/Users/gaganarora/Library/Preferences/run.pentagon.app.plist";
const PENTAGON_BIN = "/Applications/Pentagon.app/Contents/MacOS/Pentagon";
const BRIDGE_LOG = "/Users/gaganarora/.pentagon/trigger-bridge.out.log";
const BRIDGE_LABEL = "run.pentagon.trigger-bridge";
const STAMP = "20260522T230015Z";

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
    "/rest/v1/agents?select=id,name,model,directory,deleted_at&deleted_at=is.null&limit=200"
  );
  const activeGraphAgents = agents.filter((agent) => agent.directory === ROOT);
  const wrongModels = activeGraphAgents.filter((agent) => agent.model !== "gpt-5.5");
  must("live DB active_graph agent rows present", activeGraphAgents.length >= 20, "count=" + activeGraphAgents.length);
  must("live DB all active_graph agents are gpt-5.5", wrongModels.length === 0, JSON.stringify(wrongModels));
}

async function main() {
  const noDb = process.argv.includes("--no-db");

  const gitStatus = command("git", ["status", "--short", "--branch"]);
  must("git status exits 0", gitStatus.status === 0, gitStatus.stderr);
  must("tracked worktree is clean", !/^ ?[MADRCU]/m.test(gitStatus.stdout), gitStatus.stdout.trim());

  const bridgeCheck = command("node", ["--check", "scripts/pentagon-trigger-bridge.mjs"]);
  must("bridge script parses", bridgeCheck.status === 0, bridgeCheck.stderr);

  const plistCheck = command("plutil", ["-lint", "launchagents/run.pentagon.trigger-bridge.plist"]);
  must("LaunchAgent plist parses", plistCheck.status === 0, plistCheck.stdout + plistCheck.stderr);

  const launchd = command("launchctl", ["print", "gui/" + process.getuid() + "/" + BRIDGE_LABEL]);
  must("LaunchAgent readback exits 0", launchd.status === 0, launchd.stderr);
  must("LaunchAgent state is running", launchd.stdout.includes("state = running"), launchd.stdout);

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
  if (failed.length) process.exitCode = 1;
}

await main();
