import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { parseApprovalPayload, verifySlackSignature } from "./factory-slack-approve.mjs";

test("parses Slack interactive approve payload", () => {
  const payload = JSON.stringify({ actions: [{ value: "approve:evt_123" }], dedup_key: "k1" });
  const body = "payload=" + encodeURIComponent(payload);
  const r = parseApprovalPayload(body, "application/x-www-form-urlencoded");
  assert.equal(r.decision, "approve"); assert.equal(r.event_id, "evt_123"); assert.equal(r.source, "slack_interactive");
});

test("parses Slack interactive reject payload", () => {
  const payload = JSON.stringify({ actions: [{ value: "reject:evt_9" }] });
  const r = parseApprovalPayload("payload=" + encodeURIComponent(payload), "application/x-www-form-urlencoded");
  assert.equal(r.decision, "reject"); assert.equal(r.event_id, "evt_9");
});

test("parses plain JSON approve", () => {
  const r = parseApprovalPayload(JSON.stringify({ decision: "approve", event_id: "e1", dedup_key: "d1" }), "application/json");
  assert.equal(r.decision, "approve"); assert.equal(r.event_id, "e1"); assert.equal(r.dedup_key, "d1");
});

test("unparseable / unknown decision -> null", () => {
  assert.equal(parseApprovalPayload("", "application/json"), null);
  assert.equal(parseApprovalPayload(JSON.stringify({ decision: "maybe" }), "application/json"), null);
  assert.equal(parseApprovalPayload("payload=" + encodeURIComponent(JSON.stringify({ actions: [{ value: "noop" }] })), "application/x-www-form-urlencoded"), null);
});

test("no signing secret -> verification skipped (true)", () => {
  assert.equal(verifySlackSignature({ signingSecret: null, body: "x" }), true);
});

test("valid Slack signature verifies; tampered fails", () => {
  const secret = "shhh";
  const ts = String(Math.floor(Date.now() / 1000));
  const body = "payload=%7B%7D";
  const sig = "v0=" + createHmac("sha256", secret).update(`v0:${ts}:${body}`).digest("hex");
  assert.equal(verifySlackSignature({ signingSecret: secret, timestamp: ts, body, signature: sig }), true);
  assert.equal(verifySlackSignature({ signingSecret: secret, timestamp: ts, body, signature: "v0=deadbeef" }), false);
});

test("stale timestamp is rejected (replay guard)", () => {
  const secret = "shhh";
  const ts = String(Math.floor(Date.now() / 1000) - 9999);
  const body = "x";
  const sig = "v0=" + createHmac("sha256", secret).update(`v0:${ts}:${body}`).digest("hex");
  assert.equal(verifySlackSignature({ signingSecret: secret, timestamp: ts, body, signature: sig }), false);
});
