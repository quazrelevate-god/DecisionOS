"""AI audit step 5 (2026-10-06): calculated, not AI.

The expense category, contact score, task priority, work review and leave
impact are rules over the company's own data now
(services/calculated). These pin each rule, that the retired AI calls are gone,
that GET /auth/me no longer generates setup inline, and that a bill upload says
truthfully whether the bill was read.
"""
import asyncio
import pathlib
import re
from datetime import date, datetime, timedelta, timezone

import pytest

import services.calculated as calc
import services.finance_words as fw
from tests.fake_mongo import FakeDB

BACKEND = pathlib.Path(__file__).resolve().parents[1]


def _run(c):
    return asyncio.run(c)


@pytest.fixture
def fdb(monkeypatch):
    d = FakeDB()
    monkeypatch.setattr(calc, "db", d)
    monkeypatch.setattr(fw, "db", d)
    return d


CATS = list(fw.EXPENSE_CATEGORIES)


# --- expense category ------------------------------------------------------------
def test_category_follows_the_same_vendor(fdb):
    fdb.expenses.docs += [
        {"tenant_id": "t1", "category": "Logistics & Freight", "vendor_name": "Ravi Roadways", "title": "Trip 14"},
        {"tenant_id": "t1", "category": "Logistics & Freight", "vendor_name": "ravi roadways", "title": "Trip 15"},
        {"tenant_id": "t2", "category": "Rent", "vendor_name": "Ravi Roadways", "title": "x"},   # other company
    ]
    got = _run(calc.suggest_expense_category("t1", "Trip 16", vendor="Ravi Roadways", categories=CATS))
    assert got["category"] == "Logistics & Freight" and got["how"] == "vendor"
    assert "2 bills" in got["reason"] and "Ravi Roadways" in got["reason"]


def test_category_learns_from_past_titles(fdb):
    fdb.expenses.docs += [
        {"tenant_id": "t1", "category": "Maintenance & Repairs", "title": "Loom belt replacement"},
    ]
    got = _run(calc.suggest_expense_category("t1", "loom belt replacement unit 3", categories=CATS))
    assert got == {"category": "Maintenance & Repairs", "how": "history",
                   "reason": "Like your earlier expenses booked to Maintenance & Repairs."}


def test_category_uses_the_companys_own_names(fdb):
    cats = ["Yarn & Fibre", "Staff Pay", "Other"]
    got = _run(calc.suggest_expense_category("t1", "cotton bales from Erode", categories=cats))
    assert got["category"] == "Yarn & Fibre" and got["how"] == "name"


def test_category_keyword_table_then_honest_none(fdb):
    got = _run(calc.suggest_expense_category("t1", "Office rent October", categories=CATS))
    assert got["category"] == "Rent" and got["how"] in ("name", "keyword")
    none = _run(calc.suggest_expense_category("t1", "misc 4471", categories=CATS))
    assert none["how"] == "none" and none["category"] == "Other"
    empty = _run(calc.suggest_expense_category("t1", "", categories=CATS))
    assert empty["how"] == "none"


def test_category_whole_words_only(fdb):
    # "current" must not read as "rent"
    got = _run(calc.suggest_expense_category("t1", "current account charges xyz", categories=["Rent", "Other"]))
    assert got["category"] != "Rent"


def test_category_reads_company_list_when_not_given(fdb):
    fdb.tenants.docs.append({"id": "t1", "finance_categories": {"expense": ["Diesel", "Other"], "asset": ["Other"]}})
    got = _run(calc.suggest_expense_category("t1", "diesel for generator"))
    assert got["category"] == "Diesel"


# --- contact score ---------------------------------------------------------------
def _ago(days):
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()


def test_contact_good_payer_beats_bad_payer():
    good = calc.score_contact({"type": "customer"}, {"total_billed": 100000, "total_paid": 100000, "outstanding": 0,
                                                     "invoice_count": 12, "last_payment": _ago(5)})
    bad = calc.score_contact({"type": "customer"}, {"total_billed": 100000, "total_paid": 20000, "outstanding": 80000,
                                                    "invoice_count": 3, "last_payment": _ago(120), "open_complaints": 2})
    assert good["relationship_score"] > bad["relationship_score"]
    assert good["risk_score"] < bad["risk_score"]
    assert good["method"] == bad["method"] == "calculated"
    assert "outstanding" in bad["reason"] and "2 open complaints" in bad["reason"]
    for r in (good, bad):
        assert 0 <= r["relationship_score"] <= 100 and 0 <= r["risk_score"] <= 100
        assert len(r["signals"]) <= 3


