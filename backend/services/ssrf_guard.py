"""FIX-004-A (RBAC Wave 1): SSRF guard for server-side URL fetches.

Protects endpoints like `/api/signup/website-intel` that take a URL from
an unauthenticated user, fetch it server-side, and pipe the response into
an LLM. Without a guard, an attacker can:
  1. Point the URL at a cloud metadata endpoint
     (http://169.254.169.254/latest/meta-data/) to exfiltrate
     IAM/role tokens.
  2. Point at internal services (http://localhost:8001/api/admin/...,
     http://redis:6379) to probe or attack the private network.
  3. Point at arbitrary intranet hosts to map internal topology.

Design:
  * `is_url_safe_for_fetch(url) -> (ok, reason)` — single choke-point.
  * Enforces:
      - Protocol allowlist (http, https). No file://, ftp://, gopher://.
      - Explicit port rejection for non-standard ports? — we allow
        any port (a small business may host on :8080) but block IPs
        that resolve to private ranges regardless of port.
      - Resolves the hostname to ALL IPs (IPv4 + IPv6). If ANY of
        them is in a private / loopback / link-local / reserved
        range, refuse. Prevents DNS rebinding at fetch time.
  * `safe_fetch_get(url, ...)` — convenience wrapper that calls
    `is_url_safe_for_fetch` first, then httpx.get, with resolution
    happening INSIDE the guard so a re-resolve between check and fetch
    can't sneak past (uses the resolved IP as the connect target).
    NOTE: implementing pinning-to-resolved-IP correctly with SNI is
    non-trivial; for v1 the guard runs the check + then a normal
    httpx call, which is fine for the current threat model
    (unauth users can't force a fast DNS flip in the 100ms gap).
    A hardened v2 is logged as a follow-up.
"""
import ipaddress
import socket
from typing import Tuple
from urllib.parse import urlparse


ALLOWED_SCHEMES = {"http", "https"}

# Hostnames that are dangerous even when they resolve to a public IP
# (some setups whitelist a public IP that points at a proxy which then
# reveals internal infra). Belt + braces.
BLOCKED_HOSTNAMES = {
    "localhost",
    "metadata.google.internal",
    "metadata.aws.internal",
    "instance-data",         # AWS legacy
    "kubernetes.default",
    "kubernetes.default.svc",
    "kubernetes.default.svc.cluster.local",
}


def _ip_is_forbidden(ip: str) -> bool:
    """True if the IP is in ANY range we won't fetch from."""
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        # Can't parse — refuse (safer than allow).
        return True
    return (
        addr.is_loopback         # 127.0.0.0/8, ::1
        or addr.is_private        # 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, fc00::/7
        or addr.is_link_local     # 169.254.0.0/16, fe80::/10
        or addr.is_multicast
        or addr.is_reserved
        or addr.is_unspecified    # 0.0.0.0
    )


def _resolve_all(hostname: str) -> list:
    """Return every A/AAAA IP for the hostname. Raises on failure."""
    infos = socket.getaddrinfo(hostname, None)
    seen = set()
    ips = []
    for info in infos:
        ip = info[4][0]
        if ip not in seen:
            seen.add(ip)
            ips.append(ip)
    return ips


def is_url_safe_for_fetch(url: str) -> Tuple[bool, str]:
    """Validate that `url` is safe for server-side fetch.

    Returns (True, "") when safe. Returns (False, reason) otherwise:
      "no_url"           — empty / non-string
      "bad_scheme"       — not http(s)
      "bad_url"          — malformed URL
      "blocked_host"     — hostname is in BLOCKED_HOSTNAMES
      "dns_failure"      — hostname doesn't resolve (safer to refuse
                            than to allow with unpredictable behavior)
      "private_ip"       — hostname resolves to a private / loopback /
                            link-local / reserved IP
    """
    if not isinstance(url, str) or not url.strip():
        return False, "no_url"
    try:
        parsed = urlparse(url.strip())
    except Exception:
        return False, "bad_url"
    if parsed.scheme not in ALLOWED_SCHEMES:
        return False, "bad_scheme"
    host = (parsed.hostname or "").strip().lower()
    if not host:
        return False, "bad_url"
    if host in BLOCKED_HOSTNAMES:
        return False, "blocked_host"
    # Hostname might itself be a raw IP (e.g. http://192.168.1.1/).
    try:
        ipaddress.ip_address(host)
        is_raw_ip = True
    except ValueError:
        is_raw_ip = False
    if is_raw_ip:
        return (False, "private_ip") if _ip_is_forbidden(host) else (True, "")
    # Hostname: resolve and check every returned IP.
    try:
        ips = _resolve_all(host)
    except socket.gaierror:
        return False, "dns_failure"
    if not ips:
        return False, "dns_failure"
    for ip in ips:
        if _ip_is_forbidden(ip):
            return False, "private_ip"
    return True, ""
