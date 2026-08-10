"""FIX-004-G (RBAC-21) tests: session-management UI.

  * services.auth.session_tracking record/touch/list/revoke_one/
    revoke_all_for_user contracts (fail-open, ownership guard,
    keep-current on bulk revoke).
  * Bootstrap wires active_sessions indexes.
  * /me/sessions GET marks current session.
  * /me/sessions/{jti} DELETE ownership-guarded.
  * /me/sessions DELETE preserves the caller's own session.
  * login + register + switch-workspace record a session.
  * get_current_user calls touch_session.
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

    async def find_one(self, q, projection=None):
        for d in self.docs:
            if self._match(d, q):
                return dict(d)
        return None

    def find(self, q, projection=None):
        # Return COPIES so list_sessions' post-processing (datetime ->
        # iso string) doesn't mutate the source docs and break the
        # matcher on subsequent queries.
        return _Cursor([dict(d) for d in self.docs if self._match(d, q)])

    async def insert_one(self, doc):
        self.docs.append(dict(doc))
        return SimpleNamespace(inserted_id=doc.get("id") or doc.get("jti"))

    async def update_one(self, q, u, upsert=False):
        for d in self.docs:
            if self._match(d, q):
                if "$set" in u:
                    d.update(u["$set"])
                return SimpleNamespace(matched_count=1, modified_count=1)
        if upsert:
            new = {}
            if "$set" in u:
                new.update(u["$set"])
            # Merge query equality clauses in for upsert-with-filter shape.
            for k, v in q.items():
                if not isinstance(v, dict):
                    new.setdefault(k, v)
            self.docs.append(new)
            return SimpleNamespace(matched_count=0, modified_count=0,
                                    upserted_id=new.get("jti"))
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
                    if op == "$in" and dv not in ov:
                        return False
                    elif op == "$ne" and dv == ov:
                        return False
                    elif op == "$gt":
                        if dv is None or not (dv > ov):
                            return False
                    elif op == "$exists" and (k in d) != ov:
                        return False
            elif dv != v:
                return False
        return True


class _FakeDB:
    def __init__(self):
        self.active_sessions = _Col()
        self.revoked_tokens = _Col()

    def __getattr__(self, name):
        col = _Col()
        setattr(self, name, col)
        return col

    def __getitem__(self, name):
        return getattr(self, name)


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


# ===========================================================================
# services.auth.session_tracking — contract
# ===========================================================================
class TestRecordSession:
    def test_upsert_shape(self):
        from services.auth.session_tracking import record_session
        db = _FakeDB()
        _run(record_session(
            db, jti="j1", user_id="u1", tenant_id="t1",
            exp=(datetime.now(timezone.utc) + timedelta(days=7)),
            ua="Chrome/120", ip="1.2.3.4",
        ))
        row = db.active_sessions.docs[0]
        assert row["jti"] == "j1"
        assert row["user_id"] == "u1"
        assert row["tenant_id"] == "t1"
        assert row["ua"] == "Chrome/120"
        assert row["ip"] == "1.2.3.4"
        assert row["revoked_at"] is None

    def test_missing_jti_is_noop(self):
        """No jti -> silent no-op (legacy pre-jti token path)."""
        from services.auth.session_tracking import record_session
        db = _FakeDB()
        _run(record_session(db, jti="", user_id="u1", tenant_id="t1"))
        assert db.active_sessions.docs == []

    def test_ua_capped(self):
        from services.auth.session_tracking import record_session
        db = _FakeDB()
        _run(record_session(
            db, jti="j1", user_id="u1", tenant_id="t1",
            ua="a" * 5000,
        ))
        assert len(db.active_sessions.docs[0]["ua"]) <= 500

    def test_fail_open_on_db_error(self):
        from services.auth.session_tracking import record_session

        class _Busted:
            def __getitem__(self, name):
                raise RuntimeError("mongo down")
        # Must not raise.
        _run(record_session(
            _Busted(), jti="j1", user_id="u1", tenant_id="t1",
        ))


class TestListSessions:
    def test_returns_active_only(self):
        from services.auth.session_tracking import record_session, list_sessions
        db = _FakeDB()
        _run(record_session(db, jti="j1", user_id="u1", tenant_id="t1"))
        _run(record_session(db, jti="j2", user_id="u1", tenant_id="t1"))
        # Manually mark j2 as revoked.
        for d in db.active_sessions.docs:
            if d["jti"] == "j2":
                d["revoked_at"] = datetime.now(timezone.utc).isoformat()
        sessions = _run(list_sessions(db, "u1"))
        assert {s["jti"] for s in sessions} == {"j1"}

    def test_user_isolation(self):
        from services.auth.session_tracking import record_session, list_sessions
        db = _FakeDB()
        _run(record_session(db, jti="j1", user_id="u1", tenant_id="t1"))
        _run(record_session(db, jti="j2", user_id="u2", tenant_id="t1"))
        sessions = _run(list_sessions(db, "u1"))
        assert [s["jti"] for s in sessions] == ["j1"]

    def test_tenant_filter(self):
        from services.auth.session_tracking import record_session, list_sessions
        db = _FakeDB()
        _run(record_session(db, jti="j1", user_id="u1", tenant_id="t1"))
        _run(record_session(db, jti="j2", user_id="u1", tenant_id="t2"))
        # All workspaces
        assert len(_run(list_sessions(db, "u1"))) == 2
        # Just t1
        assert len(_run(list_sessions(db, "u1", tenant_id="t1"))) == 1


class TestRevokeOneSession:
    def test_ownership_guard(self):
        """A user cannot revoke someone else's jti by guessing it."""
        from services.auth.session_tracking import record_session, revoke_one_session
        db = _FakeDB()
        _run(record_session(db, jti="j1", user_id="u1", tenant_id="t1"))
        # u2 tries to revoke u1's session
        ok = _run(revoke_one_session(db, jti="j1", user_id="u2"))
        assert ok is False
        assert db.active_sessions.docs[0]["revoked_at"] is None

    def test_owner_revokes_own(self):
        from services.auth.session_tracking import record_session, revoke_one_session
        db = _FakeDB()
        _run(record_session(db, jti="j1", user_id="u1", tenant_id="t1"))
        ok = _run(revoke_one_session(db, jti="j1", user_id="u1"))
        assert ok is True
        assert db.active_sessions.docs[0]["revoked_at"]

    def test_missing_returns_false(self):
        from services.auth.session_tracking import revoke_one_session
        assert _run(revoke_one_session(_FakeDB(), jti="ghost", user_id="u1")) is False


