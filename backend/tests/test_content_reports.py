"""In-app reporting (2026-10-08) — Google Play's AI-content and UGC policies.

routers/reports.py takes reports of AI output, workspace content and people,
plus an anonymous AI-output report from the pre-account signup interview, and
gives platform admins a queue to act on them. What matters here: a report is
stored against the right workspace and reporter, junk input is refused, the
public door only lets AI-output reports through, and an admin status change is
recorded and audited.

Pure unit tests — fake Mongo, a throwaway FastAPI app, no live DB, no network.
"""
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import routers.reports as reports
from core import get_current_user, get_platform_admin


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------
def _match(d, filt):
    for k, v in filt.items():
        if isinstance(v, dict) and "$in" in v:
            if d.get(k) not in v["$in"]:
                return False
        elif d.get(k) != v:
            return False
    return True


class _Cursor:
    def __init__(self, rows):
        self._rows = rows

    def sort(self, key, direction):
        self._rows.sort(key=lambda r: r.get(key) or "", reverse=direction < 0)
        return self

    async def to_list(self, n):
        return self._rows[:n]


class _FakeColl:
    def __init__(self):
        self.docs = []

    async def insert_one(self, doc):
        self.docs.append(dict(doc))

    def find(self, filt, projection=None):
        return _Cursor([dict(d) for d in self.docs if _match(d, filt)])

    async def find_one(self, filt, projection=None):
        for d in self.docs:
            if _match(d, filt):
                return dict(d)
        return None

    async def count_documents(self, filt):
        return sum(1 for d in self.docs if _match(d, filt))

    async def update_one(self, filt, update):
        for d in self.docs:
            if _match(d, filt):
                d.update(update.get("$set", {}))
                for k, v in update.get("$push", {}).items():
                    d.setdefault(k, []).append(v)
                return


class _FakeDB:
    def __init__(self):
        self._colls = defaultdict(_FakeColl)

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        return self._colls[name]


ME = {"id": "u-me", "tenant_id": "ten-A", "name": "Priya", "role": "sales"}
ADMIN = {"id": "adm-1", "email": "ops@decisionos.test", "role": "super_admin"}


@pytest.fixture
def world(monkeypatch):
    fake = _FakeDB()
    audit = []

    async def _log(admin, action, message, target_type=None, target_id=None):
        audit.append({"admin": admin.get("email"), "action": action,
                      "target_type": target_type, "target_id": target_id})

    monkeypatch.setattr(reports, "db", fake)
    monkeypatch.setattr(reports, "log_admin_action", _log)

    app = FastAPI()
    app.include_router(reports.router)
    app.dependency_overrides[get_current_user] = lambda: dict(ME)
    app.dependency_overrides[get_platform_admin] = lambda: dict(ADMIN)
    return TestClient(app), fake, audit


GOOD = {
    "kind": "ai_output", "target_type": "dex_reply", "reason": "offensive",
    "details": "  rude answer  ", "snapshot": "Dex said something nasty",
    "context": "what's on today?",
}


# ---------------------------------------------------------------------------
# Signed-in reports
# ---------------------------------------------------------------------------
class TestReporting:
    def test_a_valid_report_is_stored_against_workspace_and_reporter(self, world):
        client, fake, _ = world
        r = client.post("/api/reports", json=GOOD)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True and body["id"]
        [doc] = fake.content_reports.docs
        assert doc["id"] == body["id"]
        assert doc["tenant_id"] == "ten-A"
        assert doc["reporter_id"] == "u-me"
        assert doc["reporter_name"] == "Priya"
        assert doc["status"] == "open"
        assert doc["created_at"]
        assert doc["details"] == "rude answer"
        assert doc["snapshot"] == "Dex said something nasty"

    def test_reporting_a_person_keeps_who_was_reported(self, world):
        client, fake, _ = world
        r = client.post("/api/reports", json={
            "kind": "user", "target_type": "user", "target_id": "u-other", "reason": "harassment"})
        assert r.status_code == 200, r.text
        assert fake.content_reports.docs[0]["target_id"] == "u-other"

    def test_a_person_report_needs_a_person(self, world):
        client, fake, _ = world
        r = client.post("/api/reports", json={"kind": "user", "target_type": "user", "reason": "spam"})
        assert r.status_code == 422
        assert fake.content_reports.docs == []

    def test_an_unknown_reason_is_refused(self, world):
        client, fake, _ = world
        r = client.post("/api/reports", json={**GOOD, "reason": "i_dont_like_it"})
        assert r.status_code == 422
        assert fake.content_reports.docs == []

    def test_an_unknown_kind_is_refused(self, world):
        client, fake, _ = world
        r = client.post("/api/reports", json={**GOOD, "kind": "vibes"})
        assert r.status_code == 422

    def test_oversized_snapshot_is_refused(self, world):
        client, _, _ = world
        r = client.post("/api/reports", json={**GOOD, "snapshot": "x" * 4001})
        assert r.status_code == 422


