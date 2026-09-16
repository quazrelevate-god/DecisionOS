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
            assert "finance" in await _refused(team.update_user("u-priya", UserUpdateInput(
                permissions=["inbox", "tasks", "finance"]), user=mgr))
            await team.update_user("u-priya", UserUpdateInput(permissions=["inbox", "tasks"]), user=mgr)
            await team.update_user("u-priya", UserUpdateInput(
                role="finance", permissions=["inbox", "tasks", "finance"]), user=mgr)
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


# ---------------------------------------------------------------------------
# Remove a member (2026-09-15) and the role permission editor
# ---------------------------------------------------------------------------
async def _member(db, uid, role, name, **extra):
    await db.users.insert_one({"id": uid, "tenant_id": T, "role": role, "name": name,
                               "email": f"{uid}@{T}.test", "created_at": now_iso(), **extra})
    await db.memberships.insert_one({"id": f"m-{uid}", "user_id": uid, "tenant_id": T, "role": role,
                                     "permissions": extra.get("permissions") or [], "status": "active",
                                     "created_at": now_iso()})


def test_remove_member_hands_over_work_and_ends_access(with_test_db):
    from models.team import DeprovisionInput
    from services.auth.membership import legacy_access_allowed

    async def scenario(db):
        await db.tenants.insert_one({"id": T, "company_name": "Weave Co", "plan": "business", "created_at": now_iso(),
                                     "roles": [{"key": k, "label": k.title()} for k in ("sales", "finance", "operations")]})
        await _member(db, "u-owner", "owner", "Rajesh (owner)")
        # Sunita leaves: she does and approves work, decides, and manages Sai.
        await _member(db, "u-sunita", "finance", "Sunita (finance)", reporting_manager_id="u-owner",
                      permissions=["inbox", "tasks", "finance", "approvals", "decisions_approve"])
        # Kiran takes over: may approve tasks, may not decide decisions.
        await _member(db, "u-kiran", "finance", "Kiran (finance)", permissions=["inbox", "tasks", "finance", "approvals"])
        await _member(db, "u-sai", "finance", "Sai (finance)", reporting_manager_id="u-sunita")
        tasks = [
            {"id": "t-open", "assignee_id": "u-sunita", "status": "in_progress"},
            {"id": "t-done", "assignee_id": "u-sunita", "status": "done"},
            {"id": "t-help", "assignee_id": "u-sai", "co_assignee_ids": ["u-sunita"], "status": "todo"},
            {"id": "t-appr", "assignee_id": "u-sai", "approval_required": True, "approver_id": "u-sunita", "status": "blocked"},
        ]
        for t in tasks:
            await db.tasks.insert_one({"tenant_id": T, "title": t["id"], "created_at": now_iso(), **t})
        await db.decisions.insert_one({"id": "d-1", "tenant_id": T, "title": "Pay the dye supplier",
                                       "status": "pending_approval", "approver_id": "u-sunita"})
        await db.contacts.insert_one({"id": "c-1", "tenant_id": T, "name": "Kumar Fabrics", "assigned_id": "u-sunita"})
        with e2e_env(db):
            s = await team.offboarding_summary("u-sunita", user=OWNER)
            assert (s["tasks_doing"], s["tasks_helping"], s["tasks_approving"], s["decisions_waiting"], s["reports"], s["contacts"]) \
                == (1, 1, 1, 1, 1, 1)
            assert s["suggested_replacement_id"] == "u-owner"

            report = await team.deprovision_member("u-sunita", DeprovisionInput(reassign_to_user_id="u-kiran"), user=OWNER)
            assert report["ok"] and report["approvals_moved"] == 1 and report["decisions_moved"] == 1 and report["reports_moved"] == 1
            t = {d["id"]: d async for d in db.tasks.find({"tenant_id": T}, {"_id": 0})}
            assert t["t-open"]["assignee_id"] == "u-kiran", "open work goes to the replacement"
            assert t["t-done"]["assignee_id"] == "u-sunita", "finished work keeps who did it"
            assert "u-sunita" not in t["t-help"]["co_assignee_ids"]
            assert t["t-appr"]["approver_id"] == "u-kiran", "Kiran may approve tasks"
            assert (await db.decisions.find_one({"id": "d-1"}))["approver_id"] == "u-owner", "Kiran may not decide -> owner"
            assert (await db.users.find_one({"id": "u-sai"}))["reporting_manager_id"] == "u-kiran"
            assert (await db.contacts.find_one({"id": "c-1"}))["assigned_id"] == "u-kiran"

            # Gone from the list, and no way back in through the old account fields.
            listed = {u["id"] for u in await team.list_users(user=OWNER)}
            assert "u-sunita" not in listed and {"u-owner", "u-kiran", "u-sai"} <= listed
            sunita = await db.users.find_one({"id": "u-sunita"}, {"_id": 0})
            assert await legacy_access_allowed(db, sunita, T) is False
            # A true pre-membership account still gets in.
            await db.users.insert_one({"id": "u-old", "tenant_id": T, "role": "sales", "name": "Old account"})
            assert await legacy_access_allowed(db, {"id": "u-old", "tenant_id": T, "role": "sales"}, T) is True
            return True
    assert with_test_db(scenario) is True


