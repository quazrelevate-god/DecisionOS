"""FIX-004-F (RBAC-20) tests: immutable audit log.

  * services.audit_log.record + query contracts (best-effort, tenant
    filtering, action/entity filters, timestamp cursor paging).
  * context_from extracts actor + IP + UA safely.
  * Bootstrap wires the 3 audit_log indexes.
  * Login (success + failure), logout, register wire audit events.
  * GET /admin/audit-log is owner-only.
  * The API deliberately does NOT expose PATCH/DELETE for audit rows.
"""
import asyncio
import inspect
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


# ---------------------------------------------------------------------------
# Tiny in-memory Mongo double with $gte / $lt operator support.
# ---------------------------------------------------------------------------
class _Cursor:
    def __init__(self, docs):
        self._docs = list(docs)
        self._sort = None

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


class _Col:
    def __init__(self):
        self.docs = []

    async def insert_one(self, doc):
        self.docs.append(dict(doc))
        return SimpleNamespace(inserted_id=doc.get("id"))

    def find(self, q, projection=None):
        return _Cursor([d for d in self.docs if self._match(d, q)])

    async def create_index(self, *a, **kw):
        return "ok"

    def _match(self, d, q):
        for k, v in q.items():
            dv = d.get(k)
            if isinstance(v, dict):
                for op, ov in v.items():
                    if op == "$gte" and not (dv is not None and dv >= ov):
                        return False
                    elif op == "$lt" and not (dv is not None and dv < ov):
                        return False
                    elif op == "$in" and dv not in ov:
                        return False
            elif dv != v:
                return False
        return True


class _FakeDB:
    def __init__(self):
        self.audit_log = _Col()

    def __getattr__(self, name):
        col = _Col()
        setattr(self, name, col)
        return col

    def __getitem__(self, name):
        return getattr(self, name)


# Dedicated module-scoped loop: created once for this module and never shared.
# `asyncio.get_event_loop()` used to be fine here, but under -n/--dist loadscope
# a worker runs many modules in one process, and an earlier module's
# `asyncio.run(...)` CLOSES the process's current loop -- so get_event_loop()
# then returned a *closed* loop and every _run() raised "Event loop is closed".
# Owning our own loop keeps all of this module's calls on one live loop (which a
# real AsyncMongoClient also needs, since it binds to the loop it's first used on)
# and is immune to whatever other modules do to the current loop.
_LOOP = asyncio.new_event_loop()


def _run(coro):
    return _LOOP.run_until_complete(coro)


# ===========================================================================
# services.audit_log.record — best-effort append
# ===========================================================================
class TestRecord:
    def test_writes_row_with_full_shape(self):
        from services.audit_log import record
        db = _FakeDB()
        _run(record(
            db, action="user_created",
            actor_id="u1", actor_email="a@b.com", tenant_id="t1",
            entity_type="user", entity_id="u_new",
            actor_ip="1.2.3.4", actor_ua="Mozilla/5.0",
            after={"email": "new@x.com", "role": "sales"},
        ))
        row = db.audit_log.docs[0]
        assert row["action"] == "user_created"
        assert row["actor_id"] == "u1"
        assert row["actor_email"] == "a@b.com"
        assert row["tenant_id"] == "t1"
        assert row["entity_type"] == "user"
        assert row["entity_id"] == "u_new"
        assert row["actor_ip"] == "1.2.3.4"
        assert row["actor_ua"] == "Mozilla/5.0"
        assert row["after"] == {"email": "new@x.com", "role": "sales"}
        assert row["id"]
        assert row["timestamp"]

    def test_null_fields_persist_as_none(self):
        """Records for pre-auth events (login_failure against unknown
        email) may have actor_id=None. Must still write cleanly."""
        from services.audit_log import record
        db = _FakeDB()
        _run(record(db, action="login_failure",
                     actor_email="unknown@x.com", tenant_id=None))
        row = db.audit_log.docs[0]
        assert row["actor_id"] is None
        assert row["tenant_id"] is None

    def test_record_never_raises_on_db_error(self):
        """Fail-open: a Mongo hiccup during audit write MUST NOT fail
        the underlying user action."""
        from services.audit_log import record

        class _Busted:
            def __getitem__(self, name):
                raise RuntimeError("mongo down")
        # Should not raise
        _run(record(_Busted(), action="user_created", actor_id="u1", tenant_id="t1"))

    def test_action_string_capped(self):
        """Long/garbage action strings must not blow up the row size."""
        from services.audit_log import record
        db = _FakeDB()
        _run(record(db, action="x" * 500, actor_id="u1", tenant_id="t1"))
        assert len(db.audit_log.docs[0]["action"]) <= 100

    def test_ua_capped_at_500_chars(self):
        """UA strings can be very long; cap for storage sanity."""
        from services.audit_log import record
        db = _FakeDB()
        _run(record(db, action="login_success",
                     actor_id="u1", tenant_id="t1",
                     actor_ua="a" * 5000))
        assert len(db.audit_log.docs[0]["actor_ua"]) <= 500


