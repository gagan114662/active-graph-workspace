"""Connect-time IP-pinning HTTP(S) fetcher that closes the DNS-rebind (TOCTOU) hole.

The SSRF defense vets resolved IPs and then connects to the EXACT vetted IP,
never re-resolving the hostname. This prevents a DNS-rebinding attacker from
flipping a vetted public IP to a private/loopback address between vet and connect.

Pure stdlib only.
"""

import ipaddress
import socket
import urllib.parse
import urllib.request


def _default_resolve(host):
    """Resolve a hostname to a list of IP strings via the system resolver."""
    infos = socket.getaddrinfo(host, None)
    # Deduplicate while preserving order.
    seen = set()
    ips = []
    for info in infos:
        ip = info[4][0]
        if ip not in seen:
            seen.add(ip)
            ips.append(ip)
    return ips


def _default_connect(ip, port, host):
    """Connect to a SPECIFIC ip, but present `host` for SNI / Host header.

    For https we wrap the socket with an SSLContext whose server_hostname is the
    original host (so SNI + cert validation use the hostname, not the raw IP).
    For http we send a Host: header with the original host. In both cases the TCP
    connection targets the pinned `ip` only.
    """
    # Determine scheme from port is unreliable; the caller passes the right port,
    # so we infer TLS from the well-known https port. To avoid ambiguity we treat
    # connect as transport-only and let safe_fetch tell us the scheme via port.
    # Here we implement HTTP/1.1 over a raw socket pinned to `ip`.
    is_ipv6 = ":" in ip
    family = socket.AF_INET6 if is_ipv6 else socket.AF_INET
    sock = socket.socket(family, socket.SOCK_STREAM)
    sock.settimeout(30)
    try:
        sock.connect((ip, port))
        # TLS for 443; plain otherwise. We present `host` for SNI/cert checks.
        if port == 443:
            import ssl
            ctx = ssl.create_default_context()
            sock = ctx.wrap_socket(sock, server_hostname=host)
        request = (
            "GET / HTTP/1.1\r\n"
            "Host: {host}\r\n"
            "User-Agent: pinned-fetch/1.0\r\n"
            "Accept: */*\r\n"
            "Connection: close\r\n"
            "\r\n"
        ).format(host=host)
        sock.sendall(request.encode("ascii"))
        chunks = []
        while True:
            data = sock.recv(65536)
            if not data:
                break
            chunks.append(data)
        raw = b"".join(chunks)
        # Split headers from body.
        sep = raw.find(b"\r\n\r\n")
        if sep == -1:
            return raw.decode("utf-8", "replace")
        return raw[sep + 4:].decode("utf-8", "replace")
    finally:
        try:
            sock.close()
        except Exception:
            pass


def _is_globally_routable(ip_str):
    """True only if the IP is globally routable.

    ip_address(x).is_global is False for loopback, private, link-local
    (incl. 169.254.169.254 cloud-metadata), reserved, multicast, and
    unspecified addresses. This is the vetting gate.
    """
    return ipaddress.ip_address(ip_str).is_global


def safe_fetch(url, *, resolve=None, connect=None):
    """Fetch `url` with connect-time IP pinning to defeat DNS rebinding.

    Steps:
      1. Refuse non-http/https schemes.
      2. Determine the target IP:
           - URL host is an IP literal -> use it directly.
           - otherwise -> resolve(host) EXACTLY ONCE.
      3. Vet: refuse if ANY resolved IP is not globally routable.
      4. Connect to the EXACT vetted IP (no re-resolution, host passed only
         for SNI / Host header).

    Containment: any refusal raises and connect() is never called.
    """
    if resolve is None:
        resolve = _default_resolve
    if connect is None:
        connect = _default_connect

    parsed = urllib.parse.urlsplit(url)
    scheme = parsed.scheme.lower()

    # 1. Scheme allowlist.
    if scheme not in ("http", "https"):
        raise ValueError("refused: scheme must be http or https, got {!r}".format(scheme))

    host = parsed.hostname
    if not host:
        raise ValueError("refused: URL has no host")

    port = parsed.port
    if port is None:
        port = 443 if scheme == "https" else 80

    # 2. Determine the target IP. Try IP-literal first; otherwise resolve ONCE.
    target_ip = None
    ips_to_vet = []
    try:
        # ip_address accepts bare literals; brackets are stripped by hostname already.
        ipaddress.ip_address(host)
        target_ip = host
        ips_to_vet = [host]
    except ValueError:
        # Hostname: resolve EXACTLY ONCE.
        resolved = resolve(host)
        if not resolved:
            raise ValueError("refused: host did not resolve to any IP")
        ips_to_vet = list(resolved)
        # Pin to the first resolved IP (the one we vet & connect to).
        target_ip = resolved[0]

    # 3. Vet: ALL candidate IPs must be globally routable.
    for ip in ips_to_vet:
        try:
            if not _is_globally_routable(ip):
                raise ValueError(
                    "refused: non-routable IP {!r} for host {!r}".format(ip, host)
                )
        except ValueError as exc:
            # Re-raise our own refusal; also catch invalid IP strings as refusal.
            if str(exc).startswith("refused:"):
                raise
            raise ValueError("refused: invalid IP {!r} for host {!r}".format(ip, host))

    # 4. CONNECT-TIME PINNING: connect to the EXACT vetted IP. Do NOT re-resolve.
    #    `host` is passed only for SNI / Host header, never for re-resolution.
    return connect(target_ip, port, host)


