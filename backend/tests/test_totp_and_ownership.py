"""FIX-005-D (RBAC-23 + RBAC-24) tests: TOTP 2FA + ownership transfer.

  * TOTP service: enroll -> confirm -> verify, backup codes single-use,
    disable, regenerate.
  * is_enabled + has_pending_enrollment state matrix.
  * Login endpoint issues challenge instead of session when 2FA on.
  * /2fa/verify-login accepts TOTP + backup code.
  * /2fa endpoints all live behind get_current_user.
  * Ownership transfer: owner-only, last-owner-guard N/A here
    (deprovision has that), self-transfer refused, target must be
    live member, 2FA-required when caller has it, promotes + demotes,
    audits.
"""
import asyncio
import inspect
import sys
from pathlib import Path
from types import SimpleNamespace

import pyotp
import pytest

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


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
                    # Support nested-key sets: {"a.b": 1} -> d["a"]["b"] = 1
                    for k, v in u["$set"].items():
                        if "." in k:
                            parts = k.split(".")
                            cur = d
                            for p in parts[:-1]:
                                cur = cur.setdefault(p, {})
                                if not isinstance(cur, dict):
                                    cur = {}
                            cur[parts[-1]] = v
                        else:
                            d[k] = v
                return SimpleNamespace(matched_count=1, modified_count=1)
        return SimpleNamespace(matched_count=0, modified_count=0)

    async def update_many(self, q, u):
        n = 0
        for d in self.docs:
            if self._match(d, q):
                if "$set" in u:
                    for k, v in u["$set"].items():
                        d[k] = v
                n += 1
        return SimpleNamespace(matched_count=n, modified_count=n)

    async def create_index(self, *a, **kw):
        return "ok"

    def _match(self, d, q):
        for k, v in q.items():
            dv = d.get(k)
            if isinstance(v, dict):
                for op, ov in v.items():
                    if op == "$in" and dv not in ov:
                        return False
                    elif op == "$ne" and dv == ov:
                        return False
            elif dv != v:
                return False
        return True


class _FakeDB:
    def __init__(self):
        self.users = _Col()
        self.tenants = _Col()
        self.memberships = _Col()

    def __getattr__(self, name):
        col = _Col()
        setattr(self, name, col)
        return col

    def __getitem__(self, name):
        return getattr(self, name)


# Dedicated module-scoped loop (see audit-log note): owning our own loop
# keeps every call in this module on one live loop and is immune to another
# module's asyncio.run() closing the process current loop under -n/loadscope.
_LOOP = asyncio.new_event_loop()


def _run(coro):
    return _LOOP.run_until_complete(coro)


# ===========================================================================
# services.auth.totp — enroll + confirm + verify
# ===========================================================================
class TestTotpFullEnrollmentFlow:
    def test_enroll_confirm_verify_roundtrip(self):
        """Standard happy path: enroll returns secret, persist it,
        confirm with a valid TOTP promotes it to enabled + issues
        backup codes."""
        from services.auth.totp import (
            begin_enrollment, persist_pending_secret,
            confirm_enrollment, verify_totp, is_enabled,
        )
        db = _FakeDB()
        _run(db.users.insert_one({"id": "u1", "email": "a@b.com"}))
        # 1. Enroll
        payload = begin_enrollment({"id": "u1", "email": "a@b.com"})
        assert len(payload["secret"]) >= 16
        assert "otpauth://totp/DecisionOS" in payload["provisioning_uri"]
        # 2. Persist pending
        _run(persist_pending_secret(db, "u1", payload["secret"]))
        # 3. Confirm with a real TOTP from the same secret
        real_code = pyotp.TOTP(payload["secret"]).now()
        ok, codes = _run(confirm_enrollment(db, "u1", real_code))
        assert ok is True
        assert len(codes) == 10
        # All backup codes are the XXXXX-XXXXX format
        for c in codes:
            assert len(c) == 11 and c[5] == "-"
        # 4. is_enabled now True
        user = _run(db.users.find_one({"id": "u1"}))
        assert is_enabled(user) is True
        # 5. verify_totp accepts current code
        assert verify_totp(user, pyotp.TOTP(payload["secret"]).now()) is True

    def test_confirm_wrong_code_fails(self):
        from services.auth.totp import (
            begin_enrollment, persist_pending_secret, confirm_enrollment,
        )
        db = _FakeDB()
        _run(db.users.insert_one({"id": "u1"}))
        payload = begin_enrollment({"id": "u1", "email": "a@b.com"})
        _run(persist_pending_secret(db, "u1", payload["secret"]))
        ok, codes = _run(confirm_enrollment(db, "u1", "000000"))
        assert ok is False
        assert codes is None

    def test_confirm_without_pending_fails(self):
        from services.auth.totp import confirm_enrollment
        db = _FakeDB()
        _run(db.users.insert_one({"id": "u1"}))
        ok, codes = _run(confirm_enrollment(db, "u1", "123456"))
        assert ok is False