# ===========================================================================
# services.audit_log.query — tenant filter + narrowing + paging
# ===========================================================================
class TestQuery:
    def test_returns_recent_first(self):
        """Rows come back most-recent-first. Tiny sleeps between
        inserts because iso-second timestamps can collide on rapid
        Windows clocks otherwise."""
        import time
        from services.audit_log import record, query
        db = _FakeDB()
        _run(record(db, action="a1", tenant_id="t1", actor_id="u1"))
        time.sleep(0.01)
        _run(record(db, action="a2", tenant_id="t1", actor_id="u1"))
        time.sleep(0.01)
        _run(record(db, action="a3", tenant_id="t1", actor_id="u1"))
        rows = _run(query(db, tenant_id="t1"))
        assert len(rows) == 3
        # Most-recent-first ordering (a3, a2, a1)
        assert rows[0]["action"] == "a3"
        assert rows[2]["action"] == "a1"

    def test_tenant_isolation(self):
        """Query must NOT return rows from another tenant even if the
        caller passes tenant_id=None or omits it."""
        from services.audit_log import record, query
        db = _FakeDB()
        _run(record(db, action="my", tenant_id="t1", actor_id="u1"))
        _run(record(db, action="theirs", tenant_id="t2", actor_id="u2"))
        rows = _run(query(db, tenant_id="t1"))
        assert [r["action"] for r in rows] == ["my"]

    def test_action_filter(self):
        from services.audit_log import record, query
        db = _FakeDB()
        _run(record(db, action="login_success", tenant_id="t1"))
        _run(record(db, action="login_failure", tenant_id="t1"))
        _run(record(db, action="user_created", tenant_id="t1"))
        rows = _run(query(db, tenant_id="t1", filters={"action": "login_failure"}))
        assert [r["action"] for r in rows] == ["login_failure"]

    def test_entity_filter(self):
        from services.audit_log import record, query
        db = _FakeDB()
        _run(record(db, action="user_updated", tenant_id="t1",
                     entity_type="user", entity_id="u1"))
        _run(record(db, action="user_updated", tenant_id="t1",
                     entity_type="user", entity_id="u2"))
        rows = _run(query(db, tenant_id="t1",
                           filters={"entity_type": "user", "entity_id": "u1"}))
        assert len(rows) == 1
        assert rows[0]["entity_id"] == "u1"

    def test_limit_capped(self):
        from services.audit_log import query
        db = _FakeDB()
        # Empty result, but the cap logic should honor a huge limit
        # without blowing up.
        rows = _run(query(db, tenant_id="t1", limit=99999))
        assert isinstance(rows, list)

    def test_before_ts_pages_older(self):
        """`before_ts` cursor returns rows STRICTLY older than the given
        timestamp — for infinite-scroll paging."""
        import time
        from services.audit_log import record, query
        db = _FakeDB()
        _run(record(db, action="a1", tenant_id="t1"))
        time.sleep(0.01)
        _run(record(db, action="a2", tenant_id="t1"))
        time.sleep(0.01)
        _run(record(db, action="a3", tenant_id="t1"))
        # Grab the middle row's timestamp; page for older.
        all_rows = _run(query(db, tenant_id="t1"))
        middle_ts = all_rows[1]["timestamp"]
        older = _run(query(db, tenant_id="t1", before_ts=middle_ts))
        # Only "a1" is strictly older than the middle row.
        assert [r["action"] for r in older] == ["a1"]


