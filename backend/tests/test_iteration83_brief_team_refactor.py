"""Iteration 83 — Phase B step 7 backend regression.

Covers the extraction of TWO domain surfaces out of `server.py`:

  (A) /api/brief + /api/notifications → routers/brief.py (6 endpoints)
        GET  /brief, GET /brief/details, POST /brief/send-digest,
        GET  /notifications, POST /notifications/{id}/read, POST /notifications/read-all

  (B) team management → routers/team.py (15 endpoints)
        Users:      GET /users, POST /users, POST /users/{id}/invite, PATCH /users/{id}
        Attendance: POST/GET /attendance
        Leaves:     POST /leaves, POST /leaves/absence, GET /leaves,
                    GET /leaves/on-leave, GET /leaves/{id},
                    POST /leaves/{id}/approve, POST /leaves/{id}/reject,
                    POST /leaves/{id}/request-info,
                    GET /leaves/{id}/impact  (Claude — ai_leave_impact)

Task-local Pydantic models + LEAVE_TYPES/ABSENCE_REASONS live in
`models/team.py`. Task-local helpers `_can_approve_leave` and `_decide_leave`
moved INTO routers/team.py. Cross-domain helpers (_norm_phone, _mask_phone,
_create_leave, ai_leave_impact, push_notification, run_followup,
_overdue_receivables, _bills_due_or_overdue, _unmatched_payments,
_inv_remaining, _pay_remaining_amt, enrich_decisions, dashboard,
send_email, DIGEST_I18N) still live in server.py and are deferred-imported.
"""
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests
from pymongo import MongoClient


BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")

_mongo = MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
_db = _mongo[os.environ.get("DB_NAME", "test_database")]


# ---------------------------------------------------------------------------
# fixtures
# ---------------------------------------------------------------------------


def _login(email: str, password: str = "demo1234") -> str:
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login {email}: {r.status_code} {r.text[:200]}"
    tok = r.json().get("token") or r.json().get("access_token")
    assert tok, f"no token in {r.json()}"
    return tok


def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def owner_token():
    return _login("owner@sharma.com")


@pytest.fixture(scope="module")
def sales_token():
    return _login("sales@sharma.com")


@pytest.fixture(scope="module")
def finance_token():
    return _login("finance@sharma.com")


@pytest.fixture(scope="module")
def owner_info():
    """Owner id and tenant id — used for tenant-scoped Mongo checks."""
    row = _db.users.find_one({"email": "owner@sharma.com"},
                             {"_id": 0, "id": 1, "tenant_id": 1})
    assert row, "owner@sharma.com not found in users"
    return row


@pytest.fixture(scope="module")
def sales_info():
    row = _db.users.find_one({"email": "sales@sharma.com"},
                             {"_id": 0, "id": 1, "tenant_id": 1, "role": 1})
    assert row
    return row


# ===========================================================================
# PART A — Brief endpoints (routers/brief.py)
# ===========================================================================


