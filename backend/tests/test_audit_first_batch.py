"""Product audit 2026-10-08 — the first batch Yokesh asked for.

  B-02  one department list: a task's department is one of the teams
  D-01  Settings crashed for a member who opened ?tab=workspace
  A-01  a reloaded sign-up skipped the unanswered name step
  B-04  the plan card: trial, upgrade, and the month's AI allowance
  A-16  nothing asked the owner to bring their team in
  C-01  Team and Settings counted seats from two separate fetches

Behaviour is tested where it lives in Python; the React pieces are pinned at
source level, as the rest of this suite does for the frontend.
"""
import asyncio
from datetime import datetime, timezone
from pathlib import Path

from tests.fake_mongo import FakeDB

ROOT = Path(__file__).resolve().parents[1]
FE = ROOT.parent / "frontend" / "src"


def _src(rel):
    return (FE / rel).read_text(encoding="utf-8")


TEAMS = [
    {"key": "sales_&_buyer_management", "label": "Sales & Buyer Management"},
    {"key": "production", "label": "Production"},
    {"key": "accounts", "label": "Accounts"},
    {"key": "hr", "label": "HR"},
    {"key": "owner", "label": "Owner"},
]


# --- B-02: one list ---------------------------------------------------------------------
def test_departments_are_the_teams_without_the_owner():
    from services.task_departments import team_categories
    cats = team_categories(TEAMS + [{"key": "production", "label": "dup"}, {"label": "no key"}])
    assert [c["key"] for c in cats] == ["sales_&_buyer_management", "production", "accounts", "hr"]
    assert cats[0]["label"] == "Sales & Buyer Management"


def test_a_company_without_teams_keeps_the_generic_list():
    from services.task_departments import tenant_task_categories
    d = FakeDB()
    d.tenants.docs.append({"id": "t1"})
    cats = asyncio.run(tenant_task_categories(d, "t1"))
    assert {c["key"] for c in cats} >= {"sales", "finance", "hr"}


def test_old_category_keys_move_onto_the_team_they_mean():
    from services.task_departments import align_task_types_with_teams
    d = FakeDB()
    tenant = {"id": "t1", "roles": TEAMS, "operating_model": {"task_categories": [
        {"key": "finance_and_accounts", "label": "Finance & Accounts"},
        {"key": "buyer_coordination", "label": "Buyer Coordination"},
        {"key": "hr_and_workforce", "label": "HR & Workforce"},
        {"key": "inventory_and_materials", "label": "Inventory & Materials"},
    ]}}
    for i, tt in enumerate(["finance_and_accounts", "buyer_coordination", "hr_and_workforce",
                            "inventory_and_materials", "operational", "other", "production", None]):
        d.tasks.docs.append({"id": f"k{i}", "tenant_id": "t1", "task_type": tt})
    d.tasks.docs.append({"id": "elsewhere", "tenant_id": "t2", "task_type": "finance_and_accounts"})
    moved = asyncio.run(align_task_types_with_teams(d, tenant))
    by = {t["id"]: t.get("task_type") for t in d.tasks.docs}
    assert moved["finance_and_accounts"] == "accounts" and by["k0"] == "accounts"
    assert by["k1"] == "sales_&_buyer_management"          # "buyer" is a selling word
    assert by["k2"] == "hr"
    assert by["k3"] == "inventory_and_materials"           # no single team means it: left alone
    assert by["k4"] == "operational" and by["k5"] == "other" and by["k6"] == "production"
    assert by["elsewhere"] == "finance_and_accounts"       # never another company's tasks
    assert asyncio.run(align_task_types_with_teams(d, tenant)) == {}   # idempotent


def test_a_task_given_to_a_team_is_filed_under_that_team():
    from services.tasks import _derive_task_type
    assert _derive_task_type({"assignee_role": "sales_&_buyer_management"}) == "sales_&_buyer_management"
    assert _derive_task_type({"task_type": "hr", "assignee_role": "production"}) == "hr"
    assert _derive_task_type({"assignee_role": "owner"}) == "other"
    assert _derive_task_type({}) == "other"


def test_dex_is_given_the_teams_as_departments():
    src = (ROOT / "services" / "voice.py").read_text(encoding="utf-8")
    assert "tenant_task_categories(db, tenant_id)" in src
    assert 'task_categories=cats' in src and 'task_categories=om["task_categories"]' not in src


def test_finance_follow_ups_are_filed_under_the_accounts_team():
    src = (ROOT / "services" / "finance_signals.py").read_text(encoding="utf-8")
    assert '"task_type": assignee_role if assignee_role and assignee_role != "owner" else "finance"' in src


def test_the_existing_tasks_are_moved_once_at_startup():
    src = (ROOT / "bootstrap" / "lifecycle.py").read_text(encoding="utf-8")
    assert '"task_types_follow_teams_v1"' in src and "migrate_task_types_to_teams" in src


def test_the_screens_offer_one_list():
    om = _src("lib/operatingModel.js")
    assert "export function teamCategories(tenant)" in om
    assert "const task_categories = teams.length ? teams : DEFAULT_OPERATING_MODEL.task_categories;" in om
    editor = _src("components/OperatingModelEditor.js")
    assert "op-add-cat" not in editor and "op-departments-note" in editor
    assert "task_categories: tenant?.operating_model?.task_categories || []" in editor
    vocab = _src("components/BusinessVocabulary.js")
    assert "TT_KEYS" not in vocab and "Task type / department labels" not in vocab


