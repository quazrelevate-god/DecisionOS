"""FIX-003-D (S2-07): email verification + password reset tests.

Covers:
  * services/auth_emails token model (issue idempotence, consume
    single-use atomicity, invalidate_active_tokens, TTL by kind)
  * Endpoints exist with the right shape (source inspection)
  * /auth/password/forgot never leaks whether an email exists
  * /auth/password/reset revokes sibling tokens on success
  * Bootstrap wires the three indexes on auth_email_tokens
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
# Tiny in-memory Mongo double with datetime-comparison support.
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
        return SimpleNamespace(inserted_id=doc.get("token") or doc.get("id"))

    async def update_one(self, q, u, upsert=False):
        for d in self.docs:
            if self._match(d, q):
                if "$set" in u:
                    d.update(u["$set"])
                return SimpleNamespace(matched_count=1, modified_count=1)
        return SimpleNamespace(matched_count=0, modified_count=0)

    async def update_many(self, q, u):
        n = 0
        for d in self.docs:
            if self._match(d, q):
                if "$set" in u:
                    d.update(u["$set"])
                n += 1
        return SimpleNamespace(matched_count=n, modified_count=n)

    async def create_index(self, *a, **kw):
        return "ok"

    def _match(self, d, q):
        for k, v in q.items():
            dv = d.get(k)
            if isinstance(v, dict):
                for op, ov in v.items():
                    if op == "$gt":
                        if dv is None or not (dv > ov):
                            return False
                    elif op == "$in":
                        if dv not in ov:
                            return False
                    elif op == "$ne":
                        if dv == ov:
                            return False
                    else:
                        return False
            elif dv != v:
                return False
        return True


class _FakeDB:
    def __init__(self):
        self.auth_email_tokens = _Col()

    def __getattr__(self, name):
        col = _Col()
        setattr(self, name, col)
        return col

    def __getitem__(self, name):
        return getattr(self, name)


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


# ===========================================================================
# services/auth_emails
# ===========================================================================
class TestIssueContract:
    def test_issue_returns_token_with_kind_and_email(self):
        from services.auth import auth_emails
        db = _FakeDB()
        row = _run(auth_emails.issue(
            db, kind=auth_emails.KIND_EMAIL_VERIFY,
            user_id="u1", tenant_id="t1", email="alice@example.com",
        ))
        assert row["kind"] == "email_verify"
        assert row["email"] == "alice@example.com"
        assert row["user_id"] == "u1"
        assert row["tenant_id"] == "t1"
        assert isinstance(row["token"], str) and len(row["token"]) >= 20
        assert row["used_at"] is None
        assert isinstance(row["expires_at"], datetime)

    def test_issue_is_idempotent_within_window(self):
        """Re-issuing before the first token expires returns the same
        token — prevents inbox flood on a jittery 'resend' click."""
        from services.auth import auth_emails
        db = _FakeDB()
        a = _run(auth_emails.issue(
            db, kind=auth_emails.KIND_PASSWORD_RESET,
            user_id="u1", tenant_id="t1", email="a@x.com",
        ))
        b = _run(auth_emails.issue(
            db, kind=auth_emails.KIND_PASSWORD_RESET,
            user_id="u1", tenant_id="t1", email="a@x.com",
        ))
        assert a["token"] == b["token"], "second issue must reuse the live token"
        assert len(db.auth_email_tokens.docs) == 1

    def test_issue_different_kinds_get_separate_tokens(self):
        from services.auth import auth_emails
        db = _FakeDB()
        a = _run(auth_emails.issue(
            db, kind=auth_emails.KIND_EMAIL_VERIFY,
            user_id="u1", tenant_id="t1", email="a@x.com",
        ))
        b = _run(auth_emails.issue(
            db, kind=auth_emails.KIND_PASSWORD_RESET,
            user_id="u1", tenant_id="t1", email="a@x.com",
        ))
        assert a["token"] != b["token"]

    def test_issue_ttl_password_reset_is_1_hour(self):
        from services.auth import auth_emails
        db = _FakeDB()
        row = _run(auth_emails.issue(
            db, kind=auth_emails.KIND_PASSWORD_RESET,
            user_id="u1", tenant_id="t1", email="a@x.com",
        ))
        delta = row["expires_at"] - datetime.now(timezone.utc)
        assert timedelta(minutes=59) < delta < timedelta(hours=1, minutes=1)

    def test_issue_ttl_email_verify_is_3_days(self):
        from services.auth import auth_emails
        db = _FakeDB()
        row = _run(auth_emails.issue(
            db, kind=auth_emails.KIND_EMAIL_VERIFY,
            user_id="u1", tenant_id="t1", email="a@x.com",
        ))
        delta = row["expires_at"] - datetime.now(timezone.utc)
        assert timedelta(days=2, hours=23) < delta < timedelta(days=3, hours=1)

    def test_issue_normalizes_email(self):
        from services.auth import auth_emails
        db = _FakeDB()
        row = _run(auth_emails.issue(
            db, kind=auth_emails.KIND_EMAIL_VERIFY,
            user_id="u1", tenant_id="t1", email="  Alice@Example.COM  ",
        ))
        assert row["email"] == "alice@example.com"

    def test_issue_rejects_invalid_kind(self):
        from services.auth import auth_emails
        db = _FakeDB()
        with pytest.raises(ValueError):
            _run(auth_emails.issue(
                db, kind="anything_else",
                user_id="u1", tenant_id="t1", email="a@x.com",
            ))

    def test_issue_rejects_empty_email(self):
        from services.auth import auth_emails
        db = _FakeDB()
        with pytest.raises(ValueError):
            _run(auth_emails.issue(
                db, kind=auth_emails.KIND_EMAIL_VERIFY,
                user_id="u1", tenant_id="t1", email="",
            ))


class TestConsumeContract:
    def _issue(self, db, kind="password_reset"):
        from services.auth import auth_emails
        return _run(auth_emails.issue(
            db, kind=kind, user_id="u1", tenant_id="t1", email="a@x.com",
        ))

    def test_consume_marks_used(self):
        from services.auth import auth_emails
        db = _FakeDB()
        row = self._issue(db)
        out = _run(auth_emails.consume(
            db, token=row["token"], kind="password_reset",
        ))
        assert out is not None
        assert out["used_at"] is not None
        # Second consume must fail (single-use).
        again = _run(auth_emails.consume(
            db, token=row["token"], kind="password_reset",
        ))
        assert again is None

    def test_consume_wrong_kind_fails(self):
        from services.auth import auth_emails
        db = _FakeDB()
        row = self._issue(db, kind="password_reset")
        # Trying to consume a reset token as a verify token must fail.
        out = _run(auth_emails.consume(
            db, token=row["token"], kind="email_verify",
        ))
        assert out is None

    def test_consume_unknown_token_returns_none(self):
        from services.auth import auth_emails
        db = _FakeDB()
        out = _run(auth_emails.consume(
            db, token="does-not-exist", kind="password_reset",
        ))
        assert out is None

    def test_consume_empty_token_returns_none(self):
        from services.auth import auth_emails
        db = _FakeDB()
        assert _run(auth_emails.consume(db, token="", kind="password_reset")) is None
        assert _run(auth_emails.consume(db, token=None, kind="password_reset")) is None

    def test_consume_expired_token_fails(self):
        from services.auth import auth_emails
        db = _FakeDB()
        row = self._issue(db)
        # Force-expire the stored row.
        db.auth_email_tokens.docs[0]["expires_at"] = (
            datetime.now(timezone.utc) - timedelta(minutes=1)
        )
        out = _run(auth_emails.consume(
            db, token=row["token"], kind="password_reset",
        ))
        assert out is None


class TestInvalidateActiveTokens:
    def test_invalidates_only_matching_kind_and_email(self):
        from services.auth import auth_emails
        db = _FakeDB()
        # Two live reset tokens for a@x.com, one for b@x.com,
        # and one live verify token for a@x.com.
        r1 = _run(auth_emails.issue(db, kind="password_reset",
                                    user_id="u1", tenant_id="t1", email="a@x.com"))
        # Second reset for the same email needs a mid-cooldown consume
        # to actually create a fresh one — otherwise issue() reuses r1.
        # Easier: directly seed.
        now = datetime.now(timezone.utc)
        db.auth_email_tokens.docs.append({
            "token": "extra", "kind": "password_reset", "user_id": "u1",
            "tenant_id": "t1", "email": "a@x.com", "used_at": None,
            "expires_at": now + timedelta(hours=1),
            "created_at": now.isoformat(),
        })
        _run(auth_emails.issue(db, kind="password_reset",
                                user_id="u2", tenant_id="t1", email="b@x.com"))
        _run(auth_emails.issue(db, kind="email_verify",
                                user_id="u1", tenant_id="t1", email="a@x.com"))
        n = _run(auth_emails.invalidate_active_tokens(
            db, kind="password_reset", email="a@x.com"))
        assert n == 2
        # Sanity: b@x.com reset + a@x.com verify are still live.
        for d in db.auth_email_tokens.docs:
            if d["email"] == "b@x.com" or d["kind"] == "email_verify":
                assert d["used_at"] is None
            elif d["email"] == "a@x.com" and d["kind"] == "password_reset":
                assert d["used_at"] is not None


# ===========================================================================
# Endpoints — source-level shape guarantees
# ===========================================================================
class TestEndpointShape:
    def test_send_verification_endpoint_exists(self):
        from routers.auth import send_verification_email
        sig = inspect.signature(send_verification_email)
        # Requires auth
        assert any(str(p.default).endswith("get_current_user)")
                   for p in sig.parameters.values())

    def test_verify_email_endpoint_is_public(self):
        from routers.auth import verify_email
        sig = inspect.signature(verify_email)
        assert "token" in sig.parameters

    def test_password_forgot_never_leaks_email_existence(self):
        """The response shape must be identical whether the email
        exists or not — no email-enumeration side channel."""
        from routers.auth import password_forgot
        src = inspect.getsource(password_forgot)
        # Canonical response is built once and returned in both branches.
        assert "canonical_response" in src
        assert 'return canonical_response' in src
        # And the same message is used in the "no user" branch too.
        # Regression guard: no distinctive 404 / "Email not found".
        assert "Email not found" not in src
        assert 'status_code=404' not in src

    def test_password_reset_invalidates_sibling_tokens(self):
        """After a successful reset, any OTHER outstanding reset token
        for the same email must be killed. Prevents a stolen-inbox
        attacker from resetting again with a stale-but-not-yet-expired
        earlier email."""
        from routers.auth import password_reset
        src = inspect.getsource(password_reset)
        assert "invalidate_active_tokens" in src
        # Must also update password_hash.
        assert "password_hash" in src

    def test_password_reset_refuses_passwordless_accounts(self):
        """Passwordless (OTP-only) accounts have no password to reset —
        must refuse rather than silently create one they didn't ask for."""
        from routers.auth import password_reset
        src = inspect.getsource(password_reset)
        assert "passwordless" in src


