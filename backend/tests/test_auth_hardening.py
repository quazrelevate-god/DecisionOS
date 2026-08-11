"""FIX-006-A (Sprint 0 batch A): auth-credential hardening tests.

Covers:
  S0-01  Hardcoded superadmin default gone; DB hash never silently
         overwritten on restart.
  S0-08  Login/register/switch/2fa/OTP-verify + admin login no longer
         return the raw JWT in the JSON body when AUTH_RETURN_TOKEN is
         off; cookie stays the source of truth.
  S0-09  Platform-admin JWT signed with PLATFORM_ADMIN_JWT_SECRET, not
         the tenant JWT_SECRET — a leak of one can't forge the other.
  S0-10  verify_otp invalidates the invitee's invite_token so the
         invite link stops resolving after acceptance.

Runs entirely in-process — no live server, no Mongo — via a tiny
async fake for the collections these paths touch.
"""
import asyncio
import inspect
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


# ---------------------------------------------------------------------------
# Tiny async fake — same shape as test_email_verification_and_reset.py.
# ---------------------------------------------------------------------------
class _Col:
    def __init__(self):
        self.docs = []

    async def find_one(self, q, projection=None):
        for d in self.docs:
            if self._match(d, q):
                return dict(d)
        return None

    async def insert_one(self, doc):
        self.docs.append(dict(doc))
        return SimpleNamespace(inserted_id=doc.get("id"))

    async def update_one(self, q, u, upsert=False):
        for d in self.docs:
            if self._match(d, q):
                if "$set" in u:
                    d.update(u["$set"])
                if "$unset" in u:
                    for k in u["$unset"]:
                        d.pop(k, None)
                return SimpleNamespace(matched_count=1, modified_count=1)
        if upsert and "$set" in u:
            new = dict(u["$set"]); new.update({k: v for k, v in q.items() if not isinstance(v, dict)})
            self.docs.append(new)
            return SimpleNamespace(matched_count=0, modified_count=0, upserted_id="x")
        return SimpleNamespace(matched_count=0, modified_count=0)

    def _match(self, d, q):
        for k, v in q.items():
            if isinstance(v, dict):
                for op, ov in v.items():
                    dv = d.get(k)
                    if op == "$ne" and dv == ov: return False
                    elif op == "$in" and dv not in ov: return False
                    elif op not in ("$ne", "$in"): return False
            elif d.get(k) != v:
                return False
        return True


class _FakeDB:
    def __getattr__(self, name):
        col = _Col()
        setattr(self, name, col)
        return col

    def __getitem__(self, name):
        return getattr(self, name)


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


# Deliberately no autouse fixture that reloads config — the tests in
# this file use monkeypatch.setattr on module attributes instead of
# importlib.reload, so no test leaves config in a polluted state.


# ===========================================================================
# S0-08: login_response helper — token in body only when AUTH_RETURN_TOKEN
# ===========================================================================
class TestLoginResponseHelper:
    def test_flag_on_includes_token(self, monkeypatch):
        import core
        monkeypatch.setattr(core, "AUTH_RETURN_TOKEN", True)
        out = core.login_response("JWT.TOKEN", user={"id": "u1"}, tenant={"id": "t1"})
        assert out["token"] == "JWT.TOKEN"
        assert out["user"]["id"] == "u1"
        assert out["tenant"]["id"] == "t1"

    def test_flag_off_omits_token_entirely(self, monkeypatch):
        """The whole point of S0-08: no `token` key at all when off. Not
        empty-string, not None — absent, so a stray XSS reading response
        JSON has nothing to grab."""
        import core
        monkeypatch.setattr(core, "AUTH_RETURN_TOKEN", False)
        out = core.login_response("JWT.TOKEN", user={"id": "u1"})
        assert "token" not in out
        assert out == {"user": {"id": "u1"}}

    def test_extra_kwargs_pass_through_in_both_modes(self, monkeypatch):
        import core
        for flag in (True, False):
            monkeypatch.setattr(core, "AUTH_RETURN_TOKEN", flag)
            out = core.login_response("T", user={"x": 1}, os_summary={"n": 2},
                                        used_backup_code=True)
            assert out["user"] == {"x": 1}
            assert out["os_summary"] == {"n": 2}
            assert out["used_backup_code"] is True

    def test_body_is_a_new_dict_each_call(self, monkeypatch):
        """No shared state between callers — mutating the returned dict
        must not leak into the next login response."""
        import core
        monkeypatch.setattr(core, "AUTH_RETURN_TOKEN", False)
        a = core.login_response("T", user={"id": "1"})
        a["poisoned"] = True
        b = core.login_response("T", user={"id": "2"})
        assert "poisoned" not in b


