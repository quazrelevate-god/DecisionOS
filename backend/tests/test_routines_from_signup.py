"""The routines promised at sign-up, made real (2026-09-21, Yokesh task 3).

The reveal screen counted "8 recurring tasks Dex will keep on rails" and
nothing created them. Now the founder confirms them and each kept one becomes
a real repeating task. Pure guesses are tested here without a database; the
start/skip flow runs single-process against a scratch database.
"""
import os
from datetime import date

import pytest

from services.routines import first_dates, guess_cadence, routine_key

MON = date(2026, 9, 21)   # a Monday


# ═══════════════════════════ the guesses (pure) ════════════════════════════
@pytest.mark.parametrize("title, every, interval, confident", [
    ("Weekly yarn order status check with mills", "week", 1, True),
    ("Monday shipment review", "week", 1, True),
    ("Monthly GST filing", "month", 1, True),
    ("Run salaries", "month", 1, True),
    ("End-of-day wastage log", "day", 1, True),
    ("Reconcile Swiggy/Zomato orders at close", "day", 1, True),
    ("Quarterly stock audit", "month", 3, True),
    ("Fortnightly supplier call", "week", 2, True),
    # Real names from a founder's sign-up (Nila Garments / Kaveri Weaves):
    ("GST filing on the 10th", "month", 1, True),
    ("Chase balance payment from exporters post-dispatch — weekly follow-up log", "week", 1, True),
    ("Confirm and log all WhatsApp bookings for the day", "day", 1, True),
])
def test_a_name_that_says_how_often_is_believed(title, every, interval, confident):
    g = guess_cadence(title)
    assert (g["every"], g["interval"], g["confident"]) == (every, interval, confident)


@pytest.mark.parametrize("title", [
    "Capture signed POD on delivery",           # per delivery: workflow work
    "Assign reefer vehicle and driver to booking",
    "Escalate any temperature excursion",
    "Process online returns and exchanges",     # says nothing about time
    "Buyer payment follow-up after shipment",
    "Prepare dispatch record and lorry details for each shipment to Tiruppur",
])
def test_a_name_that_does_not_say_starts_unticked_with_the_reason(title):
    g = guess_cadence(title)
    assert g["confident"] is False and g["reason"]


def test_the_first_date_follows_what_the_name_says():
    assert first_dates("Friday cash count", MON)["week"] == "2026-09-25"
    assert first_dates("Monday shipment review", MON)["week"] == "2026-09-28", "never today — next Monday"
    assert first_dates("Monthly GST filing", MON)["month"] == "2026-10-20", "GSTR-3B is due on the 20th"
    assert first_dates("GST filing on the 10th", MON)["month"] == "2026-10-10", "the day the name gives wins"
    assert first_dates("Run salaries", MON)["month"] == "2026-09-30", "month end"
    assert first_dates("Anything", MON)["day"] == "2026-09-22"


def test_the_same_name_is_the_same_routine():
    assert routine_key("Monday  shipment review") == routine_key("monday shipment REVIEW")


# ═══════════════════════════ start / skip (database) ═══════════════════════
single = pytest.mark.skipif(bool(os.environ.get("PYTEST_XDIST_WORKER")),
                            reason="rebinds module-level db globals - single-process only")

T = "t-rt"
OWNER = {"id": "u-owner", "tenant_id": T, "role": "owner", "name": "Kavya", "permissions": []}
TEMPLATES = [
    {"title": "Monday shipment review", "category": "Review"},
    {"title": "Monthly GST filing", "category": "Compliance"},
    {"title": "Capture signed POD on delivery", "category": "Documentation"},
]


async def _seed(db):
    await db.tenants.insert_one({"id": T, "name": "Nila", "roles": [{"key": "sales", "label": "Sales"}],
                                 "operational_task_templates": TEMPLATES})
    await db.users.insert_many([
        {"id": "u-owner", "tenant_id": T, "name": "Kavya", "role": "owner"},
        {"id": "u-priya", "tenant_id": T, "name": "Priya", "role": "sales"},
    ])
    await db.memberships.insert_many([
        {"tenant_id": T, "user_id": "u-owner", "status": "active"},
        {"tenant_id": T, "user_id": "u-priya", "status": "active"},
    ])


async def _noop(*a, **k):
    return None


def _in_env(fn):
    """Run a scenario with the app's db globals pointed at the scratch db."""
    async def run(db):
        from tests.e2e_harness import e2e_env
        with e2e_env(db, stubs={"services.notifications.push_notification": _noop}):
            return await fn(db)
    return run


