"""FIX-003-A (S2-03) tests: tenant-scoped OTP + WhatsApp routing.

The core invariant this suite locks in: **a phone number is only unique
WITHIN a tenant.** Every code path that used to assume "phone → single
user" globally is now required to either:
  (a) accept a tenant hint from the caller (OTP flow), or
  (b) refuse to silently favor one tenant over another when the phone
      matches multiple (inbound WhatsApp routing).

These tests use a small in-memory Mongo double so the whole file is
offline — no live DB required, so it runs in the standard test env
alongside the other pure-python suites.
"""
import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# --- stale-test compat shim (Epic 8 refactor moved these off server.py) ---
# The functions below moved out of server.py; re-bind them onto the
# server module so the source-inspection asserts resolve unchanged.
import server as _server_mod  # noqa: E402
from services.otp import _issue_otp as _shim__issue_otp  # noqa: E402
from routers.auth_otp import verify_otp as _shim_verify_otp  # noqa: E402
from routers.auth_otp import request_otp as _shim_request_otp  # noqa: E402
_STALE_SHIMS = {
    '_issue_otp': _shim__issue_otp,
    'verify_otp': _shim_verify_otp,
    'request_otp': _shim_request_otp,
}


def _apply_stale_shims():
    for _n, _f in _STALE_SHIMS.items():
        setattr(_server_mod, _n, _f)


_apply_stale_shims()


@pytest.fixture(autouse=True)
def _reapply_stale_shims():
    # Re-bind before every test: a monkeypatch.setattr(server, <fn>) in another
    # module deletes these on teardown (they were absent when it snapshotted),
    # which made these source-grep tests order-flaky under -n/--dist loadscope.
    _apply_stale_shims()
    yield


# =============================================================================
# Tiny in-memory Mongo double
# =============================================================================
class _FakeCursor:
    def __init__(self, docs, projection=None):
        self._docs = list(docs)
        self._sort = None
        self._limit = None

    def sort(self, field, direction=1):
        self._sort = (field, direction)
        return self

    def to_list(self, n):
        docs = list(self._docs)
        if self._sort:
            f, d = self._sort
            docs.sort(key=lambda x: (x.get(f) or ""), reverse=(d == -1))
        if n is not None:
            docs = docs[:n]

        async def _r():
            return docs
        return _r()

    def __aiter__(self):
        return _AsyncIter(iter(self._docs))


class _AsyncIter:
    def __init__(self, it):
        self._it = it

    def __aiter__(self):
        return self

    async def __anext__(self):
        try:
            return next(self._it)
        except StopIteration:
            raise StopAsyncIteration


class _FakeColl:
    def __init__(self):
        self.docs = []
        self.updated = []  # log of update_many/update_one calls

    async def find_one(self, query, projection=None):
        for d in self.docs:
            if self._match(d, query):
                return dict(d)
        return None

    def find(self, query, projection=None):
        return _FakeCursor([d for d in self.docs if self._match(d, query)],
                            projection)

    async def update_one(self, query, update, upsert=False):
        self.updated.append(("one", query, update))
        for d in self.docs:
            if self._match(d, query):
                self._apply(d, update)
                return SimpleNamespace(matched_count=1, modified_count=1)
        if upsert:
            new = {}
            self._apply(new, update)
            self.docs.append(new)
        return SimpleNamespace(matched_count=0, modified_count=0)

    async def update_many(self, query, update):
        self.updated.append(("many", query, update))
        n = 0
        for d in self.docs:
            if self._match(d, query):
                self._apply(d, update)
                n += 1
        return SimpleNamespace(matched_count=n, modified_count=n)

    async def delete_one(self, query):
        for i, d in enumerate(self.docs):
            if self._match(d, query):
                self.docs.pop(i)
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)

    async def delete_many(self, query):
        keep = [d for d in self.docs if not self._match(d, query)]
        removed = len(self.docs) - len(keep)
        self.docs = keep
        return SimpleNamespace(deleted_count=removed)

    async def insert_one(self, doc):
        self.docs.append(dict(doc))
        return SimpleNamespace(inserted_id=doc.get("id"))

    async def insert_many(self, docs):
        for d in docs:
            self.docs.append(dict(d))
        return SimpleNamespace(inserted_ids=[d.get("id") for d in docs])

    async def create_index(self, *a, **kw):
        return "index_ok"

    async def drop_index(self, name):
        return None

    async def index_information(self):
        return {}

    # helpers
    def _match(self, d, q):
        for k, v in q.items():
            if k == "$or":
                if not any(self._match(d, sub) for sub in v):
                    return False
                continue
            dv = d.get(k)
            if isinstance(v, dict):
                for op, ov in v.items():
                    if op == "$in" and dv not in ov:
                        return False
                    elif op == "$ne" and dv == ov:
                        return False
                    elif op == "$exists" and (k in d) != ov:
                        return False
                    elif op == "$type" and ov == "string" and not isinstance(dv, str):
                        return False
                    elif op == "$gt" and not (dv is not None and dv > ov):
                        return False
            elif dv != v:
                return False
        return True

    def _apply(self, d, update):
        if "$set" in update:
            d.update(update["$set"])
        if "$inc" in update:
            for k, v in update["$inc"].items():
                d[k] = (d.get(k) or 0) + v


