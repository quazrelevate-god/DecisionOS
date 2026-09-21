"""U7-24.18 (2026-09-19) — saves no longer wait while the Desk loads.

Measured against the remote database (~205 ms a round trip through the Railway
proxy): right after a member signed in, PATCH /auth/profile and POST
/auth/owner-credentials took 6-8 s. The event loop was NOT blocked (GET
/api/health stayed at ~10 ms throughout); the time went on sequential database
round trips, queued on a connection pool that could never grow:

  * every authenticated request made six lookups one after another in
    get_current_user (~1.45 s for a bare GET /auth/me);
  * GET /desk/summary made nine counts one after another (~7 s);
  * PyMongo opened at most 2 connections at a time (maxConnecting=2), so a
    dozen Desk requests shared 3-4 connections and every query queued.

These tests pin the fix without touching a network: a fake database adds a
fixed latency to every call, so "one round trip" and "six round trips" are
told apart by the clock. Plus the one piece of real CPU on the save path —
bcrypt in /auth/owner-credentials — must not freeze the loop.
"""
import asyncio
import time
import uuid

import jwt
import pytest
from fastapi import HTTPException
from starlette.requests import Request

LAT = 0.1  # one simulated database round trip (well above Windows' ~16 ms timer tick)


# --------------------------------------------------------------------------
# A tiny in-memory database whose every call costs one round trip.
# --------------------------------------------------------------------------
def _get(doc, dotted):
    cur = doc
    for part in dotted.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return None
        cur = cur[part]
    return cur


def _matches(doc, q):
    for k, v in (q or {}).items():
        have = _get(doc, k)
        if isinstance(v, dict) and any(op.startswith("$") for op in v):
            for op, arg in v.items():
                if op == "$in" and have not in arg:
                    return False
                if op == "$nin" and have in arg:
                    return False
                if op == "$ne" and have == arg:
                    return False
                if op == "$exists" and (have is not None) != bool(arg):
                    return False
                if op in ("$gt", "$gte", "$lt", "$lte"):
                    if have is None:
                        return False
                    if op == "$gt" and not have > arg:
                        return False
                    if op == "$gte" and not have >= arg:
                        return False
                    if op == "$lt" and not have < arg:
                        return False
                    if op == "$lte" and not have <= arg:
                        return False
        elif k == "$or":
            if not any(_matches(doc, sub) for sub in v):
                return False
        elif k == "$and":  # PILOT-1 D's overdue rule is an $and of an $or
            if not all(_matches(doc, sub) for sub in v):
                return False
        elif have != v:
            return False
    return True


class _Cursor:
    def __init__(self, coll, q):
        self.coll, self.q = coll, q

    def sort(self, *a, **k):
        return self

    def limit(self, *a, **k):
        return self

    async def to_list(self, n=None):
        await self.coll.db.trip()
        return [dict(d) for d in self.coll.docs if _matches(d, self.q)]


class _Coll:
    def __init__(self, db, name):
        self.db, self.name, self.docs = db, name, []

    async def find_one(self, q=None, proj=None, **kw):
        await self.db.trip()
        for d in self.docs:
            if _matches(d, q):
                return {k: v for k, v in d.items() if not (proj and proj.get(k) == 0)}
        return None

    def find(self, q=None, proj=None, **kw):
        return _Cursor(self, q)

    async def count_documents(self, q=None, **kw):
        await self.db.trip()
        return sum(1 for d in self.docs if _matches(d, q))

    async def update_one(self, q, upd, upsert=False, **kw):
        await self.db.trip()
        for d in self.docs:
            if _matches(d, q):
                d.update(upd.get("$set") or {})
                for k in (upd.get("$unset") or {}):
                    d.pop(k, None)
                return
        if upsert:
            self.docs.append({**q, **(upd.get("$set") or {})})

    async def insert_one(self, doc, **kw):
        await self.db.trip()
        self.docs.append(dict(doc))


class LatencyDB:
    def __init__(self, lat=LAT):
        self.lat, self.calls, self._c = lat, 0, {}

    async def trip(self):
        self.calls += 1
        await asyncio.sleep(self.lat)

    def __getitem__(self, name):
        return self._c.setdefault(name, _Coll(self, name))

    __getattr__ = __getitem__