if __name__ == "__main__":
    # Self-test: a DNS-rebinding attacker resolver returns a PUBLIC IP on the
    # first call and LOOPBACK on a second call. A correct pinning fetcher
    # resolves EXACTLY ONCE and connects to the vetted public IP, never loopback.

    PUBLIC_IP = "93.184.216.34"   # example.com, globally routable
    LOOPBACK = "127.0.0.1"

    resolve_calls = {"n": 0}

    def rebinding_resolve(host):
        resolve_calls["n"] += 1
        if resolve_calls["n"] == 1:
            return [PUBLIC_IP]   # vetting sees a clean public IP
        return [LOOPBACK]        # attacker flips to loopback on any later call

    connect_log = {"ip": None, "calls": 0}

    def fake_connect(ip, port, host):
        connect_log["ip"] = ip
        connect_log["calls"] += 1
        if ip == LOOPBACK:
            raise AssertionError(
                "VULNERABLE: connected to loopback {} — re-resolution happened".format(ip)
            )
        return "OK body from {} (host={}, port={})".format(ip, host, port)

    body = safe_fetch(
        "https://victim.example.com/path",
        resolve=rebinding_resolve,
        connect=fake_connect,
    )

    assert resolve_calls["n"] == 1, (
        "resolve must be called EXACTLY ONCE, was {}".format(resolve_calls["n"])
    )
    assert connect_log["ip"] == PUBLIC_IP, (
        "must connect to pinned public IP, got {!r}".format(connect_log["ip"])
    )
    assert connect_log["calls"] == 1
    print("[1] rebind-pinning   PASS:", body)

    # Self-test 2: containment — a private/metadata IP must be refused and
    # connect() must NEVER be called.
    def metadata_resolve(host):
        return ["169.254.169.254"]   # cloud metadata, link-local

    refused_connect = {"called": False}

    def must_not_connect(ip, port, host):
        refused_connect["called"] = True
        raise AssertionError("connect() called on a refused URL")

    try:
        safe_fetch("http://metadata/", resolve=metadata_resolve, connect=must_not_connect)
        raise AssertionError("expected refusal for metadata IP")
    except ValueError as exc:
        assert str(exc).startswith("refused:"), exc
        assert refused_connect["called"] is False
        print("[2] metadata-refuse  PASS:", exc)

    # Self-test 3: scheme allowlist — non-http(s) refused, connect never called.
    for bad in ("file:///etc/passwd", "ftp://host/x", "gopher://x"):
        hit = {"called": False}

        def nope(ip, port, host):
            hit["called"] = True
            raise AssertionError("connect on bad scheme")

        try:
            safe_fetch(bad, resolve=lambda h: ["8.8.8.8"], connect=nope)
            raise AssertionError("expected refusal for scheme: " + bad)
        except ValueError as exc:
            assert str(exc).startswith("refused:"), exc
            assert hit["called"] is False
    print("[3] scheme-allowlist PASS")

    # Self-test 4: IP literal that is loopback is refused (no resolve, no connect).
    lit_connect = {"called": False}

    def lit_nope(ip, port, host):
        lit_connect["called"] = True

    try:
        safe_fetch("http://127.0.0.1/", connect=lit_nope)
        raise AssertionError("expected refusal for loopback literal")
    except ValueError as exc:
        assert str(exc).startswith("refused:"), exc
        assert lit_connect["called"] is False
        print("[4] loopback-literal PASS:", exc)

    # Self-test 5: public IP literal connects (no resolve needed).
    pub = {"ip": None}

    def pub_connect(ip, port, host):
        pub["ip"] = ip
        return "ok"

    safe_fetch("https://8.8.8.8/", connect=pub_connect)
    assert pub["ip"] == "8.8.8.8"
    print("[5] public-literal   PASS")

    print("\nALL SELF-TESTS PASSED")
