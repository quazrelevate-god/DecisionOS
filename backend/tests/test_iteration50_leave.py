"""
Iteration 50 — Leave & Absence Management (Phase 1) backend tests.

Covers:
  * POST /api/leaves (validation + create)
  * POST /api/leaves/absence (emergency)
  * Approver resolution priority: reporting_manager > department mapping > owner fallback
  * GET /api/leaves?scope=mine|approvals|all + RBAC
  * POST /api/leaves/{id}/approve|reject|request-info (+ 403 for non-approver, employee notification)
  * PATCH /api/tenant/leave-approvers
  * GET /api/leaves/on-leave
  * Calendar/Dashboard/Brief integrations for approved leave
"""
import os
import re
import time
import pytest
import requests

from integration_base import base_url  # T10-11.2: fail-closed, env-only
BASE = base_url()
API = f"{BASE}/api"

OWNER = {"email": "owner@sharma.com", "password": "demo1234"}
SALES = {"email": "sales@sharma.com", "password": "demo1234"}
FINANCE = {"email": "finance@sharma.com", "password": "demo1234"}
PRODUCTION = {"email": "production@sharma.com", "password": "demo1234"}

TEST_MARK = "QA50_LEAVE"


def _login(creds):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=creds, timeout=15)
    assert r.status_code == 200, f"login failed for {creds['email']}: {r.status_code} {r.text}"
    tok = r.json().get("token")
    s.headers.update({"Authorization": f"Bearer {tok}"})
    return s, r.json()["user"]


@pytest.fixture(scope="module")
def owner():
    s, u = _login(OWNER)
    return s, u


@pytest.fixture(scope="module")
def sales():
    s, u = _login(SALES)
    return s, u


@pytest.fixture(scope="module")
def finance():
    s, u = _login(FINANCE)
    return s, u


@pytest.fixture(scope="module")
def production():
    s, u = _login(PRODUCTION)
    return s, u


# ---------------------------------------------------------------------------
# Auth / smoke
# ---------------------------------------------------------------------------
class TestSmoke:
    def test_owner_login(self, owner):
        s, u = owner
        assert u["role"] == "owner"
        assert "id" in u and "tenant_id" in u

    def test_leaves_endpoint_available(self, owner):
        s, _ = owner
        r = s.get(f"{API}/leaves?scope=mine")
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# ---------------------------------------------------------------------------
# Create leave — validation
# ---------------------------------------------------------------------------
class TestCreateValidation:
    def test_invalid_leave_type(self, sales):
        s, _ = sales
        r = s.post(f"{API}/leaves", json={
            "leave_type": "vacation", "from_date": "2026-02-01", "to_date": "2026-02-02",
            "day_portion": "full", "reason": f"{TEST_MARK} bad type"
        })
        assert r.status_code == 400

    def test_end_before_start(self, sales):
        s, _ = sales
        r = s.post(f"{API}/leaves", json={
            "leave_type": "casual", "from_date": "2026-02-05", "to_date": "2026-02-01",
            "day_portion": "full", "reason": f"{TEST_MARK} bad dates"
        })
        assert r.status_code == 400

    def test_absence_bad_reason(self, sales):
        s, _ = sales
        r = s.post(f"{API}/leaves/absence", json={"reason": "vacation", "note": ""})
        assert r.status_code == 400


