"""Unit tests for the modules extracted in Epic 8 Sprint 7 (U8-10.2).

The S7 extractions (bootstrap/lifecycle, bootstrap/seed, bootstrap/migrations,
workers/schedulers, services/otp, services/inbox) shipped with per-slice smoke
checks but no committed tests. These lock in the load-bearing invariants --
importantly the two latent NameErrors S7/S8 fixed and the modern lifespan wiring
-- without touching a database. New tests follow the "mirror the module" naming
convention (the legacy test_iteration* suite is grandfathered).
"""
import asyncio

import core  # noqa: F401  (ensures env/.env loaded before importing app modules)


# ---------------------------------------------------------------------------
# workers/schedulers.py -- the follow-up sweep + the _followup_last_run bugfix
# ---------------------------------------------------------------------------
def test_scheduler_shares_throttle_map_with_finance_signals():
    """S7 fix: _followup_last_run was used bare in server.py but never imported.
    The scheduler must reference the *same* map object finance_signals owns, or
    the timer sweep's throttle-bypass is a no-op (or a NameError)."""
    import workers.schedulers as w
    import services.finance_signals as f
    assert w._followup_last_run is f._followup_last_run
    assert w.run_followup is f.run_followup


def test_scheduler_interval_is_int():
    import workers.schedulers as w
    assert isinstance(w.FOLLOWUP_INTERVAL_SECONDS, int)
    assert w.FOLLOWUP_INTERVAL_SECONDS > 0


# ---------------------------------------------------------------------------
# services/otp.py -- salted hash + policy constants
# ---------------------------------------------------------------------------
def test_hash_otp_is_deterministic_and_salted():
    from services.otp import _hash_otp
    h1 = _hash_otp("123456", "+919820010001")
    h2 = _hash_otp("123456", "+919820010001")
    assert h1 == h2                                   # deterministic
    assert len(h1) == 64 and all(c in "0123456789abcdef" for c in h1)  # sha256 hex
    # different code OR different phone -> different hash (phone is the salt)
    assert _hash_otp("654321", "+919820010001") != h1
    assert _hash_otp("123456", "+919820010002") != h1


def test_otp_policy_constants_present():
    import services.otp as o
    assert o.OTP_MAX_ATTEMPTS >= 1
    assert o.OTP_TTL_SECONDS > 0
    assert o.OTP_RESEND_COOLDOWN >= 0
    # config flags exist (bool)
    assert isinstance(o.APM_ENABLED, bool)
    assert isinstance(o.TWILIO_ENABLED, bool)


# ---------------------------------------------------------------------------
# bootstrap/migrations.py -- UPLOAD_DIR single source (S8 centralization)
# ---------------------------------------------------------------------------
def test_migrations_upload_dir_is_core_upload_dir():
    """S8: UPLOAD_DIR was copy-defined; migrations now shares core's single source."""
    import bootstrap.migrations as m
    from core import UPLOAD_DIR as core_upload
    assert m.UPLOAD_DIR == core_upload
    assert m.UPLOAD_DIR.name == "uploads"


# ---------------------------------------------------------------------------
# bootstrap/lifecycle.py -- the modern lifespan replaces @app.on_event
# ---------------------------------------------------------------------------
def test_lifespan_starts_bootstrap_and_scheduler_and_closes_client():
    """Entering the lifespan must schedule _bootstrap + the follow-up loop;
    exiting must await client.close(). Deps are mocked so no DB is touched."""
    import bootstrap.lifecycle as L

    async def go():
        calls = {"boot": 0, "sched": 0, "close": 0}

        async def fake_boot():
            calls["boot"] += 1

        async def fake_sched():
            calls["sched"] += 1

        class FakeClient:
            async def close(self):
                calls["close"] += 1

        orig_boot, orig_sched, orig_client = L._bootstrap, L._followup_scheduler_loop, L.client
        L._bootstrap, L._followup_scheduler_loop, L.client = fake_boot, fake_sched, FakeClient()
        try:
            async with L.lifespan(object()):
                await asyncio.sleep(0.05)  # let create_task run
            assert calls == {"boot": 1, "sched": 1, "close": 1}, calls
        finally:
            L._bootstrap, L._followup_scheduler_loop, L.client = orig_boot, orig_sched, orig_client

    asyncio.run(go())


# ---------------------------------------------------------------------------
# server.py -- exit criterion: no domain endpoints, only /health
# ---------------------------------------------------------------------------
def test_server_has_no_domain_endpoints():
    """Epic 8 exit: server.py owns zero @app domain routes -- only the app-level
    /health check. Everything else lives in routers/ mounted via bootstrap."""
    import server
    app_level = [getattr(r, "path", None) for r in server.app.routes
                 if getattr(r, "endpoint", None) is not None
                 and getattr(getattr(r, "endpoint", None), "__module__", "") == "server"]
    assert app_level == ["/health"], app_level


def test_no_server_import_shims_in_app_code():
    """Epic 8 exit (U8-10.3): application code (routers/services/bootstrap/workers)
    must not `from server import ...`. Every cross-domain helper is imported from
    its real home; server.py is no longer a dependency of the app layers. (Tests
    still `from server import` handlers directly -- that surface is grandfathered.)"""
    import ast
    import os

    backend = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    offenders = []
    for pkg in ("routers", "services", "bootstrap", "workers"):
        for root, _dirs, files in os.walk(os.path.join(backend, pkg)):
            if "__pycache__" in root:
                continue
            for fn in files:
                if not fn.endswith(".py"):
                    continue
                path = os.path.join(root, fn)
                tree = ast.parse(open(path, encoding="utf-8").read())
                for node in ast.walk(tree):
                    if isinstance(node, ast.ImportFrom) and node.module == "server":
                        offenders.append(f"{os.path.relpath(path, backend)}:{node.lineno}")
                    if isinstance(node, ast.Import) and any(a.name == "server" for a in node.names):
                        offenders.append(f"{os.path.relpath(path, backend)}:{node.lineno} (import server)")
    assert not offenders, "server-import shims remain in app code:\n  " + "\n  ".join(offenders)
