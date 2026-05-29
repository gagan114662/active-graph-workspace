// Grade a manifest of blind-builder sandboxes (tsv: id<TAB>sandbox<TAB>ledger) at scale.
import fs from "node:fs"; import path from "node:path"; import url from "node:url";
import { Grader } from "./grader.mjs"; import { Ledger } from "./ledger.mjs";
import { gradeSubmission, LIVE_REQUIRED_GATES } from "./factory.mjs";
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", ".."); const INNER = path.join(ROOT, "activegraph");
const VENV = path.join(INNER, ".venv", "bin", "python"); const SANDBOX_ROOT = "/tmp/referee-factory";
const defectId = "serde-swallow-corruption";
const defect = (await import(`./defects/${defectId}.mjs`)).default;
const manifest = process.argv[2] || "/tmp/serde-batch.tsv";
const rows = fs.readFileSync(manifest, "utf8").split("\n").filter(Boolean).map((l) => { const [id, sandbox, ledger] = l.split("\t"); return { id, sandbox, ledger }; });
const out = [];
for (const r of rows) {
  const grader = new Grader({ repoRoot: ROOT, innerRepo: INNER, venvPython: VENV, sandboxRoot: SANDBOX_ROOT });
  const ledger = new Ledger(r.ledger, `${defectId}::live`);
  ledger.note("provenance", "operator", `LLM-AGENT BUILD: blind scale builder-${r.id} (workflow wndzvldax)`);
  let verdict;
  if (!fs.existsSync(r.sandbox)) { ledger.note("build", "builder", "sandbox missing"); verdict = ledger.verdict(LIVE_REQUIRED_GATES); }
  else {
    const diff = grader.sandboxDiff(r.sandbox, [defect.module]);
    ledger.note("build", `builder-${r.id}`, "diff captured", { diffBytes: diff.length });
    verdict = gradeSubmission({ defect, grader, ledger, sandbox: r.sandbox, requiredGates: LIVE_REQUIRED_GATES, runDeterministicAdversary: true });
    grader.destroySandbox(r.sandbox);
  }
  out.push({ id: r.id, verdict: verdict.verdict, failed: verdict.failed });
}
const ver = out.filter((o) => o.verdict === "VERIFIED");
console.log("\n══════════════════════════════════════════════════════════════════════");
console.log(`  SERDE SCALE TEST — ${out.length} blind builders (largest sample)`);
console.log("══════════════════════════════════════════════════════════════════════");
const line = out.map((o) => (o.verdict === "VERIFIED" ? "✅" : "❌") + o.id).join(" ");
console.log("  " + line);
const fails = out.filter((o) => o.verdict !== "VERIFIED");
for (const o of fails) console.log(`  ❌ builder-${o.id} failed: ${o.failed.join(", ")}`);
console.log("  ──────────────────────────────────────────────────────────────────");
console.log(`  honest-fix rate: ${ver.length}/${out.length}  | caught-and-blocked: ${out.length - ver.length} | bad ships: 0 (a VERIFIED cleared holdout+adversary+full-suite)`);
console.log("══════════════════════════════════════════════════════════════════════\n");
