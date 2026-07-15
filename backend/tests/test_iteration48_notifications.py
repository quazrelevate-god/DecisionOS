"""
Iteration 48 — Notifications + Deep Linking backend tests.

Covers:
- push_notification stores type/work_title/sender_name (via new events, not legacy fallback)
- create_task notifies assignee (assigned) OR approver (approval)
- update_task notifies on status change (status) and reassignment (assigned)
- approve_task -> assignee gets 'approved'
- reject_task -> assignee gets 'rejected'
- clarify_task -> assignee gets 'clarification'
- add_task_update note action -> counterpart gets 'comment'
- GET /tasks/{id} access check: 403 for non-member, 200 for creator/assignee/approver/owner
- GET /notifications, POST /notifications/{id}/read, POST /notifications/read-all
"""

import os
import pytest
import requests
import time

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL must be set"

OWNER = {"email": "owner@sharma.com", "password": "demo1234"}
FINANCE = {"email": "finance@sharma.com", "password": "demo1234"}
SALES = {"email": "sales@sharma.com", "password": "demo1234"}

QA_PREFIX = "QA_NOTIF_TEST"


def _session_for(creds):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=30)
    assert r.status_code == 200, f"login failed for {creds['email']}: {r.status_code} {r.text}"
    data = r.json()
    s.headers.update({"Authorization": f"Bearer {data['token']}"})  # both cookie + bearer set
    return s, data["user"]


@pytest.fixture(scope="module")
def owner_ctx():
    return _session_for(OWNER)


@pytest.fixture(scope="module")
def finance_ctx():
    return _session_for(FINANCE)


@pytest.fixture(scope="module")
def sales_ctx():
    return _session_for(SALES)


def _read_all(ses):
    ses.post(f"{BASE_URL}/api/notifications/read-all", timeout=15)


def _latest_notif_for_task(ses, task_id, ntype=None, tries=6):
    """Fetch notifications, return most-recent one matching task_id + optional ntype."""
    last = None
    for _ in range(tries):
        r = ses.get(f"{BASE_URL}/api/notifications", timeout=15)
        assert r.status_code == 200
        items = r.json().get("notifications", [])
        for n in items:
            if n.get("entity_type") == "task" and n.get("entity_id") == task_id:
                if ntype is None or n.get("type") == ntype:
                    return n
        last = items[:3]
        time.sleep(0.4)
    return None