# ---------------------------------------------------------------------------
# Public (signup interview) reports
# ---------------------------------------------------------------------------
class TestPublicReporting:
    def test_ai_output_is_accepted_anonymously(self, world):
        client, fake, _ = world
        r = client.post("/api/reports/public", json={**GOOD, "target_type": "signup_interview"})
        assert r.status_code == 200, r.text
        [doc] = fake.content_reports.docs
        assert doc["tenant_id"] is None
        assert doc["reporter_id"] is None
        assert doc["reporter_name"] == "anonymous-signup"

    @pytest.mark.parametrize("kind", ["content", "user"])
    def test_only_ai_output_goes_through_the_public_door(self, world, kind):
        client, fake, _ = world
        r = client.post("/api/reports/public", json={**GOOD, "kind": kind, "target_id": "x"})
        assert r.status_code == 422
        assert fake.content_reports.docs == []


# ---------------------------------------------------------------------------
# Admin queue
# ---------------------------------------------------------------------------
class TestAdminQueue:
    def test_list_newest_first_with_counts(self, world):
        client, fake, _ = world
        fake.content_reports.docs += [
            {"id": "r1", "status": "open", "created_at": "2026-10-01T00:00:00", "tenant_id": "ten-A"},
            {"id": "r2", "status": "dismissed", "created_at": "2026-10-03T00:00:00", "tenant_id": None},
            {"id": "r3", "status": "open", "created_at": "2026-10-02T00:00:00", "tenant_id": "ten-A"},
        ]
        fake.tenants.docs.append({"id": "ten-A", "company_name": "Kumar Metals"})
        r = client.get("/api/admin/reports")
        assert r.status_code == 200, r.text
        body = r.json()
        assert [x["id"] for x in body["reports"]] == ["r2", "r3", "r1"]
        assert body["counts"] == {"open": 2, "reviewing": 0, "actioned": 0, "dismissed": 1}
        assert body["reports"][1]["tenant_name"] == "Kumar Metals"
        only_open = client.get("/api/admin/reports", params={"status": "open"}).json()
        assert [x["id"] for x in only_open["reports"]] == ["r3", "r1"]

    def test_status_change_is_saved_and_audited(self, world):
        client, fake, audit = world
        fake.content_reports.docs.append({"id": "r1", "status": "open", "created_at": "x", "history": []})
        r = client.patch("/api/admin/reports/r1", json={"status": "actioned", "note": "Removed the comment"})
        assert r.status_code == 200, r.text
        doc = fake.content_reports.docs[0]
        assert doc["status"] == "actioned"
        assert doc["admin_note"] == "Removed the comment"
        assert doc["reviewed_by"] == ADMIN["email"]
        assert doc["history"][-1]["status"] == "actioned"
        assert audit == [{"admin": ADMIN["email"], "action": "report_status",
                          "target_type": "content_report", "target_id": "r1"}]

    def test_unknown_status_is_refused(self, world):
        client, fake, audit = world
        fake.content_reports.docs.append({"id": "r1", "status": "open"})
        r = client.patch("/api/admin/reports/r1", json={"status": "deleted"})
        assert r.status_code == 422
        assert fake.content_reports.docs[0]["status"] == "open"
        assert audit == []

    def test_missing_report_is_404(self, world):
        client, _, _ = world
        r = client.patch("/api/admin/reports/nope", json={"status": "dismissed"})
        assert r.status_code == 404
