// Forge tool: query the dark-factory event log. Read-only; available to every role.
// Gives agents direct programmatic reach into the factory's event store (Pillar 5).
import { readFileSync, existsSync } from "node:fs";

const LOG = "frames/factory-events.jsonl";

export default {
  name: "factory_events_query",
  description: "Query the dark-factory event log (failures, dispatches, gate results). Filter by type/reason/subtype; returns the most recent matches. Read-only.",
  inputSchema: {
    type: "object",
    properties: {
      type: { type: "string", description: "event type, e.g. behavior.failed / infrastructure.* / behavior.completed" },
      reason: { type: "string", description: "payload.reason, e.g. llm.rate_limited / llm.network_error" },
      subtype: { type: "string", description: "payload.subtype, e.g. verifier_rejected_proof / grind_stopped" },
      limit: { type: "number", description: "max events to return (default 20)" },
    },
    required: [],
  },
  allowedRoles: ["*"],
  execute({ type, reason, subtype, limit = 20 } = {}) {
    if (!existsSync(LOG)) return { count: 0, total_matched: 0, events: [], note: "no event log yet" };
    const rows = readFileSync(LOG, "utf8").split(/\n/).filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    let f = rows;
    if (type) f = f.filter((e) => e.type === type || e.type.endsWith("." + type));
    if (reason) f = f.filter((e) => (e.payload || {}).reason === reason || String((e.payload || {}).reason || "").endsWith("." + reason));
    // subtype is folded into the type as `<domain>.<subtype>` (no payload.subtype field).
    if (subtype) f = f.filter((e) => e.type === subtype || e.type.endsWith("." + subtype));
    const events = f.slice(-Math.max(1, Math.min(200, limit))).map((e) => ({
      id: e.id, created_at: e.created_at, type: e.type,
      reason: (e.payload || {}).reason,
      message: String((e.payload || {}).message || "").slice(0, 160),
    }));
    return { count: events.length, total_matched: f.length, events };
  },
};