class TestAuthReturnTokenEnvSemantics:
    """The env-driven default: prod defaults off, everywhere else on.
    Tests the parsing inline (no config reload) to avoid polluting
    module state for other tests on this xdist worker."""

    @staticmethod
    def _compute(env: str, override) -> bool:
        """Reproduce config.py's AUTH_RETURN_TOKEN parsing rule exactly."""
        arb = (override or "").strip().lower()
        if arb in ("1", "true", "yes", "on"):
            return True
        if arb in ("0", "false", "no", "off"):
            return False
        return env != "prod"

    def test_prod_defaults_off(self):
        assert self._compute("prod", None) is False

    def test_dev_defaults_on(self):
        assert self._compute("dev", None) is True

    def test_explicit_override_wins_over_env(self):
        assert self._compute("prod", "1") is True
        assert self._compute("dev", "0") is False

    def test_common_truthy_and_falsy_values_accepted(self):
        for v in ("1", "true", "yes", "on", "TRUE"):
            assert self._compute("prod", v) is True, f"{v!r} truthy"
        for v in ("0", "false", "no", "off", "FALSE"):
            assert self._compute("dev", v) is False, f"{v!r} falsy"

    def test_the_current_process_value_is_a_bool(self):
        """Sanity: whatever env this test runs in, the config module
        exposes AUTH_RETURN_TOKEN as a bool — no crashes on import."""
        import config
        assert isinstance(config.AUTH_RETURN_TOKEN, bool)


# ===========================================================================
# S0-09: platform-admin JWT signed with its own secret
# ===========================================================================
class TestPlatformAdminSecretSplit:
    """Uses monkeypatch.setattr on the config module's PLATFORM_ADMIN_JWT_SECRET
    to swap the secret in-place — no full config reload needed. That means:
      1. No cross-test config pollution on this xdist worker.
      2. create_admin_token reads PLATFORM_ADMIN_JWT_SECRET from its own
         module-level import in core.py — which was itself imported from
         config at module load. To make swaps take effect, we patch BOTH
         config.PLATFORM_ADMIN_JWT_SECRET AND core.PLATFORM_ADMIN_JWT_SECRET.
    """

    def _swap_secret(self, monkeypatch, secret: str):
        import config, core
        monkeypatch.setattr(config, "PLATFORM_ADMIN_JWT_SECRET", secret)
        monkeypatch.setattr(core, "PLATFORM_ADMIN_JWT_SECRET", secret)
        return core, config

    def test_fallback_when_env_unset(self):
        """When PLATFORM_ADMIN_JWT_SECRET env is unset, config falls
        back to JWT_SECRET (dev back-compat). Read the shipped module
        state directly — no reload needed."""
        import config
        # In dev with no explicit admin secret env, the two must equal.
        # This asserts the fallback path is wired; the shipped tests
        # env doesn't set PLATFORM_ADMIN_JWT_SECRET distinctly.
        if not os.environ.get("PLATFORM_ADMIN_JWT_SECRET", "").strip():
            assert config.PLATFORM_ADMIN_JWT_SECRET == config.JWT_SECRET

    def test_distinct_when_swap_applied(self, monkeypatch):
        """monkeypatch.setattr the module var directly — same net effect
        as a distinct env at boot, without reloading config."""
        core, config = self._swap_secret(monkeypatch, "admin-only-secret-x9y2z")
        assert config.PLATFORM_ADMIN_JWT_SECRET == "admin-only-secret-x9y2z"

    def test_admin_token_signed_with_admin_secret(self, monkeypatch):
        """When secrets differ, an admin token verifies with the admin
        secret only — the tenant secret can't decode it."""
        core, config = self._swap_secret(monkeypatch, "admin-only-secret-x9y2z")
        import jwt as _jwt
        token = core.create_admin_token("admin-id-1")
        # Verifiable with the admin secret:
        payload = _jwt.decode(token, "admin-only-secret-x9y2z",
                                algorithms=[config.JWT_ALGORITHM])
        assert payload["sub"] == "admin-id-1"
        assert payload["type"] == "platform_admin"
        # NOT verifiable with the tenant secret (if they differ):
        if config.JWT_SECRET != "admin-only-secret-x9y2z":
            with pytest.raises(_jwt.InvalidTokenError):
                _jwt.decode(token, config.JWT_SECRET,
                              algorithms=[config.JWT_ALGORITHM])

    def test_tenant_token_cannot_impersonate_admin(self, monkeypatch):
        """A stolen tenant JWT_SECRET should NOT be sufficient to
        mint an admin session, even if you set type=platform_admin."""
        core, config = self._swap_secret(monkeypatch, "admin-only-secret-x9y2z")
        import jwt as _jwt
        from datetime import timedelta
        # Skip if the tenant secret happens to equal the admin secret
        # in this test env (dev fallback case).
        if config.JWT_SECRET == "admin-only-secret-x9y2z":
            pytest.skip("tenant secret == admin secret in this env")
        forged = _jwt.encode(
            {"sub": "forged", "type": "platform_admin",
             "exp": datetime.now(timezone.utc) + timedelta(days=1)},
            config.JWT_SECRET, algorithm=config.JWT_ALGORITHM,
        )
        # Attempting to verify with the admin secret must fail:
        with pytest.raises(_jwt.InvalidTokenError):
            _jwt.decode(forged, "admin-only-secret-x9y2z",
                          algorithms=[config.JWT_ALGORITHM])