class TestBriefOwner:
    """GET /api/brief — owner view."""

    def test_brief_owner_default_morning(self, owner_token):
        r = requests.get(f"{BASE_URL}/api/brief", headers=_h(owner_token), timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        # Shape parity (must match pre-refactor exactly)
        for k in ("period", "role", "greeting", "completed_label",
                  "counters", "finance_amounts"):
            assert k in body, f"missing key {k} in brief response: {list(body.keys())}"
        assert body["period"] == "morning"
        assert body["role"] == "owner"
        # Owner counter set — every key listed in the review request
        counters = body["counters"]
        expected = {"delayed", "completed", "awaiting_approval", "absent",
                    "complaints", "payment_overdue", "fires", "on_leave",
                    "receivables_overdue", "bills_due", "unmatched_payments"}
        missing = expected - set(counters.keys())
        assert not missing, f"owner counters missing: {missing} (got {list(counters.keys())})"
        # Every value must be an int (they're all count_documents results)
        for k, v in counters.items():
            assert isinstance(v, int), f"counter {k} not int: {v!r}"
        # finance_amounts populated (all three keys, floats)
        fa = body["finance_amounts"]
        for k in ("receivables_overdue", "bills_due", "unmatched_payments"):
            assert k in fa, f"finance_amounts missing {k}"
            assert isinstance(fa[k], (int, float)), f"finance_amounts.{k}: {fa[k]!r}"

    def test_brief_owner_weekly_completed_label(self, owner_token):
        r = requests.get(f"{BASE_URL}/api/brief?period=weekly",
                         headers=_h(owner_token), timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["period"] == "weekly"
        assert body["completed_label"] == "completed (weekly)", (
            f"expected 'completed (weekly)', got {body['completed_label']!r}"
        )


class TestBriefNonOwner:
    """GET /api/brief — non-owner (sales/finance) view."""

    def test_brief_sales_counter_set(self, sales_token):
        r = requests.get(f"{BASE_URL}/api/brief", headers=_h(sales_token), timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["role"] == "sales"
        # Non-owner counter set is the restricted 6-key set
        expected = {"delayed", "todo", "in_progress", "completed",
                    "escalations", "handoffs"}
        assert set(body["counters"].keys()) == expected, (
            f"sales counters drift: {set(body['counters'].keys())} vs {expected}"
        )
        # finance_amounts must be empty for non-owners
        assert body["finance_amounts"] == {}, (
            f"finance_amounts should be empty for sales, got {body['finance_amounts']}"
        )

    def test_brief_finance_counter_set(self, finance_token):
        r = requests.get(f"{BASE_URL}/api/brief", headers=_h(finance_token), timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        # finance is ALSO a non-owner
        assert body["role"] == "finance"
        expected = {"delayed", "todo", "in_progress", "completed",
                    "escalations", "handoffs"}
        assert set(body["counters"].keys()) == expected
        assert body["finance_amounts"] == {}


class TestBriefDetails:
    """GET /api/brief/details — drill-down endpoint."""

    def test_details_delayed(self, owner_token):
        r = requests.get(f"{BASE_URL}/api/brief/details?key=delayed",
                         headers=_h(owner_token), timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("key") == "delayed"
        assert isinstance(body.get("items"), list)
        # If any items, subtitle should carry the assignee name/role/'unassigned'
        for it in body["items"][:3]:
            assert "title" in it
            assert "subtitle" in it   # assignee_name || assignee_role || 'unassigned'

    def test_details_awaiting_approval(self, owner_token):
        r = requests.get(f"{BASE_URL}/api/brief/details?key=awaiting_approval",
                         headers=_h(owner_token), timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("key") == "awaiting_approval"
        assert body.get("actionable") is True, (
            f"awaiting_approval must be actionable=true, got {body.get('actionable')!r}"
        )
        assert isinstance(body.get("items"), list)

    def test_details_receivables_overdue_meta_is_remaining(self, owner_token):
        r = requests.get(f"{BASE_URL}/api/brief/details?key=receivables_overdue",
                         headers=_h(owner_token), timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("key") == "receivables_overdue"
        items = body.get("items") or []
        # Every item must carry `meta` — and it must equal remaining, not total
        for it in items[:5]:
            assert "meta" in it, f"receivable item missing meta: {it}"
            # meta must be a number (float/int) — remaining amount
            assert isinstance(it["meta"], (int, float)), (
                f"meta must be numeric remaining amount, got {it['meta']!r}"
            )
            assert it.get("kind") == "receivable"

    def test_details_on_leave(self, owner_token):
        r = requests.get(f"{BASE_URL}/api/brief/details?key=on_leave",
                         headers=_h(owner_token), timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("key") == "on_leave"
        assert body.get("actionable") is False
        assert isinstance(body.get("items"), list)

    def test_details_sales_owner_only_lockdown(self, sales_token):
        """sales cannot drill into receivables_overdue → items=[]."""
        r = requests.get(f"{BASE_URL}/api/brief/details?key=receivables_overdue",
                         headers=_h(sales_token), timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("items") == [], (
            f"sales must be locked out of receivables_overdue, got {body.get('items')}"
        )
        assert body.get("actionable") is False


# TestBriefSendDigest removed: POST /api/brief/send-digest was deleted in E2-63
# (DIGEST_I18N and its only consumer went away). The tests exercised a route that
# no longer exists; nothing to assert.


# ===========================================================================
# PART B — Notifications endpoints (routers/brief.py)
# ===========================================================================


class TestNotifications:
    def test_list_shape(self, owner_token):
        r = requests.get(f"{BASE_URL}/api/notifications",
                         headers=_h(owner_token), timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "notifications" in body and "unread" in body
        assert isinstance(body["notifications"], list)
        assert isinstance(body["unread"], int)
        # Unread count must match items where read is falsy
        computed = sum(1 for n in body["notifications"] if not n.get("read"))
        assert body["unread"] == computed, (
            f"unread mismatch: reported {body['unread']} computed {computed}"
        )

    def test_read_single(self, owner_token, owner_info):
        # Seed a notification for owner
        tid = owner_info["tenant_id"]
        uid = owner_info["id"]
        nid = f"iter83-notif-{uuid.uuid4().hex[:8]}"
        _db.notifications.insert_one({
            "id": nid, "tenant_id": tid, "user_id": uid,
            "level": 2, "message": "TEST_iter83 single-read probe",
            "read": False,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        try:
            r = requests.post(f"{BASE_URL}/api/notifications/{nid}/read",
                              headers=_h(owner_token), timeout=15)
            assert r.status_code == 200, r.text
            assert r.json() == {"ok": True}
            doc = _db.notifications.find_one({"id": nid}, {"_id": 0, "read": 1})
            assert doc and doc.get("read") is True, (
                f"notification not marked read: {doc}"
            )
        finally:
            _db.notifications.delete_one({"id": nid})

    def test_read_all(self, owner_token, owner_info):
        # Seed 3 unread notifications for owner
        tid = owner_info["tenant_id"]
        uid = owner_info["id"]
        ids = []
        for i in range(3):
            nid = f"iter83-rall-{uuid.uuid4().hex[:6]}-{i}"
            ids.append(nid)
            _db.notifications.insert_one({
                "id": nid, "tenant_id": tid, "user_id": uid,
                "level": 1, "message": f"TEST_iter83 read-all probe {i}",
                "read": False,
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
        try:
            r = requests.post(f"{BASE_URL}/api/notifications/read-all",
                              headers=_h(owner_token), timeout=15)
            assert r.status_code == 200, r.text
            assert r.json() == {"ok": True}
            still_unread = _db.notifications.count_documents({
                "id": {"$in": ids}, "read": False
            })
            assert still_unread == 0, (
                f"read-all did not clear all {len(ids)} seeded notifications; "
                f"{still_unread} still unread"
            )
        finally:
            _db.notifications.delete_many({"id": {"$in": ids}})


# ===========================================================================
# PART C — Users endpoints (routers/team.py)
# ===========================================================================


class TestUsers:
    def test_list_no_secret_leak(self, owner_token):
        r = requests.get(f"{BASE_URL}/api/users", headers=_h(owner_token), timeout=15)
        assert r.status_code == 200, r.text
        users = r.json()
        assert isinstance(users, list) and users
        for u in users:
            assert "password_hash" not in u, (
                f"password_hash leaked in /api/users: {list(u.keys())}"
            )
            assert "invite_token" not in u, (
                f"invite_token leaked in /api/users: {list(u.keys())}"
            )

    def test_create_user_sales_with_phone_returns_invite_token(self, owner_token, owner_info):
        email = f"iter83-newmember-{uuid.uuid4().hex[:6]}@test.local"
        payload = {
            "name": "Iter83 Sales Member", "email": email,
            "role": "sales", "phone": "+919876543210",
            "password": "demo1234",
        }
        r = requests.post(f"{BASE_URL}/api/users", json=payload,
                          headers=_h(owner_token), timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        try:
            assert body.get("email") == email.lower()
            assert body.get("role") == "sales"
            # invite_token must be present because phone was provided
            assert body.get("invite_token"), (
                f"phone provided but no invite_token in response: {body}"
            )
            # invite_token should NOT be persisted in the user list response
            r2 = requests.get(f"{BASE_URL}/api/users", headers=_h(owner_token), timeout=15)
            found = next((u for u in r2.json() if u.get("email") == email.lower()), None)
            assert found, "created user not returned in list"
            assert "invite_token" not in found
        finally:
            _db.users.delete_one({"email": email.lower()})

    def test_create_owner_by_non_owner_forbidden(self, sales_token):
        # Sales does NOT have team_manage by default; but if it did, creating
        # a user with role=owner must be 403 for a non-owner. If sales lacks
        # team_manage, we also get 403 (via require_perm). Either way = 403.
        email = f"iter83-badowner-{uuid.uuid4().hex[:6]}@test.local"
        r = requests.post(f"{BASE_URL}/api/users",
                          json={"name": "X", "email": email, "role": "owner",
                                "phone": "", "password": "demo1234"},
                          headers=_h(sales_token), timeout=15)
        assert r.status_code == 403, (
            f"non-owner must not create an owner (or lacks team_manage): got {r.status_code} {r.text[:200]}"
        )
        # cleanup in case it slipped through
        _db.users.delete_one({"email": email.lower()})

    def test_invite_regenerate_requires_phone(self, owner_token, owner_info):
        tid = owner_info["tenant_id"]
        # Create a member WITHOUT a phone (passwordless path requires phone, so
        # this user must be created with password + empty phone)
        uid = f"iter83-nophone-{uuid.uuid4().hex[:6]}"
        _db.users.insert_one({
            "id": uid, "tenant_id": tid,
            "name": "Iter83 No Phone", "email": f"{uid}@test.local",
            "phone": "",
            "password_hash": "x", "role": "sales", "permissions": [],
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        try:
            r = requests.post(f"{BASE_URL}/api/users/{uid}/invite",
                              headers=_h(owner_token), timeout=15)
            assert r.status_code == 400, (
                f"invite w/o phone must be 400, got {r.status_code} {r.text[:200]}"
            )
        finally:
            _db.users.delete_one({"id": uid})

    def test_invite_regenerate_ok(self, owner_token, owner_info):
        tid = owner_info["tenant_id"]
        uid = f"iter83-phone-{uuid.uuid4().hex[:6]}"
        _db.users.insert_one({
            "id": uid, "tenant_id": tid,
            "name": "Iter83 With Phone", "email": f"{uid}@test.local",
            "phone": "+919999888877",
            "password_hash": "x", "role": "sales", "permissions": [],
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        try:
            r = requests.post(f"{BASE_URL}/api/users/{uid}/invite",
                              headers=_h(owner_token), timeout=15)
            assert r.status_code == 200, r.text
            body = r.json()
            assert body.get("invite_token")
            assert "phone_masked" in body
            # Mongo should now carry the new invite_token
            doc = _db.users.find_one({"id": uid}, {"_id": 0, "invite_token": 1})
            assert doc.get("invite_token") == body["invite_token"]
        finally:
            _db.users.delete_one({"id": uid})

    def test_patch_role_cannot_demote_last_owner(self, owner_token, owner_info):
        """Attempt to demote the only owner in the tenant → 400."""
        tid = owner_info["tenant_id"]
        owner_count = _db.users.count_documents({"tenant_id": tid, "role": "owner"})
        if owner_count != 1:
            pytest.skip(f"tenant has {owner_count} owners, need exactly 1 for this test")
        r = requests.patch(f"{BASE_URL}/api/users/{owner_info['id']}",
                           json={"role": "sales"},
                           headers=_h(owner_token), timeout=15)
        assert r.status_code == 400, (
            f"demoting last owner must 400, got {r.status_code} {r.text[:200]}"
        )
        # sanity — owner still owner
        after = _db.users.find_one({"id": owner_info["id"]}, {"_id": 0, "role": 1})
        assert after["role"] == "owner"


# ===========================================================================
# PART D — Attendance endpoints (routers/team.py)
# ===========================================================================


class TestAttendance:
    def test_mark_attendance_owner(self, owner_token, owner_info):
        tid = owner_info["tenant_id"]
        # Pick a real member (not the owner themselves) to mark absent
        member = _db.users.find_one(
            {"tenant_id": tid, "role": {"$ne": "owner"}},
            {"_id": 0, "id": 1},
        )
        if not member:
            pytest.skip("no non-owner member in tenant")
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        r = requests.post(f"{BASE_URL}/api/attendance",
                          json={"user_id": member["id"], "status": "absent",
                                "date": today},
                          headers=_h(owner_token), timeout=15)
        assert r.status_code == 200, r.text
        assert r.json() == {"ok": True}
        # Verify persistence
        att = _db.attendance.find_one(
            {"tenant_id": tid, "user_id": member["id"], "date": today},
            {"_id": 0, "status": 1},
        )
        assert att and att["status"] == "absent"
        # Cleanup
        _db.attendance.delete_one(
            {"tenant_id": tid, "user_id": member["id"], "date": today}
        )

    def test_mark_attendance_sales_forbidden(self, sales_token, owner_info):
        tid = owner_info["tenant_id"]
        member = _db.users.find_one(
            {"tenant_id": tid, "role": {"$ne": "owner"}}, {"_id": 0, "id": 1}
        )
        if not member:
            pytest.skip("no non-owner member in tenant")
        r = requests.post(f"{BASE_URL}/api/attendance",
                          json={"user_id": member["id"], "status": "absent"},
                          headers=_h(sales_token), timeout=15)
        assert r.status_code == 403, (
            f"sales must not mark attendance, got {r.status_code} {r.text[:200]}"
        )

    def test_get_attendance_defaults_today(self, owner_token):
        r = requests.get(f"{BASE_URL}/api/attendance",
                         headers=_h(owner_token), timeout=15)
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), list)


# ===========================================================================
# PART E — Leaves endpoints (routers/team.py)
# ===========================================================================


class TestLeavesCRUD:
    """Create + list + get + decide flow."""

    def test_create_casual_leave_and_notify_approver(self, sales_token, sales_info, owner_info):
        # Sales creates a casual leave request for next week (from < to allowed)
        from_d = (datetime.now(timezone.utc) + timedelta(days=7)).strftime("%Y-%m-%d")
        to_d = (datetime.now(timezone.utc) + timedelta(days=8)).strftime("%Y-%m-%d")
        r = requests.post(f"{BASE_URL}/api/leaves",
                          json={"leave_type": "casual", "from_date": from_d,
                                "to_date": to_d, "day_portion": "full",
                                "reason": "TEST_iter83 casual leave"},
                          headers=_h(sales_token), timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("status") == "pending"
        assert body.get("leave_type") == "casual"
        assert body.get("user_id") == sales_info["id"]
        assert body.get("approver_id"), "approver_id must be resolved"
        lid = body["id"]
        try:
            # An approver notification must have been fired via push_notification
            # (server-level helper, deferred-imported by _decide_leave — same
            # helper also used by _create_leave in server.py).
            # push_notification stores `ntype` as `type` in Mongo
            note = _db.notifications.find_one(
                {"entity_type": "leave", "entity_id": lid, "type": "approval"},
                {"_id": 0, "user_id": 1},
            )
            assert note, "approver notification not created for new leave"
        finally:
            _db.leaves.delete_one({"id": lid})
            _db.notifications.delete_many({"entity_id": lid})
            _db.activity.delete_many({"entity_id": lid, "entity_type": "leave"})

    def test_create_absence_report(self, sales_token, sales_info):
        r = requests.post(f"{BASE_URL}/api/leaves/absence",
                          json={"reason": "sick", "note": "TEST_iter83 sick day"},
                          headers=_h(sales_token), timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("is_emergency") is True
        assert body.get("leave_type") == "sick"
        today = datetime.now(timezone.utc).date().isoformat()
        assert body.get("from_date") == today
        assert body.get("to_date") == today
        # cleanup
        _db.leaves.delete_one({"id": body["id"]})
        _db.notifications.delete_many({"entity_id": body["id"]})
        _db.activity.delete_many({"entity_id": body["id"], "entity_type": "leave"})

    def test_create_leave_bad_date_range(self, sales_token):
        from_d = (datetime.now(timezone.utc) + timedelta(days=8)).strftime("%Y-%m-%d")
        to_d = (datetime.now(timezone.utc) + timedelta(days=7)).strftime("%Y-%m-%d")
        r = requests.post(f"{BASE_URL}/api/leaves",
                          json={"leave_type": "casual", "from_date": from_d,
                                "to_date": to_d, "day_portion": "full", "reason": "x"},
                          headers=_h(sales_token), timeout=15)
        assert r.status_code == 400, (
            f"to_date < from_date must be 400, got {r.status_code} {r.text[:200]}"
        )

    def test_create_leave_bad_type(self, sales_token):
        from_d = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        r = requests.post(f"{BASE_URL}/api/leaves",
                          json={"leave_type": "unicorn_leave", "from_date": from_d,
                                "to_date": from_d, "day_portion": "full", "reason": "x"},
                          headers=_h(sales_token), timeout=15)
        assert r.status_code == 400, (
            f"invalid leave_type must be 400, got {r.status_code} {r.text[:200]}"
        )

    def test_list_leaves_scope_mine(self, sales_token, sales_info):
        r = requests.get(f"{BASE_URL}/api/leaves?scope=mine",
                         headers=_h(sales_token), timeout=15)
        assert r.status_code == 200, r.text
        for lv in r.json():
            assert lv.get("user_id") == sales_info["id"], (
                f"scope=mine leaked another user: {lv.get('user_id')} vs {sales_info['id']}"
            )

    def test_list_leaves_scope_all_owner(self, owner_token):
        r = requests.get(f"{BASE_URL}/api/leaves?scope=all",
                         headers=_h(owner_token), timeout=15)
        assert r.status_code == 200, r.text
        # owner sees all — we can't check completeness without a fixture
        # of known leaves, but the response must at least be a list.
        assert isinstance(r.json(), list)

    def test_list_leaves_scope_all_non_approver_scopes_to_self(
        self, sales_token, sales_info
    ):
        r = requests.get(f"{BASE_URL}/api/leaves?scope=all",
                         headers=_h(sales_token), timeout=15)
        assert r.status_code == 200, r.text
        for lv in r.json():
            assert lv.get("user_id") == sales_info["id"], (
                f"non-approver scope=all leaked: {lv.get('user_id')}"
            )

    def test_on_leave_today(self, owner_token):
        r = requests.get(f"{BASE_URL}/api/leaves/on-leave",
                         headers=_h(owner_token), timeout=15)
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), list)

    def test_get_leave_403_for_outsider(self, sales_token, owner_info):
        """A leave created by owner-tenant that sales user does not own or
        approve should 403 (or 404 if outside tenant)."""
        tid = owner_info["tenant_id"]
        lid = f"iter83-outsider-{uuid.uuid4().hex[:6]}"
        # Make it belong to some *other* user (finance) so sales is not owner
        # and (assuming sales lacks leave_approve) not approver.
        finance = _db.users.find_one({"email": "finance@sharma.com"},
                                     {"_id": 0, "id": 1})
        _db.leaves.insert_one({
            "id": lid, "tenant_id": tid, "user_id": finance["id"],
            "user_name": "Finance User", "user_role": "finance",
            "leave_type": "casual", "from_date": "2030-01-01", "to_date": "2030-01-02",
            "status": "pending", "approver_id": owner_info["id"],
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        try:
            r = requests.get(f"{BASE_URL}/api/leaves/{lid}",
                             headers=_h(sales_token), timeout=15)
            assert r.status_code == 403, (
                f"outsider must be 403, got {r.status_code} {r.text[:200]}"
            )
        finally:
            _db.leaves.delete_one({"id": lid})

    def test_get_leave_404_unknown(self, owner_token):
        r = requests.get(f"{BASE_URL}/api/leaves/does-not-exist-abc",
                         headers=_h(owner_token), timeout=15)
        assert r.status_code == 404


class TestLeavesDecisions:
    """approve / reject / request-info paths."""

    def _create_pending_leave(self, sales_token):
        from_d = (datetime.now(timezone.utc) + timedelta(days=14)).strftime("%Y-%m-%d")
        to_d = (datetime.now(timezone.utc) + timedelta(days=15)).strftime("%Y-%m-%d")
        r = requests.post(f"{BASE_URL}/api/leaves",
                          json={"leave_type": "casual", "from_date": from_d,
                                "to_date": to_d, "day_portion": "full",
                                "reason": "TEST_iter83 decision probe"},
                          headers=_h(sales_token), timeout=20)
        assert r.status_code == 200, r.text
        return r.json()

    def _cleanup(self, lid):
        _db.leaves.delete_one({"id": lid})
        _db.notifications.delete_many({"entity_id": lid})
        _db.activity.delete_many({"entity_id": lid, "entity_type": "leave"})

    def test_approve_flow(self, sales_token, owner_token):
        lv = self._create_pending_leave(sales_token)
        try:
            r = requests.post(f"{BASE_URL}/api/leaves/{lv['id']}/approve",
                              json={"note": ""}, headers=_h(owner_token), timeout=15)
            assert r.status_code == 200, r.text
            body = r.json()
            assert body.get("status") == "approved"
            # notification to requester was fired
            # push_notification stores `ntype` as `type` in Mongo
            note = _db.notifications.find_one(
                {"entity_id": lv["id"], "type": "approved"}, {"_id": 0, "user_id": 1}
            )
            assert note, "requester was not notified of approval"
        finally:
            self._cleanup(lv["id"])

    def test_reject_flow_records_note(self, sales_token, owner_token):
        lv = self._create_pending_leave(sales_token)
        try:
            r = requests.post(f"{BASE_URL}/api/leaves/{lv['id']}/reject",
                              json={"note": "TEST_iter83 rejection reason"},
                              headers=_h(owner_token), timeout=15)
            assert r.status_code == 200, r.text
            body = r.json()
            assert body.get("status") == "rejected"
            # history entry must carry the note
            history = body.get("history") or []
            reject = [h for h in history if h.get("action") == "rejected"]
            assert reject, f"no rejected history entry: {history}"
            assert reject[-1].get("note") == "TEST_iter83 rejection reason"
        finally:
            self._cleanup(lv["id"])

    def test_request_info_flow(self, sales_token, owner_token):
        lv = self._create_pending_leave(sales_token)
        try:
            r = requests.post(f"{BASE_URL}/api/leaves/{lv['id']}/request-info",
                              json={"note": "TEST_iter83 need more details"},
                              headers=_h(owner_token), timeout=15)
            assert r.status_code == 200, r.text
            body = r.json()
            assert body.get("status") == "info_requested"
            assert body.get("info_note") == "TEST_iter83 need more details"
        finally:
            self._cleanup(lv["id"])


class TestLeaveImpactAI:
    """GET /api/leaves/{id}/impact — Claude-driven (ai_leave_impact).

    The AI feature is deferred-imported inside routers/team.py. The test
    validates the wrapper response shape and enforces that the server
    filters out invalid assignee suggestions (reassign → monitor when the
    proposed assignee is not in `valid_ids`). We do NOT assert particular
    Claude text — quality is for the user to judge.
    """

    def test_impact_shape_and_valid_assignee_filter(
        self, sales_token, owner_token, owner_info
    ):
        # Sales creates a leave, owner requests impact analysis
        from_d = (datetime.now(timezone.utc) + timedelta(days=1)).strftime("%Y-%m-%d")
        to_d = (datetime.now(timezone.utc) + timedelta(days=3)).strftime("%Y-%m-%d")
        r = requests.post(f"{BASE_URL}/api/leaves",
                          json={"leave_type": "casual", "from_date": from_d,
                                "to_date": to_d, "day_portion": "full",
                                "reason": "TEST_iter83 impact probe"},
                          headers=_h(sales_token), timeout=20)
        assert r.status_code == 200, r.text
        lv = r.json()
        try:
            r2 = requests.get(f"{BASE_URL}/api/leaves/{lv['id']}/impact",
                              headers=_h(owner_token), timeout=90)
            assert r2.status_code == 200, r2.text
            body = r2.json()
            # Required keys per contract
            for k in ("leave_id", "person", "from_date", "to_date",
                      "summary", "tasks", "available_members"):
                assert k in body, f"missing key {k} in impact response: {list(body.keys())}"
            assert body["leave_id"] == lv["id"]
            assert isinstance(body["tasks"], list)
            assert isinstance(body["available_members"], list)
            assert isinstance(body["summary"], str)
            # Every suggestion must have an action in the allowed set
            valid_ids = {m["id"] for m in body["available_members"]}
            for t in body["tasks"]:
                assert t.get("action") in ("reassign", "extend", "monitor"), (
                    f"invalid action: {t.get('action')}"
                )
                # server guarantees: if reassign, assignee_id is in valid_ids
                if t.get("action") == "reassign":
                    assert t.get("assignee_id") in valid_ids, (
                        f"reassign to invalid assignee: {t.get('assignee_id')} not in {valid_ids}"
                    )
        finally:
            _db.leaves.delete_one({"id": lv["id"]})
            _db.notifications.delete_many({"entity_id": lv["id"]})
            _db.activity.delete_many({"entity_id": lv["id"], "entity_type": "leave"})


# ===========================================================================
# PART F — Cross-domain regression + server.py leave-approvers still works
# ===========================================================================


class TestCrossDomainRegression:
    """Other domains untouched — must still 200 after Phase B step 7."""

    def test_tasks_ok(self, owner_token):
        r = requests.get(f"{BASE_URL}/api/tasks", headers=_h(owner_token), timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_decisions_ok(self, owner_token):
        r = requests.get(f"{BASE_URL}/api/decisions", headers=_h(owner_token), timeout=15)
        assert r.status_code == 200

    def test_inbox_ok(self, owner_token):
        r = requests.get(f"{BASE_URL}/api/inbox", headers=_h(owner_token), timeout=15)
        assert r.status_code == 200

    def test_calendar_ok(self, owner_token):
        r = requests.get(f"{BASE_URL}/api/calendar", headers=_h(owner_token), timeout=15)
        assert r.status_code == 200

    def test_brain_documents_ok(self, owner_token):
        r = requests.get(f"{BASE_URL}/api/brain/documents",
                         headers=_h(owner_token), timeout=15)
        assert r.status_code == 200


class TestLeaveApproversStillInServer:
    """PATCH /api/tenant/leave-approvers must still work — its input model
    (LeaveApproverMapInput) stayed in server.py, not moved to models/team.py.
    """

    def test_patch_leave_approvers_ok(self, owner_token, owner_info):
        tid = owner_info["tenant_id"]
        # Snapshot the current mapping so we can restore it
        before = _db.tenants.find_one({"id": tid}, {"_id": 0, "leave_approvers": 1}) or {}
        before_map = before.get("leave_approvers") or {}
        try:
            # PATCH with empty map — server should accept + persist empty dict
            r = requests.patch(f"{BASE_URL}/api/tenant/leave-approvers",
                               json={"approvers": {}},
                               headers=_h(owner_token), timeout=15)
            assert r.status_code == 200, r.text
            after = _db.tenants.find_one({"id": tid}, {"_id": 0, "leave_approvers": 1})
            assert (after or {}).get("leave_approvers") == {}, (
                f"empty patch didn't persist: {after}"
            )
        finally:
            # Restore original mapping (best-effort)
            _db.tenants.update_one({"id": tid},
                                   {"$set": {"leave_approvers": before_map}})


# ===========================================================================
# PART G — Import boot sanity
# ===========================================================================


class TestImportBootSanity:
    def test_models_team_importable(self):
        from models.team import (
            LEAVE_TYPES, ABSENCE_REASONS,
            UserCreateInput, UserUpdateInput,
            AttendanceInput, LeaveRequestInput,
            AbsenceInput, LeaveDecisionInput,
        )
        assert "casual" in LEAVE_TYPES and "sick" in LEAVE_TYPES
        assert "sick" in ABSENCE_REASONS and "personal" in ABSENCE_REASONS
        # Pydantic models must instantiate with minimum required fields
        UserCreateInput(name="x", email="x@y.z", role="sales")
        UserUpdateInput()
        AttendanceInput(user_id="x")
        LeaveRequestInput(leave_type="casual", from_date="2030-01-01", to_date="2030-01-02")
        AbsenceInput(reason="sick")
        LeaveDecisionInput()

    def test_routers_brief_importable(self):
        from routers.brief import router
        paths = {r.path for r in router.routes}
        for expected in (
            "/api/brief", "/api/brief/details",
            "/api/notifications", "/api/notifications/{nid}/read",
            "/api/notifications/read-all",
        ):  # /api/brief/send-digest was removed in E2-63 (DIGEST_I18N deleted)
            assert expected in paths, f"brief router missing route: {expected}; got {sorted(paths)}"

    def test_routers_team_importable(self):
        from routers.team import router, _can_approve_leave, _decide_leave
        assert callable(_can_approve_leave)
        assert callable(_decide_leave)
        paths = {r.path for r in router.routes}
        for expected in (
            "/api/users", "/api/users/{user_id}/invite", "/api/users/{user_id}",
            "/api/attendance",
            "/api/leaves", "/api/leaves/absence", "/api/leaves/on-leave",
            "/api/leaves/{leave_id}", "/api/leaves/{leave_id}/approve",
            "/api/leaves/{leave_id}/reject", "/api/leaves/{leave_id}/request-info",
            "/api/leaves/{leave_id}/impact",
        ):
            assert expected in paths, f"team router missing route: {expected}; got {sorted(paths)}"

    def test_cross_domain_helpers_resolve_from_real_homes(self):
        """Epic 8 (S10): the cross-domain helpers moved OUT of server.py to their
        real domain modules; app code imports them from there, not from server.
        Verify each resolves at its home. (DIGEST_I18N was deleted in E2-63.)"""
        import importlib
        homes = {
            "services.whatsapp": ("_norm_phone", "_mask_phone"),
            "services.leave": ("_create_leave", "ai_leave_impact", "_resolve_leave_approver"),
            "services.finance_signals": ("run_followup", "_overdue_receivables",
                                         "_bills_due_or_overdue", "_unmatched_payments",
                                         "_inv_remaining", "_pay_remaining_amt"),
            "services.enrich": ("enrich_decisions",),
            "services.email": ("send_email",),
            "services.notifications": ("push_notification",),
            "models.calendar": ("LeaveApproverMapInput",),
        }
        for module_name, names in homes.items():
            mod = importlib.import_module(module_name)
            for name in names:
                assert hasattr(mod, name), f"{module_name} lost cross-domain helper {name}"