def test_remove_works_for_accounts_from_before_memberships(with_test_db):
    """Demo and older accounts have no membership row: they can take work over,
    be removed (and then not sign in), and the last such owner stays."""
    from models.team import DeprovisionInput
    from services.auth.membership import legacy_access_allowed

    async def scenario(db):
        await db.tenants.insert_one({"id": T, "company_name": "Weave Co", "plan": "business", "created_at": now_iso(),
                                     "roles": [{"key": k, "label": k.title()} for k in ("sales", "finance")]})
        for uid, role, name, mgr in (("u-owner", "owner", "Rajesh", None), ("u-sunita", "finance", "Sunita", None),
                                     ("u-priya", "sales", "Priya", "u-sunita")):
            await db.users.insert_one({"id": uid, "tenant_id": T, "role": role, "name": name, "email": f"{uid}@t1.test",
                                       "reporting_manager_id": mgr, "created_at": now_iso()})
        await db.tasks.insert_one({"id": "t-1", "tenant_id": T, "title": "Quote", "assignee_id": "u-priya", "status": "todo"})
        with e2e_env(db):
            s = await team.offboarding_summary("u-priya", user=OWNER)
            assert s["suggested_replacement_id"] == "u-sunita", "an older account can be suggested"
            report = await team.deprovision_member("u-priya", DeprovisionInput(reassign_to_user_id="u-sunita"), user=OWNER)
            assert report["ok"] and report["membership_removed"]
            assert (await db.tasks.find_one({"id": "t-1"}))["assignee_id"] == "u-sunita"
            priya = await db.users.find_one({"id": "u-priya"}, {"_id": 0})
            assert await legacy_access_allowed(db, priya, T) is False, "removed: no way back in"
            assert "u-priya" not in {u["id"] for u in await team.list_users(user=OWNER)}
            # The only owner (an older account) is not removed.
            await _refused(team.deprovision_member("u-owner", DeprovisionInput(), user={**OWNER, "id": "u-other-owner"}), 400)
            return True
    assert with_test_db(scenario) is True


