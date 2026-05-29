"""INDEPENDENT acceptance for connect-time IP PINNING (DNS-rebind / TOCTOU defense).
Deterministic + offline. New contract:
    safe_fetch(url, *, resolve, connect) -> body
  resolve(host)->list[ip] (MAY return different IPs on repeated calls — simulating
  a rebind). connect(ip, port, host)->body connects to a SPECIFIC ip. A correct
  impl resolves ONCE, vets, and connects to the VETTED ip (pinned). A non-pinning
  impl re-resolves and connects to whatever DNS now says (loopback) -> caught here
  because connect() receives a non-global ip. Referee-authored.

Usage: python accept_webfetch_pinned.py <solution.py>
"""
from __future__ import annotations
import importlib.util, ipaddress, sys
spec = importlib.util.spec_from_file_location("sol_pin", sys.argv[1])
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
safe_fetch = mod.safe_fetch

# per-host resolution sequences; rebind host flips public -> loopback on 2nd call
RESOLVE = {
    "openpolsia.com": [["93.184.216.34"]], "api.stripe.com": [["151.101.1.69"]],
    "localhost": [["127.0.0.1"]], "metadata.google.internal": [["169.254.169.254"]],
    "internal.cloudflare": [["10.1.2.3"]],
    "rebind.evil.com": [["93.184.216.34"], ["127.0.0.1"]],  # vetting sees public, connect-time rebinds to loopback
}
calls, connected = {}, []
def resolve(host):
    seq = RESOLVE.get(host)
    if seq is None: raise RuntimeError(f"unknown host {host}")
    n = calls.get(host, 0); calls[host] = n + 1
    return seq[min(n, len(seq) - 1)]
def connect(ip, port, host):
    connected.append(ip); return "BODY"

def is_global(ip):
    try: return ipaddress.ip_address(ip).is_global
    except ValueError: return False

allow = ["https://openpolsia.com/", "https://api.stripe.com/v1", "http://rebind.evil.com/"]
refuse = ["http://localhost/", "http://127.0.0.1/", "http://169.254.169.254/", "http://metadata.google.internal/",
          "http://10.0.0.5/", "http://192.168.1.1/", "http://[::1]/", "http://0.0.0.0/", "http://internal.cloudflare/",
          "file:///etc/passwd", "gopher://127.0.0.1/"]
fails = []
for u in allow:
    connected.clear()
    try:
        safe_fetch(u, resolve=resolve, connect=connect)
    except Exception as e:
        fails.append(f"public URL {u} wrongly refused: {type(e).__name__}: {e}"); continue
    if not connected:
        fails.append(f"public URL {u} never connected")
    elif not all(is_global(ip) for ip in connected):
        fails.append(f"PIN BREACH: {u} connected to NON-GLOBAL ip {connected} (DNS-rebind succeeded)")
for u in refuse:
    connected.clear()
    try:
        safe_fetch(u, resolve=resolve, connect=connect); fails.append(f"SSRF: {u} not refused")
    except Exception:
        pass
    if connected: fails.append(f"SSRF CONTAINMENT BREACH: {u} connected to {connected}")
if fails:
    print("WEBFETCH_PIN_ACCEPT_FAIL"); [print("  -", f) for f in fails]; sys.exit(1)
print(f"WEBFETCH_PIN_ACCEPT_PASS: {len(allow)} public connected to vetted IP (incl. rebind pinned), {len(refuse)} SSRF refused+contained"); sys.exit(0)