class TestRegisterSendsVerification:
    def test_register_source_issues_verification_token(self):
        """New registrations should trigger a verification email
        (best-effort — must not fail the registration)."""
        from routers.auth import register
        src = inspect.getsource(register)
        assert "KIND_EMAIL_VERIFY" in src or "kind=auth_emails.KIND_EMAIL_VERIFY" in src
        assert "send_email" in src
        # Best-effort: wrapped in try/except.
        assert "try:" in src


class TestBootstrapAuthEmailTokensIndexes:
    def test_bootstrap_creates_token_ttl_and_compound_indexes(self):
        import server
        src = inspect.getsource(server._bootstrap)
        assert "auth_email_tokens_token_unique" in src
        assert "auth_email_tokens_expires_at_ttl" in src
        # Compound {kind, email, used_at} is used by issue() lookup.
        assert 'auth_email_tokens_kind_email_used' in src


# ===========================================================================
# Templates
# ===========================================================================
class TestEmailTemplates:
    def test_verify_template_includes_url(self):
        from services.auth.auth_emails import render_verify_email
        html = render_verify_email("Anita", "https://app.example.com/verify-email?token=abc")
        assert "https://app.example.com/verify-email?token=abc" in html
        assert "Anita" in html

    def test_reset_template_includes_url(self):
        from services.auth.auth_emails import render_reset_email
        html = render_reset_email("Anita", "https://app.example.com/reset-password?token=xyz")
        assert "https://app.example.com/reset-password?token=xyz" in html
        assert "1 hour" in html