# --------------------------------------------------------------------------
# get_current_user: the lookups run side by side
# --------------------------------------------------------------------------
def _seed(fdb, *, membership=True, legacy=False):
    tid, uid, jti = f"t-{uuid.uuid4().hex[:6]}", f"u-{uuid.uuid4().hex[:6]}", uuid.uuid4().hex
    user = {"id": uid, "name": "Priya Nair", "password_hash": "x"}
    if legacy:
        user.update({"tenant_id": tid, "role": "sales"})
    fdb.users.docs.append(user)
    fdb.tenants.docs.append({"id": tid, "roles": [{"key": "sales", "permissions": ["tasks", "crm"]}],
                             "owner_exclusions": ["finance"]})
    if membership:
        fdb.memberships.docs.append({"id": "m1", "user_id": uid, "tenant_id": tid, "status": "active",
                                     "role": "sales", "permissions": [], "temp_grants": [{"perm": "x"}]})
    fdb.active_sessions.docs.append({"jti": jti, "revoked_at": None})
    # someone who has handed their approvals to this user for today
    fdb.users.docs.append({"id": "boss", "tenant_id": tid,
                           "acting_as": {"delegate_user_id": uid, "from": "", "to": ""}})
    return tid, uid, jti


def _request(token):
    from config import AUTH_COOKIE_NAME
    return Request({"type": "http", "method": "GET", "path": "/", "query_string": b"",
                    "headers": [(b"cookie", f"{AUTH_COOKIE_NAME}={token}".encode())]})


def _token(uid, tid, jti):
    from config import JWT_SECRET, JWT_ALGORITHM
    claims = {"sub": uid, "jti": jti, "exp": int(time.time()) + 3600}
    if tid:
        claims["tenant_id"] = tid
    return jwt.encode(claims, JWT_SECRET, algorithm=JWT_ALGORITHM)


@pytest.fixture
def fdb(monkeypatch):
    import core.deps as deps
    db = LatencyDB()
    monkeypatch.setattr(deps, "db", db)
    return db


def _auth(fdb, token):
    from core.deps import get_current_user

    async def go():
        t = time.perf_counter()
        u = await get_current_user(_request(token), creds=None)
        return u, time.perf_counter() - t
    return asyncio.new_event_loop().run_until_complete(go())


def test_auth_costs_two_round_trips_not_six(fdb):
    tid, uid, jti = _seed(fdb)
    user, took = _auth(fdb, _token(uid, tid, jti))
    # lookups side by side (1 trip) + the session touch (1 trip). Six in a row
    # was 6 x LAT.
    assert took < 3.5 * LAT, f"auth took {took:.3f}s"
    assert fdb.calls == 6  # still every lookup — just not one after another


def test_auth_result_is_unchanged(fdb):
    tid, uid, jti = _seed(fdb)
    user, _ = _auth(fdb, _token(uid, tid, jti))
    assert user["id"] == uid and user["tenant_id"] == tid and user["role"] == "sales"
    assert "password_hash" not in user
    assert user["membership_id"] == "m1"
    assert user["_role_perms_map"] == {"sales": ["tasks", "crm"]}
    assert user["_owner_exclusions"] == ["finance"]
    assert user["_temp_grants"] == [{"perm": "x"}]
    assert user["_acting_for"] == ["boss"]
    assert fdb.active_sessions.docs[0].get("last_seen_at")  # the session was touched


def test_revoked_session_is_refused_and_not_touched(fdb):
    tid, uid, jti = _seed(fdb)
    fdb.revoked_tokens.docs.append({"jti": jti})
    with pytest.raises(HTTPException) as ei:
        _auth(fdb, _token(uid, tid, jti))
    assert ei.value.status_code == 401 and "Session ended" in ei.value.detail
    assert not fdb.active_sessions.docs[0].get("last_seen_at")


def test_missing_user_and_missing_tenant_claim_still_refused(fdb):
    tid, uid, jti = _seed(fdb)
    with pytest.raises(HTTPException) as ei:
        _auth(fdb, _token("nobody", tid, jti))
    assert ei.value.status_code == 401 and ei.value.detail == "User not found"
    with pytest.raises(HTTPException) as ei:
        _auth(fdb, _token(uid, None, jti))
    assert ei.value.status_code == 401 and "Invalid token" in ei.value.detail


def test_suspended_user_still_refused(fdb):
    tid, uid, jti = _seed(fdb)
    fdb.users.docs[0]["suspended"] = True
    with pytest.raises(HTTPException) as ei:
        _auth(fdb, _token(uid, tid, jti))
    assert ei.value.status_code == 403


def test_legacy_account_without_membership_still_signs_in(fdb):
    tid, uid, jti = _seed(fdb, membership=False, legacy=True)
    user, _ = _auth(fdb, _token(uid, tid, jti))
    assert user["tenant_id"] == tid and user["role"] == "sales"
    assert user["_acting_for"] == ["boss"]


