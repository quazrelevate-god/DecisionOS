"""Audit B-03 and D-04 (2026-10-09).

B-03  A stage's approval gate was yes/no: "sign-off only for orders over 5 lakh"
      could not be said. The gate now takes `above`; a card at or under it
      leaves without the sign-off, a card over it -- or with no value -- waits.
      Checked live on the scratch DB: Rs 3,00,000 card moved on by itself once
      its tasks were done; Rs 7,00,000 and no-value cards waited ("awaiting
      owner approval (needed above Rs 5,00,000)"); the card view said "it is
      over Rs 5,00,000". The sign-up interview can produce it (stage_signoff).
D-04  With no manager and no rule from sign-up, leave went to the owner though
      an HR team (which starts able to approve leave) was right there; and the
      Leave page printed "2026-10-15 -> 2026-10-16". Checked live: a sales
      member's leave went to Kavitha in HR; the page read "15-16 Oct".
"""
import asyncio
from pathlib import Path

from tests.fake_mongo import FakeDB

ROOT = Path(__file__).resolve().parents[1]
FE = ROOT.parent / "frontend" / "src"


def _run(c):
    return asyncio.run(c)


# ---- B-03 ---------------------------------------------------------------------
def test_the_gate_keeps_its_value_through_a_save():
    from shared.normalizers import normalize_operating_model
    om = normalize_operating_model({"pipelines": [{"key": "orders", "label": "Orders", "stages": [
        {"key": "qc", "label": "Quality Check", "approval": {"role": "owner", "required": True, "above": "200000"}},
        {"key": "ship", "label": "Dispatched", "approval": {"role": "owner", "required": True, "above": ""}},
    ]}]})
    st = om["pipelines"][0]["stages"]
    assert st[0]["approval"] == {"role": "owner", "required": True, "above": 200000.0}
    assert st[1]["approval"] == {"role": "owner", "required": True}, "no value = every card"


def test_under_the_value_the_sign_off_is_waived():
    from services.workflow_engine import approval_waived
    gate = {"role": "owner", "required": True, "above": 500000}
    assert approval_waived(gate, {"amount": 300000}) is True
    assert approval_waived(gate, {"amount": 500000}) is True
    assert approval_waived(gate, {"amount": 700000}) is False
    assert approval_waived(gate, {"amount": None}) is False, "no value: we cannot tell, so it waits"
    assert approval_waived({"role": "owner", "required": True}, {"amount": 1}) is False


def test_the_interview_can_set_a_stage_sign_off():
    from services.ai.approval_rules import validate_actions, apply_to_pipelines, describe
    pipes = [{"key": "orders", "label": "Orders", "stages": [{"key": "qc", "label": "Quality Check"},
                                                             {"key": "ship", "label": "Dispatched"}]}]
    teams = [{"key": "sales", "label": "Sales"}]
    rules = [{"name": "Big orders after QC"}]
    acts = validate_actions({"actions": [{"rule": "Big orders after QC", "kind": "stage_signoff",
                                          "pipeline": "orders", "stage": "qc", "team": "owner", "above": 200000}]},
                            rules=rules, teams=teams, pipelines=pipes)
    assert acts == [{"rule": "Big orders after QC", "kind": "stage_signoff", "pipeline": "orders",
                     "stage": "qc", "team": "owner", "above": 200000.0}]
    assert apply_to_pipelines(pipes, acts) is True
    assert pipes[0]["stages"][0]["approval"] == {"role": "owner", "required": True, "above": 200000.0}
    assert describe(acts[0], teams, pipes) == "Before work leaves Orders › Quality Check, you sign off — for work over ₹2,00,000."
    bad = validate_actions({"actions": [{"rule": "Big orders after QC", "kind": "stage_signoff",
                                         "pipeline": "orders", "stage": "nope", "team": "owner"}]},
                           rules=rules, teams=teams, pipelines=pipes)
    assert bad[0]["kind"] == "note", "a stage that does not exist becomes a note"


