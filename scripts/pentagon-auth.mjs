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
    supabaseOrigin: new URL(claims.iss).origin,
    operatorId: claims.sub,
  };
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
