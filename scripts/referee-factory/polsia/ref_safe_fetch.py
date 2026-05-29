"""Correct SSRF-defended fetcher (positive control)."""
import ipaddress, socket
from urllib.parse import urlparse
class SsrfBlocked(Exception): pass
def _ips(host, resolve):
    h = host.strip("[]")
    try:
        return [str(ipaddress.ip_address(h))]  # IP literal
    except ValueError:
        pass
    return list(resolve(host)) if resolve else [ai[4][0] for ai in socket.getaddrinfo(host, None)]
def safe_fetch(url, *, resolve=None, fetch=None):
    p = urlparse(url)
    if p.scheme not in ("http", "https"): raise SsrfBlocked(f"scheme {p.scheme!r} not allowed")
    if not p.hostname: raise SsrfBlocked("no host")
    ips = _ips(p.hostname, resolve)
    if not ips: raise SsrfBlocked("no IPs resolved")
    for ip in ips:
        if not ipaddress.ip_address(ip).is_global:
            raise SsrfBlocked(f"non-public IP {ip} for host {p.hostname}")
    f = fetch or (lambda u: __import__("urllib.request", fromlist=["urlopen"]).urlopen(u, timeout=10).read())
    return f(url)