def test_the_prompt_offers_it():
    from prompts import get, render
    assert get("generators.approval_rules").version == "1.2"
    assert '"stage_signoff"' in render("generators.approval_rules")


def test_the_screens_show_it():
    ed = (FE / "components" / "OperatingModelEditor.js").read_text(encoding="utf-8")
    assert "op-stage-approval-above-${pi}-${si}" in ed
    wd = (FE / "components" / "workflow" / "WorkflowDetail.js").read_text(encoding="utf-8")
    assert "gate?.required && !gate.waived" in wd and "wf-stage-approval-waived-" in wd
    pf = (FE / "components" / "workflow" / "PipelineFlow.jsx").read_text(encoding="utf-8")
    assert 'a.kind === "stage_signoff"' in pf


# ---- D-04 ---------------------------------------------------------------------
def test_leave_days_read_like_people_say_them():
    from services.leave import day_range
    assert day_range("2026-10-15", "2026-10-16") == "15–16 Oct"
    assert day_range("2026-10-15", "2026-10-15") == "15 Oct"
    assert day_range("2026-10-30", "2026-11-02") == "30 Oct – 2 Nov"
    assert day_range("2026-12-30", "2027-01-02") == "30 Dec 2026 – 2 Jan 2027"
    lp = (FE / "pages" / "Leave.js").read_text(encoding="utf-8")
    assert "dayRange(lv.from_date, lv.to_date)" in lp and "→ ${lv.to_date}" not in lp


def _chain(monkeypatch, users, can_approve, roles=()):
    import services.leave as lv
    import services.auth.membership as mem
    d = FakeDB()
    d.tenants.docs.append({"id": "t1", "roles": list(roles)})
    d.users.docs += users
    monkeypatch.setattr(lv, "db", d)

    async def members(db, tid, statuses=None):
        return [{"user_id": u["id"], "role": u["role"], "status": "active"} for u in d.users.docs]

    async def perms(db, tid, people):
        return {p["id"]: ({"leave_approve"} if p["id"] in can_approve else set()) for p in people}
    monkeypatch.setattr(mem, "list_memberships_for_tenant", members)
    monkeypatch.setattr(mem, "members_effective_perms", perms)
    return lv, d


USERS = [{"id": "rahul", "tenant_id": "t1", "role": "sales", "name": "Rahul"},
         {"id": "kavitha", "tenant_id": "t1", "role": "people_ops", "name": "Kavitha"},
         {"id": "suresh", "tenant_id": "t1", "role": "sales", "name": "Suresh"},
         {"id": "anand", "tenant_id": "t1", "role": "dispatch", "name": "Anand"},
         {"id": "meera", "tenant_id": "t1", "role": "owner", "name": "Meera"}]
ROLES = [{"key": "sales", "label": "Sales"}, {"key": "people_ops", "label": "HR & Payroll"},
         {"key": "dispatch", "label": "Dispatch"}]


def test_hr_approves_before_the_owner(monkeypatch):
    lv, d = _chain(monkeypatch, [dict(u) for u in USERS], {"kavitha", "anand"}, ROLES)
    assert _run(lv._resolve_leave_approver("t1", d.users.docs[0])) == ("kavitha", "Kavitha"), \
        "an HR team that can approve leave comes before any other team, and before the owner"


def test_the_own_team_lead_comes_first(monkeypatch):
    lv, d = _chain(monkeypatch, [dict(u) for u in USERS], {"kavitha", "suresh"}, ROLES)
    assert _run(lv._resolve_leave_approver("t1", d.users.docs[0])) == ("suresh", "Suresh")


def test_nobody_who_can_means_the_owner(monkeypatch):
    lv, d = _chain(monkeypatch, [dict(u) for u in USERS], set(), ROLES)
    assert _run(lv._resolve_leave_approver("t1", d.users.docs[0])) == ("meera", "Meera")


def test_never_to_yourself(monkeypatch):
    lv, d = _chain(monkeypatch, [dict(u) for u in USERS], {"kavitha"}, ROLES)
    assert _run(lv._resolve_leave_approver("t1", d.users.docs[1])) == ("meera", "Meera")
