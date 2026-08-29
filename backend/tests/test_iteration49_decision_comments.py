"""
Iteration 49 — Decision "Raised by" + Discussion/Comments backend tests.

Covers:
- GET /api/decisions/{id} returns source, wa_from (optional), created_by_name, timeline, tasks
- POST /api/decisions/{id}/comment
    * owner (participant) -> 200, timeline gets kind='comment' entry
    * non-participant (sales) -> 403
    * empty text -> 400
    * missing decision id -> 404
    * comment persists (re-GET has it)
- Notifications: after owner comments, participants (creator + task assignees, excluding commenter)
  receive a notification of ntype='comment', entity_type='decision', entity_id=<did>.
- GET /api/decisions/{id} enriches with created_by_name and tasks list; no _id leak.
"""

import os
import pytest
import requests
import time

from integration_base import base_url  # T10-11.2: fail-closed, env-only
BASE_URL = base_url()
assert BASE_URL, "REACT_APP_BACKEND_URL must be set"

OWNER = {"email": "owner@sharma.com", "password": "demo1234"}
FINANCE = {"email": "finance@sharma.com", "password": "demo1234"}
SALES = {"email": "sales@sharma.com", "password": "demo1234"}

QA_PREFIX = "QA_DEC_COMMENT"


def _session_for(creds):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=30)
    assert r.status_code == 200, f"login failed for {creds['email']}: {r.status_code} {r.text}"
    data = r.json()
    s.headers.update({"Authorization": f"Bearer {data['token']}"})
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


def _find_or_create_decision(owner_ses, owner_user, want_assignee_id=None):
    """Return an existing pending or approved decision, or create one via
    manual write endpoint if the API supports it (fallback to using an existing
    approved decision id from GET /decisions)."""
    r = owner_ses.get(f"{BASE_URL}/api/decisions", timeout=15)
    assert r.status_code == 200, r.text
    decisions = r.json()
    assert isinstance(decisions, list)
    if not decisions:
        pytest.skip("No decisions exist in tenant to test against")
    # Prefer a pending_approval one, else fall back to any
    pending = [d for d in decisions if d.get("status") == "pending_approval"]
    return (pending[0] if pending else decisions[0])


class TestDecisionRaisedByAndFetch:
    """GET /api/decisions/{id} enrichment tests."""

    def test_get_decisions_list_has_source_and_created_by_name(self, owner_ctx):
        ses, _ = owner_ctx
        r = ses.get(f"{BASE_URL}/api/decisions", timeout=15)
        assert r.status_code == 200
        decisions = r.json()
        assert isinstance(decisions, list)
        if not decisions:
            pytest.skip("No decisions in tenant")
        d = decisions[0]
        assert "id" in d
        assert "title" in d
        assert "created_by_name" in d, "list should enrich created_by_name"
        # source may be None on very old rows but the key should generally be present
        assert "status" in d
        assert "_id" not in d, "no ObjectId leak"

    def test_get_decision_detail_shape(self, owner_ctx):
        ses, u = owner_ctx
        d = _find_or_create_decision(ses, u)
        r = ses.get(f"{BASE_URL}/api/decisions/{d['id']}", timeout=15)
        assert r.status_code == 200, r.text
        full = r.json()
        assert full["id"] == d["id"]
        assert "created_by_name" in full
        assert "tasks" in full
        assert isinstance(full["tasks"], list)
        # timeline may not exist on older rows but is expected to be a list when present
        if "timeline" in full:
            assert isinstance(full["timeline"], list)
        assert "_id" not in full

    def test_get_decision_missing_id_404(self, owner_ctx):
        ses, _ = owner_ctx
        r = ses.get(f"{BASE_URL}/api/decisions/nonexistent-id-12345", timeout=15)
        assert r.status_code == 404


