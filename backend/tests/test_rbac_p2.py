"""RBAC P2 (2026-09-16, docs/SETTINGS_RBAC_REVIEW.md) — real saves in an isolated
with_test_db Mongo:

  - overdue work: the company's escalation days drive the ladder; owners can
    switch the alert email off
  - "approve on my behalf while I'm away": the delegate approves tasks and
    decides decisions that name the person away, sees them in Approvals and is
    told when new ones arrive
  - /tasks/{id}/reassign follows the task's people rule; hand-off follows the
    assign rules; dictation needs Ask AI or Voice capture
  - owners can't be excluded from Manage team; one AI key can be set without
    losing the others

    .venv/Scripts/python -m pytest tests/test_rbac_p2.py -o addopts="" -p no:xdist
"""
import os
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from shared.ids import now_iso
from tests.e2e_harness import e2e_env

pytestmark = pytest.mark.skipif(
    bool(os.environ.get("PYTEST_XDIST_WORKER")),
    reason="in-process E2E reaches shared Mongo clients -> run single-process, not under xdist")

import routers.tasks as tasks  # noqa: E402
import routers.tenant_settings as tenant_settings  # noqa: E402
import routers.voice_notes as voice_notes  # noqa: E402
from models.tasks import TaskReassignInput  # noqa: E402
from models.tenant import OwnerExclusionsInput, TenantAIKeyInput, TenantSettingsInput  # noqa: E402

T = "t1"
OWNER = {"id": "u-owner", "tenant_id": T, "role": "owner", "name": "Rajesh (owner)", "email": "u-owner@t1.test"}
SALES = {"id": "u-sales", "tenant_id": T, "role": "sales", "name": "Priya (sales lead)"}
OPS = {"id": "u-ops", "tenant_id": T, "role": "operations", "name": "Amit (operations)", "reporting_manager_id": "u-sales"}
FIN = {"id": "u-fin", "tenant_id": T, "role": "finance", "name": "Sunita (finance)",
       "permissions": ["inbox", "tasks", "finance", "approvals", "decisions_approve"]}
KEEP = {"services.notifications.push_notification"}
REQUEST = Request({"type": "http", "method": "PUT", "path": "/api/tenant", "headers": [(b"user-agent", b"pytest")],
                   "client": ("127.0.0.1", 1)})


async def _seed(db):
    await db.tenants.insert_one({"id": T, "company_name": "Weave Co", "plan": "business", "created_at": now_iso(),
                                 "roles": [{"key": k, "label": k.title()} for k in ("sales", "finance", "operations")]})
    for u in (OWNER, SALES, OPS, FIN):
        await db.users.insert_one({"email": f"{u['id']}@{T}.test", "created_at": now_iso(), **u})


async def _refused(coro, status=403):
    try:
        await coro
    except HTTPException as e:
        assert e.status_code == status, (e.status_code, e.detail)
        return e.detail
    raise AssertionError(f"expected HTTP {status}")


def test_overdue_work_uses_the_companys_days_and_alert_email(with_test_db):
    from services.tasks import followup_days, followup_level
    assert [followup_level(d) for d in range(7)] == [1, 2, 3, 3, 4, 4, 4], "defaults unchanged"
    assert [followup_level(d, 3, 6) for d in range(8)] == [1, 2, 2, 3, 3, 3, 4, 4]
    assert followup_days({}) == (2, 4)
    assert followup_days({"followup_manager_days": 3, "followup_owner_days": 6}) == (3, 6)
    assert followup_days({"followup_manager_days": 5, "followup_owner_days": 2}) == (5, 6), "owner always after manager"

    sent = []

    async def fake_email(to, subject, html):
        sent.append(to)

    async def scenario(db):
        await _seed(db)
        import services.notifications as notifications
        with e2e_env(db, stubs={"services.notifications.send_email": fake_email}):
            await tenant_settings.update_tenant_settings(
                TenantSettingsInput(followup_manager_days=3, followup_owner_days=6, owner_alert_email=False), user=OWNER)
            t = await db.tenants.find_one({"id": T})
            assert (t["followup_manager_days"], t["followup_owner_days"], t["owner_alert_email"]) == (3, 6, False)
            await _refused(tenant_settings.update_tenant_settings(TenantSettingsInput(followup_owner_days=3), user=OWNER), 400)
            await _refused(tenant_settings.update_tenant_settings(TenantSettingsInput(followup_manager_days=0), user=OWNER), 400)

            await notifications.dispatch_owner_alert(T, "Task 'Pay dyes' is overdue by 6 day(s).")
            assert sent == [], "email off"
            await tenant_settings.update_tenant_settings(TenantSettingsInput(owner_alert_email=True), user=OWNER)
            await notifications.dispatch_owner_alert(T, "Task 'Pay dyes' is overdue by 6 day(s).")
            assert sent == [["u-owner@t1.test"]]
            return True
    assert with_test_db(scenario) is True


