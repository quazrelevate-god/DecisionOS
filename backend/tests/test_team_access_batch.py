"""Audit 2026-10-09: B-09, C-02, B-10, B-06 -- team, access and setup.

B-09  HR approved leave but could not add the person who had just joined: that
      needed Manage Team, which also edits the company, the teams, the pipelines
      and everybody's access. "staff_manage" (Manage people) is the people half
      on its own; HR teams start with it; Manage Team includes it. With it alone
      you follow the team's access, never choose it. Live on the scratch DB:
      Kavitha (HR) added Selvi to Production, renamed her and moved her between
      teams (200); giving her own access, editing the owner and the company
      settings were refused (403).
C-02  The Add member preview listed CRM (struck through) and "Finance (upload
      only)" while the profile said "No access to ... CRM ... Finance". Both now
      read one list: the menus they will see, then "Not in their menus: ...".
B-10  The only owner could switch Finance off for themselves with one save. A new
      exclusion now asks first (409 with the areas); turning areas back on never
      asks; Manage people can't be switched off for owners. Live: 409, then
      confirmed -> /invoices 403 for the owner, then back on -> Finance again.
B-06  Company mobile, email and region were empty though sign-up collected them.
      Register fills them (the region only when the founder named a place --
      evals region_from_interview / niche_restaurant, live); existing companies
      get mobile and email from the owner who signed up.
"""
import asyncio
from pathlib import Path

import pytest
from fastapi import HTTPException

from config import PERMISSION_KEYS
from core.permissions import user_perms
from shared.roles import starting_perms
from tests.fake_mongo import FakeDB

ROOT = Path(__file__).resolve().parents[1]
FE = ROOT.parent / "frontend" / "src"


def run(c):
    return asyncio.run(c)


# ---- B-09 ---------------------------------------------------------------------
def test_manage_people_is_its_own_key_and_manage_team_carries_it():
    assert "staff_manage" in PERMISSION_KEYS
    assert "staff_manage" in user_perms({"role": "x", "permissions": ["team_manage"]})
    assert "staff_manage" not in user_perms({"role": "x", "permissions": ["leave_approve"]})
    assert "staff_manage" in user_perms({"role": "owner"})


def test_an_hr_team_starts_able_to_add_people():
    assert starting_perms("hr", "HR") == ["leave_approve", "staff_manage"]
    assert "staff_manage" in starting_perms("human_resources", "Human Resources")
    assert "staff_manage" not in starting_perms("admin_&_dispatch", "Admin & Dispatch")
    assert "team_manage" not in starting_perms("hr", "HR")


def _tenant_db():
    d = FakeDB()
    d.tenants.docs.append({"id": "t1", "roles": [
        {"key": "hr", "label": "HR", "permissions": ["inbox", "tasks", "leave_approve", "staff_manage"]},
        {"key": "managers", "label": "Managers", "permissions": ["inbox", "team_manage"]},
        {"key": "production", "label": "Production"},
    ]})
    return d


HR = {"id": "k", "tenant_id": "t1", "role": "hr", "permissions": ["inbox", "tasks", "leave_approve", "staff_manage"]}


def test_manage_people_stops_at_access(monkeypatch):
    import routers.team as team
    monkeypatch.setattr(team, "db", _tenant_db())
    guard = team._refuse_beyond_people
    run(guard(HR, role="production"))                                     # add to an ordinary team
    run(guard(HR, target={"id": "s", "role": "production", "permissions": []}))   # edit a member
    with pytest.raises(HTTPException) as e:
        run(guard(HR, own_access=True))
    assert e.value.status_code == 403 and "follow their team's access" in e.value.detail
    with pytest.raises(HTTPException) as e:
        run(guard(HR, role="managers"))
    assert "a team that manages the team" in e.value.detail
    with pytest.raises(HTTPException):
        run(guard(HR, target={"id": "m", "role": "managers", "permissions": []}))
    with pytest.raises(HTTPException):
        run(guard(HR, target={"id": "o", "role": "owner"}))
    # owners and team managers are never stopped here
    run(guard({"id": "o", "tenant_id": "t1", "role": "owner"}, own_access=True, role="managers"))
    run(guard({"id": "x", "tenant_id": "t1", "role": "y", "permissions": ["team_manage"]}, own_access=True))


