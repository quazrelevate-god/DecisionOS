"""Self-service account deletion (2026-09-29).

Google Play's User Data policy requires an app that creates accounts to let
people delete them. routers/account.py does that, and the thinking worth
testing is not the erasing — services/tenant_wipe is covered by
test_tenant_deletion — but the DECISION: a person is a mobile number that may
belong to several workspaces, and what deleting them means differs per
workspace.

The case that matters most is `blocked`. An owner with other people in the
workspace must not be deletable, because both silent answers are wrong:
destroying a company other people work in, or leaving it with no owner.

Pure unit tests — fake Mongo, no live DB, no server, no network.
"""
import asyncio
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import pytest
from fastapi import HTTPException

import routers.account as account
from routers.account import CONFIRM_PHRASE, DeleteAccountInput


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------
class _FakeColl:
    def __init__(self, docs=None):
        self.docs = list(docs or [])

    def find(self, filt, projection=None):
        rows = [dict(d) for d in self.docs if all(d.get(k) == v for k, v in filt.items())]

        class _Cursor:
            def __init__(self, r): self._rows = r
            async def to_list(self, n): return self._rows[:n]
            def __aiter__(self):
                self._i = 0
                return self
            async def __anext__(self):
                if self._i >= len(self._rows):
                    raise StopAsyncIteration
                r = self._rows[self._i]
                self._i += 1
                return r
        return _Cursor(rows)

    async def find_one(self, filt, projection=None):
        for d in self.docs:
            if all(d.get(k) == v for k, v in filt.items()):
                return dict(d)
        return None

    async def delete_many(self, filt):
        before = len(self.docs)
        self.docs = [d for d in self.docs if not all(d.get(k) == v for k, v in filt.items())]
        class _R: pass
        r = _R(); r.deleted_count = before - len(self.docs)
        return r

    async def delete_one(self, filt):
        for i, d in enumerate(self.docs):
            if all(d.get(k) == v for k, v in filt.items()):
                self.docs.pop(i)
                class _R: deleted_count = 1
                return _R()
        class _R: deleted_count = 0
        return _R()

    async def count_documents(self, filt):
        return sum(1 for d in self.docs if all(d.get(k) == v for k, v in filt.items()))


class _FakeDB:
    def __init__(self):
        self._colls = defaultdict(_FakeColl)

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        return self._colls[name]

    def __getitem__(self, name):
        return self._colls[name]


class _FakeRequest:
    cookies = {}
    headers = {}


class _FakeResponse:
    def __init__(self):
        self.deleted_cookies = []
        self.headers = {}

    def delete_cookie(self, *a, **k):
        self.deleted_cookies.append((a, k))

    def set_cookie(self, *a, **k):
        pass


PHONE = "919876500011"


def _seed(monkeypatch, *, choices, seats_by_tenant, users=()):
    """Wire routers.account to a fake world.

    `choices` is what find_tenant_choices_for_phone would return (one entry
    per workspace this number can reach); `seats_by_tenant` maps tenant_id to
    the membership rows that occupy a seat there.
    """
    fake = _FakeDB()
    for u in users:
        fake.users.docs.append(dict(u))
    for tid, seats in seats_by_tenant.items():
        for m in seats:
            fake.memberships.docs.append({**m, "tenant_id": tid})

    monkeypatch.setattr(account, "db", fake)

    import services.auth.phone as phone_mod
    import services.auth.membership as mem_mod

    async def _choices(db, norm):
        return [dict(c) for c in choices]

    async def _seats(db, tenant_id, statuses=None):
        return [dict(m) for m in seats_by_tenant.get(tenant_id, [])]

    async def _remove(db, *, user_id, tenant_id):
        return True

    monkeypatch.setattr(phone_mod, "find_tenant_choices_for_phone", _choices)
    monkeypatch.setattr(mem_mod, "list_memberships_for_tenant", _seats)
    monkeypatch.setattr(mem_mod, "remove_membership", _remove)

    wiped = []

    async def _wipe(tenant_id, **kw):
        wiped.append(tenant_id)
        return {"found": True, "name": tenant_id, "total_removed": 7,
                "files_deleted": 1, "files_failed": 0, "records_removed": {}}

    import services.tenant_wipe as wipe_mod
    monkeypatch.setattr(wipe_mod, "wipe_tenant", _wipe)
    return fake, wiped


ME = {"id": "u-me", "tenant_id": "ten-A", "role": "owner", "phone_norm": PHONE}