class _FakeDB:
    def __init__(self):
        self.users = _FakeColl()
        self.tenants = _FakeColl()
        self.otp_codes = _FakeColl()
        self.wa_events = _FakeColl()

    def __getattr__(self, name):
        # any collection not pre-declared: give a fresh one
        col = _FakeColl()
        setattr(self, name, col)
        return col

    def __getitem__(self, name):
        return getattr(self, name)


# =============================================================================
# Helpers
# =============================================================================
# Dedicated module-scoped loop (see audit-log note): owning our own loop
# keeps every call in this module on one live loop and is immune to another
# module's asyncio.run() closing the process current loop under -n/loadscope.
_LOOP = asyncio.new_event_loop()


def _run(coro):
    return _LOOP.run_until_complete(coro)


@pytest.fixture
def db():
    return _FakeDB()


# =============================================================================
# find_tenant_choices_for_phone (services/phone.py) — the new helper
# =============================================================================
class TestFindTenantChoicesForPhone:
    def test_returns_empty_when_phone_too_short(self, db):
        from services.auth.phone import find_tenant_choices_for_phone
        assert _run(find_tenant_choices_for_phone(db, "12345")) == []

    def test_returns_empty_when_no_matches(self, db):
        from services.auth.phone import find_tenant_choices_for_phone
        assert _run(find_tenant_choices_for_phone(db, "9820010001")) == []

    def test_single_tenant_returns_one_choice(self, db):
        from services.auth.phone import find_tenant_choices_for_phone
        _run(db.users.insert_one({
            "id": "u1", "tenant_id": "t1", "phone_norm": "9820010001",
            "name": "Anita", "role": "owner", "created_at": "2026-01-01T00:00:00+00:00",
        }))
        _run(db.tenants.insert_one({"id": "t1", "name": "Sharma Textiles"}))

        out = _run(find_tenant_choices_for_phone(db, "9820010001"))
        assert len(out) == 1
        assert out[0] == {
            "tenant_id": "t1", "tenant_name": "Sharma Textiles",
            "user_id": "u1", "user_name": "Anita", "role": "owner",
        }

    def test_multi_tenant_returns_distinct_tenants_newest_first(self, db):
        """Same phone in three tenants -> three choices, newest first."""
        from services.auth.phone import find_tenant_choices_for_phone
        _run(db.users.insert_many([
            {"id": "u1", "tenant_id": "t_old", "phone_norm": "9820010001",
             "name": "Ravi (old)", "role": "employee",
             "created_at": "2025-01-01T00:00:00+00:00"},
            {"id": "u2", "tenant_id": "t_mid", "phone_norm": "9820010001",
             "name": "Ravi (mid)", "role": "manager",
             "created_at": "2026-05-01T00:00:00+00:00"},
            {"id": "u3", "tenant_id": "t_new", "phone_norm": "9820010001",
             "name": "Ravi (new)", "role": "owner",
             "created_at": "2026-08-01T00:00:00+00:00"},
        ]))
        _run(db.tenants.insert_many([
            {"id": "t_old", "name": "Old Co"},
            {"id": "t_mid", "name": "Mid Co"},
            {"id": "t_new", "name": "New Co"},
        ]))
        out = _run(find_tenant_choices_for_phone(db, "9820010001"))
        assert [c["tenant_id"] for c in out] == ["t_new", "t_mid", "t_old"]

    def test_wa_phone_obsolete_users_are_excluded(self, db):
        """A user marked obsolete by within-tenant dedup must not be
        offered as a login candidate."""
        from services.auth.phone import find_tenant_choices_for_phone
        _run(db.users.insert_many([
            {"id": "u_obsolete", "tenant_id": "t1", "phone_norm": "9820010001",
             "name": "Old", "wa_phone_obsolete": True,
             "created_at": "2026-01-01T00:00:00+00:00"},
            {"id": "u_active", "tenant_id": "t1", "phone_norm": "9820010001",
             "name": "New",
             "created_at": "2026-08-01T00:00:00+00:00"},
        ]))
        _run(db.tenants.insert_one({"id": "t1", "name": "T"}))
        out = _run(find_tenant_choices_for_phone(db, "9820010001"))
        assert len(out) == 1
        assert out[0]["user_id"] == "u_active"

    def test_same_tenant_dupe_dedupes_to_newest_row(self, db):
        """If a tenant has two rows for the phone (rare, but seen), the
        newer one wins — matches how the WhatsApp path resolves it."""
        from services.auth.phone import find_tenant_choices_for_phone
        _run(db.users.insert_many([
            {"id": "u_old", "tenant_id": "t1", "phone_norm": "9820010001",
             "name": "Old", "created_at": "2026-01-01T00:00:00+00:00"},
            {"id": "u_new", "tenant_id": "t1", "phone_norm": "9820010001",
             "name": "New", "created_at": "2026-08-01T00:00:00+00:00"},
        ]))
        _run(db.tenants.insert_one({"id": "t1", "name": "T"}))
        out = _run(find_tenant_choices_for_phone(db, "9820010001"))
        assert len(out) == 1
        assert out[0]["user_id"] == "u_new"

    def test_non_string_input_returns_empty(self, db):
        from services.auth.phone import find_tenant_choices_for_phone
        assert _run(find_tenant_choices_for_phone(db, None)) == []
        assert _run(find_tenant_choices_for_phone(db, 12345)) == []


