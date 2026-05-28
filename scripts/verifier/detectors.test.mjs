import test from "node:test";
import assert from "node:assert/strict";
import { loadDetectors } from "./load-detectors.mjs";
import { detector as sos } from "./detectors/satisfaction-of-search.mjs";

test("auto-discovery finds the satisfaction-of-search detector", async () => {
  const detectors = await loadDetectors();
  assert.ok(detectors.length >= 1, "at least one detector discovered");
  const names = detectors.map((d) => d.name);
  assert.ok(names.includes("satisfaction_of_search"));
  // every discovered detector satisfies the contract
  for (const d of detectors) {
    assert.equal(typeof d.detect, "function");
    assert.ok(d.name && d.eventType);
  }
});

test("satisfaction detector: <3 candidates → flagged", () => {
  const r = sos.detect({ fields: { target_symbol: "a.b.C.m", candidates_considered: "a.b.C.m" } });
  assert.equal(r.ok, false);
  assert.equal(r.findings[0].reason, "fewer_than_3_candidates");
  assert.equal(r.findings[0].extras.candidate_count, 1);
});

test("satisfaction detector: 0 candidates → distinct reason", () => {
  const r = sos.detect({ fields: { target_symbol: "a.b.C.m" } });
  assert.equal(r.findings[0].reason, "no_candidates_considered_field");
});

test("satisfaction detector: ≥3 candidates → clean", () => {
  const r = sos.detect({ fields: { uncovered_symbol: "x", candidates_considered: "x, y, z" } });
  assert.equal(r.ok, true);
  assert.equal(r.findings.length, 0);
});

test("satisfaction detector: no target symbol → flagged", () => {
  const r = sos.detect({ fields: { candidates_considered: "x, y, z" } });
  assert.equal(r.ok, false);
  assert.equal(r.findings[0].reason, "no_target_symbol");
});
