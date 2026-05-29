"""Non-pinning fetcher (negative control): vets, then RE-RESOLVES at connect (TOCTOU). Must FAIL on rebind."""
import ipaddress
from urllib.parse import urlsplit
class SsrfBlocked(Exception): pass
def safe_fetch(url, *, resolve, connect):
    p = urlsplit(url)
    if p.scheme not in ("http", "https"): raise SsrfBlocked("scheme")
    if not p.hostname: raise SsrfBlocked("no host")
    port = p.port or (443 if p.scheme == "https" else 80)
    h = p.hostname.strip("[]")
    try:
        ips = [str(ipaddress.ip_address(h))]; literal = True
    except ValueError:
        ips = list(resolve(p.hostname)); literal = False
    for ip in ips:
        if not ipaddress.ip_address(ip).is_global: raise SsrfBlocked(f"non-global {ip}")
    fresh = ips[0] if literal else list(resolve(p.hostname))[0]  # BUG: second resolution at connect
    return connect(fresh, port, p.hostname)
