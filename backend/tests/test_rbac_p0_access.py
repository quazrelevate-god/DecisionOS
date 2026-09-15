"""RBAC P0 (2026-09-15, docs/SETTINGS_RBAC_REVIEW.md) — Manage team cannot raise access.

Real handlers against an isolated with_test_db Mongo:
  - nobody changes their own role or gives themselves access (owners aside)
  - someone who isn't an owner gives only access they hold, the person already
    has, or the defaults of that person's role
  - temporary grants follow the same rule
  - only an owner changes what a role can do

Single-process, like the other in-process journeys:

    .venv/Scripts/python -m pytest tests/test_rbac_p0_access.py -o addopts="" -p no:xdist
"""
import os

import pytest
from fastapi import HTTPException

from shared.ids import now_iso
from tests.e2e_harness import e2e_env

pytestmark = pytest.mark.skipif(
    bool(os.environ.get("PYTEST_XDIST_WORKER")),
    reason="in-process E2E reaches shared Mongo clients -> run single-process, not under xdist")

import routers.access as access  # noqa: E402
import routers.team as team  # noqa: E402
import routers.tenant_settings as tenant_settings  # noqa: E402
from models.access import TempGrantInput  # noqa: E402
from models.team import UserCreateInput, UserUpdateInput  # noqa: E402
from models.tenant import RolePermissionsInput  # noqa: E402

T = "t1"
OWNER = {"id": "u-owner", "tenant_id": T, "role": "owner", "name": "Rajesh (owner)"}
MGR = {"id": "u-mgr", "tenant_id": T, "role": "operations", "name": "Amit (ops lead)",
       "permissions": ["inbox", "tasks", "workflows", "team_manage"]}
PRIYA = {"id": "u-priya", "tenant_id": T, "role": "sales", "name": "Priya (sales)"}
LATER = "2099-01-01T00:00:00+00:00"


async def _seed(db):
    await db.tenants.insert_one({
        "id": T, "company_name": "Weave Co", "plan": "business", "created_at": now_iso(),
        "roles": [{"key": k, "label": k.title()} for k in ("sales", "finance", "operations")]})
    for u in (OWNER, MGR, PRIYA):
        await db.users.insert_one({**u, "email": f"{u['id']}@{T}.test", "created_at": now_iso()})


async def _refused(coro, status=403):
    try:
        await coro
    except HTTPException as e:
        assert e.status_code == status, (e.status_code, e.detail)
        return e.detail
    raise AssertionError(f"expected HTTP {status}")


def test_manage_team_cannot_raise_its_own_access(with_test_db):
    async def scenario(db):
        await _seed(db)
        with e2e_env(db):
            # Own access and own role: refused.
            detail = await _refused(team.update_user("u-mgr", UserUpdateInput(
                permissions=MGR["permissions"] + ["finance"]), user=MGR))
            assert "finance" in detail
            await _refused(team.update_user("u-mgr", UserUpdateInput(role="finance"), user=MGR))
            # Dropping own access, or editing own title, is fine.
            await team.update_user("u-mgr", UserUpdateInput(permissions=["inbox", "tasks", "team_manage"], title="Ops lead"), user=MGR)
            assert (await db.users.find_one({"id": "u-mgr"}))["title"] == "Ops lead"
            mgr = {**MGR, "permissions": ["inbox", "tasks", "team_manage"]}

            # Someone else: only what the manager holds, what they already have, or their role's defaults.
            assert "ledger" in await _refused(team.update_user("u-priya", UserUpdateInput(
                permissions=["inbox", "tasks", "ledger"]), user=mgr))
            await team.update_user("u-priya", UserUpdateInput(permissions=["inbox", "tasks"]), user=mgr)
            await team.update_user("u-priya", UserUpdateInput(
                role="finance", permissions=["inbox", "tasks", "finance", "ledger"]), user=mgr)
            assert (await db.users.find_one({"id": "u-priya"}))["role"] == "finance"
            # A new member: same rule.
            await _refused(team.create_user(UserCreateInput(
                name="Ravi", email="ravi@t1.test", role="sales", password="secret1",
                permissions=["inbox", "tasks", "decisions_approve"]), user=mgr))
            assert await db.users.count_documents({"email": "ravi@t1.test"}) == 0

            # The owner gives anything.
            await team.update_user("u-priya", UserUpdateInput(permissions=["inbox", "tasks", "decisions_approve"]), user=OWNER)
            assert "decisions_approve" in (await db.users.find_one({"id": "u-priya"}))["permissions"]
            return True
    assert with_test_db(scenario) is True


def test_temporary_grants_and_role_permissions(with_test_db):
    async def scenario(db):
        await _seed(db)
        with e2e_env(db):
            await _refused(access.grant_temp_perm("u-mgr", TempGrantInput(perm="finance", expires_at=LATER), user=MGR))
            await _refused(access.grant_temp_perm("u-mgr", TempGrantInput(perm="tasks", expires_at=LATER), user=MGR))
            await _refused(access.grant_temp_perm("u-priya", TempGrantInput(perm="finance", expires_at=LATER), user=MGR))
            # A permission the manager holds passes the check (no membership row here -> 404 after it).
            await _refused(access.grant_temp_perm("u-priya", TempGrantInput(perm="tasks", expires_at=LATER), user=MGR), 404)

            # What a role can do: owner only.
            await _refused(tenant_settings.update_role_permissions(
                "operations", RolePermissionsInput(permissions=["inbox", "tasks", "finance", "team_manage"]), user=MGR))
            out = await tenant_settings.update_role_permissions(
                "operations", RolePermissionsInput(permissions=["inbox", "tasks", "workflows"]), user=OWNER)
            assert next(r for r in out["roles"] if r["key"] == "operations")["permissions"] == ["inbox", "tasks", "workflows"]
            return True
    assert with_test_db(scenario) is True
