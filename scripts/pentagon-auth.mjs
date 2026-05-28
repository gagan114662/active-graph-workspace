// Pentagon Supabase auth — pure-function helpers shared by the bridge,
// pentagon-rest.mjs, and the runner.
//
// Each of those files needs to read Pentagon's stored Supabase session +
// the embedded anon key. Before this module they each had their own copy
// of decodeJwtPayload + readSession + readAnonKey + isExpiredJwtResponse.
// Three copies meant three places to fix when the plist key shape changes
// or PGRST adds a new expiry code. This file is the single source of truth.
//
// What stays per-file:
//   - the HTTP `request()` wrapper, because each file owns its own
//     `state` singleton (bridge uses module-level `state` rebound by
//     refreshSession(); pentagon-rest uses an enclosed `_state`)
//   - the JWT-refresh retry policy, because the bridge wants to log
//     refresh as a factory event whereas pentagon-rest stays silent
//
// What lives here:
//   - decodeJwtPayload(jwt) → claims object
//   - readSession() → { accessToken, supabaseOrigin, operatorId }
//   - readAnonKey() → string anon key
//   - isExpiredJwtResponse(status, parsed) → boolean
//
// Task #23 (refactor pentagon helpers) per
// frames/codex-goals/factory-fully-autonomous-goal-20260528.md.

import { execFileSync } from "node:child_process";

const PLIST = "/Users/gaganarora/Library/Preferences/run.pentagon.app.plist";
const PENTAGON_BIN = "/Applications/Pentagon.app/Contents/MacOS/Pentagon";

/**
 * Decode a JWT payload (middle segment) without verifying signature.
 * Used to extract the issuer (Supabase URL) and the sub (operator id).
 */
export function decodeJwtPayload(jwt) {
  const part = jwt.split(".")[1];
  const padded = part
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(part.length / 4) * 4, "=");
  return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
}

/**
 * Read Pentagon's stored Supabase session from its plist. Returns the
 * canonical shape both bridge + pentagon-rest agreed on: accessToken,
 * supabaseOrigin, operatorId. Throws if the plist key is missing
 * (Pentagon not logged in).
 */
export function readSession() {
  const raw = execFileSync(
    "/usr/libexec/PlistBuddy",
    ["-c", "Print :supabase.auth.sb-auth-auth-token", PLIST],
    { encoding: "utf8" }
  );
  const session = JSON.parse(raw);
  const accessToken = session.accessToken;
  const claims = decodeJwtPayload(accessToken);
  return {
    accessToken,
    refreshToken: session.refreshToken ?? null,
    supabaseOrigin: new URL(claims.iss).origin,
    operatorId: claims.sub,
  };
}

/**
 * Exchange a Supabase refresh token for a fresh access token via the auth
 * gateway. This is the AUTHORITATIVE refresh — unlike re-reading the plist, it
 * produces a token the server will accept even when the plist's accessToken was
 * rotated/invalidated despite a future `exp` (the exact 401 that bit
 * pentagon-rest/Phoenix on 2026-05-28).
 *
 * Callers should prefer a plist RE-READ first (free, and avoids refresh-token
 * rotation churn — the documented OAuth refresh-token-reuse trap) and only fall
 * back to this grant when the re-read token is unchanged/still failing. Returns
 * the raw token response `{ access_token, refresh_token, expires_at, ... }`.
 * Does NOT write back to the plist — Pentagon.app owns that file.
 */
export async function refreshAccessToken({ refreshToken, supabaseOrigin, anonKey }) {
  if (!refreshToken) throw new Error("refreshAccessToken: no refresh token in Pentagon session");
  const res = await fetch(supabaseOrigin + "/auth/v1/token?grant_type=refresh_token", {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  let j = {};
  try { j = await res.json(); } catch {}
  if (!res.ok || !j.access_token) {
    throw new Error(`refresh_token grant failed ${res.status}: ${JSON.stringify(j).slice(0, 200)}`);
  }
  return j;
}

/**
 * Is a decoded access token at/near expiry? Used to decide whether a plist
 * re-read actually helped or we still need a real grant. `skewSeconds` guards
 * against clock drift + in-flight latency.
 */
export function isAccessTokenExpired(accessToken, skewSeconds = 30) {
  try {
    const { exp } = decodeJwtPayload(accessToken);
    return !exp || exp <= Math.floor(Date.now() / 1000) + skewSeconds;
  } catch {
    return true;
  }
}

/**
 * Extract the embedded Supabase anon key from the Pentagon binary. Cached
 * in the caller's state since the binary doesn't change between sessions.
 */
export function readAnonKey() {
  const out = execFileSync(
    "zsh",
    ["-lc", `strings "${PENTAGON_BIN}" | rg '^eyJ' | head -1`],
    { encoding: "utf8" }
  ).trim();
  if (!out) throw new Error("Could not find embedded Supabase anon key in Pentagon binary.");
  return out;
}

/**
 * Detect an "expired JWT" response from PostgREST so the caller can refresh
 * and retry. Both PGRST303 (PostgREST 11+) and the legacy "jwt expired"
 * message are recognized.
 */
export function isExpiredJwtResponse(status, parsed) {
  return (
    status === 401 &&
    (parsed?.code === "PGRST303" ||
      /jwt expired/i.test(String(parsed?.message ?? parsed ?? "")))
  );
}