def test_removed_member_still_refused(fdb):
    tid, uid, jti = _seed(fdb, legacy=True)
    fdb.memberships.docs[0]["status"] = "removed"
    with pytest.raises(HTTPException) as ei:
        _auth(fdb, _token(uid, tid, jti))
    assert ei.value.status_code == 403


# --------------------------------------------------------------------------
# /desk/summary: the counters run side by side
# --------------------------------------------------------------------------
def test_desk_summary_counters_run_side_by_side(monkeypatch):
    import routers.desk as desk
    import services.finance_signals as fs
    db = LatencyDB()
    monkeypatch.setattr(desk, "db", db)
    monkeypatch.setattr(fs, "db", db)

    async def _narrative(**kw):
        return "stub"
    monkeypatch.setattr(desk, "ai_desk_narrative", _narrative)
    db.tasks.docs.append({"tenant_id": "t1", "status": "open", "due_date": "2000-01-01", "assignee_id": "u1"})

    async def go():
        t = time.perf_counter()
        out = await desk.desk_summary(user={"id": "u1", "tenant_id": "t1", "role": "sales", "name": "Priya"})
        return out, time.perf_counter() - t
    out, took = asyncio.new_event_loop().run_until_complete(go())
    # nine counts one after another was 9 x LAT
    assert took < 4 * LAT, f"desk summary took {took:.3f}s"
    assert db.calls == 9
    assert out["counters"]["delayed"] == 1
    assert out["narrative"] == "stub" and out["greeting"].endswith("Priya")


# --------------------------------------------------------------------------
# A save made while the Desk loads isn't held up by it
# --------------------------------------------------------------------------
def test_owner_credentials_save_does_not_freeze_the_desk(monkeypatch):
    """bcrypt is ~0.3 s of CPU. On the loop it froze every Desk request loading
    behind the owner-credentials screen; in a thread the loop keeps ticking."""
    import routers.auth as auth
    from models.auth import OwnerCredentialsInput
    db = LatencyDB(lat=0.001)
    monkeypatch.setattr(auth, "db", db)
    db.users.docs.append({"id": "u1", "tenant_id": "t1", "name": "Priya", "passwordless": True})

    def slow_hash(pw):
        time.sleep(0.3)  # what bcrypt costs
        return "hashed:" + pw
    monkeypatch.setattr(auth, "hash_password", slow_hash)

    async def go():
        gaps, stop = [], asyncio.Event()

        async def desk_ticks():  # stands in for the Desk's requests
            last = time.perf_counter()
            while not stop.is_set():
                await asyncio.sleep(0.01)
                now = time.perf_counter()
                gaps.append(now - last)
                last = now
        ticker = asyncio.create_task(desk_ticks())
        await asyncio.sleep(0.03)
        out = await auth.set_owner_credentials(
            OwnerCredentialsInput(email="priya@newcompany.co", password="Anand2026x"),
            request=None, user={"id": "u1", "tenant_id": "t1", "role": "owner"})
        stop.set()
        await ticker
        return out, max(gaps)
    out, worst_gap = asyncio.new_event_loop().run_until_complete(go())
    assert worst_gap < 0.15, f"the loop froze for {worst_gap:.3f}s"
    saved = db.users.docs[0]
    assert saved["password_hash"] == "hashed:Anand2026x" and saved["passwordless"] is False
    assert saved["email"] == "priya@newcompany.co"
    assert out["user"]["email"] == "priya@newcompany.co" and "password_hash" not in out["user"]


def test_auth_for_a_save_is_not_queued_behind_desk_load(fdb):
    """The Desk fires about a dozen authenticated requests at once. A save made
    in the middle of them costs the same two round trips as on its own."""
    tid, uid, jti = _seed(fdb)
    token = _token(uid, tid, jti)
    from core.deps import get_current_user

    async def go():
        desk = [get_current_user(_request(token), creds=None) for _ in range(12)]

        async def save():
            t = time.perf_counter()
            await get_current_user(_request(token), creds=None)
            return time.perf_counter() - t
        *_, took = await asyncio.gather(*desk, save())
        return took
    took = asyncio.new_event_loop().run_until_complete(go())
    assert took < 3.5 * LAT, f"the save's auth took {took:.3f}s under Desk load"


def test_mongo_client_opens_connections_in_parallel():
    """PyMongo's default maxConnecting=2 kept the pool at 3-4 connections, so a
    dozen concurrent Desk requests queued on it against a remote database."""
    import database
    assert database.client.options.pool_options.max_connecting >= 8
