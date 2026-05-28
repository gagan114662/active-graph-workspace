import test from "node:test";
import assert from "node:assert/strict";
import {
  parseRowanAck, parseTheoAck, parseGraceAck, parseAnyJudgeAck, stripAckMarkdown,
  parseRowanReviewAck, parseTheoTestReviewAck, parseGraceGateAck,
  evaluateReviewerAcks, parseReviewersField,
} from "./judge-ack-parse.mjs";

test("Rowan: strict one-liner", () => {
  const a = parseRowanAck("ROWAN_REVIEW_PASS abc123 findings=2 top_finding=looks fine");
  assert.equal(a.judge, "rowan"); assert.equal(a.verdict, "PASS");
  assert.equal(a.sha, "abc123"); assert.equal(a.commit_sha, "abc123");
  assert.equal(a.findings, 2); assert.equal(a.top_finding, "looks fine");
});

test("Rowan: REAL 2026-05-28 markdown-wrapped reply, top_finding omitted", () => {
  const reply = "Review complete and posted.\n\n**Verdict: `ROWAN_REVIEW_PASS pending findings=6`**\n";
  const a = parseRowanAck(reply);
  assert.ok(a); assert.equal(a.verdict, "PASS"); assert.equal(a.findings, 6);
  assert.equal(a.top_finding, "(not provided)");
});

test("Rowan: FAIL parses", () => {
  const a = parseRowanAck("`ROWAN_REVIEW_FAIL pending findings=3 top_finding=null deref`");
  assert.equal(a.verdict, "FAIL"); assert.equal(a.findings, 3); assert.equal(a.top_finding, "null deref");
});

test("Rowan: non-ack prose -> null (no false positive)", () => {
  assert.equal(parseRowanAck("I think this looks okay overall, no complaints."), null);
  assert.equal(parseRowanAck("ROWAN_REVIEW_MAYBE abc findings=1"), null); // bad verdict token
  assert.equal(parseRowanAck("ROWAN_REVIEW_PASS abc"), null);             // missing findings (load-bearing)
});

test("Theo: markdown + reasoning optional", () => {
  const a = parseTheoAck("**THEO_TEST_REVIEW_PASS deadbeef tests=7**");
  assert.equal(a.judge, "theo"); assert.equal(a.verdict, "PASS");
  assert.equal(a.hash, "deadbeef"); assert.equal(a.tests, 7); assert.equal(a.reasoning, "(not provided)");
  assert.equal(parseTheoAck("THEO_TEST_REVIEW_FAIL h tests="), null); // missing count (load-bearing)
});

test("Grace: tier required, dirty_files optional", () => {
  const a = parseGraceAck("`GRACE_GATE_OPEN T6`");
  assert.equal(a.judge, "grace"); assert.equal(a.verdict, "OPEN"); assert.equal(a.tier, "T6");
  assert.equal(a.dirty_files, "(not provided)");
  const b = parseGraceAck("GRACE_GATE_BLOCKED extra-hard dirty_files=CLAUDE.md,a.py");
  assert.equal(b.verdict, "BLOCKED"); assert.equal(b.dirty_files, "CLAUDE.md,a.py");
  assert.equal(parseGraceAck("GRACE_GATE_SOMETHING T6"), null); // bad verdict token
});

test("parseAnyJudgeAck dispatches to the right judge", () => {
  assert.equal(parseAnyJudgeAck("ROWAN_REVIEW_PASS x findings=0").judge, "rowan");
  assert.equal(parseAnyJudgeAck("THEO_TEST_REVIEW_FAIL x tests=1").judge, "theo");
  assert.equal(parseAnyJudgeAck("GRACE_GATE_OPEN T7").judge, "grace");
  assert.equal(parseAnyJudgeAck("nothing here"), null);
});

test("bridge-side aliases are the same functions", () => {
  assert.equal(parseRowanReviewAck, parseRowanAck);
  assert.equal(parseTheoTestReviewAck, parseTheoAck);
  assert.equal(parseGraceGateAck, parseGraceAck);
});

test("stripAckMarkdown removes backticks and asterisks", () => {
  assert.equal(stripAckMarkdown("**`x`**").trim(), "x");
});

test("parseReviewersField splits + lowercases", () => {
  assert.deepEqual(parseReviewersField("Theo, Rowan ,grace"), ["theo", "rowan", "grace"]);
  assert.deepEqual(parseReviewersField(""), []);
  assert.deepEqual(parseReviewersField(null), []);
});

test("evaluateReviewerAcks: all present", () => {
  const messages = [
    "ROWAN_REVIEW_PASS abc findings=0",
    "THEO_TEST_REVIEW_PASS abc tests=5",
    "GRACE_GATE_OPEN T6",
  ];
  const r = evaluateReviewerAcks({ reviewers: ["rowan", "theo", "grace"], messages });
  assert.ok(r.every((x) => x.ok), JSON.stringify(r));
});

test("evaluateReviewerAcks: missing reviewer ack -> ok=false", () => {
  const r = evaluateReviewerAcks({ reviewers: ["rowan", "grace"], messages: ["ROWAN_REVIEW_PASS abc findings=0"] });
  assert.equal(r.find((x) => x.reviewer === "rowan").ok, true);
  assert.equal(r.find((x) => x.reviewer === "grace").ok, false);
});

test("evaluateReviewerAcks: wrong-run hash is rejected", () => {
  const msgs = ["THEO_TEST_REVIEW_PASS HASH_A tests=3"];
  assert.equal(evaluateReviewerAcks({ reviewers: ["theo"], messages: msgs, expectedHash: "HASH_B" })[0].ok, false);
  assert.equal(evaluateReviewerAcks({ reviewers: ["theo"], messages: msgs, expectedHash: "HASH_A" })[0].ok, true);
});

test("evaluateReviewerAcks: unknown reviewer name", () => {
  assert.equal(evaluateReviewerAcks({ reviewers: ["bogus"], messages: [] })[0].ok, false);
});

test("evaluateReviewerAcks: accepts {content} objects", () => {
  const r = evaluateReviewerAcks({ reviewers: ["grace"], messages: [{ content: "`GRACE_GATE_BLOCKED T7`" }] });
  assert.equal(r[0].ok, true); assert.equal(r[0].ack.verdict, "BLOCKED");
});
