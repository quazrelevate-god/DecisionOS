"""A task's name and description can be changed (PILOT-1 B, 2026-09-21).

The pilot client: "When I created a task for me, I am not able to edit the name
of the task." Nobody could, anywhere. TaskUpdateInput had no title or
description, so a PATCH that sent a new name was dropped without a word, and
the task drawer showed the name as plain text.

Who may change them: the person who asked for the task, their manager and the
owner — the same people who can change its priority. Someone doing a task
another person gave them does not get to rewrite what they were asked to do.
A rename is a change like any other, so it shows on the task's timeline.
"""
import os

import pytest
from fastapi import HTTPException

from tests.e2e_harness import e2e_env

pytestmark = pytest.mark.skipif(
    bool(os.environ.get("PYTEST_XDIST_WORKER")),
    reason="rebinds module-level db globals - single-process only",
)

TENANT = "t-rename"
OWNER = {"id": "u-owner", "tenant_id": TENANT, "role": "owner", "name": "Rajesh", "permissions": []}
ASKER = {"id": "u-asker", "tenant_id": TENANT, "role": "sales", "name": "Meena", "permissions": ["tasks"]}
DOER = {"id": "u-doer", "tenant_id": TENANT, "role": "sales", "name": "Priya", "permissions": ["tasks"]}
HELPER = {"id": "u-help", "tenant_id": TENANT, "role": "sales", "name": "Kavya", "permissions": ["tasks"]}
MANAGER = {"id": "u-mgr", "tenant_id": TENANT, "role": "sales", "name": "Suresh", "permissions": ["tasks"]}


def _seed(**over):
    return {
        "id": "task1", "tenant_id": TENANT, "title": "Send the quote",
        "description": "To Anand Fabrics, before Friday.",
        "status": "todo", "priority": "medium", "progress": 0,
        "assignee_id": DOER["id"], "assignee_role": "sales", "co_assignee_ids": [HELPER["id"]],
        "created_by": ASKER["id"], "due_date": "2026-10-02",
        "created_at": "2026-09-01T09:00:00+00:00", "updated_at": "2026-09-01T09:00:00+00:00",
        **over,
    }


async def _people(db):
    await db.users.insert_many([
        {"id": OWNER["id"], "tenant_id": TENANT, "name": "Rajesh", "role": "owner"},
        {"id": ASKER["id"], "tenant_id": TENANT, "name": "Meena", "role": "sales"},
        {"id": MANAGER["id"], "tenant_id": TENANT, "name": "Suresh", "role": "sales"},
        {"id": HELPER["id"], "tenant_id": TENANT, "name": "Kavya", "role": "sales"},
        {"id": DOER["id"], "tenant_id": TENANT, "name": "Priya", "role": "sales",
         "reporting_manager_id": MANAGER["id"]},
    ])


async def _roles(tenant_id, *a, **k):
    return ["owner", "sales", "finance", "production"]


def _run(with_test_db, user, body, task=None):
    """Seed one task, PATCH it, hand back (stored row, timeline lines, refusal)."""
    async def scenario(db):
        import routers.tasks as rt
        from models.tasks import TaskUpdateInput
        with e2e_env(db, stubs={"routers.tasks.tenant_role_keys": _roles}):
            await _people(db)
            await db.tasks.insert_one(task or _seed())
            try:
                await rt.update_task("task1", TaskUpdateInput(**body), user=user)
                refused = None
            except HTTPException as e:
                refused = (e.status_code, e.detail)
            row = await db.tasks.find_one({"id": "task1"}, {"_id": 0})
            trail = await db.activity.find(
                {"entity_id": "task1"}, {"_id": 0, "kind": 1, "detail": 1}).to_list(20)
            return row, trail, refused

    return with_test_db(scenario)


# --------------------------------------------------------------- the rename
def test_the_owner_can_rename_a_task_and_the_timeline_says_so(with_test_db):
    row, trail, refused = _run(with_test_db, OWNER, {"title": "Send the revised quote"})
    assert refused is None
    assert row["title"] == "Send the revised quote"
    assert row["last_action"] == "Renamed"
    lines = [e["detail"] for e in trail if e["kind"] == "task_renamed"]
    assert len(lines) == 1, "a rename is a change like any other: it goes on the timeline"
    assert "Send the quote" in lines[0] and "Send the revised quote" in lines[0], \
        "and the line names the old name as well as the new one"