def test_delegate_approves_decides_sees_and_is_told(with_test_db):
    from services.decision_flow import can_decide
    from services.delegation import acting_for, delegates_of
    from services.tasks import task_list_query

    today = datetime.now(timezone.utc).date()

    async def scenario(db):
        await _seed(db)
        # Sunita is away this week and hands her approvals to Priya; Amit's hand-over ended last month.
        await db.users.update_one({"id": "u-fin"}, {"$set": {"acting_as": {
            "delegate_user_id": "u-sales", "from": str(today - timedelta(days=1)), "to": str(today + timedelta(days=3))}}})
        await db.users.update_one({"id": "u-ops"}, {"$set": {"acting_as": {
            "delegate_user_id": "u-sales", "from": str(today - timedelta(days=40)), "to": str(today - timedelta(days=30))}}})
        with e2e_env(db, keep=KEEP):
            held = await acting_for(db, T, "u-sales")
            assert held == ["u-fin"], held
            assert await delegates_of(db, T, ["u-fin", "u-owner"]) == ["u-sales"]
            # "From today" in India (UTC+5:30) is on even while the UTC date is still yesterday.
            from services.delegation import is_active_now
            ahead = (datetime.now(timezone.utc) + timedelta(hours=10)).date().isoformat()
            assert is_active_now({"delegate_user_id": "x", "from": ahead, "to": ahead}) is True
            far = (datetime.now(timezone.utc) + timedelta(days=3)).date().isoformat()
            assert is_active_now({"delegate_user_id": "x", "from": far, "to": far}) is False
            gone = (datetime.now(timezone.utc) - timedelta(days=3)).date().isoformat()
            assert is_active_now({"delegate_user_id": "x", "from": gone, "to": gone}) is False
            priya = {**SALES, "_acting_for": held}

            await db.tasks.insert_one({"id": "t-1", "tenant_id": T, "title": "Buy a spare motor", "assignee_id": "u-ops",
                                       "created_by": "u-owner", "approval_required": True, "approval_stage": "start",
                                       "approval_status": "pending", "approver_id": "u-fin", "status": "blocked",
                                       "created_at": now_iso()})
            t = await db.tasks.find_one({"id": "t-1"}, {"_id": 0})
            assert tasks._can_approve_task(priya, t) is True
            assert tasks._can_approve_task(SALES, t) is False, "not without the hand-over"
            assert task_list_query(priya, view="approvals")["approver_id"] == {"$in": ["u-sales", "u-fin"]}
            await tasks.approve_task("t-1", user=priya)
            assert (await db.tasks.find_one({"id": "t-1"}))["approval_status"] == "approved"

            assert can_decide(priya, {"approver_id": "u-fin"}) is True
            assert can_decide(SALES, {"approver_id": "u-fin"}) is False

            from services.notifications import push_notification
            await push_notification(T, ["u-fin"], 2, "Approval needed", "task", "t-9", ntype="approval")
            told = {n["user_id"] async for n in db.notifications.find({"entity_id": "t-9"}, {"_id": 0, "user_id": 1})}
            assert told == {"u-fin", "u-sales"}
            await push_notification(T, ["u-fin"], 1, "FYI", "task", "t-10", ntype="reminder")
            assert await db.notifications.count_documents({"entity_id": "t-10"}) == 1, "only approvals go to the delegate"
            return True
    assert with_test_db(scenario) is True


def test_reassign_handoff_dictation_owner_exclusions_and_one_ai_key(with_test_db):
    from services.tenant_ai_keys import CUSTOMIZABLE_PROVIDERS

    async def scenario(db):
        await _seed(db)
        await db.tasks.insert_one({"id": "t-2", "tenant_id": T, "title": "Quote for Kapoor", "assignee_id": "u-sales",
                                   "assignee_role": "sales", "created_by": "u-sales", "status": "todo",
                                   "created_at": now_iso()})
        with e2e_env(db):
            # Reassign: Sunita isn't on it or running it; Priya asked for it and may give it to Amit (her report).
            await _refused(tasks.reassign_task("t-2", TaskReassignInput(assignee_id="u-ops"), user=FIN))
            await tasks.reassign_task("t-2", TaskReassignInput(assignee_id="u-ops"), user=SALES)
            assert (await db.tasks.find_one({"id": "t-2"}))["assignee_id"] == "u-ops"

            # Hand-off: Amit can't hand work to Sunita (not his team, not his report).
            t = await db.tasks.find_one({"id": "t-2"}, {"_id": 0})
            await _refused(tasks._resolve_task_handoff(OPS, t, "t-2", "handoff", "need help", None,
                                                       SimpleNamespace(to_id="u-fin", to_role=None)))
            await _refused(tasks._resolve_task_handoff(OPS, t, "t-2", "handoff", "need help", None,
                                                       SimpleNamespace(to_id=None, to_role="finance")))
            assert await db.tasks.count_documents({"parent_task_id": "t-2"}) == 0

            # Dictation needs Ask AI or Voice capture.
            nobody = {"id": "u-x", "tenant_id": T, "role": "sales", "permissions": ["tasks"], "permissions_custom": True}
            await _refused(voice_notes.transcribe_only(file=None, language="auto", user=nobody))

            # Owners keep Manage team.
            await _refused(tenant_settings.update_owner_exclusions(
                OwnerExclusionsInput(exclusions=["finance", "team_manage"]), REQUEST, user=OWNER), 400)
            out = await tenant_settings.update_owner_exclusions(OwnerExclusionsInput(exclusions=["finance"]), REQUEST, user=OWNER)
            assert out["owner_exclusions"] == ["finance"]

            # One AI key at a time keeps the others.
            first, *rest = CUSTOMIZABLE_PROVIDERS
            await _refused(tenant_settings.set_tenant_ai_key(first, TenantAIKeyInput(key="short"), REQUEST, user=OWNER), 400)
            await tenant_settings.set_tenant_ai_key(first, TenantAIKeyInput(key="key-one-1234567890"), REQUEST, user=OWNER)
            if rest:
                out = await tenant_settings.set_tenant_ai_key(rest[0], TenantAIKeyInput(key="key-two-1234567890"), REQUEST, user=OWNER)
                have = {p["provider"]: p["has_tenant_key"] for p in out["providers"]}
                assert have[first] and have[rest[0]], have
            stored = (await db.tenants.find_one({"id": T}))["ai_keys"]
            assert stored[first] == "key-one-1234567890"
            return True
    assert with_test_db(scenario) is True
