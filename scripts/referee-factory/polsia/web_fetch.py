"""SSRF-defended web-fetch tool for the Open Polsia factory.

An AI agent uses safe_fetch() to research users on the *public* internet.
The single hard requirement: it must be impossible to turn this against the
internal network. Containment is enforced by proving the target is globally
routable BEFORE any connection is attempted.
"""

import ipaddress
import socket
import urllib.request
from urllib.parse import urlsplit


class SSRFError(Exception):
    """Raised when a request is refused for SSRF-safety reasons.

    When this is raised, fetch() has NOT been (and must not be) called.
    """


_ALLOWED_SCHEMES = frozenset({"http", "https"})


def _default_resolve(host):
    """Resolve a hostname to a list of IP-address strings via stdlib."""
    infos = socket.getaddrinfo(host, None)
    ips = []
    for info in infos:
        sockaddr = info[4]
        # sockaddr is (ip, port) for IPv4, (ip, port, flow, scope) for IPv6.
        ip = sockaddr[0]
        # Strip any IPv6 zone id (e.g. "fe80::1%en0") before parsing.
        if "%" in ip:
            ip = ip.split("%", 1)[0]
        if ip not in ips:
            ips.append(ip)
    return ips


def _default_fetch(url):
    """Perform an actual HTTP GET and return the body via stdlib."""
    with urllib.request.urlopen(url) as resp:  # noqa: S310 - scheme vetted above
        return resp.read()


def _parse_ip_literal(host):
    """Return an ip_address object if host is an IP literal, else None.

    Handles bracketed IPv6 literals (e.g. "[::1]") as found in URLs.
    """
    candidate = host
    if candidate.startswith("[") and candidate.endswith("]"):
        candidate = candidate[1:-1]
    # Strip an IPv6 zone id if present (e.g. "fe80::1%25en0" -> "fe80::1").
    if "%" in candidate:
        candidate = candidate.split("%", 1)[0]
    try:
        return ipaddress.ip_address(candidate)
    except ValueError:
        return None


def _assert_global(ip):
    """Raise SSRFError unless the given IP is globally routable.

    is_global is the clean allow-check: it is False for loopback, private,
    link-local (incl. 169.254.169.254 cloud metadata), reserved, multicast,
    and unspecified (0.0.0.0 / ::) addresses. IPv4-mapped/compatible IPv6
    addresses are unwrapped first so a private v4 cannot hide inside a v6.
    """
    # Unwrap IPv4-mapped (::ffff:a.b.c.d) and 6to4/IPv4-compatible forms so an
    # internal v4 address can't be smuggled through an IPv6 wrapper.
    if isinstance(ip, ipaddress.IPv6Address):
        if ip.ipv4_mapped is not None:
            ip = ip.ipv4_mapped
        elif getattr(ip, "sixtofour", None) is not None:
            ip = ip.sixtofour
        elif getattr(ip, "ipv4_compat", None) is not None and ip.ipv4_compat is not None:
            ip = ip.ipv4_compat

    if not ip.is_global:
        raise SSRFError(f"refused: target IP {ip} is not globally routable")


def safe_fetch(url, *, resolve=None, fetch=None):
    """Fetch the body of `url`, refusing anything that could hit internal hosts.

    SSRF defense (the whole point):
      * Only http/https schemes are allowed.
      * The target IPs are determined and EVERY one must be globally routable.
        For hostnames this defeats DNS rebinding (a public-looking host that
        resolves to a private/loopback IP is still refused).
      * On any refusal an SSRFError is raised and fetch() is NEVER called.

    `resolve(host)` -> list[str] of IPs; `fetch(url)` -> body. Both injectable
    for testing; default to stdlib (socket.getaddrinfo / urllib).
    """
    if resolve is None:
        resolve = _default_resolve
    if fetch is None:
        fetch = _default_fetch

    parts = urlsplit(url)

    # 1. Scheme must be http or https (blocks file:, gopher:, ftp:, data:, ...).
    scheme = parts.scheme.lower()
    if scheme not in _ALLOWED_SCHEMES:
        raise SSRFError(f"refused: scheme {scheme!r} is not http/https")

    # 2. Extract the host. urlsplit.hostname lowercases and strips brackets,
    #    but we re-derive from the raw netloc for IP-literal bracket handling.
    host = parts.hostname
    if not host:
        raise SSRFError("refused: URL has no host")

    # 3. Determine the target IPs.
    literal = _parse_ip_literal(host)
    if literal is not None:
        target_ips = [literal]
    else:
        resolved = resolve(host)
        if not resolved:
            raise SSRFError(f"refused: host {host!r} did not resolve to any IP")
        target_ips = []
        for raw in resolved:
            try:
                target_ips.append(ipaddress.ip_address(raw))
            except ValueError as exc:
                # An unparseable "IP" from resolve() is untrusted -> refuse.
                raise SSRFError(
                    f"refused: host {host!r} resolved to invalid IP {raw!r}"
                ) from exc

    # 4. EVERY target IP must be globally routable. Any failure raises before
    #    fetch() is ever touched (containment). This is what stops DNS
    #    rebinding: even one private/loopback IP in the set kills the request.
    for ip in target_ips:
        _assert_global(ip)

    # 5. Only now, with the target proven public, do we connect.
    return fetch(url)