class TestBackupCodes:
    def _enroll(self, db):
        from services.auth.totp import (
            begin_enrollment, persist_pending_secret, confirm_enrollment,
        )
        _run(db.users.insert_one({"id": "u1"}))
        payload = begin_enrollment({"id": "u1", "email": "a@b.com"})
        _run(persist_pending_secret(db, "u1", payload["secret"]))
        _, codes = _run(confirm_enrollment(
            db, "u1", pyotp.TOTP(payload["secret"]).now(),
        ))
        return payload["secret"], codes

    def test_backup_code_single_use(self):
        from services.auth.totp import consume_backup_code
        db = _FakeDB()
        _, codes = self._enroll(db)
        # First use succeeds
        assert _run(consume_backup_code(db, "u1", codes[0])) is True
        # Same code again fails (marked used)
        assert _run(consume_backup_code(db, "u1", codes[0])) is False
        # A DIFFERENT unused code still works
        assert _run(consume_backup_code(db, "u1", codes[1])) is True

    def test_wrong_code_rejected(self):
        from services.auth.totp import consume_backup_code
        db = _FakeDB()
        self._enroll(db)
        assert _run(consume_backup_code(db, "u1", "WRONG-CODE")) is False

    def test_regenerate_invalidates_old(self):
        from services.auth.totp import (
            regenerate_backup_codes, consume_backup_code,
        )
        db = _FakeDB()
        _, old_codes = self._enroll(db)
        new_codes = _run(regenerate_backup_codes(db, "u1"))
        assert len(new_codes) == 10
        assert set(new_codes) != set(old_codes)
        # Old code should no longer work
        assert _run(consume_backup_code(db, "u1", old_codes[0])) is False
        # New code should work
        assert _run(consume_backup_code(db, "u1", new_codes[0])) is True

    def test_regenerate_requires_enrollment(self):
        from services.auth.totp import regenerate_backup_codes
        db = _FakeDB()
        _run(db.users.insert_one({"id": "u1"}))   # never enrolled
        assert _run(regenerate_backup_codes(db, "u1")) is None


class TestDisableTotp:
    def test_disable_wipes_secret_and_codes(self):
        from services.auth.totp import (
            begin_enrollment, persist_pending_secret, confirm_enrollment,
            disable_totp, is_enabled,
        )
        db = _FakeDB()
        _run(db.users.insert_one({"id": "u1"}))
        payload = begin_enrollment({"id": "u1", "email": "a@b.com"})
        _run(persist_pending_secret(db, "u1", payload["secret"]))
        _run(confirm_enrollment(db, "u1", pyotp.TOTP(payload["secret"]).now()))
        _run(disable_totp(db, "u1"))
        user = _run(db.users.find_one({"id": "u1"}))
        assert is_enabled(user) is False


class TestIsEnabledStateMatrix:
    def test_no_two_factor_field(self):
        from services.auth.totp import is_enabled
        assert is_enabled({}) is False

    def test_pending_only(self):
        from services.auth.totp import is_enabled, has_pending_enrollment
        user = {"two_factor": {"pending_secret": "S", "enabled_secret": None}}
        assert is_enabled(user) is False
        assert has_pending_enrollment(user) is True

    def test_enabled(self):
        from services.auth.totp import is_enabled
        user = {"two_factor": {"enabled_secret": "S", "enabled_at": "iso"}}
        assert is_enabled(user) is True


# ===========================================================================
# Login flow — 2FA challenge injection
# ===========================================================================
class TestLoginTwoFactorChallenge:
    def test_source_returns_challenge_when_totp_enabled(self):
        """When user.two_factor is enabled, login returns challenge_token
        + two_factor_required=True instead of the session token."""
        from routers.auth import login
        src = inspect.getsource(login)
        assert '"two_factor_required": True' in src
        assert "challenge_token" in src
        assert "_mint_challenge" in src

    def test_source_audits_challenge_issue(self):
        from routers.auth import login
        src = inspect.getsource(login)
        assert 'action="two_factor_challenge_issued"' in src


