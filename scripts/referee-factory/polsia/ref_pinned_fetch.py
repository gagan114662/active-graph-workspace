"""Correct connect-time-PINNED fetcher (positive control): resolves once, vets, connects to the vetted IP."""
import ipaddress
from urllib.parse import urlsplit
class SsrfBlocked(Exception): pass
def safe_fetch(url, *, resolve, connect):
    p = urlsplit(url)
    if p.scheme not in ("http", "https"): raise SsrfBlocked(f"scheme {p.scheme!r}")
    if not p.hostname: raise SsrfBlocked("no host")
    port = p.port or (443 if p.scheme == "https" else 80)
    h = p.hostname.strip("[]")
    try:
        ips = [str(ipaddress.ip_address(h))]
    except ValueError:
        ips = list(resolve(p.hostname))   # resolve ONCE
    if not ips: raise SsrfBlocked("no ips")
    for ip in ips:
        if not ipaddress.ip_address(ip).is_global: raise SsrfBlocked(f"non-global {ip}")
    return connect(ips[0], port, p.hostname)  # PIN to the vetted ip — no re-resolution