# =============================================================================
# OTP flow shape (structural asserts on the actual server.py handlers)
#
# We assert the *shape* of the handlers (ambiguity payload, tenant-scoped
# otp_codes key, argument threading) via source inspection + partial
# import — a full HTTP integration test would need a live Mongo which is
# what the deployed suite (test_iteration29/30) already covers.
# =============================================================================
class TestOtpHandlerContract:
    def test_otp_models_have_tenant_id_field(self):
        """OtpRequestInput + OtpVerifyInput both accept optional tenant_id."""
        from server import OtpRequestInput, OtpVerifyInput
        m1 = OtpRequestInput(phone="9820010001")
        assert m1.tenant_id is None  # optional
        m2 = OtpRequestInput(phone="9820010001", tenant_id="t1")
        assert m2.tenant_id == "t1"
        m3 = OtpVerifyInput(phone="9820010001", code="123456")
        assert m3.tenant_id is None
        m4 = OtpVerifyInput(phone="9820010001", code="123456", tenant_id="t1")
        assert m4.tenant_id == "t1"

    def test_issue_otp_requires_tenant_id(self):
        """The private _issue_otp helper must refuse to write an OTP
        without a tenant scope. It's the single choke point — a
        missing tenant_id here means a caller has a bug."""
        import inspect
        import server
        sig = inspect.signature(_shim__issue_otp)
        assert "tenant_id" in sig.parameters, (
            "_issue_otp lost its tenant_id parameter — that's the whole point of FIX-003-A"
        )

    def test_issue_otp_source_uses_compound_key(self):
        """otp_codes writes must key on (phone, tenant_id), not phone alone.
        Regression guard for the S2-03 bug."""
        import inspect
        import server
        src = inspect.getsource(_shim__issue_otp)
        # The key dict has both fields.
        assert '"phone": norm' in src and '"tenant_id": tenant_id' in src, (
            "_issue_otp must build its otp_codes key with both phone AND tenant_id"
        )
        # It must NOT key its update on the bare {"phone": norm} pattern.
        # (Regression guard against reverting to the old single-column key.)
        assert "otp_codes.update_one(\n        {\"phone\": norm}" not in src, (
            "_issue_otp regressed to single-column update_one — must key by (phone, tenant_id)"
        )

    def test_verify_otp_source_uses_compound_key(self):
        import inspect
        import server
        src = inspect.getsource(_shim_verify_otp)
        # Compound key used for lookup + all delete/update calls.
        assert 'key = {"phone": norm, "tenant_id": tenant_id}' in src, (
            "verify_otp must build its otp_codes key as (phone, tenant_id)"
        )
        # Regression: none of the mutation calls key by just phone.
        assert 'otp_codes.delete_one({"phone": norm})' not in src
        assert 'otp_codes.update_one({"phone": norm},' not in src
        # Explicit 409 for cross-tenant ambiguity.
        assert 'status_code=409' in src
        assert '"ambiguous_tenant"' in src

    def test_request_otp_source_returns_ambiguous_payload(self):
        import inspect
        import server
        src = inspect.getsource(_shim_request_otp)
        assert '"ambiguous": True' in src
        assert '"choices"' in src
        # And the single-tenant fast path is preserved.
        assert 'len(choices) == 1' in src