def test_no_access_name_and_email(with_test_db):
    """RBAC P1 (2026-09-15): their own list with nothing ticked is No access (not
    the role's); following the role again restores it. A name can be corrected;
    only an owner changes an email, and it must be free."""
    async def scenario(db):
        await _seed(db)
        with e2e_env(db):
            await team.update_user("u-priya", UserUpdateInput(follow_role=False, permissions=[]), user=OWNER)
            eff = {u["id"]: u["effective_permissions"] for u in await team.list_users(user=OWNER)}
            assert eff["u-priya"] == [], "No access"
            await team.update_user("u-priya", UserUpdateInput(follow_role=True, permissions=["finance"]), user=OWNER)
            eff = {u["id"]: u["effective_permissions"] for u in await team.list_users(user=OWNER)}
            assert eff["u-priya"] and "finance" not in eff["u-priya"], "back to the sales role's access"

            await team.update_user("u-priya", UserUpdateInput(name="Priya Nair"), user=MGR)
            assert (await db.users.find_one({"id": "u-priya"}))["name"] == "Priya Nair"
            await _refused(team.update_user("u-priya", UserUpdateInput(email="priya.new@t1.test"), user=MGR))
            await _refused(team.update_user("u-priya", UserUpdateInput(email="u-mgr@t1.test"), user=OWNER), 400)
            await _refused(team.update_user("u-priya", UserUpdateInput(name="  "), user=OWNER), 400)
            await team.update_user("u-priya", UserUpdateInput(email="Priya.New@T1.test"), user=OWNER)
            assert (await db.users.find_one({"id": "u-priya"}))["email"] == "priya.new@t1.test"
            return True
    assert with_test_db(scenario) is True


def test_real_access_for_deciders_approvers_and_decisions(with_test_db):
    """RBAC P1 (2026-09-15): routing, the deciders list and approval notifications
    use what people can really open (membership, role settings, temporary grants,
    owner exclusions); the decisions list shows only what you can open; adding a
    task to a decision needs you on it and follows the assign rules."""
    import routers.decisions as decisions
    from models.tasks import TaskCreateInput
    from services.decision_flow import decision_deciders, route_approver
    from services.notifications import _approver_ids

    async def scenario(db):
        await db.tenants.insert_one({"id": T, "company_name": "Weave Co", "plan": "business", "created_at": now_iso(),
                                     "owner_exclusions": ["decisions_approve"],
                                     "roles": [{"key": "sales", "label": "Sales"},
                                               {"key": "finance", "label": "Finance", "permissions": ["inbox", "tasks", "approvals"]}]})
        await _member(db, "u-owner", "owner", "Rajesh (owner)")
        await _member(db, "u-owner2", "owner", "Anita (owner)")
        await _member(db, "u-priya", "sales", "Priya (sales)")
        await _member(db, "u-sunita", "finance", "Sunita (finance)")   # approvals from the role only
        # Priya holds Approve decisions for a week (temporary grant on her membership).
        await db.memberships.update_one({"user_id": "u-priya"}, {"$set": {"temp_grants": [
            {"perm": "decisions_approve", "expires_at": "2099-01-01T00:00:00+00:00"}]}})
        with e2e_env(db):
            assert (await route_approver(T, "u-priya"))[0] == "u-priya", "temporary grant counts"
            deciders = {d["id"] for d in await decision_deciders(T)}
            assert "u-priya" in deciders and "u-owner" not in deciders, "owner exclusion counts"
            assert "u-sunita" in set(await _approver_ids(T)), "role-level Approve tasks is told"

            for did, by in (("d-mine", "u-priya"), ("d-other", "u-sunita")):
                await db.decisions.insert_one({"id": did, "tenant_id": T, "title": did, "status": "approved",
                                               "created_by": by, "created_at": now_iso()})
            priya = {"id": "u-priya", "tenant_id": T, "role": "sales", "name": "Priya", "permissions": []}
            assert {d["id"] for d in await decisions.list_decisions(user=priya)} == {"d-mine"}
            assert {d["id"] for d in await decisions.list_decisions(user=OWNER)} == {"d-mine", "d-other"}
            await _refused(decisions.add_decision_task("d-other", TaskCreateInput(title="x"), user=priya))
            # On her own decision, but Sunita isn't someone Priya may give work to.
            await _refused(decisions.add_decision_task(
                "d-mine", TaskCreateInput(title="Chase Kapoor", assignee_id="u-sunita"), user=priya))
            return True
    assert with_test_db(scenario) is True


