"""FIX-003-C (S2-06 + S2-09 + S2-11) tests.

S2-06 — session invalidation on logout:
  * services/session_revocation.revoke/is_revoked contract
  * create_token payload now has a jti
  * bootstrap creates the TTL + unique indexes
  * /logout handler source revokes the current jti

S2-09 — contact rename cascade:
  * update_contact source cascades name -> invoices/payments/workflows

S2-11 — AI operating-model regeneration flags failure:
  * regenerate_operating_model + regenerate_finance_categories use
    the status-tracking wrapper and update tenant.ai_setup_status
"""
import asyncio
import inspect
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


# ---------------------------------------------------------------------------
# In-memory Mongo double (kept local so this file is self-contained)
# ---------------------------------------------------------------------------
class _Col:
    def __init__(self):
        self.docs = []

    async def find_one(self, q, projection=None):
        for d in self.docs:
            if self._match(d, q):
                return dict(d)
        return None

    async def update_one(self, q, update, upsert=False):
        for d in self.docs:
            if self._match(d, q):
                if "$set" in update:
                    d.update(update["$set"])
                return SimpleNamespace(matched_count=1, modified_count=1)
        if upsert:
            new = {}
            if "$set" in update:
                new.update(update["$set"])
            self.docs.append(new)
            return SimpleNamespace(matched_count=0, modified_count=0, upserted_id=new.get("jti"))
        return SimpleNamespace(matched_count=0, modified_count=0)

    async def create_index(self, *a, **kw):
        return "ok"

    def _match(self, d, q):
        for k, v in q.items():
            if d.get(k) != v:
                return False
        return True


class _FakeDB:
    def __init__(self):
        self.revoked_tokens = _Col()

    def __getattr__(self, name):
        col = _Col()
        setattr(self, name, col)
        return col

    def __getitem__(self, name):
        return getattr(self, name)


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


# ---------------------------------------------------------------------------
# S2-06 tests
# ---------------------------------------------------------------------------
class TestSessionRevocationContract:
    def test_revoke_and_is_revoked_roundtrip(self):
        from services.auth.session_revocation import revoke, is_revoked
        db = _FakeDB()
        exp = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
        assert _run(is_revoked(db, "jti-1")) is False
        _run(revoke(db, "jti-1", exp=exp))
        assert _run(is_revoked(db, "jti-1")) is True

    def test_revoke_is_idempotent(self):
        """Double-clicking logout must not accumulate duplicate rows."""
        from services.auth.session_revocation import revoke
        db = _FakeDB()
        _run(revoke(db, "jti-2", exp=1_800_000_000))  # numeric exp
        _run(revoke(db, "jti-2", exp=1_800_000_000))
        assert len(db.revoked_tokens.docs) == 1

    def test_revoke_missing_jti_is_noop(self):
        """Legacy pre-jti tokens land here; must not crash /logout."""
        from services.auth.session_revocation import revoke
        db = _FakeDB()
        _run(revoke(db, "", exp=None))
        _run(revoke(db, None, exp=None))
        assert db.revoked_tokens.docs == []

    def test_is_revoked_empty_jti_is_false(self):
        from services.auth.session_revocation import is_revoked
        db = _FakeDB()
        assert _run(is_revoked(db, "")) is False
        assert _run(is_revoked(db, None)) is False

    def test_is_revoked_degrades_open_on_db_error(self):
        """Fail-open: if Mongo blinks, we prefer letting the request
        through (session revocation is a bonus safety layer; the JWT
        itself is still crypto-valid until exp). Fail-closed would lock
        every user out on a Mongo blip — worse."""
        from services.auth.session_revocation import is_revoked

        class _BustedDB:
            def __getitem__(self, name):
                raise RuntimeError("mongo down")
        assert _run(is_revoked(_BustedDB(), "any")) is False

    def test_exp_defaults_to_7_days_when_unparseable(self):
        """A garbage exp claim must still result in a row with a valid
        future exp — else the TTL index would purge it immediately and
        the token would be un-revoked before it expires."""
        from services.auth.session_revocation import revoke
        db = _FakeDB()
        _run(revoke(db, "jti-x", exp="not-a-date"))
        row = db.revoked_tokens.docs[0]
        assert isinstance(row["exp"], datetime)
        # Should be roughly 7 days out.
        delta = row["exp"] - datetime.now(timezone.utc)
        assert timedelta(days=6, hours=23) < delta < timedelta(days=7, hours=1)


