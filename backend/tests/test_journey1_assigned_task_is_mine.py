"""A task somebody made FOR you is in your My Tasks (JOURNEY-1 J1-07).

The finding was that a task created for somebody else only shows under "Asked
by me". That is true and right for the person who ASKED: it is not their work.
The founder's question was the other half — does it reach the person it was
made for? It does, and this test holds that open, because the answer is the
reason nothing else needed changing.

What was left was the creator's experience: My Work opens on My Tasks, "Asked
by me" is a separate lens reached by ?view=asked, so pressing Create landed
them back on a list that does not contain what they just made.
"""
from services.tasks import task_list_query

T = "t-j1-asked"
PRIYA = {"id": "u-priya", "tenant_id": T, "role": "sales", "permissions": []}
SURESH = {"id": "u-suresh", "tenant_id": T, "role": "owner", "permissions": []}


def _ors(q):
    return q.get("$or") or []


def test_priya_sees_a_task_made_for_her_in_my_tasks():
    q = task_list_query(PRIYA, mine=True)
    assert {"assignee_id": PRIYA["id"]} in _ors(q), \
        "a task assigned to her must be in her own list — this is the whole answer to J1-07"


def test_and_when_she_is_only_helping_on_it():
    q = task_list_query(PRIYA, mine=True)
    assert {"co_assignee_ids": PRIYA["id"]} in _ors(q)


def test_the_creator_does_not_get_somebody_elses_work_in_theirs():
    """Which is why it is under "Asked by me" for him, and correct."""
    q = task_list_query(SURESH, mine=True)
    assert {"assignee_id": SURESH["id"]} in _ors(q)
    assert {"assignee_id": PRIYA["id"]} not in _ors(q)


def test_asked_by_me_is_what_he_created_and_is_not_doing():
    q = task_list_query(SURESH, view="asked")
    assert q.get("created_by") == SURESH["id"]
    assert q.get("assignee_id") == {"$ne": SURESH["id"]}
    assert q.get("co_assignee_ids") == {"$ne": SURESH["id"]}