def test_ai_consent_turns_on_and_off(with_test_db):
    """RBAC P1 (2026-09-16): the Settings card's two actions. Turning AI off used
    to fail every time (updated_at outside $set)."""
    from starlette.requests import Request
    from models.tenant import AiConsentGrantInput

    request = Request({"type": "http", "method": "POST", "path": "/api/tenant/ai-consent",
                       "headers": [(b"user-agent", b"pytest")], "client": ("127.0.0.1", 1)})

    async def scenario(db):
        await _seed(db)
        owner = {**OWNER, "email": "u-owner@t1.test"}
        with e2e_env(db):
            assert (await tenant_settings.get_ai_consent(user=owner))["active"] is False
            on = await tenant_settings.grant_ai_consent(AiConsentGrantInput(acknowledged=True), request, user=owner)
            assert on["active"] is True and on["granted_by_email"] == "u-owner@t1.test"
            off = await tenant_settings.revoke_ai_consent(request, user=owner)
            assert off["active"] is False and off["revoked_at"]
            again = await tenant_settings.grant_ai_consent(AiConsentGrantInput(acknowledged=True), request, user=owner)
            assert again["active"] is True
            return True
    assert with_test_db(scenario) is True


def test_contacts_crm_complaints_use_people_access():
    import inspect
    import routers.complaints as complaints
    import routers.contacts as contacts
    import routers.crm as crm
    for fn in (contacts.create_contact, contacts.update_contact, contacts.delete_contact,
               complaints.create_complaint, complaints.resolve_complaint, crm.log_activity_for_contact):
        src = inspect.getsource(fn)
        assert 'require_perm("people")' in src and 'require_role("owner", "sales")' not in src, fn.__name__


def test_role_access_editor_reaches_people_who_follow_the_role(with_test_db):
    async def scenario(db):
        await db.tenants.insert_one({"id": T, "company_name": "Weave Co", "plan": "business", "created_at": now_iso(),
                                     "roles": [{"key": k, "label": k.title()} for k in ("sales", "finance", "operations")]})
        await _member(db, "u-owner", "owner", "Rajesh (owner)")
        await _member(db, "u-priya", "sales", "Priya (sales)")                                   # follows the role
        await _member(db, "u-anil", "sales", "Anil (sales)", permissions=["inbox", "tasks"])     # own list
        with e2e_env(db):
            role_perms = ["inbox", "tasks", "people", "approvals"]
            out = await tenant_settings.update_role_permissions("sales", RolePermissionsInput(permissions=role_perms), user=OWNER)
            assert out["members_updated"] == 0
            eff = {u["id"]: u["effective_permissions"] for u in await team.list_users(user=OWNER)}
            assert eff["u-priya"] == sorted(role_perms), "follows the role"
            assert eff["u-anil"] == ["inbox", "tasks"], "own list wins"

            out = await tenant_settings.update_role_permissions(
                "sales", RolePermissionsInput(permissions=role_perms, apply_to_members=True), user=OWNER)
            assert out["members_updated"] == 1
            assert (await db.users.find_one({"id": "u-anil"}))["permissions"] == []
            eff = {u["id"]: u["effective_permissions"] for u in await team.list_users(user=OWNER)}
            assert eff["u-anil"] == sorted(role_perms)

            # A member saved with "Use the role's access" (an empty list) follows it too.
            await team.update_user("u-anil", UserUpdateInput(permissions=["inbox"]), user=OWNER)
            await team.update_user("u-anil", UserUpdateInput(permissions=[]), user=OWNER)
            eff = {u["id"]: u["effective_permissions"] for u in await team.list_users(user=OWNER)}
            assert eff["u-anil"] == sorted(role_perms)
            return True
    assert with_test_db(scenario) is True