def test_contact_no_history_and_supplier_wording():
    empty = calc.score_contact({}, {})
    assert empty["reason"].startswith("Not enough history")
    sup = calc.score_contact({"type": "vendor"}, {"total_billed": 5000, "total_paid": 0, "outstanding": 5000})
    assert sup["signals"][0].startswith("We owe")


# --- task priority -----------------------------------------------------------------
def test_tasks_overdue_outrank_far_off():
    today = datetime.now(timezone.utc).date()      # the rule counts days in UTC
    out = calc.score_tasks([
        {"id": "a", "title": "Send invoice to buyer", "due_date": (today - timedelta(days=3)).isoformat(), "priority": "high"},
        {"id": "b", "title": "Tidy shelf", "due_date": (today + timedelta(days=30)).isoformat(), "priority": "low"},
        {"id": "c", "title": "No date", "priority": "medium", "status": "blocked"},
    ])
    assert out["a"]["priority_score"] > out["c"]["priority_score"] > 0
    assert out["a"]["priority_score"] > out["b"]["priority_score"]
    assert "Overdue by 3 days" in out["a"]["reason"]
    assert out["a"]["revenue"] > out["b"]["revenue"]
    assert "blocked" in out["c"]["reason"].lower()
    assert all(v["method"] == "calculated" for v in out.values())


def test_tasks_bad_date_does_not_crash():
    out = calc.score_tasks([{"id": "x", "due_date": "soon"}])
    assert out["x"]["urgency"] == 20


# --- work coach ------------------------------------------------------------------
def test_coach_overdue_first():
    r = calc.work_coach({"name": "Priya Raman"}, {"completion_rate": 60, "overdue": 3, "open": 8, "completed": 6,
                                                  "proof_upload_rate": 20, "timing": {"on_time_rate": 50}})
    assert r["headline"].startswith("Priya has 3 overdue of 8 open")
    assert any("overdue" in i for i in r["improvements"])
    assert any("proof" in i.lower() for i in r["improvements"])
    assert r["method"] == "calculated"


def test_coach_strong_and_empty():
    strong = calc.work_coach({"name": "Ravi"}, {"completion_rate": 90, "completed": 18, "proof_upload_rate": 80,
                                                "timing": {"on_time_rate": 95}})
    assert "90%" in strong["headline"] and len(strong["strengths"]) >= 3
    none = calc.work_coach({"name": ""}, {})
    assert none["headline"].startswith("Not enough work")


# --- leave impact ------------------------------------------------------------------
def test_leave_hands_over_to_lightest_same_team():
    members = [{"id": "u2", "name": "Asha", "role": "sales", "load": 5},
               {"id": "u3", "name": "Bala", "role": "sales", "load": 1},
               {"id": "u4", "name": "Chitra", "role": "production", "load": 0}]
    tasks = [{"id": "t1", "due_date": "2026-10-08", "priority": "medium"},
             {"id": "t2", "due_date": "2026-10-09", "priority": "high"}]
    r = calc.leave_impact("Kumar", "2026-10-07", "2026-10-10", tasks, members, person_role="sales")
    s = {x["task_id"]: x for x in r["suggestions"]}
    assert s["t1"]["action"] == "reassign" and s["t1"]["assignee_id"] == "u3"
    assert s["t2"]["action"] == "reassign"       # load moves: Bala now has 2 — still lightest vs Asha's 5
    assert "2 can be handed over" in r["summary"]


def test_leave_extends_past_the_leave_or_monitors():
    r = calc.leave_impact("Kumar", "2026-10-07", "2026-10-10",
                          [{"id": "t1", "due_date": "2026-10-08"}, {"id": "t2", "due_date": "2026-11-30"}],
                          [{"id": "u9", "name": "Other", "role": "accounts", "load": 0}], person_role="sales")
    s = {x["task_id"]: x for x in r["suggestions"]}
    assert s["t1"] == {"task_id": "t1", "action": "extend", "due_date": "2026-10-11",
                       "reason": "Due during the leave and nobody in the team can take it."}
    assert s["t2"]["action"] == "monitor"
    assert calc.leave_impact("K", "a", "b", [], [])["suggestions"] == []


