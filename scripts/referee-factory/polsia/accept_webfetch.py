"""INDEPENDENT SSRF acceptance for the Polsia web-fetch tool. Deterministic + OFFLINE:
injects a resolver (hostname->IPs) and a fetch-spy, so we test the VETTING decision
without real network. Contract:
    safe_fetch(url, *, resolve, fetch) -> body
  resolve(host)->list[ip]; fetch(url)->body. The tool must refuse non-http(s)
  schemes and any URL whose host resolves to a non-public IP (loopback, private,
  link-local incl. 169.254.169.254 metadata, reserved), and MUST NOT call fetch()
  for a refused URL (containment: never even connect). Referee-authored.

Usage: python accept_webfetch.py <solution-module.py>
"""
from __future__ import annotations
import importlib.util, sys
spec = importlib.util.spec_from_file_location("sol_webfetch", sys.argv[1])
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
safe_fetch = mod.safe_fetch

RESOLVE = {
    "openpolsia.com": ["93.184.216.34"], "api.stripe.com": ["151.101.1.69"],
    "localhost": ["127.0.0.1"], "metadata.google.internal": ["169.254.169.254"],
    "internal.cloudflare": ["10.1.2.3"], "rebind.evil.com": ["127.0.0.1"],  # DNS-rebinding
}
fetched = []
def resolve(host):
    if host in RESOLVE: return RESOLVE[host]
    raise RuntimeError(f"unknown host {host}")
def fetch(url):
    fetched.append(url); return "BODY:" + url

allow = ["https://openpolsia.com/", "https://api.stripe.com/v1/charges"]
refuse = [
    "http://localhost:8787/", "http://127.0.0.1/", "http://169.254.169.254/latest/meta-data/",
    "http://metadata.google.internal/", "http://10.0.0.5/", "http://192.168.1.1/",
    "http://172.16.5.5/", "http://[::1]/", "http://0.0.0.0/", "http://internal.cloudflare/",
    "http://rebind.evil.com/", "file:///etc/passwd", "gopher://127.0.0.1:7000/",
]
fails = []
for u in allow:
    fetched.clear()
    try:
        safe_fetch(u, resolve=resolve, fetch=fetch)
    except Exception as e:
        fails.append(f"public URL {u} wrongly refused: {type(e).__name__}: {e}"); continue
    if u not in fetched: fails.append(f"public URL {u} not actually fetched")
for u in refuse:
    fetched.clear()
    try:
        safe_fetch(u, resolve=resolve, fetch=fetch)
        fails.append(f"SSRF: {u} was NOT refused")
    except Exception:
        pass
    if fetched:
        fails.append(f"SSRF CONTAINMENT BREACH: {u} reached fetch() -> {fetched}")
if fails:
    print("WEBFETCH_ACCEPT_FAIL"); [print("  -", f) for f in fails]; sys.exit(1)
print(f"WEBFETCH_ACCEPT_PASS: {len(allow)} public allowed, {len(refuse)} SSRF attacks refused + contained"); sys.exit(0)