@single
def test_the_setup_lists_every_routine_with_a_suggestion(with_test_db):
    async def scenario(db):
        from services.routines import setup_view
        await _seed(db)
        return await setup_view(OWNER, MON)

    view = with_test_db(_in_env(scenario))
    assert view["pending"] == 3
    by = {i["title"]: i for i in view["items"]}
    assert by["Monday shipment review"]["confident"] is True
    assert by["Capture signed POD on delivery"]["confident"] is False
    assert [p["name"] for p in view["people"]] == ["Kavya", "Priya"], "owner first"


@single
def test_starting_makes_real_repeating_tasks_and_skipping_is_remembered(with_test_db):
    async def scenario(db):
        from services.routines import apply_setup, setup_view
        await _seed(db)
        view = await setup_view(OWNER, MON)
        k = {i["title"]: i["key"] for i in view["items"]}
        out = await apply_setup(OWNER, [
            {"key": k["Monday shipment review"], "assignee_id": "u-priya"},
            {"key": k["Monthly GST filing"]},
        ], [k["Capture signed POD on delivery"]], MON)
        tasks = await db.tasks.find({"tenant_id": T}, {"_id": 0}).to_list(10)
        return out, tasks

    out, tasks = with_test_db(_in_env(scenario))
    assert len(out["created"]) == 2 and out["skipped"] == 1
    assert out["pending"] == 0, "nothing is offered twice"
    by = {t["title"]: t for t in tasks}
    ship = by["Monday shipment review"]
    assert ship["recurrence"]["every"] == "week" and ship["series_id"] == ship["id"]
    assert ship["due_date"] == "2026-09-28" and ship["assignee_id"] == "u-priya"
    assert ship["assignee_role"] == "sales" and ship["source"] == "routine"
    gst = by["Monthly GST filing"]
    assert gst["recurrence"]["every"] == "month" and gst["due_date"] == "2026-10-20"
    assert gst["assignee_id"] == "u-owner", "no person chosen = the founder"
    assert "Capture signed POD on delivery" not in by


@single
def test_a_double_tap_starts_one_series(with_test_db):
    async def scenario(db):
        from services.routines import apply_setup, setup_view
        await _seed(db)
        key = (await setup_view(OWNER, MON))["items"][0]["key"]
        await apply_setup(OWNER, [{"key": key}], [], MON)
        await apply_setup(OWNER, [{"key": key}], [], MON)
        return await db.tasks.count_documents({"tenant_id": T})

    assert with_test_db(_in_env(scenario)) == 1


@single
def test_a_changed_cadence_and_an_outsider_are_handled(with_test_db):
    async def scenario(db):
        from services.routines import apply_setup, setup_view
        await _seed(db)
        key = next(i["key"] for i in (await setup_view(OWNER, MON))["items"] if i["title"] == "Monthly GST filing")
        await apply_setup(OWNER, [{"key": key, "every": "week", "assignee_id": "u-from-elsewhere"}], [], MON)
        return await db.tasks.find_one({"tenant_id": T}, {"_id": 0})

    t = with_test_db(_in_env(scenario))
    assert t["recurrence"]["every"] == "week" and t["due_date"] == "2026-09-28"
    assert t["assignee_id"] == "u-owner", "someone outside the company falls back to the founder"


@single
def test_closing_a_routine_brings_the_next_one(with_test_db):
    """The loop that makes it a routine: services/recurrence, via the task route."""
    async def scenario(db):
        from services.routines import apply_setup, setup_view
        from routers.tasks import _spawn_next_occurrence
        await _seed(db)
        key = (await setup_view(OWNER, MON))["items"][0]["key"]
        made = (await apply_setup(OWNER, [{"key": key}], [], MON))["created"][0]
        first = await db.tasks.find_one({"id": made["task_id"]}, {"_id": 0})
        await db.tasks.update_one({"id": first["id"]}, {"$set": {"status": "done"}})
        first["status"] = "done"
        nid = await _spawn_next_occurrence(OWNER, first)
        return await db.tasks.find_one({"id": nid}, {"_id": 0})

    nxt = with_test_db(_in_env(scenario))
    assert nxt["due_date"] == "2026-10-05" and nxt["title"] == "Monday shipment review"


@single
def test_only_the_owner_sees_or_answers_them(with_test_db):
    async def scenario(db):
        import routers.routines as r
        await _seed(db)
        return await r.routines_setup(user={**OWNER, "id": "u-priya", "role": "sales"})

    assert with_test_db(_in_env(scenario))["items"] == []