# ---------------------------------------------------------------------------
# Approver resolution
# ---------------------------------------------------------------------------
class TestApproverResolution:
    """Owner-fallback and department mapping paths."""

    def test_owner_fallback(self, owner, sales):
        """Sales user has no reporting_manager_id set and no mapping — approver should be owner."""
        so, ou = owner
        ss, su = sales
        # ensure no mapping for sales role
        so.patch(f"{API}/tenant/leave-approvers", json={"approvers": {}})
        # clear reporting manager on sales user
        so.patch(f"{API}/users/{su['id']}", json={"reporting_manager_id": ""})
        r = ss.post(f"{API}/leaves", json={
            "leave_type": "casual", "from_date": "2026-02-10", "to_date": "2026-02-10",
            "day_portion": "full", "reason": f"{TEST_MARK} owner-fallback"
        })
        assert r.status_code == 200, r.text
        lv = r.json()
        assert lv["approver_id"] == ou["id"]
        assert lv["status"] == "pending"
        assert "_id" not in lv

    def test_department_mapping(self, owner, sales, finance):
        """Map sales role → finance user; new leave should route to finance."""
        so, ou = owner
        ss, su = sales
        _, fu = finance
        # ensure sales has NO reporting manager (so mapping takes effect)
        so.patch(f"{API}/users/{su['id']}", json={"reporting_manager_id": ""})
        r = so.patch(f"{API}/tenant/leave-approvers", json={"approvers": {"sales": fu["id"]}})
        assert r.status_code == 200
        r = ss.post(f"{API}/leaves", json={
            "leave_type": "wfh", "from_date": "2026-02-11", "to_date": "2026-02-11",
            "day_portion": "full", "reason": f"{TEST_MARK} dept-mapping"
        })
        assert r.status_code == 200, r.text
        lv = r.json()
        assert lv["approver_id"] == fu["id"], f"expected finance, got {lv.get('approver_name')}"

    def test_reporting_manager_priority(self, owner, sales, finance, production):
        """Set sales.reporting_manager = production; mapping still points to finance — RM must win."""
        so, ou = owner
        ss, su = sales
        _, fu = finance
        _, pu = production
        # ensure mapping exists (sales -> finance) but RM should override
        so.patch(f"{API}/tenant/leave-approvers", json={"approvers": {"sales": fu["id"]}})
        r = so.patch(f"{API}/users/{su['id']}", json={"reporting_manager_id": pu["id"]})
        assert r.status_code == 200
        r = ss.post(f"{API}/leaves", json={
            "leave_type": "sick", "from_date": "2026-02-12", "to_date": "2026-02-12",
            "day_portion": "half", "reason": f"{TEST_MARK} rm-priority"
        })
        assert r.status_code == 200, r.text
        lv = r.json()
        assert lv["approver_id"] == pu["id"], f"expected production (RM), got {lv.get('approver_name')}"

    def test_cleanup_reset(self, owner, sales):
        """Reset RM back to None so subsequent tests hit owner fallback / clean state.
        NOTE: server.py:1219 `if inp.reporting_manager_id is not None` short-circuits when
        JSON null is sent, so passing an empty string is the only way to clear it."""
        so, _ = owner
        _, su = sales
        so.patch(f"{API}/users/{su['id']}", json={"reporting_manager_id": ""})
        so.patch(f"{API}/tenant/leave-approvers", json={"approvers": {}})


# ---------------------------------------------------------------------------
# Approve / Reject / Request-Info + notification
# ---------------------------------------------------------------------------
class TestApprovalWorkflow:
    def _submit(self, sales_sess, tag):
        r = sales_sess.post(f"{API}/leaves", json={
            "leave_type": "casual", "from_date": "2026-03-01", "to_date": "2026-03-02",
            "day_portion": "full", "reason": f"{TEST_MARK} {tag}"
        })
        assert r.status_code == 200, r.text
        return r.json()

    def test_approve_and_notify(self, owner, sales):
        so, _ = owner
        ss, su = sales
        lv = self._submit(ss, "approve-flow")
        lid = lv["id"]
        r = so.post(f"{API}/leaves/{lid}/approve", json={"note": ""})
        assert r.status_code == 200, r.text
        got = r.json()
        assert got["status"] == "approved"
        assert got["decided_by"]

        # GET after approval → status persists
        r2 = ss.get(f"{API}/leaves/{lid}")
        assert r2.status_code == 200
        assert r2.json()["status"] == "approved"

        # Notification for sales
        time.sleep(0.5)
        r3 = ss.get(f"{API}/notifications")
        data = r3.json()
        notifs = data.get("notifications") if isinstance(data, dict) else data
        assert any(n.get("entity_type") == "leave" and n.get("entity_id") == lid and n.get("type") == "approved"
                   for n in (notifs or [])), "employee did not receive 'approved' notification"

    def test_reject_and_notify(self, owner, sales):
        so, _ = owner
        ss, _ = sales
        lv = self._submit(ss, "reject-flow")
        lid = lv["id"]
        r = so.post(f"{API}/leaves/{lid}/reject", json={"note": f"{TEST_MARK} not now"})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "rejected"
        time.sleep(0.5)
        r3 = ss.get(f"{API}/notifications").json()
        notifs = r3.get("notifications") if isinstance(r3, dict) else r3
        assert any(n.get("entity_type") == "leave" and n.get("entity_id") == lid and n.get("type") == "rejected"
                   for n in (notifs or [])), "employee did not receive 'rejected' notification"

    def test_request_info_and_notify(self, owner, sales):
        so, _ = owner
        ss, _ = sales
        lv = self._submit(ss, "info-flow")
        lid = lv["id"]
        r = so.post(f"{API}/leaves/{lid}/request-info", json={"note": f"{TEST_MARK} which project?"})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "info_requested"
        assert r.json().get("info_note", "").startswith(TEST_MARK)
        time.sleep(0.5)
        r3 = ss.get(f"{API}/notifications").json()
        notifs = r3.get("notifications") if isinstance(r3, dict) else r3
        assert any(n.get("entity_type") == "leave" and n.get("entity_id") == lid and n.get("type") == "clarification"
                   for n in (notifs or [])), "employee did not receive 'clarification' notification"