class TestCreateTokenHasJti:
    def test_token_payload_includes_jti(self):
        import jwt
        from core import JWT_SECRET, JWT_ALGORITHM, create_token
        tok = create_token("u1", "t1", "owner")
        payload = jwt.decode(tok, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        assert "jti" in payload
        assert isinstance(payload["jti"], str)
        assert len(payload["jti"]) >= 20

    def test_each_token_has_unique_jti(self):
        from core import create_token
        import jwt
        from core import JWT_SECRET, JWT_ALGORITHM
        a = jwt.decode(create_token("u", "t", "owner"), JWT_SECRET, algorithms=[JWT_ALGORITHM])
        b = jwt.decode(create_token("u", "t", "owner"), JWT_SECRET, algorithms=[JWT_ALGORITHM])
        assert a["jti"] != b["jti"], "jti must be random per token"


class TestLogoutRevokesJti:
    def test_logout_source_revokes_current_jti(self):
        """Regression guard: /logout must call the revocation service
        with the current token's jti BEFORE clearing the cookie."""
        from routers.auth import logout
        src = inspect.getsource(logout)
        assert "session_revocation" in src
        assert "revoke" in src
        # Cookie clear is still present.
        assert "clear_auth_cookie(response)" in src

    def test_logout_signature_has_no_auth_dependency(self):
        """/logout must NOT require Depends(get_current_user). A
        corrupted or already-revoked token still needs to be able to
        hit /logout to reset the browser's cookie."""
        from routers.auth import logout
        sig = inspect.signature(logout)
        # Only Request + Response, no user injection.
        param_defaults = [p.default for p in sig.parameters.values()]
        # None of the defaults is a Depends(get_current_user) instance.
        from fastapi.params import Depends as FDepends
        for d in param_defaults:
            if isinstance(d, FDepends):
                # If any Depends slipped in, its callable name must not
                # be get_current_user.
                dep_name = getattr(d.dependency, "__name__", "")
                assert dep_name != "get_current_user", (
                    "/logout must not require auth — corrupted/revoked "
                    "tokens still need a way to clear the browser cookie"
                )

    def test_get_current_user_checks_revocation(self):
        """The auth choke-point must reject revoked jtis."""
        import inspect
        import core
        src = inspect.getsource(core.get_current_user)
        assert "is_revoked" in src
        assert "session_revocation" in src


class TestRevokedTokensBootstrap:
    def test_bootstrap_creates_jti_and_ttl_indexes(self):
        import server
        src = inspect.getsource(server._bootstrap)
        assert "revoked_tokens" in src
        assert "revoked_tokens_jti_unique" in src or 'create_index("jti"' in src
        assert "revoked_tokens_exp_ttl" in src or '"exp", expireAfterSeconds=0' in src


# ---------------------------------------------------------------------------
# S2-09 — contact rename cascade
# ---------------------------------------------------------------------------
class TestContactRenameCascade:
    def test_update_contact_source_cascades_name(self):
        """Regression guard: renaming a contact must update every
        denormalized copy so search + display columns don't stay stale."""
        import server
        src = inspect.getsource(server.update_contact)
        # Cascade blocks
        assert "invoices" in src
        assert "payments" in src
        assert "workflows" in src
        # counterparty is the workflow's denormalized contact display.
        assert "counterparty" in src
        # Every cascade update must be tenant-scoped — otherwise a
        # tenant renaming their contact "Acme" could rewrite ANOTHER
        # tenant's "Acme" invoices. This is the whole point of S2-09.
        assert '"tenant_id": tid' in src

    def test_cascade_matches_by_id_and_by_legacy_name(self):
        """Both match strategies must be present so legacy rows written
        before contact_id was persisted also get updated."""
        import server
        src = inspect.getsource(server.update_contact)
        assert '"contact_id": contact_id' in src
        # Legacy fallback: match by exact old_name where contact_id is
        # missing.
        assert "old_name" in src
        assert '"contact_id": {"$in": [None, ""]}' in src


# ---------------------------------------------------------------------------
# S2-11 — AI operating-model + finance-categories regen tracks status
# ---------------------------------------------------------------------------
class TestAiRegenTracksStatus:
    def test_operating_model_regen_source_uses_status_wrapper(self):
        import server
        src = inspect.getsource(server.regenerate_operating_model)
        assert "ai_generate_operating_model_with_status" in src
        # And updates ai_setup_status.operating_model on the tenant.
        assert "ai_setup_status" in src
        assert 'status_map["operating_model"]' in src
        # And it does NOT clobber the existing operating_model on a
        # defaulted/failed run — that was the silent-degradation bug.
        assert "STATUS_GENERATED" in src

    def test_finance_categories_regen_source_uses_status_wrapper(self):
        import server
        src = inspect.getsource(server.regenerate_finance_categories)
        assert "ai_generate_finance_categories_with_status" in src
        assert 'status_map["finance_categories"]' in src
        assert "STATUS_GENERATED" in src

    def test_regen_endpoints_surface_status_summary(self):
        """The response payload includes ai_setup_status_summary so the
        frontend can show 'needs retry' without a second /me round-trip."""
        import server
        for fn in (server.regenerate_operating_model,
                   server.regenerate_finance_categories):
            src = inspect.getsource(fn)
            assert "ai_setup_status_summary" in src
            assert "summarize_ai_setup_status" in src