class TestChallengeToken:
    def test_mint_and_decode_roundtrip(self):
        from routers.auth import _mint_challenge, _decode_challenge
        tok = _mint_challenge("u1", "t1", "owner")
        p = _decode_challenge(tok)
        assert p["sub"] == "u1"
        assert p["tenant_id"] == "t1"
        assert p["role"] == "owner"
        assert p["type"] == "2fa_challenge"

    def test_decode_rejects_wrong_type(self):
        """A non-challenge JWT (e.g. a regular access token) must not
        be accepted at /auth/2fa/verify-login."""
        from routers.auth import _decode_challenge
        from core import create_token
        access = create_token("u1", "t1", "owner")
        with pytest.raises(Exception):
            _decode_challenge(access)


# ===========================================================================
# 2FA endpoints
# ===========================================================================
class TestTotpEndpoints:
    def test_enroll_requires_auth(self):
        from routers.auth import begin_2fa_enrollment
        src = inspect.getsource(begin_2fa_enrollment)
        assert "get_current_user" in src
        assert "begin_enrollment" in src

    def test_confirm_returns_backup_codes_once(self):
        from routers.auth import confirm_2fa_enrollment
        src = inspect.getsource(confirm_2fa_enrollment)
        assert "backup_codes" in src
        assert "confirm_enrollment" in src
        # Audit-logs the enable event.
        assert 'action="two_factor_enabled"' in src

    def test_verify_login_accepts_backup_code(self):
        from routers.auth import verify_2fa_on_login
        src = inspect.getsource(verify_2fa_on_login)
        assert "consume_backup_code" in src
        assert "verify_totp" in src
        # Records session + audit on success.
        assert "record_session" in src or "_rec_sess" in src
        assert 'action="two_factor_success"' in src
        # Failure audit + 401.
        assert 'action="two_factor_failure"' in src

    def test_disable_requires_valid_code(self):
        from routers.auth import disable_2fa
        src = inspect.getsource(disable_2fa)
        assert "verify_totp" in src
        assert "consume_backup_code" in src
        assert "disable_totp" in src
        assert 'action="two_factor_disabled"' in src

    def test_regenerate_requires_current_totp(self):
        """Not a backup code — regen must prove the authenticator is
        still working."""
        from routers.auth import regenerate_2fa_backup
        src = inspect.getsource(regenerate_2fa_backup)
        assert "verify_totp" in src
        # Deliberately NOT `consume_backup_code` — regen should reject
        # if only a backup code is available.
        assert "consume_backup_code" not in src


# ===========================================================================
# Ownership transfer
# ===========================================================================
class TestOwnershipTransfer:
    def test_source_owner_only(self):
        from routers.auth import transfer_ownership
        src = inspect.getsource(transfer_ownership)
        # Uses get_current_user (not require_role) + checks role
        # inline so it can return a friendly 403.
        assert 'user.get("role") != "owner"' in src
        assert "status_code=403" in src

    def test_refuses_self_transfer(self):
        from routers.auth import transfer_ownership
        src = inspect.getsource(transfer_ownership)
        assert 'inp.new_owner_user_id == user["id"]' in src

    def test_validates_target_is_live_member(self):
        from routers.auth import transfer_ownership
        src = inspect.getsource(transfer_ownership)
        assert "find_membership" in src
        assert "LIVE_STATUSES" in src

    def test_2fa_required_when_caller_has_totp(self):
        from routers.auth import transfer_ownership
        src = inspect.getsource(transfer_ownership)
        assert "totp_is_enabled" in src or "is_enabled" in src
        assert "verify_totp" in src

    def test_promotes_and_demotes_atomically(self):
        from routers.auth import transfer_ownership
        src = inspect.getsource(transfer_ownership)
        # Both memberships updated
        assert "update_membership" in src
        # And legacy user.role fields kept in sync for compat.
        assert '{"role": "owner"}' in src
        assert '{"role": "sales"}' in src

    def test_audits_the_transfer(self):
        from routers.auth import transfer_ownership
        src = inspect.getsource(transfer_ownership)
        assert 'action="tenant_ownership_transferred"' in src
        # Before/after captured so the compliance timeline shows the swap.
        assert '"owner_id"' in src
