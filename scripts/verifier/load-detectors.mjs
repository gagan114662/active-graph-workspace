// load-detectors.mjs — P12 auto-discovery (open to extension, closed to modification).
//
// Discovers every detector module in ./detectors/ (each exports a `detector`
// object per the contract in detectors/satisfaction-of-search.mjs) and returns
// the registry. Adding a new failure-mode = drop a *.mjs in detectors/; NOTHING
// here or in the central verifier changes. A broken detector is skipped (logged
// to stderr) so it can't take down discovery of the others.

import { readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DETECTORS_DIR = resolve(HERE, "detectors");

export async function loadDetectors(dir = DETECTORS_DIR) {
  let files = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs"));
  } catch {
    return [];
  }
  const out = [];
  for (const f of files.sort()) {
    try {
      const mod = await import(pathToFileURL(resolve(dir, f)).href);
      const d = mod.detector;
      if (d && typeof d.detect === "function" && d.name && d.eventType) {
        out.push(d);
      } else {
        process.stderr.write(`[load-detectors] ${f}: no valid 'detector' export — skipped\n`);
      }
    } catch (e) {
      process.stderr.write(`[load-detectors] ${f}: import failed (${e?.message || e}) — skipped\n`);
    }
  }
  return out;
}