# ---------------------------------------------------------------------------
# The plan — what would happen, per workspace
# ---------------------------------------------------------------------------
class TestThePlan:
    def test_a_member_just_leaves_and_the_history_stays(self, monkeypatch):
        _seed(monkeypatch,
              choices=[{"tenant_id": "ten-A", "tenant_name": "Kumar Metals",
                        "user_id": "u-me", "role": "sales"}],
              seats_by_tenant={"ten-A": [{"user_id": "u-me", "status": "active"},
                                         {"user_id": "u-boss", "status": "active"}]})
        plan = asyncio.run(account._plan({**ME, "role": "sales"}))
        assert plan["workspaces"][0]["outcome"] == "you_leave"
        assert plan["blocked"] == []

    def test_a_sole_owner_takes_the_workspace_with_them(self, monkeypatch):
        _seed(monkeypatch,
              choices=[{"tenant_id": "ten-A", "tenant_name": "Kumar Metals",
                        "user_id": "u-me", "role": "owner"}],
              seats_by_tenant={"ten-A": [{"user_id": "u-me", "status": "active"}]})
        plan = asyncio.run(account._plan(ME))
        assert plan["workspaces"][0]["outcome"] == "workspace_deleted"
        assert plan["blocked"] == []

    def test_an_owner_with_people_in_it_is_blocked(self, monkeypatch):
        _seed(monkeypatch,
              choices=[{"tenant_id": "ten-A", "tenant_name": "Kumar Metals",
                        "user_id": "u-me", "role": "owner"}],
              seats_by_tenant={"ten-A": [{"user_id": "u-me", "status": "active"},
                                         {"user_id": "u-2", "status": "active"},
                                         {"user_id": "u-3", "status": "pending"}]})
        plan = asyncio.run(account._plan(ME))
        w = plan["workspaces"][0]
        assert w["outcome"] == "blocked"
        assert w["other_people"] == 2
        # It has to say what to do, not just refuse.
        assert "owner" in w["reason"].lower()
        assert plan["blocked"] == [w]

    def test_a_pending_invite_still_counts_as_somebody(self, monkeypatch):
        """An invited person who has not signed in yet is still a person the
        workspace belongs to — SEAT_STATUSES already treats the invite as the
        commitment (J12-09), and deletion must agree."""
        _seed(monkeypatch,
              choices=[{"tenant_id": "ten-A", "tenant_name": "Kumar Metals",
                        "user_id": "u-me", "role": "owner"}],
              seats_by_tenant={"ten-A": [{"user_id": "u-me", "status": "active"},
                                         {"user_id": "u-invited", "status": "pending"}]})
        plan = asyncio.run(account._plan(ME))
        assert plan["workspaces"][0]["outcome"] == "blocked"

    def test_people_without_a_membership_row_still_count(self, monkeypatch):
        """THE ONE THAT NEARLY DELETED THE DEMO WORKSPACE.

        Memberships arrived in FIX-004-B. Anyone who predates it — and anything
        seeded straight into `users`, which is how the demo workspace is built
        — has a user row carrying tenant_id and no membership row. Counting
        seats alone reported a workspace with four people in it as empty, so
        its owner looked like a sole owner and was offered deletion of the
        whole company. Caught by running the endpoint against the real demo
        workspace, which answered other_people: 0.
        """
        _seed(monkeypatch,
              choices=[{"tenant_id": "ten-A", "tenant_name": "Sharma Textiles",
                        "user_id": "u-me", "role": "owner"}],
              # No membership rows at all, exactly like the seeded demo.
              seats_by_tenant={"ten-A": []},
              users=[{"id": "u-me", "tenant_id": "ten-A", "phone_norm": PHONE},
                     {"id": "u-sales", "tenant_id": "ten-A", "phone_norm": "919000000001"},
                     {"id": "u-fin", "tenant_id": "ten-A", "phone_norm": "919000000002"}])
        plan = asyncio.run(account._plan(ME))
        w = plan["workspaces"][0]
        assert w["outcome"] == "blocked", "a workspace with people in it must never be deletable"
        assert w["other_people"] == 2

    def test_the_two_sources_are_not_double_counted(self, monkeypatch):
        """A person with BOTH a membership row and a user row is one person."""
        _seed(monkeypatch,
              choices=[{"tenant_id": "ten-A", "tenant_name": "K",
                        "user_id": "u-me", "role": "owner"}],
              seats_by_tenant={"ten-A": [{"user_id": "u-me", "status": "active"},
                                         {"user_id": "u-2", "status": "active"}]},
              users=[{"id": "u-me", "tenant_id": "ten-A", "phone_norm": PHONE},
                     {"id": "u-2", "tenant_id": "ten-A", "phone_norm": "919000000001"}])
        plan = asyncio.run(account._plan(ME))
        assert plan["workspaces"][0]["other_people"] == 1

    def test_each_workspace_is_judged_on_its_own(self, monkeypatch):
        """The accountant case: owns her own practice, sits in a client's
        workspace as staff. One deletion, two different outcomes."""
        _seed(monkeypatch,
              choices=[
                  {"tenant_id": "ten-A", "tenant_name": "Her practice",
                   "user_id": "u-me", "role": "owner"},
                  {"tenant_id": "ten-B", "tenant_name": "A client",
                   "user_id": "u-me-b", "role": "accounts"},
              ],
              seats_by_tenant={
                  "ten-A": [{"user_id": "u-me", "status": "active"}],
                  "ten-B": [{"user_id": "u-me-b", "status": "active"},
                            {"user_id": "u-client", "status": "active"}],
              })
        plan = asyncio.run(account._plan(ME))
        outcomes = {w["tenant_id"]: w["outcome"] for w in plan["workspaces"]}
        assert outcomes == {"ten-A": "workspace_deleted", "ten-B": "you_leave"}
        assert plan["blocked"] == []


