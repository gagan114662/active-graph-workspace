// Records the ONE real-network proof: the SSRF-defended fetcher fetches a real public
// page AND refuses real internal targets — no secrets, no money, no comms. This is the
// honest boundary of "online" before the operator injects live credentials.
import { spawnSync } from "node:child_process";
import path from "node:path"; import url from "node:url";
import { Ledger } from "./ledger.mjs";
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", ".."); const VENV = path.join(ROOT, "activegraph", ".venv", "bin", "python");
const probe = `
import importlib.util
spec=importlib.util.spec_from_file_location("wf","scripts/referee-factory/polsia/web_fetch.py")
m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
pub=0
try:
    b=m.safe_fetch("https://example.com/"); t=b.decode() if isinstance(b,(bytes,bytearray)) else str(b)
    pub=1 if ("<title>" in t.lower() and len(t)>100) else 0
except Exception: pub=0
ref=0
for bad in ["http://localhost:8787/","http://127.0.0.1/","http://169.254.169.254/latest/meta-data/"]:
    try: m.safe_fetch(bad)
    except Exception: ref+=1
print(f"PUB={pub} REF={ref}")
`;
const r = spawnSync(VENV, ["-c", probe], { cwd: ROOT, encoding: "utf8", timeout: 60000 });
const out = (r.stdout || "") + (r.stderr || "");
const mm = out.match(/PUB=(\d) REF=(\d)/) || [, "0", "0"];
const pub = mm[1] === "1", refCount = parseInt(mm[2], 10);
const ts = new Date().toISOString().replace(/[:.]/g, "-");
const L = new Ledger(path.join(ROOT, "frames", "referee", `online-proof-${ts}.proof.jsonl`), "online-proof::real-network");
L.note("control", "harness", "REAL-NETWORK test (no secrets/money/comms): SSRF fetcher vs the live internet");
L.note("provenance", "operator", "OPERATOR-TASK: real-network smoke test of canonical web_fetch.py (non-deterministic by nature; evidence captured)");
L.openGate("real_public_fetch", "grader");
pub ? L.clearGate("real_public_fetch", "grader", {}, "fetched https://example.com over real DNS+HTTP (real <title>, >100 bytes)") : L.failGate("real_public_fetch", "grader", "could not fetch real public URL (env egress?)");
L.openGate("real_ssrf_blocked", "grader");
refCount === 3 ? L.clearGate("real_ssrf_blocked", "grader", { refused: refCount }, "real localhost/127.0.0.1/cloud-metadata all REFUSED against real DNS") : L.failGate("real_ssrf_blocked", "grader", `only ${refCount}/3 internal targets refused`);
const v = L.verdict(["real_public_fetch", "real_ssrf_blocked"]);
console.log(`ONLINE PROOF: ${v.verdict} — public fetch=${pub}, real SSRF blocks=${refCount}/3`);
process.exit(v.verified ? 0 : 1);