def test_the_people_routes_open_on_manage_people():
    src = (ROOT / "routers" / "team.py").read_text(encoding="utf-8")
    for route in ('async def create_user(inp: UserCreateInput, user: dict = Depends(require_perm("staff_manage")))',
                  'async def update_user(user_id: str, inp: UserUpdateInput, user: dict = Depends(require_perm("staff_manage")))',
                  'async def regenerate_invite(user_id: str, user: dict = Depends(require_perm("staff_manage")))',
                  'async def reactivate_member(user_id: str, user: dict = Depends(require_perm("staff_manage")))',
                  'async def uninvite_user(user_id: str, user: dict = Depends(require_perm("staff_manage")))',
                  'async def list_deactivated(user: dict = Depends(require_perm("staff_manage")))'):
        assert route in src, route
    # removing someone stays an owner's call, as before
    assert 'async def deprovision_member(user_id: str, inp: DeprovisionInput,\n                              user: dict = Depends(require_role("owner")))' in src.replace("\r\n", "\n")
    # and the company settings stay Manage Team's
    ts = (ROOT / "routers" / "tenant_settings.py").read_text(encoding="utf-8")
    assert 'async def update_tenant(inp: TenantUpdateInput, user: dict = Depends(require_perm("team_manage")))' in ts


def test_existing_hr_teams_get_manage_people_once(monkeypatch):
    from bootstrap.migrations import hr_teams_manage_people
    d = FakeDB()
    d.tenants.docs.append({"id": "t1", "roles": [
        {"key": "hr", "label": "HR", "permissions": ["inbox", "leave_approve"]},
        {"key": "admin_&_dispatch", "label": "Admin & Dispatch", "permissions": ["inbox", "leave_approve"]},
        {"key": "sales", "label": "Sales"},
    ]})
    run(hr_teams_manage_people(d))
    roles = {r["key"]: r.get("permissions") for r in d.tenants.docs[0]["roles"]}
    assert roles["hr"] == ["inbox", "leave_approve", "staff_manage"]
    assert "staff_manage" not in roles["admin_&_dispatch"], "only teams named for HR"
    assert roles["sales"] is None


def test_the_team_page_reads_manage_people():
    perms = (FE / "lib" / "perms.js").read_text(encoding="utf-8")
    assert '{ key: "staff_manage", label: "Manage people (add and edit members)" }' in perms
    assert '"team_manage", "staff_manage", "tasks_assign_any", "tasks_view_all"' in perms
    team = (FE / "pages" / "Team.js").read_text(encoding="utf-8")
    assert 'const canManageTeam = !readOnly && hasPerm(user, "staff_manage");' in team
    assert 'const accessLocked = me?.role !== "owner" && !userPerms(me).includes("team_manage");' in team
    assert 'data-testid="member-access-locked"' in team


# ---- C-02 ---------------------------------------------------------------------
def test_the_preview_and_the_profile_read_one_list():
    team = (FE / "pages" / "Team.js").read_text(encoding="utf-8")
    assert "function MenuList({ perms, testid" in team
    assert '<MenuList perms={shownPerms} testid="menu-preview" />' in team
    assert '<MenuList perms={perms} testid={`profile-menus-${u.id}`} label="Their menus" />' in team
    assert "Not in their menus:" in team
    assert "line-through" not in team.split("function MenuList")[1].split("\n}\n")[0], "no struck-through chips"


# ---- B-10 ---------------------------------------------------------------------
class _Req:
    headers = {}
    client = None


def _owners_db(owners=1, excl=None):
    d = FakeDB()
    d.tenants.docs.append({"id": "t1", "owner_exclusions": excl or []})
    for i in range(owners):
        d.users.docs.append({"id": f"o{i}", "tenant_id": "t1", "role": "owner"})
    return d


def _put(monkeypatch, d, exclusions, confirm=False):
    import routers.tenant_settings as ts
    from models.tenant import OwnerExclusionsInput
    import services.audit_log as al
    monkeypatch.setattr(ts, "db", d)

    async def _noop(*a, **k):
        return None
    monkeypatch.setattr(ts, "log_activity", _noop)
    monkeypatch.setattr(al, "record", _noop)
    monkeypatch.setattr(al, "context_from", lambda *a, **k: {})
    return run(ts.update_owner_exclusions(OwnerExclusionsInput(exclusions=exclusions, confirm_self=confirm), _Req(),
                                          {"id": "o0", "tenant_id": "t1", "role": "owner", "name": "Meera"}))


