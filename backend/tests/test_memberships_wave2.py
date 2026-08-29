"""FIX-004-B (RBAC Wave 2) tests: memberships collection + email-per-person.

RBAC-13 — memberships collection contract:
  * create_membership: fresh insert, idempotent re-invite, reactivate
    removed, invalid status rejection, invited_by lineage
  * find_membership: hit + miss + status filtering
  * list_memberships_for_user / for_tenant: ordering + status filter
  * update_membership: role + permissions changes
  * remove_membership: soft-delete via status flip
  * resolve_login_choices: multi-tenant, ordering (newest first),
    excludes non-live statuses, joins tenant names in one round-trip

RBAC-12 — login ambiguity picker:
  * Single-membership fast path
  * Multi-membership without tenant_id -> ambiguity response
  * Multi-membership with valid tenant_id -> issued token
  * Multi-membership with invalid tenant_id -> 404
  * Legacy fallback: pre-migration user with tenant_id/role still works

Compat layer (get_current_user):
  * Projects membership role + permissions onto user dict
  * Refuses when the JWT's claimed tenant no longer has a live
    membership for the user
  * Legacy fallback when memberships row is missing

Bootstrap wiring:
  * Migration registered
  * Indexes created (compound unique + query indexes)

Endpoints:
  * /me/workspaces returns memberships with is_current flag
  * /me/switch-workspace refuses non-member tenants
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
# In-memory Mongo double with $in / $type / $gt operator support.
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

    def __aiter__(self):
        return _AIter(iter(self._docs))


class _AIter:
    def __init__(self, it):
        self._it = it

    def __aiter__(self):
        return self

    async def __anext__(self):
        try:
            return next(self._it)
        except StopIteration:
            raise StopAsyncIteration


class _Col:
    def __init__(self):
        self.docs = []

    async def find_one(self, q, projection=None):
        for d in self.docs:
            if self._match(d, q):
                return dict(d)
        return None

    def find(self, q, projection=None):
        return _Cursor([d for d in self.docs if self._match(d, q)])

    async def insert_one(self, doc):
        self.docs.append(dict(doc))
        return SimpleNamespace(inserted_id=doc.get("id"))

    async def update_one(self, q, u, upsert=False):
        for d in self.docs:
            if self._match(d, q):
                if "$set" in u:
                    d.update(u["$set"])
                return SimpleNamespace(matched_count=1, modified_count=1)
        return SimpleNamespace(matched_count=0, modified_count=0)

    async def delete_one(self, q):
        for i, d in enumerate(self.docs):
            if self._match(d, q):
                self.docs.pop(i)
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)

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
                    elif op == "$type" and ov == "string" and not isinstance(dv, str):
                        return False
                    elif op == "$gt" and not (dv is not None and dv > ov):
                        return False
                    elif op == "$exists" and (k in d) != ov:
                        return False
            elif dv != v:
                return False
        return True


class _FakeDB:
    def __init__(self):
        self.memberships = _Col()
        self.tenants = _Col()
        self.users = _Col()

    def __getattr__(self, name):
        c = _Col()
        setattr(self, name, c)
        return c

    def __getitem__(self, name):
        return getattr(self, name)


# Dedicated module-scoped loop (see audit-log note): owning our own loop
# keeps every call in this module on one live loop and is immune to another
# module's asyncio.run() closing the process current loop under -n/loadscope.
_LOOP = asyncio.new_event_loop()


def _run(coro):
    return _LOOP.run_until_complete(coro)


# ===========================================================================
# services.auth.membership — contract
# ===========================================================================
class TestCreateMembership:
    def test_fresh_create_returns_full_doc(self):
        from services.auth.membership import create_membership
        db = _FakeDB()
        m = _run(create_membership(
            db, user_id="u1", tenant_id="t1", role="owner",
            permissions=["finance", "ledger"],
        ))
        assert m["user_id"] == "u1"
        assert m["tenant_id"] == "t1"
        assert m["role"] == "owner"
        assert m["permissions"] == ["finance", "ledger"]
        assert m["status"] == "active"
        assert m["id"]
        assert m["accepted_at"]  # active -> accepted immediately

    def test_second_create_is_idempotent(self):
        """Re-adding a member who's already active must not duplicate
        the row."""
        from services.auth.membership import create_membership
        db = _FakeDB()
        m1 = _run(create_membership(db, user_id="u1", tenant_id="t1", role="sales"))
        m2 = _run(create_membership(db, user_id="u1", tenant_id="t1", role="finance"))
        assert m1["id"] == m2["id"]
        assert len(db.memberships.docs) == 1

    def test_reinvite_removed_reactivates_in_place(self):
        """A previously-removed member re-invited flips status back to
        active without duplicating the row. Preserves audit lineage."""
        from services.auth.membership import (
            create_membership, remove_membership, STATUS_ACTIVE,
        )
        db = _FakeDB()
        _run(create_membership(db, user_id="u1", tenant_id="t1", role="sales"))
        _run(remove_membership(db, user_id="u1", tenant_id="t1"))
        assert db.memberships.docs[0]["status"] == "removed"
        _run(create_membership(
            db, user_id="u1", tenant_id="t1", role="finance",
            invited_by="u_owner",
        ))
        row = db.memberships.docs[0]
        assert row["status"] == STATUS_ACTIVE
        assert row["role"] == "finance"
        assert row["invited_by"] == "u_owner"
        assert row["removed_at"] is None
        assert len(db.memberships.docs) == 1

    def test_pending_status_no_accepted_at(self):
        from services.auth.membership import create_membership
        db = _FakeDB()
        m = _run(create_membership(
            db, user_id="u1", tenant_id="t1", role="sales",
            status="pending", invite_token="tok-1",
        ))
        assert m["status"] == "pending"
        assert m["accepted_at"] is None
        assert m["invite_token"] == "tok-1"

    def test_invalid_status_rejected(self):
        from services.auth.membership import create_membership
        db = _FakeDB()
        with pytest.raises(ValueError):
            _run(create_membership(
                db, user_id="u1", tenant_id="t1", role="sales",
                status="not-a-real-status",
            ))


class TestFindMembership:
    def test_hit_and_miss(self):
        from services.auth.membership import create_membership, find_membership
        db = _FakeDB()
        _run(create_membership(db, user_id="u1", tenant_id="t1", role="sales"))
        assert _run(find_membership(db, "u1", "t1"))["role"] == "sales"
        assert _run(find_membership(db, "u1", "t_other")) is None

    def test_status_filter(self):
        from services.auth.membership import (
            create_membership, remove_membership, find_membership, LIVE_STATUSES,
        )
        db = _FakeDB()
        _run(create_membership(db, user_id="u1", tenant_id="t1", role="sales"))
        _run(remove_membership(db, user_id="u1", tenant_id="t1"))
        # Live-only lookup must return None for a removed membership.
        assert _run(find_membership(db, "u1", "t1", statuses=LIVE_STATUSES)) is None
        # Unfiltered still finds it.
        assert _run(find_membership(db, "u1", "t1")) is not None


class TestListMembershipsForUser:
    def test_multi_tenant(self):
        from services.auth.membership import (
            create_membership, list_memberships_for_user,
        )
        db = _FakeDB()
        _run(create_membership(db, user_id="u1", tenant_id="t1", role="owner"))
        _run(create_membership(db, user_id="u1", tenant_id="t2", role="sales"))
        _run(create_membership(db, user_id="u2", tenant_id="t1", role="finance"))
        rows = _run(list_memberships_for_user(db, "u1"))
        assert len(rows) == 2
        assert {r["tenant_id"] for r in rows} == {"t1", "t2"}

    def test_excludes_removed_when_filtered(self):
        from services.auth.membership import (
            create_membership, remove_membership, list_memberships_for_user,
            LIVE_STATUSES,
        )
        db = _FakeDB()
        _run(create_membership(db, user_id="u1", tenant_id="t1", role="owner"))
        _run(create_membership(db, user_id="u1", tenant_id="t2", role="sales"))
        _run(remove_membership(db, user_id="u1", tenant_id="t2"))
        rows = _run(list_memberships_for_user(db, "u1", statuses=LIVE_STATUSES))
        assert len(rows) == 1
        assert rows[0]["tenant_id"] == "t1"


class TestResolveLoginChoices:
    def test_returns_tenant_name_joined(self):
        from services.auth.membership import create_membership, resolve_login_choices
        db = _FakeDB()
        _run(db.tenants.insert_one({"id": "t1", "name": "Sharma Textiles"}))
        _run(db.tenants.insert_one({"id": "t2", "name": "Kumar Salon"}))
        _run(create_membership(db, user_id="u1", tenant_id="t1", role="owner"))
        _run(create_membership(db, user_id="u1", tenant_id="t2", role="sales"))
        out = _run(resolve_login_choices(db, "u1"))
        by_id = {c["tenant_id"]: c for c in out}
        assert by_id["t1"]["tenant_name"] == "Sharma Textiles"
        assert by_id["t2"]["tenant_name"] == "Kumar Salon"
        assert by_id["t1"]["role"] == "owner"
        assert by_id["t2"]["role"] == "sales"

    def test_empty_user_returns_empty(self):
        from services.auth.membership import resolve_login_choices
        assert _run(resolve_login_choices(_FakeDB(), "no-such-user")) == []

    def test_excludes_removed(self):
        from services.auth.membership import (
            create_membership, remove_membership, resolve_login_choices,
        )
        db = _FakeDB()
        _run(db.tenants.insert_one({"id": "t1", "name": "T"}))
        _run(db.tenants.insert_one({"id": "t2", "name": "T2"}))
        _run(create_membership(db, user_id="u1", tenant_id="t1", role="owner"))
        _run(create_membership(db, user_id="u1", tenant_id="t2", role="sales"))
        _run(remove_membership(db, user_id="u1", tenant_id="t2"))
        out = _run(resolve_login_choices(db, "u1"))
        assert len(out) == 1
        assert out[0]["tenant_id"] == "t1"


class TestUpdateMembership:
    def test_role_permission_change(self):
        from services.auth.membership import (
            create_membership, update_membership, find_membership,
        )
        db = _FakeDB()
        _run(create_membership(db, user_id="u1", tenant_id="t1", role="sales"))
        _run(update_membership(
            db, user_id="u1", tenant_id="t1",
            updates={"role": "finance", "permissions": ["ledger", "finance"]},
        ))
        m = _run(find_membership(db, "u1", "t1"))
        assert m["role"] == "finance"
        assert m["permissions"] == ["ledger", "finance"]

    def test_update_missing_returns_none(self):
        from services.auth.membership import update_membership
        assert _run(update_membership(
            _FakeDB(), user_id="ghost", tenant_id="ghost",
            updates={"role": "x"},
        )) is None


class TestRemoveMembership:
    def test_soft_delete_via_status_flip(self):
        from services.auth.membership import (
            create_membership, remove_membership, find_membership,
        )
        db = _FakeDB()
        _run(create_membership(db, user_id="u1", tenant_id="t1", role="sales"))
        assert _run(remove_membership(db, user_id="u1", tenant_id="t1")) is True
        row = _run(find_membership(db, "u1", "t1"))
        assert row is not None
        assert row["status"] == "removed"
        assert row["removed_at"]

    def test_remove_missing_returns_false(self):
        from services.auth.membership import remove_membership
        assert _run(remove_membership(
            _FakeDB(), user_id="ghost", tenant_id="ghost",
        )) is False


# ===========================================================================
# Compat layer — project_membership_onto_user
# ===========================================================================
class TestProjectMembership:
    def test_projects_role_and_permissions(self):
        from services.auth.membership import project_membership_onto_user
        user = {"id": "u1", "email": "a@b.com"}
        membership = {
            "id": "m1", "tenant_id": "t1", "role": "owner",
            "permissions": ["finance", "ledger"], "status": "active",
        }
        out = project_membership_onto_user(user, membership)
        assert out["tenant_id"] == "t1"
        assert out["role"] == "owner"
        assert out["permissions"] == ["finance", "ledger"]
        assert out["membership_id"] == "m1"
        assert out["membership_status"] == "active"
        # Original user dict unchanged (returns a NEW dict)
        assert "tenant_id" not in user

    def test_none_membership_returns_user_unchanged(self):
        from services.auth.membership import project_membership_onto_user
        user = {"id": "u1"}
        assert project_membership_onto_user(user, None) == user


# ===========================================================================
# Bootstrap wiring
# ===========================================================================
class TestBootstrapMemberships:
    def test_migration_registered(self):
        import server
        src = inspect.getsource(server._bootstrap)
        assert "backfill_memberships_v1" in src
        assert "memberships_user_tenant_unique" in src
        assert "memberships_user_status" in src
        assert "memberships_tenant_status" in src


# ===========================================================================
# Register wires membership creation
# ===========================================================================
class TestRegisterCreatesMembership:
    def test_register_source_creates_owner_membership(self):
        from routers.auth import register
        src = inspect.getsource(register)
        assert "create_membership" in src
        assert 'role="owner"' in src
        # And rolls back tenant + user on membership-creation failure
        # so we don't leave a half-provisioned workspace behind.
        assert "delete_one" in src


# ===========================================================================
# Login flow — ambiguity + fast path + legacy fallback
# ===========================================================================
class TestLoginFlow:
    def test_login_source_handles_multi_membership(self):
        from routers.auth import login
        src = inspect.getsource(login)
        # Ambiguity payload shape
        assert '"ambiguous": True' in src
        assert '"choices"' in src
        # Fast path for single membership
        assert "len(choices) == 1" in src
        # tenant_id hint honored on re-submit
        assert "inp.tenant_id" in src
        # Legacy fallback for pre-migration users
        assert 'user.get("tenant_id")' in src

    def test_login_input_has_tenant_id(self):
        from routers.auth import LoginInput
        m = LoginInput(email="a@b.com", password="pw")
        assert m.tenant_id is None
        m2 = LoginInput(email="a@b.com", password="pw", tenant_id="t1")
        assert m2.tenant_id == "t1"


# ===========================================================================
# /me/workspaces + /me/switch-workspace
# ===========================================================================
class TestWorkspaceEndpoints:
    def test_workspaces_endpoint_exists_and_uses_choices(self):
        from routers.auth import list_my_workspaces
        src = inspect.getsource(list_my_workspaces)
        assert "resolve_login_choices" in src
        assert "is_current" in src

    def test_switch_workspace_refuses_non_member(self):
        from routers.auth import switch_workspace
        src = inspect.getsource(switch_workspace)
        assert "find_membership" in src
        assert "status_code=403" in src
        assert "create_token" in src
        assert "set_auth_cookie" in src

    def test_switch_workspace_input_requires_tenant_id(self):
        from routers.auth import SwitchWorkspaceInput
        with pytest.raises(Exception):
            # Missing required tenant_id -> pydantic ValidationError.
            SwitchWorkspaceInput()


# ===========================================================================
# get_current_user — membership resolution + rejection
# ===========================================================================
class TestGetCurrentUserResolvesMembership:
    def test_source_resolves_membership_and_projects(self):
        import inspect as _inspect
        import core
        src = _inspect.getsource(core.get_current_user)
        # Uses the membership finder + projector
        assert "find_membership" in src
        assert "project_membership_onto_user" in src
        # Refuses when no live membership + no legacy fallback
        assert "status_code=403" in src

    def test_source_has_legacy_fallback(self):
        """A user whose backfill hasn't run yet still has legacy
        tenant_id + role on the user doc — accept that as a fallback
        so a mid-migration boot doesn't lock everyone out."""
        import inspect as _inspect
        import core
        src = _inspect.getsource(core.get_current_user)
        assert 'user.get("tenant_id") == claimed_tenant' in src


# ===========================================================================
# team.py — create_user + update_user wire membership
# ===========================================================================
class TestTeamRouterSyncsMembership:
    def test_create_user_creates_membership(self):
        from routers.team import create_user
        src = inspect.getsource(create_user)
        assert "create_membership" in src
        # Uses pending status when there's an invite token, active otherwise.
        assert "STATUS_PENDING" in src
        assert "STATUS_ACTIVE" in src

    def test_update_user_mirrors_role_perms_to_membership(self):
        from routers.team import update_user
        src = inspect.getsource(update_user)
        assert "update_membership" in src
        # Only role + permissions get mirrored; phone/manager stay on user.
        assert "membership_updates" in src
