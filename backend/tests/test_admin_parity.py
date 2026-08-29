"""Epic 9 Sprint 10 -- admin API-parity gate (U9-10.4).

A focused contract over the /api/admin surface (the whole-app parity gate in
test_api_parity.py covers the route table; this one asserts admin-specific
invariants that matter for a business-critical console):

  1. every /api/admin route resolves through the platform-admin gate
     (get_platform_admin, directly or via require_admin_role) -- no admin
     endpoint is accidentally left open;
  2. the Sprint 9 compliance routes are all present;
  3. the admin route count matches a committed number, so an admin route
     added or dropped shows up as an explicit diff.

Imports server with a lazy Mongo client -- no DB, no network.
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import pytest

# Bump this when an admin route is intentionally added/removed (same discipline
# as regenerating the whole-app baseline).
EXPECTED_ADMIN_ROUTE_COUNT = 71

# Two /api/admin/* paths are legitimately NOT behind the platform-admin gate:
#   * POST /api/admin/login -- the login entry point, open by design;
#   * GET  /api/admin/audit-log -- a TENANT-owner route (routers/tenant_settings,
#     gated by require_role("owner")) that only shares the /admin/ path prefix;
#     it is the tenant's own audit log, not the platform console.
# Any OTHER ungated admin route is a real security bug.
GATE_EXEMPT = {
    "POST /api/admin/login",
    "GET /api/admin/audit-log",
}

COMPLIANCE_ROUTES = {
    "GET /api/admin/tenants/{tenant_id}/export",
    "GET /api/admin/tenants/{tenant_id}/consent-export",
    "GET /api/admin/tenants/{tenant_id}/retention",
    "PUT /api/admin/tenants/{tenant_id}/retention",
    "GET /api/admin/retention/status",
    "POST /api/admin/retention/run",
    "POST /api/admin/tenants/{tenant_id}/delete-with-export",
    "GET /api/admin/users/{user_id}/dsar",
}


def _admin_routes():
    import server
    out = []
    for r in server.app.routes:
        path = getattr(r, "path", "")
        if not path.startswith("/api/admin"):
            continue
        for m in sorted(getattr(r, "methods", []) or []):
            if m in ("HEAD", "OPTIONS"):
                continue
            out.append((f"{m} {path}", r))
    return out


def test_compliance_routes_present():
    labels = {label for label, _ in _admin_routes()}
    missing = COMPLIANCE_ROUTES - labels
    assert not missing, f"compliance routes missing from the app: {missing}"


def test_every_admin_route_is_gated():
    """No /api/admin route may be reachable without the platform-admin
    dependency. We inspect each route's dependant tree for get_platform_admin
    (require_admin_role wraps it, so it shows up transitively)."""
    from core.security import get_platform_admin
    ungated = []
    for label, r in _admin_routes():
        dep = getattr(r, "dependant", None)
        calls = set()

        def _walk(d):
            if d is None:
                return
            if getattr(d, "call", None) is not None:
                calls.add(d.call)
            for sub in getattr(d, "dependencies", []) or []:
                _walk(sub)
        _walk(dep)
        # require_admin_role's inner _dep itself Depends on get_platform_admin,
        # so the gate appears in the transitive call set of every gated route.
        if get_platform_admin not in calls and label not in GATE_EXEMPT:
            ungated.append(label)
    assert not ungated, f"admin routes NOT behind the admin gate: {ungated}"


def test_admin_route_count_matches():
    n = len(_admin_routes())
    assert n == EXPECTED_ADMIN_ROUTE_COUNT, (
        f"admin route count drifted: expected {EXPECTED_ADMIN_ROUTE_COUNT}, got {n}. "
        "If intended, update EXPECTED_ADMIN_ROUTE_COUNT in this test."
    )