def test_the_only_owner_is_asked_before_shutting_their_own_door(monkeypatch):
    d = _owners_db()
    with pytest.raises(HTTPException) as e:
        _put(monkeypatch, d, ["finance"])
    assert e.value.status_code == 409
    assert e.value.detail["code"] == "only_owner_excludes_self" and e.value.detail["areas"] == ["finance"]
    assert d.tenants.docs[0]["owner_exclusions"] == []
    _put(monkeypatch, d, ["finance"], confirm=True)
    assert d.tenants.docs[0]["owner_exclusions"] == ["finance"]
    _put(monkeypatch, d, [])                      # back on: never asks
    assert d.tenants.docs[0]["owner_exclusions"] == []


def test_with_a_co_owner_it_does_not_ask(monkeypatch):
    d = _owners_db(owners=2)
    _put(monkeypatch, d, ["finance"])
    assert d.tenants.docs[0]["owner_exclusions"] == ["finance"]


def test_owners_always_keep_manage_people(monkeypatch):
    with pytest.raises(HTTPException) as e:
        _put(monkeypatch, _owners_db(), ["staff_manage"], confirm=True)
    assert e.value.status_code == 400
    s = (FE / "pages" / "Settings.js").read_text(encoding="utf-8")
    assert 'const locked = p.key === "team_manage" || p.key === "staff_manage";' in s
    assert 'data-testid="owner-exclusions-self-confirm"' in s and "Switch off for me too" in s


# ---- B-06 ---------------------------------------------------------------------
def test_signup_fills_the_company_contact():
    src = (ROOT / "routers" / "auth.py").read_text(encoding="utf-8")
    assert '"phone": display_indian_mobile(_phone_norm) if _phone_norm else "",' in src
    assert '"support_email": ((inp.support_email or "").strip() or email).lower(),' in src
    assert '"region": (inp.region or str((inp.os_blueprint or {}).get("region") or "")).strip()[:80],' in src
    br = (FE / "pages" / "onboarding" / "BuildReveal.js").read_text(encoding="utf-8")
    assert "...(bp.region ? { region: bp.region } : {})," in br
    from prompts import render
    assert '"region": string' in render("onboarding.blueprint")


def test_the_blueprint_carries_only_a_named_region(monkeypatch):
    import services.ai.onboarding as ob

    class _Chat:
        def __init__(self, reply):
            self.reply = reply

        def with_model(self, *a):
            return self

        async def send_message(self, _m):
            return self.reply

    for reply, want in (('{"departments": ["Knitting"], "region": "Tiruppur, Tamil Nadu"}', "Tiruppur, Tamil Nadu"),
                        ('{"departments": ["Knitting"]}', ""),
                        ('{"departments": ["Knitting"], "region": 42}', "")):
        monkeypatch.setattr(ob, "claude_chat", lambda *a, _r=reply, **k: _Chat(_r))
        out = run(ob.generate_blueprint(profile={"company_name": "K"}, transcript=[]))
        assert out["region"] == want


def test_existing_companies_get_mobile_and_email_from_their_owner():
    from bootstrap.migrations import fill_company_contact
    d = FakeDB()
    d.tenants.docs += [{"id": "t1", "phone": "", "support_email": ""},
                       {"id": "t2", "phone": "+91 99999 00000", "support_email": "books@acme.in"},
                       {"id": "t3"}]
    d.users.docs += [{"id": "a", "tenant_id": "t1", "role": "owner", "phone": "+91 90000 10001",
                      "email": "Meera@Example.com", "created_at": "1"},
                     {"id": "b", "tenant_id": "t2", "role": "owner", "phone": "+91 90000 20002",
                      "email": "x@y.in", "created_at": "1"},
                     {"id": "c", "tenant_id": "t3", "role": "owner", "phone": "+91 90000 30003", "email": "",
                      "created_at": "1"}]
    run(fill_company_contact(d))
    t1, t2, t3 = d.tenants.docs
    assert (t1["phone"], t1["support_email"]) == ("+91 90000 10001", "meera@example.com")
    assert (t2["phone"], t2["support_email"]) == ("+91 99999 00000", "books@acme.in"), "never overwrites"
    assert t3["phone"] == "+91 90000 30003" and not t3.get("support_email")