# ===========================================================================
# services.audit_log.context_from
# ===========================================================================
class TestContextFrom:
    def test_user_provides_actor_and_tenant(self):
        from services.audit_log import context_from
        ctx = context_from(None, {"id": "u1", "email": "a@b.com", "tenant_id": "t1"})
        assert ctx["actor_id"] == "u1"
        assert ctx["actor_email"] == "a@b.com"
        assert ctx["tenant_id"] == "t1"

    def test_request_extracts_ip_from_xff(self):
        from services.audit_log import context_from

        class _Req:
            headers = {"X-Forwarded-For": "203.0.113.5, 10.0.0.1",
                        "User-Agent": "TestBot"}
            client = None
        ctx = context_from(_Req(), {"id": "u1"})
        assert ctx["actor_ip"] == "203.0.113.5"
        assert ctx["actor_ua"] == "TestBot"

    def test_no_request_omits_ip(self):
        from services.audit_log import context_from
        ctx = context_from(None, {"id": "u1"})
        assert ctx["actor_ip"] is None
        assert ctx["actor_ua"] is None

    def test_no_user_pre_auth_case(self):
        from services.audit_log import context_from
        ctx = context_from(None, None)
        assert ctx["actor_id"] is None
        assert ctx["actor_email"] is None
        assert ctx["tenant_id"] is None


# ===========================================================================
# Bootstrap + endpoint wiring
# ===========================================================================
class TestBootstrapIndexes:
    def test_three_indexes_registered(self):
        import server
        src = inspect.getsource(server._bootstrap)
        assert "audit_log_tenant_timestamp" in src
        assert "audit_log_actor_timestamp" in src
        assert "audit_log_entity" in src


class TestReadEndpoint:
    def test_read_audit_log_is_owner_only(self):
        from routers.tenant_settings import read_audit_log
        src = inspect.getsource(read_audit_log)
        assert 'require_role("owner")' in src

    def test_read_endpoint_supports_all_filters(self):
        from routers.tenant_settings import read_audit_log
        sig = inspect.signature(read_audit_log)
        for expected in ("action", "actor_id", "entity_type",
                          "entity_id", "since_ts", "before_ts", "limit"):
            assert expected in sig.parameters, (
                f"read_audit_log missing param {expected!r}"
            )

    def test_no_patch_or_delete_on_audit_endpoints(self):
        """The API deliberately does NOT expose write access to audit
        rows. Tampering the log requires DB-level access."""
        from server import app
        for route in app.routes:
            path = getattr(route, "path", "")
            if "/admin/audit-log" not in path:
                continue
            methods = set(getattr(route, "methods", set()) or set())
            for bad in ("PATCH", "PUT", "DELETE"):
                assert bad not in methods, (
                    f"audit-log route {path} exposes {bad} — "
                    "audit rows must be append-only at the API layer"
                )


# ===========================================================================
# Wire-up: high-value events call record()
# ===========================================================================
class TestLoginAudits:
    def test_login_success_records(self):
        from routers.auth import login
        src = inspect.getsource(login)
        assert 'action="login_success"' in src

    def test_login_failure_records(self):
        from routers.auth import login
        src = inspect.getsource(login)
        assert 'action="login_failure"' in src
        # Captures the attempted email even for unknown users.
        assert 'attempted email' in src or 'actor_email' in src

    def test_logout_records(self):
        from routers.auth import logout
        src = inspect.getsource(logout)
        assert 'action="logout"' in src


class TestRegisterAudits:
    def test_register_records_tenant_and_user_creation(self):
        from routers.auth import register
        src = inspect.getsource(register)
        assert 'action="tenant_created"' in src
        assert 'action="user_created"' in src


class TestOwnerExclusionsAudits:
    def test_owner_exclusions_edit_is_audited(self):
        from routers.tenant_settings import update_owner_exclusions
        src = inspect.getsource(update_owner_exclusions)
        assert 'action="owner_exclusions_updated"' in src
        # before/after captured for the compliance diff view.
        assert '"owner_exclusions":' in src
