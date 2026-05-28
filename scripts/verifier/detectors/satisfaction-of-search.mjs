// Detector: satisfaction-of-search (Brandon-B).
//
// First migrated detector demonstrating the P12 drop-in pattern: a detector is a
// pure module exporting a `detector` object with a standard interface. The
// auto-discovery loader (../load-detectors.mjs) finds every *.mjs in this dir and
// registers its `detector` export — adding a new failure-mode is "drop a file
// here", NOT editing the 1000-line verifier (IndyDevDan Pillar 3: open to
// extension, closed to modification).
//
// Contract:
//   detector.name        — stable id
//   detector.eventType   — factory event type the runner emits for findings
//   detector.severity    — "warn" | "fail" (warn = advisory, fail = gating)
//   detector.detect(input) -> { ok: boolean, findings: Finding[] }
//     input  = { proofPath, fields }  (fields = parsed key=value proof fields)
//     Finding = { reason, detail, extras }
//   PURE — no I/O, no emit, no console. The runner handles emit + exit codes.

function countCandidates(fields) {
  const list = fields.candidates_considered;
  if (!list) return 0;
  return list.split(/[,;]/).map((s) => s.trim()).filter(Boolean).length;
}

export const detector = {
  name: "satisfaction_of_search",
  eventType: "verifier.satisfaction_of_search_risk",
  severity: "warn", // advisory by default (back-compat); a tier can promote to fail
  description:
    "Flags symbol-selection proofs that recorded <3 candidate targets with rejection rationale " +
    "(radiology 'satisfaction of search' — stopping at the first plausible find).",

  detect({ fields = {} } = {}) {
    const count = countCandidates(fields);
    const target = fields.uncovered_symbol || fields.target_symbol || fields.chosen_symbol || null;
    if (!target) {
      return { ok: false, findings: [{ reason: "no_target_symbol", detail: "no target/uncovered/chosen symbol field", extras: { candidate_count: count } }] };
    }
    if (count < 3) {
      const reason = count === 0 ? "no_candidates_considered_field" : "fewer_than_3_candidates";
      return {
        ok: false,
        findings: [{ reason, detail: `only ${count} candidate(s) recorded (chosen: ${target})`,
          extras: { candidate_count: count, target_symbol: target, risk_reason: reason } }],
      };
    }
    return { ok: true, findings: [] };
  },
};