# ---------------------------------------------------------------------------
# RBAC — 403 for non-approver
# ---------------------------------------------------------------------------
class TestRBAC:
    def test_non_approver_cannot_approve(self, owner, sales, production):
        """Sales submits, production (no leave_approve, not owner, not approver) cannot approve."""
        so, _ = owner
        ss, su = sales
        _, pu = production
        # ensure production does NOT have leave_approve; clear mapping so approver = owner
        so.patch(f"{API}/tenant/leave-approvers", json={"approvers": {}})
        so.patch(f"{API}/users/{su['id']}", json={"reporting_manager_id": ""})
        # ensure production does not have leave_approve
        prod_perms = ["inbox", "data_input", "people", "workflows", "tasks", "brain", "ask"]
        so.patch(f"{API}/users/{pu['id']}", json={"permissions": prod_perms})

        r = ss.post(f"{API}/leaves", json={
            "leave_type": "casual", "from_date": "2026-03-05", "to_date": "2026-03-05",
            "day_portion": "full", "reason": f"{TEST_MARK} rbac"
        })
        assert r.status_code == 200
        lid = r.json()["id"]

        prod_sess, _ = _login(PRODUCTION)
        rr = prod_sess.post(f"{API}/leaves/{lid}/approve", json={"note": ""})
        assert rr.status_code == 403, f"expected 403, got {rr.status_code}: {rr.text}"

        # And GET should also 403
        rg = prod_sess.get(f"{API}/leaves/{lid}")
        assert rg.status_code == 403

        # approvals list for production should be empty (they're not the approver)
        rl = prod_sess.get(f"{API}/leaves?scope=approvals")
        assert rl.status_code == 200
        assert all(x.get("approver_id") == pu["id"] for x in rl.json())  # only ones for them; likely []

    def test_permission_grant_enables_approve(self, owner, sales, production):
        """Grant leave_approve to production; they should then be able to act on someone else's leave."""
        so, _ = owner
        ss, su = sales
        _, pu = production
        # grant leave_approve to production
        prod_perms = ["inbox", "data_input", "people", "workflows", "tasks", "brain", "ask", "leave_approve"]
        rp = so.patch(f"{API}/users/{pu['id']}", json={"permissions": prod_perms})
        assert rp.status_code == 200

        r = ss.post(f"{API}/leaves", json={
            "leave_type": "earned", "from_date": "2026-03-08", "to_date": "2026-03-09",
            "day_portion": "full", "reason": f"{TEST_MARK} perm-grant"
        })
        lid = r.json()["id"]

        prod_sess, _ = _login(PRODUCTION)
        rr = prod_sess.post(f"{API}/leaves/{lid}/approve", json={"note": f"{TEST_MARK} ok"})
        assert rr.status_code == 200, rr.text
        assert rr.json()["status"] == "approved"

        # cleanup: revoke leave_approve
        so.patch(f"{API}/users/{pu['id']}", json={"permissions": prod_perms[:-1]})


# ---------------------------------------------------------------------------
# Emergency absence
# ---------------------------------------------------------------------------
class TestAbsence:
    def test_absence_creates_today_leave(self, sales):
        ss, su = sales
        r = ss.post(f"{API}/leaves/absence", json={"reason": "sick", "note": f"{TEST_MARK} fever"})
        assert r.status_code == 200, r.text
        lv = r.json()
        assert lv["is_emergency"] is True
        assert lv["from_date"] == lv["to_date"]
        assert lv["status"] == "pending"
        # visible in scope=mine
        rm = ss.get(f"{API}/leaves?scope=mine").json()
        assert any(x["id"] == lv["id"] for x in rm)


