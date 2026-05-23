#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const ROOT = "/Users/gaganarora/Desktop/my projects/active_graph";
const PLIST = "/Users/gaganarora/Library/Preferences/run.pentagon.app.plist";
const PENTAGON_BIN = "/Applications/Pentagon.app/Contents/MacOS/Pentagon";
const BRIDGE_LOG = "/Users/gaganarora/.pentagon/trigger-bridge.out.log";

function arg(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  return idx === -1 ? fallback : process.argv[idx + 1] ?? fallback;
}

function decodeJwtPayload(jwt) {
  const part = jwt.split(".")[1];
  const padded = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
  return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
}

function readSession() {
  const raw = execFileSync("/usr/libexec/PlistBuddy", [
    "-c",
    "Print :supabase.auth.sb-auth-auth-token",
    PLIST,
  ], { encoding: "utf8" });
  const session = JSON.parse(raw);
  const accessToken = session.accessToken;
  const supabaseOrigin = new URL(decodeJwtPayload(accessToken).iss).origin;
  const anonKey = execFileSync("zsh", [
    "-lc",
    "strings " + JSON.stringify(PENTAGON_BIN) + " | rg '^eyJ' | head -1",
  ], { encoding: "utf8" }).trim();
  return { accessToken, supabaseOrigin, anonKey };
}

async function supabase(state, path) {
  const res = await fetch(state.supabaseOrigin + path, {
    headers: {
      apikey: state.anonKey,
      Authorization: "Bearer " + state.accessToken,
      Accept: "application/json",
    },
  });
  const text = await res.text();
  let parsed = text;
  try { parsed = JSON.parse(text); } catch {}
  if (!res.ok) throw new Error(path + " failed " + res.status + ": " + JSON.stringify(parsed));
  return parsed;
}

function addSeconds(iso, seconds) {
  return new Date(new Date(iso).getTime() + seconds * 1000).toISOString();
}

function bridgeEvidence(triggerId, hash, ackMessageId) {
  const text = existsSync(BRIDGE_LOG) ? readFileSync(BRIDGE_LOG, "utf8") : "";
  return {
    bridge_log_path: BRIDGE_LOG,
    trigger_id_matches: (text.match(new RegExp(triggerId, "g")) ?? []).length,
    hash_matches: hash ? (text.match(new RegExp(hash, "g")) ?? []).length : 0,
    ack_message_id_matches: ackMessageId ? (text.match(new RegExp(ackMessageId, "g")) ?? []).length : 0,
  };
}

async function main() {
  const triggerId = arg("--trigger-id");
  const hash = arg("--hash");
  const nativeWindowSeconds = Number(arg("--native-window-seconds", "30"));
  const maxAgeSeconds = Number(arg("--bridge-max-age-seconds", "180"));
  if (!triggerId || !hash) {
    throw new Error("usage: node scripts/audit-pentagon-trigger-attribution.mjs --trigger-id <uuid> --hash <hash> [--native-window-seconds 30]");
  }

  const state = readSession();
  const triggerRows = await supabase(
    state,
    "/rest/v1/agent_triggers?id=eq." + triggerId + "&select=*&limit=1"
  );
  if (!triggerRows.length) throw new Error("trigger not found: " + triggerId);
  const trigger = triggerRows[0];
  const nativeWindowEndedAt = addSeconds(trigger.created_at, nativeWindowSeconds);
  const bridgeAgeWindowEndedAt = addSeconds(trigger.created_at, maxAgeSeconds);

  const messages = await supabase(
    state,
    "/rest/v1/messages?conversation_id=eq." + trigger.conversation_id + "&content=ilike.*" + encodeURIComponent(hash) + "*&select=*&order=created_at.asc&limit=20"
  );
  const ackRows = messages.filter((message) => message.sender_id === trigger.agent_id);
  const ack = ackRows[0] ?? null;
  const bridge = bridgeEvidence(triggerId, hash, ack?.id);

  const claimedAt = trigger.claimed_at ? new Date(trigger.claimed_at).getTime() : null;
  const completedAt = trigger.completed_at ? new Date(trigger.completed_at).getTime() : null;
  const ackAt = ack?.created_at ? new Date(ack.created_at).getTime() : null;
  const nativeEnd = new Date(nativeWindowEndedAt).getTime();
  const bridgeAgeEnd = new Date(bridgeAgeWindowEndedAt).getTime();
  const hasBridgeProof = bridge.trigger_id_matches > 0 && (bridge.hash_matches > 0 || bridge.ack_message_id_matches > 0);

  let classification = "still_pending";
  if (claimedAt && completedAt && ackAt && claimedAt <= nativeEnd && completedAt <= nativeEnd && ackAt <= nativeEnd && !hasBridgeProof) {
    classification = "native_window_completed_with_ack";
  } else if (claimedAt && claimedAt <= nativeEnd) {
    classification = hasBridgeProof ? "ambiguous_native_window_with_bridge_log" : "native_window_claim_possible";
  } else if (claimedAt && claimedAt <= bridgeAgeEnd && hasBridgeProof) {
    classification = "bridge_catchup_after_native_window";
  } else if (claimedAt && hasBridgeProof) {
    classification = "late_bridge_or_manual_catchup_after_age_window";
  } else if (claimedAt) {
    classification = "claimed_without_bridge_log_attribution";
  }

  const pendingRows = await supabase(
    state,
    "/rest/v1/agent_triggers?conversation_id=eq." + trigger.conversation_id + "&claimed_at=is.null&completed_at=is.null&select=id,created_at,content&order=created_at.asc&limit=50"
  );

  console.log(JSON.stringify({
    trigger_id: triggerId,
    hash,
    native_window_seconds: nativeWindowSeconds,
    bridge_max_age_seconds: maxAgeSeconds,
    trigger: {
      id: trigger.id,
      conversation_id: trigger.conversation_id,
      agent_id: trigger.agent_id,
      sender_id: trigger.sender_id,
      message_id: trigger.message_id,
      created_at: trigger.created_at,
      claimed_at: trigger.claimed_at,
      completed_at: trigger.completed_at,
    },
    native_window_ended_at: nativeWindowEndedAt,
    bridge_age_window_ended_at: bridgeAgeWindowEndedAt,
    ack_rows: ackRows.map((message) => ({
      id: message.id,
      sender_id: message.sender_id,
      content: message.content,
      created_at: message.created_at,
    })),
    bridge_evidence: bridge,
    classification,
    pending_unclaimed_triggers_in_conversation: pendingRows.map((row) => ({
      id: row.id,
      created_at: row.created_at,
      content_preview: String(row.content ?? "").slice(0, 120),
    })),
  }, null, 2));
}

await main();