# ---------------------------------------------------------------------------
# Doing it
# ---------------------------------------------------------------------------
class TestDeleting:
    def _call(self, confirm="DELETE"):
        return asyncio.run(account.delete_account(
            DeleteAccountInput(confirm=confirm), _FakeRequest(), _FakeResponse(), ME))

    def test_the_wrong_word_erases_nothing(self, monkeypatch):
        fake, wiped = _seed(
            monkeypatch,
            choices=[{"tenant_id": "ten-A", "tenant_name": "K", "user_id": "u-me", "role": "owner"}],
            seats_by_tenant={"ten-A": [{"user_id": "u-me", "status": "active"}]},
            users=[{"id": "u-me", "tenant_id": "ten-A", "phone_norm": PHONE}])
        with pytest.raises(HTTPException) as e:
            self._call(confirm="delete please")
        assert e.value.status_code == 400
        assert wiped == []
        assert len(fake.users.docs) == 1

    def test_one_blocked_workspace_stops_the_whole_thing(self, monkeypatch):
        """Half-deleting somebody is worse than not starting: they believe
        they are gone and they are not."""
        fake, wiped = _seed(
            monkeypatch,
            choices=[
                {"tenant_id": "ten-A", "tenant_name": "Solo", "user_id": "u-me", "role": "owner"},
                {"tenant_id": "ten-B", "tenant_name": "Shared", "user_id": "u-me-b", "role": "owner"},
            ],
            seats_by_tenant={
                "ten-A": [{"user_id": "u-me", "status": "active"}],
                "ten-B": [{"user_id": "u-me-b", "status": "active"},
                          {"user_id": "u-other", "status": "active"}],
            },
            users=[{"id": "u-me", "tenant_id": "ten-A", "phone_norm": PHONE},
                   {"id": "u-me-b", "tenant_id": "ten-B", "phone_norm": PHONE}])
        with pytest.raises(HTTPException) as e:
            self._call()
        assert e.value.status_code == 409
        # ten-A was deletable on its own and must NOT have gone anyway.
        assert wiped == []
        assert len(fake.users.docs) == 2

    def test_leaving_removes_the_person_and_frees_the_number(self, monkeypatch):
        fake, wiped = _seed(
            monkeypatch,
            choices=[{"tenant_id": "ten-A", "tenant_name": "K", "user_id": "u-me", "role": "sales"}],
            seats_by_tenant={"ten-A": [{"user_id": "u-me", "status": "active"},
                                       {"user_id": "u-boss", "status": "active"}]},
            users=[{"id": "u-me", "tenant_id": "ten-A", "phone_norm": PHONE},
                   {"id": "u-boss", "tenant_id": "ten-A", "phone_norm": "919999900000"}])
        out = asyncio.run(account.delete_account(
            DeleteAccountInput(confirm=CONFIRM_PHRASE), _FakeRequest(), _FakeResponse(),
            {**ME, "role": "sales"}))
        assert out["ok"] is True
        assert wiped == []                                   # the company stays
        ids = [u["id"] for u in fake.users.docs]
        assert "u-me" not in ids                             # the person goes
        assert "u-boss" in ids                               # nobody else does
        assert await_count(fake, PHONE) == 0                 # the number is free

    def test_a_sole_owner_deletes_the_workspace(self, monkeypatch):
        fake, wiped = _seed(
            monkeypatch,
            choices=[{"tenant_id": "ten-A", "tenant_name": "K", "user_id": "u-me", "role": "owner"}],
            seats_by_tenant={"ten-A": [{"user_id": "u-me", "status": "active"}]},
            users=[{"id": "u-me", "tenant_id": "ten-A", "phone_norm": PHONE}])
        out = self._call()
        assert wiped == ["ten-A"]
        assert out["workspaces_deleted"][0]["tenant_id"] == "ten-A"

    def test_the_session_is_ended_not_just_the_cookie(self, monkeypatch):
        _seed(monkeypatch,
              choices=[{"tenant_id": "ten-A", "tenant_name": "K", "user_id": "u-me", "role": "owner"}],
              seats_by_tenant={"ten-A": [{"user_id": "u-me", "status": "active"}]},
              users=[{"id": "u-me", "tenant_id": "ten-A", "phone_norm": PHONE}])
        resp = _FakeResponse()
        asyncio.run(account.delete_account(
            DeleteAccountInput(confirm=CONFIRM_PHRASE), _FakeRequest(), resp, ME))
        assert resp.deleted_cookies, "the auth cookie must be cleared"


def await_count(fake, phone):
    return asyncio.run(fake.users.count_documents({"phone_norm": phone}))