# --- D-01: Settings for a member ---------------------------------------------------------
def test_the_url_cannot_pick_a_tab_the_person_cannot_open():
    s = _src("pages/Settings.js")
    assert 'const tabAllowed = (key) => VALID_TAB_KEYS.has(key) && (key !== "workspace" || user?.role === "owner");' in s
    assert 'const initialTab = urlTab && tabAllowed(urlTab) ? urlTab : "business";' in s
    assert "if (urlTab && tabAllowed(urlTab) && urlTab !== tab) {" in s
    # The ping-pong pair is gone: the sync effect no longer trusts any valid key.
    assert "if (urlTab && VALID_TAB_KEYS.has(urlTab) && urlTab !== tab) {" not in s


# --- A-01: resume at the first unanswered step --------------------------------------------
def test_resume_scans_in_the_order_the_wizard_asks():
    s = _src("pages/Signup.js")
    assert '["phone", "name", "company_name", "email", "team_size"]' in s
    assert '["phone", "company_name", "team_size"]' in s
    assert '["company_name", "name", "phone", "email", "team_size"]' not in s
    flow = _src("pages/onboarding/BasicsFlow.js")
    keys = [k for k in ("phone", "name", "company_name", "email", "team_size")]
    pos = [flow.index(f'key: "{k}"') for k in keys]
    assert pos == sorted(pos), "the scan order must match BasicsFlow's STEPS"


# --- B-04: plan card ------------------------------------------------------------------------
def test_allowance_starts_again_on_the_first_of_next_month():
    from services.quotas import next_reset_date
    assert next_reset_date(datetime(2026, 10, 8, tzinfo=timezone.utc)) == "2026-11-01"
    assert next_reset_date(datetime(2026, 12, 31, 23, 0, tzinfo=timezone.utc)) == "2027-01-01"


def test_trial_days_left():
    from routers.tenant_settings import _days_left
    today = datetime.now(timezone.utc).date()
    assert _days_left(f"{today.isoformat()}T23:00:00+00:00") == 0
    assert _days_left(None) is None and _days_left("not a date") is None
    assert _days_left("2000-01-01T00:00:00Z") < 0


def test_plan_endpoint_reports_allowance_trial_and_checkout(monkeypatch):
    import routers.tenant_settings as ts
    import services.auth.membership as mem
    d = FakeDB()
    d.tenants.docs.append({"id": "t1", "plan": "trial", "trial_ends_at": "2099-01-01T00:00:00+00:00"})
    monkeypatch.setattr(ts, "db", d)

    async def fake_members(db, tid, statuses=None):
        return [{"user_id": "u1", "status": "active"}, {"user_id": "u2", "status": "pending"}]
    monkeypatch.setattr(mem, "list_memberships_for_tenant", fake_members)

    import services.quotas as q

    async def fake_usage(db, tid, resource):
        return 150_000
    monkeypatch.setattr(q, "_usage_for_resource", fake_usage)
    out = asyncio.run(ts.get_tenant_plan({"id": "u1", "tenant_id": "t1"}))
    assert out["seats_used"] == 2 and out["seats_invited"] == 1 and out["seat_limit"] == 15
    ai = out["ai_allowance"]
    assert ai["used"] == 150_000 and ai["cap"] == 300_000 and ai["percent"] == 50.0 and not ai["over"]
    assert len(ai["resets_on"]) == 10 and ai["resets_on"].endswith("-01")
    assert out["trial_days_left"] > 0
    assert out["billing_configured"] in (True, False)


def test_the_card_shows_upgrade_and_allowance():
    card = _src("components/settings/PlanCard.jsx")
    assert 'api.post("/billing/checkout"' in card and 'api.get("/billing/plans")' in card
    assert "ai_allowance" in card and "starts again" in card
    assert "support@decisionos.biz" in card           # a next step even without online payment
    s = _src("pages/Settings.js")
    assert "<PlanCard />" in s and "function PlanSeatsCard" not in s


def test_team_and_settings_count_seats_from_one_cache():
    # C-01: Settings used its own uncached fetch; it now shares Team's query.
    assert 'queryKey: ["tenant-plan"]' in _src("components/settings/PlanCard.jsx")
    assert 'queryKey: ["tenant-plan"]' in _src("pages/Team.js")


# --- A-16: bring your team in -----------------------------------------------------------
def test_the_desk_asks_until_someone_is_added():
    nudge = _src("pages/desk/TeamNudge.jsx")
    assert 'hasPerm(user, "team_manage")' in nudge
    assert 'to="/team?add=1"' in nudge
    assert 'p.invite_status === "pending"' in nudge        # an invite counts as "someone"
    assert "<TeamNudge" in _src("pages/Desk.js")


def test_sign_up_goes_straight_in_and_the_team_is_invited_from_inside():
    # 2026-10-08 (Yokesh): no "bring my team in first" at the end of sign-up;
    # the founder enters and invites from the Desk card / Team.
    s = _src("pages/Signup.js")
    assert "/team?add=1" not in s
    reveal = _src("pages/onboarding/BuildReveal.js")
    assert 'confirmAndRegister("team")' not in reveal and "Enter and bring my team in first" not in reveal
    assert 'to="/team?add=1"' in _src("pages/desk/TeamNudge.jsx")


def test_team_page_opens_add_member_from_the_link():
    t = _src("pages/Team.js")
    assert 'searchParams.get("add") === "1"' in t
    assert "autoOpen={addOnArrival}" in t
    assert "openChange(true);" in t