def test_the_person_who_asked_can_rename_it(with_test_db):
    row, _, refused = _run(with_test_db, ASKER, {"title": "Send the revised quote"})
    assert refused is None and row["title"] == "Send the revised quote"


def test_the_pilot_clients_own_task_can_be_renamed_by_them(with_test_db):
    """The complaint itself: a task they made for themselves. They asked for it
    AND they do it, so asking wins — it is their own work to describe."""
    own = _seed(assignee_id=ASKER["id"], co_assignee_ids=[])
    row, _, refused = _run(with_test_db, ASKER, {"title": "Call Anand Fabrics about the quote"}, task=own)
    assert refused is None and row["title"] == "Call Anand Fabrics about the quote"


def test_the_doers_manager_can_rename_it(with_test_db):
    row, _, refused = _run(with_test_db, MANAGER, {"title": "Send the revised quote"})
    assert refused is None and row["title"] == "Send the revised quote"


def test_the_doer_cannot_rewrite_what_they_were_asked_to_do(with_test_db):
    row, trail, refused = _run(with_test_db, DOER, {"title": "Think about the quote"})
    assert refused and refused[0] == 403
    assert "rename" in refused[1]
    assert row["title"] == "Send the quote"
    assert not [e for e in trail if e["kind"] == "task_renamed"]


def test_a_helper_cannot_rename_it_either(with_test_db):
    row, _, refused = _run(with_test_db, HELPER, {"title": "Think about the quote"})
    assert refused and refused[0] == 403 and row["title"] == "Send the quote"


def test_a_name_has_to_say_something(with_test_db):
    row, _, refused = _run(with_test_db, OWNER, {"title": "    "})
    assert refused and refused[0] == 400
    assert row["title"] == "Send the quote"


def test_a_pasted_paragraph_is_not_a_name(with_test_db):
    row, _, refused = _run(with_test_db, OWNER, {"title": "x" * 201})
    assert refused and refused[0] == 400 and row["title"] == "Send the quote"


def test_a_new_name_is_tidied(with_test_db):
    row, _, refused = _run(with_test_db, OWNER, {"title": "  Send   the revised\tquote  "})
    assert refused is None and row["title"] == "Send the revised quote"


def test_sending_the_name_back_unchanged_is_not_a_rename(with_test_db):
    """A drawer saving what it was shown is not a change, and nobody is refused
    for it — including the doer, who may not rename."""
    row, trail, refused = _run(with_test_db, DOER, {"title": " Send the quote ", "progress": 30})
    assert refused is None
    assert row["title"] == "Send the quote" and row["progress"] == 30
    assert not [e for e in trail if e["kind"] == "task_renamed"]


# ---------------------------------------------------------- the description
def test_the_person_who_asked_can_change_the_description(with_test_db):
    row, trail, refused = _run(with_test_db, ASKER, {"description": "To Anand Fabrics, before Thursday."})
    assert refused is None
    assert row["description"] == "To Anand Fabrics, before Thursday."
    assert [e["detail"] for e in trail if e["kind"] == "task_edited"] == ["Changed the description"]


def test_a_description_can_be_emptied(with_test_db):
    row, trail, refused = _run(with_test_db, OWNER, {"description": ""})
    assert refused is None and row["description"] == ""
    assert [e["detail"] for e in trail if e["kind"] == "task_edited"] == ["Removed the description"]


def test_the_doer_cannot_change_the_description(with_test_db):
    row, _, refused = _run(with_test_db, DOER, {"description": "Whenever."})
    assert refused and refused[0] == 403
    assert row["description"] == "To Anand Fabrics, before Friday."


# ------------------------------------------------------------- the rule itself
def test_renaming_belongs_to_exactly_the_people_who_set_the_priority():
    """One rule, stated once: whoever may change the priority may change the
    wording, and nobody else. Checked across every kind of person on a task."""
    from services.tasks import task_edit_rights
    task = _seed()
    for user, team in ((OWNER, []), (ASKER, []), (MANAGER, [DOER["id"]]), (DOER, []), (HELPER, [])):
        rights = task_edit_rights(user, task, team, set(user["permissions"]))
        assert rights["wording"] == rights["priority"], user["name"]
