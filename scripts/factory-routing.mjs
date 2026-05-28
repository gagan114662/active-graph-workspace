// Shared routing decision module — the SINGLE source of truth for how a
// factory failure event is routed to an agent (or skipped).
//
// Why this file exists
// --------------------
// Before this module, the decision logic lived in TWO places:
//   * scripts/sasha-skeptic.mjs::routeFailureToAgent  (the producer)
//   * scripts/factory-replay.mjs::routeReplay          (the replayer)
// They were "kept in sync by hand" — and had already drifted (replay was
// missing the extras.canary_authorized predicate). Two copies of a decision
// function is non-determinism by construction: the replay harness can no
// longer faithfully reproduce what the producer decided. By importing ONE
// decideRoute() into both, replay is faithful by construction and the
// function is unit-testable in one place.
//
// Determinism contract
// --------------------
// decideRoute(event, config) is a PURE function of (event, config). Given the
// same event payload and the same routing-config object, it always returns the
// same decision. The config is versioned (config.version) and content-hashed
// (configHash) so that every recorded decision can be pinned to the exact
// config that produced it. Replay then classifies a divergence as either:
//   * expected_config_evolution  — the recorded decision used a different
//     config version than the current one (the rules legitimately changed), OR
//   * real_nondeterminism        — same config version, different decision
//     (a true bug in the decision function — must be 0).

import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";

export const DEFAULT_ROUTING_CONFIG_PATH =
  process.env.FACTORY_ROUTING_CONFIG ||
  "/Users/gaganarora/Desktop/my projects/active_graph/agent-os/factory-routing-config.json";

/**
 * Stable content hash of a routing config. Hashes the canonical JSON of the
 * rules array (order-preserving) plus the version, so any rule change moves
 * the hash. 12 hex chars is plenty to disambiguate config generations.
 */
export function configHash(config) {
  if (!config) return null;
  const canonical = JSON.stringify({ version: config.version ?? null, rules: config.rules ?? [] });
  return createHash("sha256").update(canonical).digest("hex").slice(0, 12);
}

let _cached = null;
let _cachedKey = 0;

/**
 * Load + cache the routing config. Cache is invalidated by file length change
 * (cheap freshness check — the file is ~2KB and reloaded each tick). On a read
 * or parse error, the last-good config is retained so a half-written edit never
 * blanks routing.
 */
export function loadRoutingConfig(path = DEFAULT_ROUTING_CONFIG_PATH) {
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf8");
    if (_cached && raw.length === _cachedKey) return _cached;
    _cached = JSON.parse(raw);
    _cachedKey = raw.length;
    return _cached;
  } catch {
    return _cached;
  }
}

/**
 * Does an event match a rule's `when` predicate? Pure.
 * Supported predicate keys: always, extras.synthetic, extras.canary_authorized,
 * reason_equals, reason_prefix, behavior_equals, type_equals, type_prefix.
 */
export function matchPredicate(when, event) {
  if (!when) return false;
  if (when.always === true) return true;
  const reason = event?.payload?.reason ?? null;
  const behavior = event?.payload?.behavior ?? null;
  const type = event?.type ?? null;
  if ("extras.synthetic" in when) {
    if ((event?.payload?.synthetic === true) !== (when["extras.synthetic"] === true)) return false;
  }
  if ("extras.canary_authorized" in when) {
    if ((event?.payload?.canary_authorized === true) !== (when["extras.canary_authorized"] === true)) return false;
  }
  if (when.reason_equals !== undefined && reason !== when.reason_equals) return false;
  if (when.reason_prefix !== undefined && !(reason && reason.startsWith(when.reason_prefix))) return false;
  if (when.behavior_equals !== undefined && behavior !== when.behavior_equals) return false;
  if (when.type_equals !== undefined && type !== when.type_equals) return false;
  if (when.type_prefix !== undefined && !(type && String(type).startsWith(when.type_prefix))) return false;
  return true;
}

/**
 * The hardcoded fallback ladder — used ONLY when the config is missing or has
 * no rules. Production always has a config (with an `always:true` catch-all),
 * so this never runs there; it's a safety net for stripped-down environments
 * and unit tests. Kept congruent with the config's rule order.
 */
function fallbackLadder(event) {
  const reason = event?.payload?.reason ?? null;
  const type = event?.type ?? null;
  const synthetic = event?.payload?.synthetic === true;
  const canaryAuthorized = event?.payload?.canary_authorized === true;
  if (synthetic && canaryAuthorized) return { decision: "route", agent: "sasha", priority: "p2", canary: true, matched_rule: "fallback:canary_probe_authorized" };
  if (synthetic) return { decision: "skip", matched_rule: "fallback:synthetic_short_circuit" };
  if (reason === "llm.rate_limited") return { decision: "skip", matched_rule: "fallback:transient_rate_limit_skip" };
  if (reason === "llm.network_error") return { decision: "skip", matched_rule: "fallback:transient_network_skip" };
  if (reason === "llm.provider_error") return { decision: "route", agent: "sasha", priority: "p1", matched_rule: "fallback:llm_provider_error" };
  if (reason && reason.startsWith("agent.")) return { decision: "route", agent: "sasha", priority: "p1", matched_rule: "fallback:agent_failures" };
  if (reason === "verifier.check_failed" || type === "verifier.check_failed") return { decision: "route", agent: "maya", priority: "p1", matched_rule: "fallback:verifier_check_failed" };
  if (reason === "script.crash" || type === "script.crash") return { decision: "route", agent: "maya", priority: "p1", matched_rule: "fallback:script_crash" };
  if (reason && reason.startsWith("infrastructure.")) return { decision: "route", agent: "sasha", priority: "p2", matched_rule: "fallback:infrastructure" };
  return { decision: "route", agent: "sasha", priority: "p2", matched_rule: "fallback:default" };
}

/**
 * Decide how to route a failure event. PURE function of (event, config).
 *
 * @returns {{decision:"route"|"skip", agent?:string, priority?:string,
 *            canary?:boolean, matched_rule:string,
 *            config_version:(number|null), config_hash:(string|null)}}
 */
export function decideRoute(event, config) {
  // Support legacy bare-string callers (reason as a string).
  if (typeof event === "string") event = { payload: { reason: event } };
  const version = config?.version ?? null;
  const hash = configHash(config);
  if (config?.rules?.length) {
    for (const rule of config.rules) {
      if (!matchPredicate(rule.when, event)) continue;
      if (rule.skip_todo) {
        return { decision: "skip", matched_rule: rule.name, config_version: version, config_hash: hash };
      }
      if (rule.route) {
        return {
          decision: "route",
          agent: rule.route.agent,
          priority: rule.route.priority,
          canary: rule.route.canary === true,
          matched_rule: rule.name,
          config_version: version,
          config_hash: hash,
        };
      }
    }
  }
  const fb = fallbackLadder(event);
  return { ...fb, config_version: version, config_hash: hash };
}
