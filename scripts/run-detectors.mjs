#!/usr/bin/env node
// run-detectors.mjs — P12 runner: load all auto-discovered detectors and run
// them over a proof file, emitting a factory event per finding.
//
// This is the thin shell; the detectors are the units (scripts/verifier/detectors/).
// Adding a detector requires NO change here. `warn`-severity findings are
// advisory (exit 0); `fail`-severity findings exit non-zero (gate).
//
// Usage:
//   node scripts/run-detectors.mjs <proof-file> [--json] [--no-emit]

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { emitFactoryEvent } from "./factory-events.mjs";
import { loadDetectors } from "./verifier/load-detectors.mjs";

const has = (n) => process.argv.includes(n);

function parseProofFields(text) {
  const out = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const m = line.match(/^(\w+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

export async function runDetectors(proofPath, { emit = true } = {}) {
  const detectors = await loadDetectors();
  const fields = existsSync(proofPath) ? parseProofFields(readFileSync(proofPath, "utf8")) : {};
  const input = { proofPath, fields };
  const results = [];
  let anyFail = false;
  for (const d of detectors) {
    let r;
    try { r = d.detect(input); } catch (e) { r = { ok: false, findings: [{ reason: "detector_threw", detail: String(e?.message || e), extras: {} }] }; }
    const findings = r?.findings || [];
    for (const f of findings) {
      if (d.severity === "fail") anyFail = true;
      if (emit) {
        try {
          emitFactoryEvent({
            type: d.eventType,
            behavior: "verifier",
            reason: d.eventType,
            message: `${proofPath}: ${f.reason} — ${f.detail}`,
            extras: { detector: d.name, severity: d.severity, proof_file: proofPath, ...f.extras },
          });
        } catch {}
      }
    }
    results.push({ detector: d.name, severity: d.severity, ok: !!r?.ok, findings });
  }
  return { proofPath, detectors_run: detectors.length, any_fail: anyFail, results };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const proof = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (!proof) { console.error("usage: node scripts/run-detectors.mjs <proof-file> [--json] [--no-emit]"); process.exit(2); }
  const r = await runDetectors(proof, { emit: !has("--no-emit") });
  if (has("--json")) console.log(JSON.stringify(r, null, 2));
  else {
    console.log(`ran ${r.detectors_run} detector(s) on ${proof}`);
    for (const res of r.results) {
      const mark = res.ok ? "✅" : (res.severity === "fail" ? "❌" : "⚠");
      console.log(`  ${mark} ${res.detector}${res.findings.length ? ": " + res.findings.map((f) => f.reason).join(", ") : ""}`);
    }
  }
  process.exit(r.any_fail ? 1 : 0);  // fail-severity findings gate
}
