"""FIX-004-H (RBAC-22) tests: off-boarding wizard (deprovision_user).

Coverage:
  * Fresh deprovision revokes sessions, removes membership,
    invalidates invite token, reassigns tasks + contacts.
  * Idempotent — second call is a clean no-op with zero counts.
  * Last-owner guard refuses.
  * Session revoke is TENANT-SCOPED — user's session in ANOTHER
    tenant survives.
  * Task reassignment updates denormalized assignee_role.
  * No reassign target = nullify assignee_id.
  * Audit log entry written on success.
  * Endpoint refuses self-deprovision.
  * Endpoint refuses when replacement user isn't a live member.
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
        return _wrap([dict(x) for x in (docs[:n] if n else docs)])


def _wrap(v):
    async def _r():
        return v
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
        return _Cursor([dict(d) for d in self.docs if self._match(d, q)])

    async def insert_one(self, doc):
        self.docs.append(dict(doc))
        return SimpleNamespace(inserted_id=doc.get("id"))

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
            for k, v in q.items():
                if not isinstance(v, dict):
                    new.setdefault(k, v)
            self.docs.append(new)
            return SimpleNamespace(matched_count=0, modified_count=0)
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
            elif dv != v:
                return False
        return True


class _FakeDB:
    def __init__(self):
        self.users = _Col()
        self.tenants = _Col()
        self.tasks = _Col()
        self.contacts = _Col()
        self.memberships = _Col()
        self.active_sessions = _Col()
        self.revoked_tokens = _Col()
        self.audit_log = _Col()

    def __getattr__(self, name):
        col = _Col()
        setattr(self, name, col)
        return col

    def __getitem__(self, name):
        return getattr(self, name)


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


async def _seed_workspace_with_target(db, tenant="t1",
                                        target="u_target", owner="u_owner",
                                        replacement="u_rep"):
    """Build a minimal fixture: owner + target + replacement, active
    memberships for all, one task assigned to target, one contact
    assigned to target, one active session for target in this tenant."""
    from services.auth.membership import create_membership
    await db.users.insert_one({"id": owner, "tenant_id": tenant, "name": "Owner",
                                "email": "owner@x.com"})
    await db.users.insert_one({"id": target, "tenant_id": tenant, "name": "Target",
                                "email": "target@x.com", "role": "sales",
                                "invite_token": "tok-still-valid",
                                "invite_expires_at": "2099-01-01"})
    await db.users.insert_one({"id": replacement, "tenant_id": tenant, "name": "Replacement",
                                "email": "rep@x.com", "role": "sales"})
    await create_membership(db, user_id=owner, tenant_id=tenant, role="owner")
    await create_membership(db, user_id=target, tenant_id=tenant, role="sales")
    await create_membership(db, user_id=replacement, tenant_id=tenant, role="sales")
    await db.tasks.insert_one({
        "id": "t_A", "tenant_id": tenant,
        "assignee_id": target, "assignee_role": "sales", "title": "Task A",
    })
    await db.tasks.insert_one({
        "id": "t_B", "tenant_id": tenant,
        "assignee_id": target, "assignee_role": "sales", "title": "Task B",
    })
    await db.contacts.insert_one({
        "id": "c_1", "tenant_id": tenant, "assigned_id": target, "name": "Contact 1",
    })
    from services.auth.session_tracking import record_session
    await record_session(
        db, jti="j_target_t1", user_id=target, tenant_id=tenant,
        exp=datetime.now(timezone.utc) + timedelta(days=7),
    )


class TestFreshDeprovision:
    def test_full_run_reassigns_everything(self):
        from services.deprovisioning import deprovision_user
        db = _FakeDB()
        _run(_seed_workspace_with_target(db))
        report = _run(deprovision_user(
            db, target_user_id="u_target", tenant_id="t1",
            actor_user_id="u_owner",
            reassign_to_user_id="u_rep",
        ))
        assert report["ok"] is True
        assert report["sessions_revoked"] == 1
        assert report["membership_removed"] is True
        assert report["tasks_reassigned"] == 2
        assert report["contacts_reassigned"] == 1
        assert report["invite_token_cleared"] is True
        # Membership row is soft-deleted
        m = _run(db.memberships.find_one({"user_id": "u_target", "tenant_id": "t1"}))
        assert m["status"] == "removed"
        # Task assignee flipped to replacement + role updated
        task_a = _run(db.tasks.find_one({"id": "t_A"}))
        assert task_a["assignee_id"] == "u_rep"
        assert task_a["assignee_role"] == "sales"
        # Contact reassigned
        contact = _run(db.contacts.find_one({"id": "c_1"}))
        assert contact["assigned_id"] == "u_rep"
        # Sessions revoked
        for s in db.active_sessions.docs:
            if s["user_id"] == "u_target" and s["tenant_id"] == "t1":
                assert s["revoked_at"] is not None
        # Invite token cleared on user doc
        target_user = _run(db.users.find_one({"id": "u_target"}))
        assert target_user["invite_token"] is None

    def test_no_reassign_target_nullifies_assignments(self):
        from services.deprovisioning import deprovision_user
        db = _FakeDB()
        _run(_seed_workspace_with_target(db))
        report = _run(deprovision_user(
            db, target_user_id="u_target", tenant_id="t1",
            actor_user_id="u_owner",
        ))
        assert report["ok"] is True
        # Tasks flipped to None assignee
        task_a = _run(db.tasks.find_one({"id": "t_A"}))
        assert task_a["assignee_id"] is None
        # Contact assigned_id nullified
        contact = _run(db.contacts.find_one({"id": "c_1"}))
        assert contact["assigned_id"] is None


class TestIdempotent:
    def test_second_call_is_clean_noop(self):
        from services.deprovisioning import deprovision_user
        db = _FakeDB()
        _run(_seed_workspace_with_target(db))
        _run(deprovision_user(
            db, target_user_id="u_target", tenant_id="t1",
            actor_user_id="u_owner", reassign_to_user_id="u_rep",
        ))
        # Second call
        report2 = _run(deprovision_user(
            db, target_user_id="u_target", tenant_id="t1",
            actor_user_id="u_owner", reassign_to_user_id="u_rep",
        ))
        assert report2["ok"] is True
        # Nothing left to do the second time
        assert report2["sessions_revoked"] == 0
        assert report2["tasks_reassigned"] == 0
        assert report2["contacts_reassigned"] == 0


class TestLastOwnerGuard:
    def test_refuses_deprovisioning_sole_owner(self):
        from services.deprovisioning import deprovision_user
        from services.auth.membership import create_membership
        db = _FakeDB()
        _run(db.users.insert_one({"id": "u_solo", "tenant_id": "t1"}))
        _run(create_membership(
            db, user_id="u_solo", tenant_id="t1", role="owner",
        ))
        report = _run(deprovision_user(
            db, target_user_id="u_solo", tenant_id="t1",
            actor_user_id="u_solo",
        ))
        assert report["ok"] is False
        assert "last owner" in (report.get("error") or "").lower()

    def test_allows_owner_deprov_when_second_owner_exists(self):
        """Two owners = the guard doesn't fire."""
        from services.deprovisioning import deprovision_user
        from services.auth.membership import create_membership
        db = _FakeDB()
        for uid in ("u_1", "u_2"):
            _run(db.users.insert_one({"id": uid, "tenant_id": "t1"}))
            _run(create_membership(
                db, user_id=uid, tenant_id="t1", role="owner",
            ))
        report = _run(deprovision_user(
            db, target_user_id="u_1", tenant_id="t1",
            actor_user_id="u_2",
        ))
        assert report["ok"] is True


