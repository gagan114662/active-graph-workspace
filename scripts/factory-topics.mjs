#!/usr/bin/env node
// Topic modeling on the failure log (Task #16d).
//
// Per Phil Hetzel's Level 3 emerging pattern ("topic modeling on production
// failures + claude-code + eval-provider CLI loop"): clusters behavior.failed
// events by (reason, behavior, message-fingerprint). New clusters that hit a
// configurable threshold emit `topic.discovered` events. Operator decides if
// the cluster becomes a routing rule.
//
// No embedding API call required: the fingerprint is a hash over the most
// salient tokens in the message (stop words removed, numbers + ids stripped,
// path prefixes normalized). Pure-function, replayable, fast.
//
// Usage:
//   node scripts/factory-topics.mjs                       # report top clusters
//   node scripts/factory-topics.mjs --since 7d
//   node scripts/factory-topics.mjs --min-occurrences 3
//   node scripts/factory-topics.mjs --emit                # emit topic.discovered events for new clusters

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { emitFactoryEvent } from "./factory-events.mjs";

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i < 0 ? fallback : process.argv[i + 1] ?? fallback;
}
function flag(name) { return process.argv.includes(name); }

const SINCE_SPEC = arg("--since", "7d");
const MIN_OCCURRENCES = Number(arg("--min-occurrences", "3"));
const EMIT = flag("--emit");
const AS_JSON = flag("--json");

const EVENTS_PATH = resolve(process.env.FACTORY_EVENTS_PATH || "frames/factory-events.jsonl");

function parseSinceMs(spec) {
  const m = String(spec).match(/^(\d+)([smhd])$/);
  if (!m) return 7 * 86400_000;
  const mult = { s: 1000, m: 60_000, h: 3600_000, d: 86400_000 }[m[2]];
  return Number(m[1]) * mult;
}
const SINCE_CUTOFF = Date.now() - parseSinceMs(SINCE_SPEC);

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "if", "of", "to", "in", "on", "at",
  "by", "for", "with", "from", "as", "is", "it", "this", "that", "be", "are",
  "was", "were", "has", "have", "had", "not", "no", "yes", "do", "does",
  "did", "can", "could", "should", "would", "will", "may", "might",
  "error", "failed", "exception", "occurred", "while", "during",
]);

function fingerprint(reason, behavior, message) {
  const msg = String(message || "");
  // Strip ids, numbers, paths into tokens; keep alpha sequences of length >=3.
  const tokens = msg
    .toLowerCase()
    .replace(/[\/\\:]/g, " ")               // path separators
    .replace(/\b(?:0x)?[0-9a-f]{8,}\b/g, " ")  // hex ids / shas
    .replace(/\b\d+\b/g, " ")               // numbers
    .replace(/[^a-z\s]/g, " ")              // non-letters
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOP_WORDS.has(t));
  const uniq = Array.from(new Set(tokens)).sort();
  const top = uniq.slice(0, 6); // dominant tokens form the fingerprint
  const fp = `${reason || "_"}::${behavior || "_"}::${top.join(",")}`;
  return {
    key: "topic_" + createHash("sha256").update(fp).digest("hex").slice(0, 16),
    label: top.length ? top.join(" + ") : "(no salient tokens)",
    fp,
  };
}

if (!existsSync(EVENTS_PATH)) {
  console.error(`no events log at ${EVENTS_PATH}`);
  process.exit(1);
}

const failures = [];
for (const line of readFileSync(EVENTS_PATH, "utf-8").split(/\r?\n/)) {
  if (!line.trim()) continue;
  try {
    const ev = JSON.parse(line);
    if (ev.type !== "behavior.failed") continue;
    if (Date.parse(ev.created_at) < SINCE_CUTOFF) continue;
    // Skip synthetic-without-canary noise.
    if (ev.payload?.synthetic === true && ev.payload?.canary_authorized !== true) continue;
    failures.push(ev);
  } catch {}
}

const clusters = new Map();
for (const ev of failures) {
  const fp = fingerprint(ev.payload?.reason, ev.payload?.behavior, ev.payload?.message);
  if (!clusters.has(fp.key)) {
    clusters.set(fp.key, {
      topic_id: fp.key,
      label: fp.label,
      reason: ev.payload?.reason || null,
      behavior: ev.payload?.behavior || null,
      occurrences: 0,
      first_seen: ev.created_at,
      last_seen: ev.created_at,
      sample_event_ids: [],
      sample_messages: [],
    });
  }
  const c = clusters.get(fp.key);
  c.occurrences++;
  c.last_seen = ev.created_at;
  if (c.sample_event_ids.length < 5) c.sample_event_ids.push(ev.id);
  if (c.sample_messages.length < 3 && ev.payload?.message) c.sample_messages.push(String(ev.payload.message).slice(0, 200));
}

const all = Array.from(clusters.values()).sort((a, b) => b.occurrences - a.occurrences);
const notable = all.filter((c) => c.occurrences >= MIN_OCCURRENCES);

// Look for prior topic.discovered events so we don't re-emit the same topic.
const prior = new Set();
for (const line of readFileSync(EVENTS_PATH, "utf-8").split(/\r?\n/)) {
  if (!line.trim()) continue;
  try {
    const ev = JSON.parse(line);
    if (ev.type === "topic.discovered" && ev.payload?.topic_id) prior.add(ev.payload.topic_id);
  } catch {}
}

const newTopics = notable.filter((c) => !prior.has(c.topic_id));

const summary = {
  window: SINCE_SPEC,
  failures_scanned: failures.length,
  distinct_topics: all.length,
  notable_topics: notable.length,
  new_topics: newTopics.length,
  min_occurrences: MIN_OCCURRENCES,
  top: notable.slice(0, 10),
  new: newTopics,
};

if (AS_JSON) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(`Topic modeling — window=${SINCE_SPEC}, min-occurrences=${MIN_OCCURRENCES}`);
  console.log(`  failures scanned:   ${failures.length}`);
  console.log(`  distinct topics:    ${all.length}`);
  console.log(`  notable topics:     ${notable.length}`);
  console.log(`  new (un-seen):      ${newTopics.length}`);
  console.log("");
  console.log(`Top ${Math.min(10, notable.length)} topics:`);
  for (const t of notable.slice(0, 10)) {
    console.log(`  [${t.occurrences}x] ${t.topic_id} reason=${t.reason || "-"} behavior=${t.behavior || "-"}`);
    console.log(`        ${t.label}`);
  }
  if (newTopics.length) {
    console.log("");
    console.log(`NEW topics (no prior topic.discovered event):`);
    for (const t of newTopics) {
      console.log(`  [${t.occurrences}x] ${t.topic_id} — ${t.label}`);
    }
  }
}

if (EMIT && newTopics.length > 0) {
  for (const t of newTopics) {
    emitFactoryEvent({
      type: "topic.discovered",
      behavior: "factory-topics",
      reason: "topic.discovered",
      message: `topic ${t.topic_id}: ${t.label} (${t.occurrences} occurrences over ${SINCE_SPEC})`,
      extras: {
        topic_id: t.topic_id,
        label: t.label,
        reason_pattern: t.reason,
        behavior_pattern: t.behavior,
        occurrences: t.occurrences,
        first_seen: t.first_seen,
        last_seen: t.last_seen,
        sample_event_ids: t.sample_event_ids,
        window: SINCE_SPEC,
      },
    });
  }
  console.log("");
  console.log(`emitted ${newTopics.length} topic.discovered events`);
}
