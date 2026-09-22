"""A decision's timeline names the team, not its key (JOURNEY-1, 2026-09-22).

A new founder approved his first decision on the phone and its timeline said
"Task assigned to order_intake_&_customer_coordination: …" — the department's
internal key, from the AI-designed company. The frontend already names
departments by their label (lib/departments.js); the timeline line is written
by the server, so the server learns the same rule (shared/roles.dept_name).
"""
import os

import pytest

from tests.e2e_harness import e2e_env

T = "t-j1-team"
ROLES = [{"key": "order_intake_&_customer_coordination", "label": "Order Intake & Customer Coordination"},
         {"key": "production", "label": "Production"}]


def test_a_department_is_called_by_its_label():
    from shared.roles import dept_name
    assert dept_name(ROLES, "order_intake_&_customer_coordination") == "Order Intake & Customer Coordination"
    assert dept_name(ROLES, "owner") == "Owner"


def test_a_key_the_company_has_no_label_for_is_made_readable():
    from shared.roles import dept_name
    assert dept_name([], "loom_floor_&_production") == "Loom floor & production"
    assert dept_name(None, "") == ""


pytestmark_db = pytest.mark.skipif(
    bool(os.environ.get("PYTEST_XDIST_WORKER")),
    reason="rebinds module-level db globals - single-process only",
)


@pytestmark_db
def test_the_timeline_line_names_the_person_or_the_team(with_test_db):
    async def scenario(db):
        from services.decision_flow import task_assigned_line
        with e2e_env(db):
            await db.users.insert_one({"id": "u-ganesh", "tenant_id": T, "name": "Ganesh More"})
            person = await task_assigned_line(T, {"assignee_id": "u-ganesh", "title": "Prepare floor space"}, ROLES)
            team = await task_assigned_line(
                T, {"assignee_role": "order_intake_&_customer_coordination", "title": "Review the request"}, ROLES)
            nobody = await task_assigned_line(T, {"title": "Something"}, ROLES)
            return person, team, nobody

    person, team, nobody = with_test_db(scenario)
    assert person == "Task assigned to Ganesh More: Prepare floor space"
    assert team == "Task assigned to the Order Intake & Customer Coordination team: Review the request"
    assert "_&_" not in team
    assert nobody == "Task assigned to the team: Something"
