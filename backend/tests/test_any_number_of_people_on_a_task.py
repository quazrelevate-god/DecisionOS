"""Any number of people on a task, and "Everyone" in one pick (FIX-2, 2026-10-21).

The client: in the task drawer's "Assigned to", "Add a person" seemed to have
a limit. It did — services.tasks.clean_co_assignees kept the first 10 people
beside the lead and silently dropped the rest, while the drawer said "Added".
The cap is gone; the company's own people are the only bound. And both people
pickers (the drawer's "Add a person", the new task's "Add a helper") open on
"Everyone" once there are two or more to add.
"""
import os
from pathlib import Path

import pytest

from tests.e2e_harness import e2e_env

SRC = Path(__file__).resolve().parents[2] / "frontend" / "src"
TENANT = "t-people"


@pytest.mark.skipif(bool(os.environ.get("PYTEST_XDIST_WORKER")),
                    reason="rebinds module-level db globals - single-process only")
def test_every_person_picked_is_kept(with_test_db):
    async def scenario(db):
        from services.tasks import clean_co_assignees
        with e2e_env(db):
            await db.users.insert_many(
                [{"id": f"u{i}", "tenant_id": TENANT, "name": f"Person {i}", "role": "sales"} for i in range(30)]
                + [{"id": "other-co", "tenant_id": "t-else", "name": "Elsewhere", "role": "sales"}])
            picked = [f"u{i}" for i in range(1, 30)] + ["u3", "other-co", "u0"]
            return await clean_co_assignees(TENANT, picked, lead_id="u0")

    kept = with_test_db(scenario)
    # All 29 beside the lead, once each, in the order picked; never the lead,
    # never someone from another company.
    assert kept == [f"u{i}" for i in range(1, 30)]


def _read(*parts):
    return SRC.joinpath(*parts).read_text(encoding="utf-8")


def test_both_people_pickers_offer_everyone():
    access = _read("lib", "taskAccess.js")
    assert 'export const EVERYONE = "__everyone__";' in access
    assert "label: `Everyone (${people.length})`" in access
    assert "if (people.length < 2) return one;" in access

    drawer = _read("pages", "MyWork.js")
    assert "options={addPeopleOptions(addable, roleOptions)}" in drawer
    assert "if (id === EVERYONE) save([...co, ...addable.map((m) => m.id)]" in drawer

    new_task = _read("pages", "Tasks.js")
    assert "options={addPeopleOptions(helperChoices, roleOptions)}" in new_task
    assert "id === EVERYONE ? helperChoices.map((m) => m.id) : [id]" in new_task
