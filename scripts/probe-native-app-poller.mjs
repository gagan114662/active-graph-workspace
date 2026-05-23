#!/usr/bin/env node
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";

const ROOT = "/Users/gaganarora/Desktop/my projects/active_graph";
const PENTAGON_BIN = "/Applications/Pentagon.app/Contents/MacOS/Pentagon";
const PENTAGON_INFO_PLIST = "/Applications/Pentagon.app/Contents/Info.plist";

function arg(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  return idx === -1 ? fallback : process.argv[idx + 1] ?? fallback;
}

function command(cmd, args, options = {}) {
  return spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    ...options,
  });
}

function textCommand(cmd, args) {
  const res = command(cmd, args);
  return {
    status: res.status,
    stdout: String(res.stdout ?? ""),
    stderr: String(res.stderr ?? ""),
  };
}

function pentagonProcesses() {
  const res = command("zsh", [
    "-lc",
    "ps -axo pid=,command= | rg '/Applications/Pentagon.app/Contents/MacOS/Pentagon' | rg -v 'rg '",
  ]);
  return {
    status: res.status,
    stdout: String(res.stdout ?? ""),
    stderr: String(res.stderr ?? ""),
  };
}

function appVersion() {
  const shortVersion = command("/usr/libexec/PlistBuddy", [
    "-c",
    "Print :CFBundleShortVersionString",
    PENTAGON_INFO_PLIST,
  ]);
  const bundleVersion = command("/usr/libexec/PlistBuddy", [
    "-c",
    "Print :CFBundleVersion",
    PENTAGON_INFO_PLIST,
  ]);
  return {
    short_version: String(shortVersion.stdout ?? "").trim(),
    bundle_version: String(bundleVersion.stdout ?? "").trim(),
  };
}

function binaryContains(needle) {
  const res = command("zsh", [
    "-lc",
    "strings " + JSON.stringify(PENTAGON_BIN) + " | rg " + JSON.stringify(needle),
  ]);
  return res.status === 0;
}

function parseProbeJson(stdout) {
  const text = String(stdout ?? "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(text.slice(start, end + 1));
    }
  }
  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run() {
  const watchSeconds = Number(arg("--watch-seconds", "30"));
  const hash = arg("--hash", "T5M_NATIVE_APP_POLLER_" + new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15) + "Z");
  const tmp = mkdtempSync(join(tmpdir(), "pentagon-native-app-poller-"));
  const logPath = join(tmp, "pentagon.log");

  const result = {
    hash,
    watch_seconds: watchSeconds,
    app_version: appVersion(),
    app_process_before: pentagonProcesses(),
    binary_hooks: {
      TriggerPoller: binaryContains("TriggerPoller"),
      claim_agent_trigger: binaryContains("claim_agent_trigger"),
      complete_agent_trigger: binaryContains("complete_agent_trigger") || binaryContains("messaging.complete-trigger"),
      triggerAgentResponse: binaryContains("triggerAgentResponse"),
    },
    log_path: logPath,
  };

  const logPredicate = [
    'process == "Pentagon"',
    'eventMessage CONTAINS "TriggerPoller"',
    'eventMessage CONTAINS "handleAgentTrigger"',
    'eventMessage CONTAINS "triggerAgentResponse"',
    'eventMessage CONTAINS "claim_agent_trigger"',
    'eventMessage CONTAINS "' + hash + '"',
  ].join(" OR ");

  const logStream = spawn("/usr/bin/log", [
    "stream",
    "--style",
    "compact",
    "--predicate",
    logPredicate,
  ], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logBuffer = "";
  logStream.stdout.on("data", (chunk) => { logBuffer += chunk.toString(); });
  logStream.stderr.on("data", (chunk) => { logBuffer += chunk.toString(); });

  try {
    result.open_app = textCommand("open", ["-a", "Pentagon"]);
    await sleep(3000);
    result.app_process_after_open = pentagonProcesses();

    const probe = command("node", [
      "scripts/probe-native-poller.mjs",
      "--watch-seconds",
      String(watchSeconds),
      "--hash",
      hash,
    ], { timeout: (watchSeconds + 45) * 1000 });
    result.probe_exit = probe.status;
    result.probe_stdout = String(probe.stdout ?? "");
    result.probe_stderr = String(probe.stderr ?? "");
    result.probe = parseProbeJson(probe.stdout);

    await sleep(3000);
  } finally {
    logStream.kill("SIGTERM");
    await new Promise((resolve) => {
      const done = setTimeout(resolve, 1500);
      logStream.once("exit", () => {
        clearTimeout(done);
        resolve();
      });
    });
    const logLines = logBuffer
      .split(/\r?\n/)
      .filter(Boolean)
      .filter((line) => !line.includes("Filtering the log data using"));
    const joinedLogLines = logLines.join("\n");
    result.log_excerpt = logLines.slice(-200);
    result.log_match_counts = {
      TriggerPoller: (joinedLogLines.match(/TriggerPoller/g) ?? []).length,
      handleAgentTrigger: (joinedLogLines.match(/handleAgentTrigger/g) ?? []).length,
      triggerAgentResponse: (joinedLogLines.match(/triggerAgentResponse/g) ?? []).length,
      claim_agent_trigger: (joinedLogLines.match(/claim_agent_trigger/g) ?? []).length,
      hash: (joinedLogLines.match(new RegExp(hash, "g")) ?? []).length,
    };
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch {}
  }

  result.native_pass = Boolean(result.probe?.native_pass);
  result.verdict = result.native_pass ? "native_app_poller_passed" : "native_app_poller_still_blocked";
  console.log(JSON.stringify(result, null, 2));
  if (!result.native_pass) process.exitCode = 2;
}

await run();
