#!/usr/bin/env node
// referee-factory/replay.mjs
//
// "The trace is the proof." (Active Graph runtime motto.)
//
// This tool proves the referee's verdict is a PROJECTION OF THE EVENT LOG — not a
// stored opinion. It reads an append-only ledger (.proof.jsonl), replays every
// event in order, reconstructs each gate's final state and the verdict PURELY
// from the trace (no pytest, no sandbox, no re-grading), and shows that the
// reconstructed verdict matches the verdict event that was recorded live.
//
// This is the activegraph event-sourcing model applied to the factory's own
// audit: the current state (VERIFIED / ERROR) is derived by reading the log from
// start to finish. Anyone — the operator, a skeptic, a future session — can take
// the ledger file and independently derive the same verdict. That is auditability
// as a mathematical property, not a promise.
//
// Usage: node scripts/referee-factory/replay.mjs <ledger.jsonl> [task_id]

import fs from "node:fs";

const file = process.argv[2];
const onlyTask = process.argv[3];
if (!file || !fs.existsSync(file)) {
  console.error("usage: replay.mjs <ledger.jsonl> [task_id]");
  process.exit(2);
}

const events = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => {
  try { return JSON.parse(l); } catch { return null; }
}).filter(Boolean);

const tasks = [...new Set(events.map((e) => e.task_id))].filter((t) => !onlyTask || t === onlyTask);

const ICON = { cleared: "✓", failed: "✗", open: "•", note: "·", VERIFIED: "✅", ERROR: "❌" };

for (const task of tasks) {
  const evs = events.filter((e) => e.task_id === task).sort((a, b) => a.seq - b.seq);
  console.log(`\n┌─ TRACE: ${task}`);
  console.log(`│  ${evs.length} events in the append-only log (the proof)`);
  console.log("│");

  // Replay: reconstruct gate state purely from the event stream.
  const gateState = new Map();
  let recordedVerdict = null;
  for (const e of evs) {
    if (e.stage === "gate") {
      gateState.set(e.gate, e.status);
      const ic = ICON[e.status] || "·";
      console.log(`│  ${ic} [${e.role}] ${e.gate}: ${e.status}  — ${(e.detail || "").slice(0, 64)}`);
    } else if (e.stage === "verdict") {
      recordedVerdict = e.status;
    } else if (e.stage === "build" || e.stage === "setup" || e.stage === "control") {
      console.log(`│  · [${e.role}] ${(e.detail || "").slice(0, 72)}`);
    }
  }

  // The verdict is a PURE FUNCTION of the final gate states. Required gates are
  // inferred from the gates that appear in the trace (every opened gate must clear).
  const gates = [...gateState.keys()];
  const cleared = gates.filter((g) => gateState.get(g) === "cleared");
  const notCleared = gates.filter((g) => gateState.get(g) !== "cleared");
  const reconstructed = notCleared.length === 0 && gates.length > 0 ? "VERIFIED" : "ERROR";

  console.log("│");
  console.log(`│  RECONSTRUCTED FROM TRACE: ${ICON[reconstructed]} ${reconstructed}`);
  console.log(`│    cleared : [${cleared.join(", ")}]`);
  if (notCleared.length) console.log(`│    NOT cleared: [${notCleared.join(", ")}]`);
  if (recordedVerdict) {
    const match = recordedVerdict === reconstructed;
    console.log(`│  RECORDED LIVE         : ${ICON[recordedVerdict]} ${recordedVerdict}`);
    console.log(`│  ${match ? "✓ MATCH — verdict is a faithful projection of the log" : "✗ MISMATCH — trace and recorded verdict disagree (investigate!)"}`);
  }
  console.log("└─");
}

console.log("\n\"The trace is the proof.\" The verdict above was re-derived by reading the");
console.log("event log alone — no tests were re-run. That is event-sourced auditability.\n");