# =============================================================================
# resolve_wa_tenant (server.py) — multi-tenant safety
# =============================================================================
class TestResolveWaTenantMultiTenant:
    """Runs against the live server.resolve_wa_tenant by monkeypatching
    server.db + server._owner_ids + server.push_notification. Verifies:
      - Cross-tenant collision does NOT mark any user obsolete.
      - Both tenant owners get notified.
      - Falls back to WA_TENANT_ID (or None).
      - Within-tenant duplicate resolution stays intact and is guarded
        to the same tenant.
    """
    def _install(self, monkeypatch, fake_db, owners_by_tid=None, wa_env=None):
        # Epic 8 moved resolve_wa_tenant to services/whatsapp.py, where it
        # resolves db / push_notification / _owner_ids as *that module's*
        # globals (db<-core, push/_owner_ids<-services.notifications). Patching
        # the server.* re-exports is dead here -- the function never reads them,
        # so the old test silently hit the REAL hosted DB (and could have fired
        # real update_many/push_notification side effects). Patch the live
        # module the function actually reads.
        from services import whatsapp as wa
        monkeypatch.setattr(wa, "db", fake_db)
        pushes = []

        async def _push(*args, **kwargs):
            pushes.append((args, kwargs))
        monkeypatch.setattr(wa, "push_notification", _push)

        async def _owners(tid):
            return (owners_by_tid or {}).get(tid, [f"owner_of_{tid}"])
        monkeypatch.setattr(wa, "_owner_ids", _owners)

        # Explicit WA_TENANT_ID env clear so tests are deterministic.
        import os as _os
        if wa_env is None:
            monkeypatch.delenv("WA_TENANT_ID", raising=False)
        else:
            monkeypatch.setenv("WA_TENANT_ID", wa_env)
        return pushes

    def test_single_tenant_match_routes_normally(self, monkeypatch):
        import server
        db = _FakeDB()
        _run(db.users.insert_one({
            "id": "u1", "tenant_id": "t_only", "phone_norm": "9820010001",
            "name": "Anita", "created_at": "2026-08-01T00:00:00+00:00",
        }))
        pushes = self._install(monkeypatch, db)
        tid = _run(server.resolve_wa_tenant("+91 98200 10001"))
        assert tid == "t_only"
        # No dedup notifications since it's a unique match.
        assert pushes == []

    def test_cross_tenant_collision_never_marks_anyone_obsolete(self, monkeypatch):
        """The bug that S2-03 closes: two tenants share a phone -> the
        prior code silently marked one tenant's user obsolete. Must not
        happen anymore, regardless of created_at order."""
        import server
        db = _FakeDB()
        _run(db.users.insert_many([
            {"id": "u_A", "tenant_id": "t_A", "phone_norm": "9820010001",
             "name": "Accountant (A)",
             "created_at": "2025-01-01T00:00:00+00:00"},
            {"id": "u_B", "tenant_id": "t_B", "phone_norm": "9820010001",
             "name": "Accountant (B)",
             "created_at": "2026-08-01T00:00:00+00:00"},
        ]))
        pushes = self._install(monkeypatch, db)
        _run(server.resolve_wa_tenant("+91 98200 10001"))
        # No user was mutated.
        assert all(not d.get("wa_phone_obsolete") for d in db.users.docs), (
            "Cross-tenant collision must NOT mark any user obsolete "
            "(the old bug silently orphaned the losing tenant's user)."
        )
        # Both tenants were notified so nothing is silent.
        notified_tids = {call[0][0] for call in pushes}
        assert notified_tids == {"t_A", "t_B"}, (
            f"Expected both tenants notified, got {notified_tids}"
        )

    def test_cross_tenant_collision_returns_fallback_or_none(self, monkeypatch):
        import server
        db = _FakeDB()
        _run(db.users.insert_many([
            {"id": "u_A", "tenant_id": "t_A", "phone_norm": "9820010001",
             "created_at": "2025-01-01T00:00:00+00:00"},
            {"id": "u_B", "tenant_id": "t_B", "phone_norm": "9820010001",
             "created_at": "2026-08-01T00:00:00+00:00"},
        ]))
        # No WA_TENANT_ID -> None
        self._install(monkeypatch, db)
        assert _run(server.resolve_wa_tenant("9820010001")) is None
        # With WA_TENANT_ID -> that value
        self._install(monkeypatch, _fresh := db, wa_env="platform_fallback_tid")
        # (db was already installed above; the second _install just resets env)
        assert _run(server.resolve_wa_tenant("9820010001")) == "platform_fallback_tid"

    def test_within_tenant_duplicates_still_dedupe(self, monkeypatch):
        """Two users in the SAME tenant on one phone: legitimate cleanup.
        Older row gets marked obsolete, tenant owner notified."""
        import server
        db = _FakeDB()
        _run(db.users.insert_many([
            {"id": "u_old", "tenant_id": "t1", "phone_norm": "9820010001",
             "name": "Old rec",
             "created_at": "2025-01-01T00:00:00+00:00"},
            {"id": "u_new", "tenant_id": "t1", "phone_norm": "9820010001",
             "name": "New rec",
             "created_at": "2026-08-01T00:00:00+00:00"},
        ]))
        pushes = self._install(monkeypatch, db)
        tid = _run(server.resolve_wa_tenant("9820010001"))
        assert tid == "t1"
        # Old row obsoleted, new one still active.
        by_id = {d["id"]: d for d in db.users.docs}
        assert by_id["u_old"].get("wa_phone_obsolete") is True
        assert not by_id["u_new"].get("wa_phone_obsolete")
        # Notification fired for the winning tenant.
        assert len(pushes) == 1
        assert pushes[0][0][0] == "t1"

    def test_within_tenant_dedup_has_tenant_guard(self, monkeypatch):
        """Even though at this branch all rows share a tenant_id, the
        update_many query must ALSO scope by tenant_id (defense-in-depth
        against a future refactor loosening the outer filter)."""
        import server
        import inspect
        src = inspect.getsource(server.resolve_wa_tenant)
        # The update_many call must include the tenant_id filter.
        assert '"tenant_id": tenant_id' in src, (
            "resolve_wa_tenant.update_many must guard with tenant_id "
            "so a wider match can never leak into another tenant's rows"
        )

    def test_empty_sender_falls_back_immediately(self, monkeypatch):
        import server
        db = _FakeDB()
        self._install(monkeypatch, db, wa_env="fallback")
        assert _run(server.resolve_wa_tenant("")) == "fallback"

    def test_no_matches_no_invited_falls_back(self, monkeypatch):
        import server
        db = _FakeDB()
        self._install(monkeypatch, db, wa_env="fallback_env")
        assert _run(server.resolve_wa_tenant("9990001111")) == "fallback_env"