class TestRevokeAllSessionsForUser:
    def test_keeps_current_jti(self):
        from services.auth.session_tracking import (
            record_session, revoke_all_sessions_for_user,
        )
        db = _FakeDB()
        _run(record_session(db, jti="j1", user_id="u1", tenant_id="t1"))
        _run(record_session(db, jti="j2", user_id="u1", tenant_id="t1"))
        _run(record_session(db, jti="j3", user_id="u1", tenant_id="t1"))
        n = _run(revoke_all_sessions_for_user(
            db, user_id="u1", keep_jti="j2",
        ))
        assert n == 2
        by_jti = {d["jti"]: d for d in db.active_sessions.docs}
        assert by_jti["j1"]["revoked_at"]
        assert by_jti["j2"]["revoked_at"] is None
        assert by_jti["j3"]["revoked_at"]

    def test_tenant_filter_scopes_revoke(self):
        """Off-boarding a user from tenant A should NOT wipe their
        sessions in tenant B (they may still be a legitimate member)."""
        from services.auth.session_tracking import (
            record_session, revoke_all_sessions_for_user,
        )
        db = _FakeDB()
        _run(record_session(db, jti="jA", user_id="u1", tenant_id="tA"))
        _run(record_session(db, jti="jB", user_id="u1", tenant_id="tB"))
        n = _run(revoke_all_sessions_for_user(
            db, user_id="u1", tenant_id="tA",
        ))
        assert n == 1
        by_jti = {d["jti"]: d for d in db.active_sessions.docs}
        assert by_jti["jA"]["revoked_at"]
        assert by_jti["jB"]["revoked_at"] is None


# ===========================================================================
# Bootstrap + endpoint wiring
# ===========================================================================
class TestBootstrapIndexes:
    def test_three_active_session_indexes(self):
        import server
        src = inspect.getsource(server._bootstrap)
        assert "active_sessions_jti_unique" in src
        assert "active_sessions_user_created" in src
        assert "active_sessions_exp_ttl" in src


class TestSessionEndpoints:
    def test_list_endpoint_marks_current(self):
        from routers.auth import list_my_sessions
        src = inspect.getsource(list_my_sessions)
        assert "is_current" in src
        # Decodes cookie/bearer to find current jti.
        assert "jwt.decode" in src or "_jwt.decode" in src

    def test_delete_one_uses_ownership_guard(self):
        from routers.auth import revoke_my_session
        src = inspect.getsource(revoke_my_session)
        assert "revoke_one_session" in src
        assert 'user_id=user["id"]' in src

    def test_delete_all_preserves_current(self):
        from routers.auth import revoke_my_other_sessions
        src = inspect.getsource(revoke_my_other_sessions)
        assert "revoke_all_sessions_for_user" in src
        assert "keep_jti=" in src


class TestGetCurrentUserTouches:
    def test_source_calls_touch_session(self):
        import core
        src = inspect.getsource(core.get_current_user)
        assert "touch_session" in src


class TestNewSessionsRecordedOnAuthFlows:
    def test_login_records_session(self):
        from routers.auth import login
        src = inspect.getsource(login)
        assert "record_session" in src or "_rec_sess" in src

    def test_register_records_session(self):
        from routers.auth import register
        src = inspect.getsource(register)
        assert "record_session" in src or "_rec_sess" in src

    def test_switch_workspace_records_session(self):
        from routers.auth import switch_workspace
        src = inspect.getsource(switch_workspace)
        assert "record_session" in src or "_rec_sess" in src