class TestTenantScoping:
    def test_session_revoke_scoped_to_tenant(self):
        """User has sessions in tenant A + B. Deprovisioning from A
        must leave B's session alive."""
        from services.deprovisioning import deprovision_user
        from services.auth.membership import create_membership
        from services.auth.session_tracking import record_session
        db = _FakeDB()
        _run(db.users.insert_one({"id": "u1"}))
        _run(create_membership(db, user_id="u1", tenant_id="tA", role="sales"))
        _run(create_membership(db, user_id="u1", tenant_id="tB", role="sales"))
        # Owner of tA to authorize + guard the last-owner check.
        _run(create_membership(db, user_id="owner_A", tenant_id="tA", role="owner"))
        _run(record_session(db, jti="jA", user_id="u1", tenant_id="tA",
                             exp=datetime.now(timezone.utc) + timedelta(days=7)))
        _run(record_session(db, jti="jB", user_id="u1", tenant_id="tB",
                             exp=datetime.now(timezone.utc) + timedelta(days=7)))
        _run(deprovision_user(
            db, target_user_id="u1", tenant_id="tA",
            actor_user_id="owner_A",
        ))
        by_jti = {d["jti"]: d for d in db.active_sessions.docs}
        assert by_jti["jA"]["revoked_at"] is not None
        assert by_jti["jB"]["revoked_at"] is None
        # Membership in tB survives (still an active member there)
        m_B = _run(db.memberships.find_one({"user_id": "u1", "tenant_id": "tB"}))
        assert m_B["status"] == "active"


class TestAuditLogEntry:
    def test_records_user_deprovisioned_action(self):
        from services.deprovisioning import deprovision_user
        db = _FakeDB()
        _run(_seed_workspace_with_target(db))
        _run(deprovision_user(
            db, target_user_id="u_target", tenant_id="t1",
            actor_user_id="u_owner", reassign_to_user_id="u_rep",
        ))
        # Audit log has the row
        audits = [d for d in db.audit_log.docs if d["action"] == "user_deprovisioned"]
        assert len(audits) == 1
        assert audits[0]["actor_id"] == "u_owner"
        assert audits[0]["entity_id"] == "u_target"
        assert audits[0]["meta"]["reassigned_to"] == "u_rep"
        assert audits[0]["meta"]["tasks_reassigned"] == 2


class TestEndpoint:
    def test_endpoint_is_owner_only(self):
        from routers.team import deprovision_member
        src = inspect.getsource(deprovision_member)
        assert 'require_role("owner")' in src

    def test_endpoint_refuses_self_deprovision(self):
        from routers.team import deprovision_member
        src = inspect.getsource(deprovision_member)
        assert 'user_id == user["id"]' in src
        assert 'status_code=400' in src

    def test_endpoint_validates_replacement_is_live_member(self):
        from routers.team import deprovision_member
        src = inspect.getsource(deprovision_member)
        assert "find_membership" in src
        assert "LIVE_STATUSES" in src

    def test_endpoint_surfaces_400_on_last_owner(self):
        from routers.team import deprovision_member
        src = inspect.getsource(deprovision_member)
        # The report.ok=false branch raises HTTPException.
        assert 'report.get("ok")' in src
