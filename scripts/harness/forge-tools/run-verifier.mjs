// Forge tool: run the INDEPENDENT dark-factory verifier on a proof — the same gate
// that grades gauntlet runs. Lets a builder/tester self-check BEFORE claiming done
// (turns the gate from an after-the-fact judge into a tool the agent can call).
// Read-only side effects (the verifier spins ephemeral worktrees it cleans up).
import { spawnSync } from "node:child_process";

export default {
  name: "run_verifier",
  description: "Run the independent factory verifier on a proof file (the real gate, worktree ground-truth). Returns pass/fail + the summary line. Use it to self-verify before declaring done.",
  inputSchema: {
    type: "object",
    properties: {
      proof_file: { type: "string", description: "path to the proof file (repo-relative)" },
      tier: { type: "string", description: "one of: easy | medium | hard | extra-hard" },
    },
    required: ["proof_file", "tier"],
  },
  allowedRoles: ["builder", "tester", "verifier"],
  execute({ proof_file, tier }) {
    const allowed = ["easy", "medium", "hard", "extra-hard"];
    if (!allowed.includes(tier)) return { error: `tier must be one of ${allowed.join(", ")}` };
    const r = spawnSync("node", [
      "scripts/verify-pentagon-autonomy-from-logs.mjs",
      "--t6", `--tier=${tier}`, "--proof-file", proof_file, "--no-db",
    ], { encoding: "utf8", timeout: 300_000, maxBuffer: 16 * 1024 * 1024 });
    const summary = (String(r.stdout || "").match(/^summary: .+$/m) || ["no summary"])[0];
    const failing = String(r.stdout || "").split(/\n/).filter((l) => l.startsWith("FAIL ")).slice(0, 8);
    return { proof_file, tier, exit: r.status, pass: r.status === 0, summary, failing_checks: failing };
  },
};
