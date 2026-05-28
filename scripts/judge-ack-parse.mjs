// judge-ack-parse.mjs — single source of truth for parsing reviewer (judge) ack
// lines out of an agent's reply. Previously duplicated in TWO places that had
// already drifted apart:
//   * scripts/pentagon-trigger-bridge.mjs (flywheel review path) — was strict,
//     fixed 2026-05-28 to tolerate markdown.
//   * scripts/verify-pentagon-autonomy-from-logs.mjs (gauntlet tier checks) —
//     was even stricter (anchored ^$, mandatory descriptive field).
// Two copies => two false-malformed bugs. This module is the one place.
//
// Wire formats (from agent-os/AGENT_IDENTITY_MAP.md):
//   ROWAN_REVIEW_{PASS|FAIL}   <sha>   findings=<N> [top_finding=<one_line>]
//   THEO_TEST_REVIEW_{PASS|FAIL} <hash> tests=<N>   [reasoning=<one_line>]
//   GRACE_GATE_{OPEN|BLOCKED}  <tier>          [dirty_files=<list>]
//
// Robustness rules (proven necessary by the 2026-05-28 live Rowan review, which
// returned a CORRECT verdict wrapped as **`ROWAN_REVIEW_PASS pending findings=6`**):
//   - strip markdown decoration (backticks, bold/italic asterisks) before matching
//   - UNANCHORED: find the ack token anywhere (agents add surrounding prose)
//   - the trailing DESCRIPTIVE field is OPTIONAL (agents sometimes omit / move it)
//   - the LOAD-BEARING fields (verdict + count) stay REQUIRED
//   - non-ack prose still returns null (no false positives)

export function stripAckMarkdown(content) {
  return String(content ?? "").replace(/[`*]/g, " ");
}

export function parseRowanAck(content) {
  const m = stripAckMarkdown(content).match(
    /ROWAN_REVIEW_(PASS|FAIL)\s+(\S+)\s+findings=(\d+)(?:\s+top_finding=([^\n]+))?/
  );
  if (!m) return null;
  const sha = m[2];
  return {
    judge: "rowan",
    verdict: m[1],
    sha,
    commit_sha: sha, // verifier-side alias
    findings: Number(m[3]),
    top_finding: (m[4] || "").trim() || "(not provided)",
  };
}

export function parseTheoAck(content) {
  const m = stripAckMarkdown(content).match(
    /THEO_TEST_REVIEW_(PASS|FAIL)\s+(\S+)\s+tests=(\d+)(?:\s+reasoning=([^\n]+))?/
  );
  if (!m) return null;
  return {
    judge: "theo",
    verdict: m[1],
    hash: m[2],
    tests: Number(m[3]),
    reasoning: (m[4] || "").trim() || "(not provided)",
  };
}

export function parseGraceAck(content) {
  const m = stripAckMarkdown(content).match(
    /GRACE_GATE_(OPEN|BLOCKED)\s+(\S+)(?:\s+dirty_files=([^\n]+))?/
  );
  if (!m) return null;
  return {
    judge: "grace",
    verdict: m[1],
    tier: m[2],
    dirty_files: (m[3] || "").trim() || "(not provided)",
  };
}

// Bridge-side aliases (the flywheel review path imports these names).
export const parseRowanReviewAck = parseRowanAck;
export const parseTheoTestReviewAck = parseTheoAck;
export const parseGraceGateAck = parseGraceAck;

// Try every judge parser; return the first match (or null). Handy for callers
// that don't know which judge replied.
export function parseAnyJudgeAck(content) {
  return parseRowanAck(content) || parseTheoAck(content) || parseGraceAck(content);
}

const REVIEWER_PARSERS = { theo: parseTheoAck, rowan: parseRowanAck, grace: parseGraceAck };

/**
 * P2a wiring (pure + testable). Given the reviewers a gauntlet declared, the
 * conversation messages, and the expected gauntlet hash, return one result per
 * reviewer: { reviewer, ok, detail, ack }. `ok` means a parseable ack from that
 * reviewer was found (and, when the ack carries a hash, it matches `expectedHash`).
 *
 * The verifier calls this ONLY when a proof declares `reviewers=` — so existing
 * proofs (no reviewers field) are completely unaffected. `messages` items may be
 * strings or `{content}` objects.
 */
export function evaluateReviewerAcks({ reviewers = [], messages = [], expectedHash = null } = {}) {
  const text = (m) => (typeof m === "string" ? m : m?.content ?? "");
  return reviewers.map((raw) => {
    const reviewer = String(raw).trim().toLowerCase();
    const parse = REVIEWER_PARSERS[reviewer];
    if (!parse) return { reviewer, ok: false, detail: `unknown reviewer "${reviewer}"`, ack: null };
    let ack = null;
    for (const m of messages) {
      const a = parse(text(m));
      if (!a) continue;
      if (expectedHash && a.hash && a.hash !== expectedHash) continue; // wrong-run ack
      ack = a;
      break;
    }
    return {
      reviewer,
      ok: !!ack,
      detail: ack ? `${reviewer} ack present: ${ack.verdict}` : `no ${reviewer} ack found among ${messages.length} message(s)`,
      ack,
    };
  });
}

/** Parse a `reviewers=theo,rowan,grace` proof field into a lowercased array. */
export function parseReviewersField(value) {
  return String(value ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}