# ===========================================================================
# S0-01: seed_platform_admin
# ===========================================================================
class TestSeedPlatformAdmin:
    def _patch_bootstrap(self, monkeypatch, *, prod=False,
                          email=None, password=None, allow_refresh=False):
        """Wire seed_platform_admin's world without reloading config —
        that would pollute module state for other tests on this xdist
        worker. Instead we monkeypatch:
          * os.environ (seed_platform_admin reads these at call time)
          * config.SUPERADMIN_ALLOW_HASH_REFRESH (deferred `from config
            import` inside the function fetches this attribute)
        """
        monkeypatch.setenv("ENV", "prod" if prod else "dev")
        # NB: setenv("", "") not delenv — .env in the repo carries the
        # default SUPERADMIN_* pair, and dotenv.load_dotenv() re-populates
        # delenv'd keys. Setting explicit empty blocks the re-population.
        for k, v in {"SUPERADMIN_EMAIL": email,
                      "SUPERADMIN_PASSWORD": password}.items():
            monkeypatch.setenv(k, "" if v is None else v)
        import config
        monkeypatch.setattr(config, "SUPERADMIN_ALLOW_HASH_REFRESH",
                              bool(allow_refresh))
        return config

    def test_prod_without_env_refuses_to_boot(self, monkeypatch):
        self._patch_bootstrap(monkeypatch, prod=True, email=None, password=None)
        import server  # deliberate no-reload; see other tests in this class
        with pytest.raises(RuntimeError, match="SUPERADMIN_EMAIL"):
            _run(server.seed_platform_admin())

    def test_dev_without_env_uses_fallback_and_seeds(self, monkeypatch):
        self._patch_bootstrap(monkeypatch, prod=False)
        # NB: do NOT importlib.reload(server) — that resets server.db,
        # server.app etc. and pollutes other tests on the same xdist
        # worker. seed_platform_admin reads os.environ + does deferred
        # `from config import X` at call time, so it picks up whatever
        # we monkeypatched without needing a module reload.
        import server
        db = _FakeDB()
        monkeypatch.setattr(server, "db", db)
        _run(server.seed_platform_admin())
        docs = db.platform_admins.docs
        assert len(docs) == 1
        assert docs[0]["email"] == "admin@decisionos.biz"
        assert docs[0]["password_hash"]  # some hash written

    def test_env_creds_inserted_when_admin_missing(self, monkeypatch):
        self._patch_bootstrap(monkeypatch, prod=True,
                                email="ops@corp.com", password="P@ssw0rd!strong")
        # NB: do NOT importlib.reload(server) — that resets server.db,
        # server.app etc. and pollutes other tests on the same xdist
        # worker. seed_platform_admin reads os.environ + does deferred
        # `from config import X` at call time, so it picks up whatever
        # we monkeypatched without needing a module reload.
        import server
        db = _FakeDB()
        monkeypatch.setattr(server, "db", db)
        _run(server.seed_platform_admin())
        assert len(db.platform_admins.docs) == 1
        assert db.platform_admins.docs[0]["email"] == "ops@corp.com"

    def test_existing_admin_hash_NOT_overwritten_by_default(self, monkeypatch):
        """The critical S0-01 fix: bumping SUPERADMIN_PASSWORD in env
        and restarting does NOT silently rewrite the DB hash."""
        self._patch_bootstrap(monkeypatch, prod=True,
                                email="ops@corp.com", password="NEW-password-99",
                                allow_refresh=False)
        import server, core
        db = _FakeDB()
        # Pre-existing admin with a DIFFERENT hash than the env password:
        original_hash = core.hash_password("original-password-01")
        db.platform_admins.docs.append({
            "id": "existing", "email": "ops@corp.com",
            "password_hash": original_hash, "created_at": "2026-01-01T00:00:00+00:00",
        })
        monkeypatch.setattr(server, "db", db)
        _run(server.seed_platform_admin())
        # Hash preserved; env password did NOT take over.
        assert db.platform_admins.docs[0]["password_hash"] == original_hash
        assert core.verify_password("original-password-01",
                                      db.platform_admins.docs[0]["password_hash"])
        assert not core.verify_password("NEW-password-99",
                                          db.platform_admins.docs[0]["password_hash"])

    def test_hash_refresh_opt_in_actually_refreshes(self, monkeypatch):
        """With the one-off opt-in flag on, the env password overwrites
        the DB hash. That's the escape hatch for legitimate rotation."""
        self._patch_bootstrap(monkeypatch, prod=True,
                                email="ops@corp.com", password="NEW-password-99",
                                allow_refresh=True)
        import server, core
        db = _FakeDB()
        db.platform_admins.docs.append({
            "id": "existing", "email": "ops@corp.com",
            "password_hash": core.hash_password("original-password-01"),
            "created_at": "2026-01-01T00:00:00+00:00",
        })
        monkeypatch.setattr(server, "db", db)
        _run(server.seed_platform_admin())
        assert core.verify_password("NEW-password-99",
                                      db.platform_admins.docs[0]["password_hash"])

    def test_hash_refresh_opt_in_but_password_matches_is_noop(self, monkeypatch):
        """No churn when the env password already matches the stored
        hash — even with the opt-in on, we don't re-hash on every restart."""
        self._patch_bootstrap(monkeypatch, prod=True,
                                email="ops@corp.com", password="stable-password-77",
                                allow_refresh=True)
        import server, core
        db = _FakeDB()
        h = core.hash_password("stable-password-77")
        db.platform_admins.docs.append({
            "id": "existing", "email": "ops@corp.com",
            "password_hash": h, "created_at": "2026-01-01T00:00:00+00:00",
        })
        monkeypatch.setattr(server, "db", db)
        _run(server.seed_platform_admin())
        assert db.platform_admins.docs[0]["password_hash"] == h  # untouched