# =============================================================================
# whatsapp_logs — kill the tenant_id=None OR leak (S2-04 fold-in)
# =============================================================================
class TestWhatsappLogsTenantIsolation:
    def test_source_no_longer_or_includes_tenant_none(self):
        """Regression guard: the old query {'$or': [{tenant_id: tid},
        {tenant_id: None}]} leaked unrouted events into every tenant's
        log view. Must be a strict {tenant_id: tid} now."""
        import inspect
        # Epic 8 moved the GET /whatsapp/logs handler to routers/whatsapp.py;
        # server.py no longer defines whatsapp_logs.
        from routers import whatsapp as wa_router
        src = inspect.getsource(wa_router.whatsapp_logs)
        assert '"$or"' not in src, (
            "whatsapp_logs regressed to OR-inclusion — cross-tenant leak"
        )
        assert '{"tenant_id": tid}' in src


# =============================================================================
# Migration + index registration (bootstrap wiring)
# =============================================================================
class TestBootstrapWiring:
    def test_migration_registered(self):
        import inspect
        import server
        src = inspect.getsource(server._bootstrap)
        assert "otp_codes_tenant_scope_v1" in src, (
            "FIX-003-A migration must be registered in the bootstrap sequence"
        )
        assert "otp_codes_phone_tenant_unique" in src, (
            "FIX-003-A compound unique index must be created in bootstrap"
        )

    def test_migration_drops_legacy_phone_index(self):
        """The migration must drop any pre-existing {phone: 1} unique
        index — otherwise inserting the compound-scoped rows would
        collide on the old single-column unique constraint."""
        import inspect
        import server
        src = inspect.getsource(server._bootstrap)
        assert 'drop_index' in src
        assert 'index_information' in src