# ---------------------------------------------------------------------------
# On-leave / Dashboard / Brief / Calendar integrations
# ---------------------------------------------------------------------------
class TestIntegrations:
    def test_on_leave_and_calendar_after_approve(self, owner, sales):
        so, ou = owner
        ss, su = sales
        today = time.strftime("%Y-%m-%d")
        # Submit leave for today (so it shows on-leave / dashboard)
        r = ss.post(f"{API}/leaves", json={
            "leave_type": "casual", "from_date": today, "to_date": today,
            "day_portion": "full", "reason": f"{TEST_MARK} today-approved"
        })
        assert r.status_code == 200
        lid = r.json()["id"]
        r2 = so.post(f"{API}/leaves/{lid}/approve", json={"note": ""})
        assert r2.status_code == 200

        # on-leave endpoint
        r3 = so.get(f"{API}/leaves/on-leave")
        assert r3.status_code == 200
        assert any(x.get("user_id") == su["id"] for x in r3.json())

        # dashboard
        r4 = so.get(f"{API}/dashboard")
        assert r4.status_code == 200
        j = r4.json()
        stats = j.get("stats", {})
        assert stats.get("on_leave_today", 0) >= 1

        # brief owner counters
        r5 = so.get(f"{API}/brief")
        assert r5.status_code == 200
        counters_resp = r5.json()
        counters = counters_resp.get("counters") if isinstance(counters_resp, dict) else {}
        assert isinstance(counters, dict), f"counters missing/wrong shape: {counters_resp}"
        assert (counters.get("on_leave") or 0) >= 1, f"on_leave counter not present: {counters}"

        # brief details
        r6 = so.get(f"{API}/brief/details?key=on_leave")
        assert r6.status_code == 200
        det = r6.json()
        items = det.get("items") if isinstance(det, dict) else det
        assert items, f"no on_leave items: {det}"
        # items are shaped {id: leave_id, title: user_name, subtitle, meta: role, kind: 'leave'}
        assert any(su["name"] == it.get("title") for it in items), \
            f"sales user not in on_leave items: {items[:3]}"

        # calendar shows type='leave' on today's date (nested under days[].events[])
        r7 = so.get(f"{API}/calendar")
        assert r7.status_code == 200
        cal = r7.json()
        days = cal.get("days", []) if isinstance(cal, dict) else []
        found = False
        for day in days:
            if day.get("date") == today:
                for ev in day.get("events", []):
                    if ev.get("type") == "leave":
                        found = True
                        break
        assert found, f"no leave event on {today} in calendar"


# ---------------------------------------------------------------------------
# Scope RBAC + listing
# ---------------------------------------------------------------------------
class TestScopes:
    def test_mine_scope_only_self(self, sales):
        ss, su = sales
        r = ss.get(f"{API}/leaves?scope=mine")
        assert r.status_code == 200
        for lv in r.json():
            assert lv["user_id"] == su["id"]

    def test_approvals_scope_owner_sees_all(self, owner):
        so, _ = owner
        r = so.get(f"{API}/leaves?scope=approvals")
        assert r.status_code == 200
        # owner is can_approve_all → sees all leaves
        assert isinstance(r.json(), list)

    def test_approvals_scope_non_approver_empty_or_own(self, production):
        ps, pu = production
        r = ps.get(f"{API}/leaves?scope=approvals")
        assert r.status_code == 200
        for lv in r.json():
            assert lv.get("approver_id") == pu["id"]


# ---------------------------------------------------------------------------
# Update leave approvers PATCH RBAC
# ---------------------------------------------------------------------------
class TestApproverConfigRBAC:
    def test_non_team_manage_cannot_update(self, sales):
        ss, _ = sales
        r = ss.patch(f"{API}/tenant/leave-approvers", json={"approvers": {}})
        assert r.status_code in (401, 403)

    def test_owner_can_update(self, owner, finance):
        so, _ = owner
        _, fu = finance
        r = so.patch(f"{API}/tenant/leave-approvers", json={"approvers": {"finance": fu["id"]}})
        assert r.status_code == 200
        # reset
        so.patch(f"{API}/tenant/leave-approvers", json={"approvers": {}})


# ---------------------------------------------------------------------------
# Bug repro — clearing reporting_manager_id via JSON null is a no-op
# ---------------------------------------------------------------------------
class TestReportingManagerClearBug:
    """Frontend Team.js sends `reporting_manager_id: form.value || null` when the user
    deselects a manager. Server.py:1219 short-circuits on `is not None`, so the JSON `null`
    is IGNORED and the RM cannot be cleared once set. Must send empty string instead.
    """
    def test_null_does_not_clear(self, owner, sales, production):
        so, _ = owner
        _, su = sales
        _, pu = production
        # first set an RM
        so.patch(f"{API}/users/{su['id']}", json={"reporting_manager_id": pu["id"]})
        u = so.get(f"{API}/users").json()
        after_set = next(x for x in u if x["id"] == su["id"])
        assert after_set.get("reporting_manager_id") == pu["id"]
        # now try to clear via JSON null (like the frontend does when user deselects)
        import json as _j
        r_null = so.patch(f"{API}/users/{su['id']}",
                          data=_j.dumps({"reporting_manager_id": None}),
                          headers={"Content-Type": "application/json"})
        assert r_null.status_code == 200
        u = so.get(f"{API}/users").json()
        after_null = next(x for x in u if x["id"] == su["id"])
        # BUG: RM is still set (null is a no-op due to `is not None` guard)
        assert after_null.get("reporting_manager_id") == pu["id"], \
            "Backend accepted `null` and cleared RM — bug appears fixed; adjust FE accordingly."
        # workaround: empty string works
        so.patch(f"{API}/users/{su['id']}", json={"reporting_manager_id": ""})
        u = so.get(f"{API}/users").json()
        after_empty = next(x for x in u if x["id"] == su["id"])
        assert after_empty.get("reporting_manager_id") in (None, ""), \
            f"Empty string workaround also failed: {after_empty.get('reporting_manager_id')}"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