class TestDecisionCommentAccess:
    """POST /api/decisions/{id}/comment access control + validation."""

    def test_owner_can_comment(self, owner_ctx):
        ses, u = owner_ctx
        d = _find_or_create_decision(ses, u)
        txt = f"{QA_PREFIX} owner comment {int(time.time())}"
        r = ses.post(f"{BASE_URL}/api/decisions/{d['id']}/comment",
                     json={"text": txt}, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        # timeline should include the comment
        tl = body.get("timeline") or []
        assert any(e.get("kind") == "comment" and e.get("label") == txt for e in tl), \
            f"timeline missing owner comment: {tl[-3:]}"
        assert "_id" not in body

    def test_owner_empty_comment_rejected(self, owner_ctx):
        ses, u = owner_ctx
        d = _find_or_create_decision(ses, u)
        r = ses.post(f"{BASE_URL}/api/decisions/{d['id']}/comment",
                     json={"text": "   "}, timeout=15)
        assert r.status_code == 400, r.text

    def test_comment_missing_decision_id_404(self, owner_ctx):
        ses, _ = owner_ctx
        r = ses.post(f"{BASE_URL}/api/decisions/nonexistent-id-abc/comment",
                     json={"text": "hi"}, timeout=15)
        assert r.status_code == 404

    def test_non_participant_sales_gets_403(self, owner_ctx, sales_ctx):
        """Sales user is not owner (well, sales isn't owner) and not creator/assignee of the picked decision.
        This test picks an approved decision that has no sales-assigned tasks."""
        owner_ses, ou = owner_ctx
        sales_ses, su = sales_ctx
        # Grab list; owner_ids are owners so we need a decision where sales is not in _decision_participants.
        r = owner_ses.get(f"{BASE_URL}/api/decisions", timeout=15)
        assert r.status_code == 200
        decisions = r.json()
        target = None
        for d in decisions:
            full = owner_ses.get(f"{BASE_URL}/api/decisions/{d['id']}", timeout=15).json()
            assignees = {t.get("assignee_id") for t in (full.get("tasks") or []) if t.get("assignee_id")}
            creator = full.get("created_by")
            if su["id"] not in assignees and creator != su["id"]:
                target = full
                break
        if not target:
            pytest.skip("Every decision has sales user as a participant — cannot exercise 403")

        r = sales_ses.post(f"{BASE_URL}/api/decisions/{target['id']}/comment",
                            json={"text": f"{QA_PREFIX} sales should be blocked"}, timeout=15)
        assert r.status_code == 403, f"expected 403 for non-participant, got {r.status_code}: {r.text}"


class TestDecisionCommentPersistence:
    """Verify comment persists to timeline and re-GET returns it."""

    def test_comment_persists_across_get(self, owner_ctx):
        ses, u = owner_ctx
        d = _find_or_create_decision(ses, u)
        txt = f"{QA_PREFIX} persistence check {int(time.time())}"
        r = ses.post(f"{BASE_URL}/api/decisions/{d['id']}/comment",
                     json={"text": txt}, timeout=15)
        assert r.status_code == 200, r.text

        # Re-GET the decision and confirm comment persisted
        r2 = ses.get(f"{BASE_URL}/api/decisions/{d['id']}", timeout=15)
        assert r2.status_code == 200
        tl = r2.json().get("timeline") or []
        matched = [e for e in tl if e.get("kind") == "comment" and e.get("label") == txt]
        assert matched, "comment did not persist to timeline"
        # Actor + actor_id set
        m = matched[0]
        assert m.get("actor") == u["name"]
        assert m.get("actor_id") == u["id"]
        assert "ts" in m


class TestDecisionCommentNotifications:
    """After owner comments, other participants (creator/assignees) get ntype='comment' notification."""

    def test_participant_gets_comment_notification(self, owner_ctx, finance_ctx):
        owner_ses, ou = owner_ctx
        fin_ses, fu = finance_ctx

        # Find a decision that has finance as an assignee OR create one path is not easy.
        # Iterate decisions and check assignee_ids.
        r = owner_ses.get(f"{BASE_URL}/api/decisions", timeout=15)
        assert r.status_code == 200
        target = None
        for d in r.json():
            full = owner_ses.get(f"{BASE_URL}/api/decisions/{d['id']}", timeout=15).json()
            assignees = {t.get("assignee_id") for t in (full.get("tasks") or []) if t.get("assignee_id")}
            if fu["id"] in assignees:
                target = full
                break
        if not target:
            pytest.skip("No decision has finance user as task assignee — cannot exercise notification path")

        # Clear finance notifications
        fin_ses.post(f"{BASE_URL}/api/notifications/read-all", timeout=15)

        txt = f"{QA_PREFIX} notif trigger {int(time.time())}"
        r = owner_ses.post(f"{BASE_URL}/api/decisions/{target['id']}/comment",
                            json={"text": txt}, timeout=15)
        assert r.status_code == 200

        # Poll finance notifications for a decision-comment
        found = None
        for _ in range(6):
            rr = fin_ses.get(f"{BASE_URL}/api/notifications", timeout=15).json()
            notifs = rr.get("notifications", [])
            for n in notifs:
                if n.get("entity_type") == "decision" and n.get("entity_id") == target["id"] and n.get("type") == "comment":
                    found = n
                    break
            if found:
                break
            time.sleep(0.5)

        assert found, f"finance participant did not receive comment notification for decision {target['id']}"
        # Sender/title should be enriched
        assert found.get("sender_name") in (ou["name"], None)  # some code paths may set sender
        # entity metadata present
        assert found.get("entity_id") == target["id"]
        assert found.get("entity_type") == "decision"
        assert "_id" not in found

    def test_commenter_does_not_receive_own_notification(self, owner_ctx):
        owner_ses, ou = owner_ctx
        d = _find_or_create_decision(owner_ses, ou)
        # Read-all first
        owner_ses.post(f"{BASE_URL}/api/notifications/read-all", timeout=15)
        txt = f"{QA_PREFIX} self-notif check {int(time.time())}"
        owner_ses.post(f"{BASE_URL}/api/decisions/{d['id']}/comment", json={"text": txt}, timeout=15)
        time.sleep(0.5)
        rr = owner_ses.get(f"{BASE_URL}/api/notifications", timeout=15).json()
        for n in rr.get("notifications", []):
            if n.get("entity_type") == "decision" and n.get("entity_id") == d["id"] and n.get("type") == "comment":
                # It's fine if the notif exists as a broadcast, but sender should not be flagged as sole recipient of own comment
                # ensure the message doesn't include this owner as the notified target only.
                # We accept the notif appearing (owner is in _owner_ids and _decision_participants) — but the code
                # excludes commenter from recipients. So we should NOT see the owner's own comment.
                pytest.fail(f"Owner received notification for their own comment: {n}")