# --- the AI calls are gone -----------------------------------------------------------
_RETIRED = ("ai_score_tasks", "ai_score_contact", "ai_classify_purchase", "ai_work_coach",
            "ai_leave_impact", "ai_suggest_expense_category")
_RETIRED_PROMPTS = ("extraction.score_tasks", "extraction.score_contact", "documents.purchase_class",
                    "coaching.work_coach", "coaching.leave_impact", "ledger.expense_cat")


def test_retired_ai_functions_and_prompts_are_gone():
    hits = []
    for p in BACKEND.rglob("*.py"):
        rel = p.relative_to(BACKEND).as_posix()
        if rel.startswith((".venv/", "tests/")) or "/site-packages/" in rel:
            continue
        src = p.read_text(encoding="utf-8", errors="ignore")
        for name in _RETIRED:
            if re.search(r"\b" + name + r"\s*\(", src):
                hits.append(f"{rel}: {name}")
        for pr in _RETIRED_PROMPTS:
            if f'"{pr}"' in src:
                hits.append(f"{rel}: {pr}")
    assert not hits, hits


# --- GET /auth/me never generates inline ---------------------------------------------
def test_me_does_not_call_ai_inline():
    src = (BACKEND / "routers" / "auth.py").read_text(encoding="utf-8")
    for fn in ("ai_generate_lexicon", "ai_generate_finance_categories", "backfill_operating_model"):
        assert not re.search(r"\b" + fn + r"\s*\(", src), fn       # named in the docstring, never called
    assert "claim_setup_backfill" in src


def test_setup_backfill_is_claimed_once(monkeypatch):
    import services.ai.ai_setup as setup
    d = FakeDB()
    d.tenants.docs.append({"id": "t1"})
    monkeypatch.setattr(setup, "db", d)
    ran = []

    async def fake_backfill(tid):
        ran.append(tid)

    monkeypatch.setattr(setup, "_backfill_missing_setup", fake_backfill)

    async def go():
        first = await setup.claim_setup_backfill({"id": "t1"})
        second = await setup.claim_setup_backfill({"id": "t1"})        # inside the cooldown
        done = await setup.claim_setup_backfill({"id": "t1", "lexicon": {"a": 1},
                                                 "operating_model": {"pipelines": [1]},
                                                 "finance_categories": {"expense": ["x"]}})
        await asyncio.sleep(0)
        return first, second, done

    assert _run(go()) == (True, False, False)
    assert ran == ["t1"]
    assert setup.setup_missing({}) == ["lexicon", "operating_model", "finance_categories"]


# --- a bill upload says whether the bill was read -----------------------------------------
class _Upload:
    filename = "bill.jpg"
    content_type = "image/jpeg"

    async def read(self):
        return b"\xff\xd8\xff fake"


def _wire_upload(monkeypatch, tmp_path, ai_result):
    import routers.ledger as L
    import services.uploads as up

    async def save(tid, content, filename, content_type=None):
        return {"filename": filename, "url": "/u/x", "storage_path": "t1/x"}

    async def to_temp(path):
        f = tmp_path / "bill.jpg"
        f.write_bytes(b"x")
        return f

    async def currency(tid):
        return "INR"

    async def cats(tid):
        return {"expense": CATS, "asset": fw.ASSET_CATEGORIES}

    async def extract(*a, **k):
        if isinstance(ai_result, Exception):
            raise ai_result
        return ai_result

    monkeypatch.setattr(L, "_save_upload_async", save)
    monkeypatch.setattr(up, "download_to_temp", to_temp)
    monkeypatch.setattr(L, "_currency", currency)
    monkeypatch.setattr(L, "get_finance_categories", cats)
    monkeypatch.setattr(L, "ai_extract_ledger_file", extract)
    return L


@pytest.mark.parametrize("ai_result, read", [
    ({"title": "Diesel", "amount": 4200}, True),
    ({}, False),
    (RuntimeError("vision down"), False),
])
def test_bill_read_flag(monkeypatch, tmp_path, ai_result, read):
    L = _wire_upload(monkeypatch, tmp_path, ai_result)
    data, att = _run(L._read_attachment(_Upload(), "expense", "t1", {"title": "", "amount": None}))
    assert att["read"] is read
    assert data["attachment"] is att