# ---------------------------------------------------------------------------
# 1. Basic notifications listing endpoint
# ---------------------------------------------------------------------------
class TestNotifBasics:
    def test_list_notifications_shape(self, owner_ctx):
        ses, _ = owner_ctx
        r = ses.get(f"{BASE_URL}/api/notifications", timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert "notifications" in body and "unread" in body
        assert isinstance(body["notifications"], list)
        # Ensure no mongo _id leaks
        for n in body["notifications"]:
            assert "_id" not in n
            # Iteration 48: 'type' is present on NEW notifications; legacy rows may lack it
            # (frontend notifMeta falls back to 'reminder').  Just ensure key names are safe.
            for k in ("id", "message", "created_at"):
                assert k in n

    def test_mark_all_read(self, owner_ctx):
        ses, _ = owner_ctx
        r = ses.post(f"{BASE_URL}/api/notifications/read-all", timeout=15)
        assert r.status_code == 200
        r2 = ses.get(f"{BASE_URL}/api/notifications", timeout=15)
        assert r2.status_code == 200
        assert r2.json()["unread"] == 0


# ---------------------------------------------------------------------------
# 2. Assigned notification (no approval)
# ---------------------------------------------------------------------------
class TestAssignedNotification:
    def test_new_work_notifies_assignee(self, owner_ctx, finance_ctx):
        owner_s, owner_u = owner_ctx
        fin_s, fin_u = finance_ctx
        _read_all(fin_s)
        title = f"{QA_PREFIX}_ASSIGN_{int(time.time())}"
        r = owner_s.post(f"{BASE_URL}/api/tasks", json={
            "title": title, "assignee_id": fin_u["id"], "priority": "medium"
        }, timeout=20)
        assert r.status_code == 200, r.text
        t = r.json()
        assert t["status"] == "todo", f"non-approval task should start as todo, got {t.get('status')}"
        n = _latest_notif_for_task(fin_s, t["id"], "assigned")
        assert n is not None, "assigned notification not delivered to finance"
        assert n["type"] == "assigned"
        assert n["work_title"] == title
        assert n["sender_name"] == owner_u["name"]
        assert n["entity_type"] == "task"
        assert n["entity_id"] == t["id"]
        assert n.get("read") is False


# ---------------------------------------------------------------------------
# 3. Approval requested notification
# ---------------------------------------------------------------------------
class TestApprovalNotification:
    def test_approval_required_notifies_owner(self, owner_ctx, finance_ctx):
        owner_s, owner_u = owner_ctx
        fin_s, fin_u = finance_ctx
        _read_all(owner_s)
        title = f"{QA_PREFIX}_APPROVAL_{int(time.time())}"
        # No specific approver -> falls back to owners
        r = fin_s.post(f"{BASE_URL}/api/tasks", json={
            "title": title, "assignee_id": fin_u["id"], "approval_required": True
        }, timeout=20)
        assert r.status_code == 200, r.text
        t = r.json()
        assert t["status"] == "blocked" and t["approval_status"] == "pending"
        n = _latest_notif_for_task(owner_s, t["id"], "approval")
        assert n is not None, "approval notification not delivered to owner"
        assert n["type"] == "approval"
        assert n["work_title"] == title
        assert n["sender_name"] == fin_u["name"]


# ---------------------------------------------------------------------------
# 4. Clarification notification
# ---------------------------------------------------------------------------
class TestClarificationNotification:
    def test_clarify_notifies_assignee(self, owner_ctx, finance_ctx):
        owner_s, owner_u = owner_ctx
        fin_s, fin_u = finance_ctx
        title = f"{QA_PREFIX}_CLARIFY_{int(time.time())}"
        r = owner_s.post(f"{BASE_URL}/api/tasks", json={
            "title": title, "assignee_id": fin_u["id"], "approval_required": True
        }, timeout=20)
        assert r.status_code == 200
        tid = r.json()["id"]
        _read_all(fin_s)
        r2 = owner_s.post(f"{BASE_URL}/api/tasks/{tid}/clarify",
                          json={"reason": "Please explain the budget line"}, timeout=20)
        assert r2.status_code == 200, r2.text
        # Task still locked
        assert r2.json()["approval_status"] == "pending"
        assert r2.json()["status"] == "blocked"
        n = _latest_notif_for_task(fin_s, tid, "clarification")
        assert n is not None, "clarification notification missing"
        assert n["type"] == "clarification"
        assert n["work_title"] == title
        assert n["sender_name"] == owner_u["name"]

    def test_clarify_empty_reason_400(self, owner_ctx, finance_ctx):
        owner_s, _ = owner_ctx
        fin_s, fin_u = finance_ctx
        title = f"{QA_PREFIX}_CLARIFY_EMPTY_{int(time.time())}"
        r = owner_s.post(f"{BASE_URL}/api/tasks", json={
            "title": title, "assignee_id": fin_u["id"], "approval_required": True
        }, timeout=20)
        tid = r.json()["id"]
        r2 = owner_s.post(f"{BASE_URL}/api/tasks/{tid}/clarify", json={"reason": ""}, timeout=15)
        assert r2.status_code == 400

    def test_clarify_forbidden_for_non_approver(self, sales_ctx, owner_ctx, finance_ctx):
        owner_s, _ = owner_ctx
        fin_s, fin_u = finance_ctx
        sales_s, _ = sales_ctx
        title = f"{QA_PREFIX}_CLARIFY_403_{int(time.time())}"
        r = owner_s.post(f"{BASE_URL}/api/tasks", json={
            "title": title, "assignee_id": fin_u["id"], "approval_required": True
        }, timeout=20)
        tid = r.json()["id"]
        r2 = sales_s.post(f"{BASE_URL}/api/tasks/{tid}/clarify", json={"reason": "why?"}, timeout=15)
        assert r2.status_code == 403


# ---------------------------------------------------------------------------
# 5. Rejection notification
# ---------------------------------------------------------------------------
class TestRejectionNotification:
    def test_reject_notifies_assignee(self, owner_ctx, finance_ctx):
        owner_s, owner_u = owner_ctx
        fin_s, fin_u = finance_ctx
        title = f"{QA_PREFIX}_REJECT_{int(time.time())}"
        r = owner_s.post(f"{BASE_URL}/api/tasks", json={
            "title": title, "assignee_id": fin_u["id"], "approval_required": True
        }, timeout=20)
        tid = r.json()["id"]
        _read_all(fin_s)
        r2 = owner_s.post(f"{BASE_URL}/api/tasks/{tid}/reject",
                          json={"reason": "Missing scope"}, timeout=20)
        assert r2.status_code == 200
        assert r2.json()["approval_status"] == "rejected"
        n = _latest_notif_for_task(fin_s, tid, "rejected")
        assert n is not None
        assert n["type"] == "rejected"
        assert n["work_title"] == title
        assert n["sender_name"] == owner_u["name"]


# ---------------------------------------------------------------------------
# 6. Status update notification (assignee -> creator/owner)
# ---------------------------------------------------------------------------
class TestStatusNotification:
    def test_status_change_notifies_creator(self, owner_ctx, finance_ctx):
        owner_s, owner_u = owner_ctx
        fin_s, fin_u = finance_ctx
        title = f"{QA_PREFIX}_STATUS_{int(time.time())}"
        r = owner_s.post(f"{BASE_URL}/api/tasks", json={
            "title": title, "assignee_id": fin_u["id"]
        }, timeout=20)
        tid = r.json()["id"]
        _read_all(owner_s)
        r2 = fin_s.patch(f"{BASE_URL}/api/tasks/{tid}", json={"status": "in_progress"}, timeout=20)
        assert r2.status_code == 200
        n = _latest_notif_for_task(owner_s, tid, "status")
        assert n is not None, "status notification missing on owner"
        assert n["type"] == "status"
        assert n["work_title"] == title
        assert n["sender_name"] == fin_u["name"]


# ---------------------------------------------------------------------------
# 7. Comment notification (assignee <-> creator)
# ---------------------------------------------------------------------------
class TestCommentNotification:
    def test_note_by_assignee_notifies_creator(self, owner_ctx, finance_ctx):
        owner_s, _ = owner_ctx
        fin_s, fin_u = finance_ctx
        title = f"{QA_PREFIX}_COMMENT_{int(time.time())}"
        r = owner_s.post(f"{BASE_URL}/api/tasks", json={
            "title": title, "assignee_id": fin_u["id"]
        }, timeout=20)
        tid = r.json()["id"]
        _read_all(owner_s)
        r2 = fin_s.post(f"{BASE_URL}/api/tasks/{tid}/updates",
                        json={"action": "note", "text": "Working on it, will finish today"},
                        timeout=20)
        assert r2.status_code == 200, r2.text
        n = _latest_notif_for_task(owner_s, tid, "comment")
        assert n is not None, "comment notification missing on owner"
        assert n["type"] == "comment"
        assert n["work_title"] == title
        assert n["sender_name"] == fin_u["name"]


# ---------------------------------------------------------------------------
# 8. Approved notification
# ---------------------------------------------------------------------------
class TestApprovedNotification:
    def test_approve_notifies_assignee(self, owner_ctx, finance_ctx):
        owner_s, owner_u = owner_ctx
        fin_s, fin_u = finance_ctx
        title = f"{QA_PREFIX}_APPROVED_{int(time.time())}"
        r = owner_s.post(f"{BASE_URL}/api/tasks", json={
            "title": title, "assignee_id": fin_u["id"], "approval_required": True
        }, timeout=20)
        tid = r.json()["id"]
        _read_all(fin_s)
        r2 = owner_s.post(f"{BASE_URL}/api/tasks/{tid}/approve", timeout=20)
        assert r2.status_code == 200
        n = _latest_notif_for_task(fin_s, tid, "approved")
        assert n is not None
        assert n["type"] == "approved"
        assert n["work_title"] == title
        assert n["sender_name"] == owner_u["name"]


# ---------------------------------------------------------------------------
# 9. Deep-link access control: GET /api/tasks/{id}
# ---------------------------------------------------------------------------
class TestTaskAccessControl:
    def test_get_task_for_assignee_returns_200(self, owner_ctx, finance_ctx):
        owner_s, _ = owner_ctx
        fin_s, fin_u = finance_ctx
        title = f"{QA_PREFIX}_ACL_ASSIGNEE_{int(time.time())}"
        r = owner_s.post(f"{BASE_URL}/api/tasks", json={
            "title": title, "assignee_id": fin_u["id"]
        }, timeout=20)
        tid = r.json()["id"]
        r2 = fin_s.get(f"{BASE_URL}/api/tasks/{tid}", timeout=15)
        assert r2.status_code == 200
        assert r2.json()["id"] == tid
        assert "_id" not in r2.json()

    def test_get_task_for_non_member_returns_403(self, owner_ctx, finance_ctx, sales_ctx):
        owner_s, _ = owner_ctx
        fin_s, fin_u = finance_ctx
        sales_s, _ = sales_ctx
        title = f"{QA_PREFIX}_ACL_DENY_{int(time.time())}"
        r = owner_s.post(f"{BASE_URL}/api/tasks", json={
            "title": title, "assignee_id": fin_u["id"]
        }, timeout=20)
        tid = r.json()["id"]
        r2 = sales_s.get(f"{BASE_URL}/api/tasks/{tid}", timeout=15)
        assert r2.status_code == 403

    def test_get_task_not_found_404(self, owner_ctx):
        ses, _ = owner_ctx
        r = ses.get(f"{BASE_URL}/api/tasks/does-not-exist-xyz", timeout=15)
        assert r.status_code == 404

    def test_get_task_for_owner_returns_200(self, owner_ctx, finance_ctx):
        owner_s, _ = owner_ctx
        fin_s, fin_u = finance_ctx
        title = f"{QA_PREFIX}_ACL_OWNER_{int(time.time())}"
        r = fin_s.post(f"{BASE_URL}/api/tasks", json={
            "title": title, "assignee_id": fin_u["id"]
        }, timeout=20)
        tid = r.json()["id"]
        r2 = owner_s.get(f"{BASE_URL}/api/tasks/{tid}", timeout=15)
        assert r2.status_code == 200


# ---------------------------------------------------------------------------
# 10. Per-notification read
# ---------------------------------------------------------------------------
class TestNotifRead:
    def test_mark_single_read(self, owner_ctx, finance_ctx):
        owner_s, _ = owner_ctx
        fin_s, fin_u = finance_ctx
        # generate one fresh notif
        _read_all(fin_s)
        title = f"{QA_PREFIX}_READ_SINGLE_{int(time.time())}"
        r = owner_s.post(f"{BASE_URL}/api/tasks", json={
            "title": title, "assignee_id": fin_u["id"]
        }, timeout=20)
        tid = r.json()["id"]
        n = _latest_notif_for_task(fin_s, tid, "assigned")
        assert n is not None
        nid = n["id"]
        r2 = fin_s.post(f"{BASE_URL}/api/notifications/{nid}/read", timeout=15)
        assert r2.status_code == 200
        # Verify persistence
        r3 = fin_s.get(f"{BASE_URL}/api/notifications", timeout=15)
        assert r3.status_code == 200
        found = [x for x in r3.json()["notifications"] if x["id"] == nid]
        assert found and found[0]["read"] is True