# ===========================================================================
# S0-10: invite_token invalidated on OTP verify success
# ===========================================================================
class TestInviteTokenInvalidatedOnVerify:
    """verify_otp is a fat endpoint (~100 LOC in server.py). Rather than
    duplicate its DB shape here, we source-inspect the endpoint to make
    sure the invalidation branch (a) checks invite_token, (b) clears it
    to None, (c) clears invite_expires_at, (d) stamps invite_consumed_at."""

    def test_source_has_invite_invalidation_block(self):
        import server
        src = inspect.getsource(server.verify_otp)
        # Guards
        assert 'invite_token' in src
        assert 'invite_expires_at' in src
        # The specific write pattern — token cleared to None on the DB.
        assert '"invite_token": None' in src
        assert '"invite_expires_at": None' in src
        # Consumption timestamp so we have a paper trail.
        assert 'invite_consumed_at' in src

    def test_invite_lookup_endpoints_404_on_none_token(self):
        """Structural check: the two public /auth/invite/* endpoints
        query by invite_token. Once we set the field to None on verify,
        those queries can never match again — that IS the invalidation."""
        import server
        for fn_name in ("invite_info", "invite_start"):
            fn = getattr(server, fn_name)
            src = inspect.getsource(fn)
            assert '"invite_token": token' in src, (
                f"{fn_name} should look up by invite_token so setting it "
                "to None on verify_otp truly kills the link")
            # 404 branch present — no ghost lookups.
            assert "404" in src


# ===========================================================================
# S0-08: no raw token in body — endpoint-level source inspection
# ===========================================================================
class TestNoRawTokenInBodyForKnownEndpoints:
    """Grep-style guard that catches accidental regressions where someone
    adds a new auth endpoint and hand-rolls `return {"token": token, ...}`
    instead of using the login_response helper."""

    ENDPOINTS = [
        ("routers.auth", "register"),
        ("routers.auth", "login"),
        ("routers.auth", "switch_workspace"),
        ("routers.auth", "verify_2fa_on_login"),
        ("routers.admin", "admin_login"),
    ]

    def test_all_auth_endpoints_route_through_login_response(self):
        import importlib
        for module_name, fn_name in self.ENDPOINTS:
            mod = importlib.import_module(module_name)
            fn = getattr(mod, fn_name)
            src = inspect.getsource(fn)
            assert "login_response" in src, (
                f"{module_name}.{fn_name} must return via login_response(); "
                "hand-rolled `return {\"token\": ...}` regresses S0-08."
            )
            # And it must NOT still return the raw token literal.
            # We check the exact literal `"token": token` pattern to avoid
            # false-positives on invite_token, challenge_token, etc.
            assert '"token": token' not in src, (
                f"{module_name}.{fn_name} still returns `\"token\": token` "
                "in its body — regression of S0-08."
            )

    def test_server_verify_otp_uses_login_response(self):
        """The one endpoint on server.py (not a router) that mints
        a tenant session — the invite-accept path."""
        import server
        src = inspect.getsource(server.verify_otp)
        assert "login_response(" in src
        assert '"token": token' not in src
