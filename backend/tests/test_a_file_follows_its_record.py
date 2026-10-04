"""A file follows its record (2026-10-03, founder: "fix the file download access").

A file was served to any member who had its id. Ids are random and only travel
inside records a person may see, so the risk was low -- but the record's rule
was not the file's rule: a task photo stayed readable after the task moved on,
a bill photo to someone without Finance.

Verified on the scratch company: a photo attached to a task assigned to the
sales member opened for her and the owner, and was refused (403) to the finance
member who is not on the task -- through /files/{id}/download and the legacy
/files/{name} route alike.
"""
from pathlib import Path

BE = Path(__file__).resolve().parents[1]


def src(rel):
    return (BE / rel).read_text(encoding="utf-8")


def test_download_asks_the_records_question():
    f = src("routers/files.py")
    assert "async def may_read_file(user: dict, rec: dict) -> bool:" in f
    i = f.index("async def download_file(")
    assert "if not await may_read_file(user, rec):" in f[i:i + 900]


def test_each_kind_of_file_asks_its_own_record():
    f = src("routers/files.py")
    body = f[f.index("async def may_read_file("):f.index("@router.post(\"/files\")")]
    assert 'rec.get("kind") == "avatar"' in body                     # faces on every card
    assert 'rec.get("uploaded_by") == user["id"]' in body             # your own staged upload
    assert "may_read_task(user, t)" in body                           # a task's attachment
    assert "_may_read_note(user, note)" in body                       # a capture's reference
    assert "_decision_participants(" in body                          # a decision's reference


def test_the_legacy_route_asks_too():
    f = src("routers/files.py")
    body = f[f.index("async def get_file("):]
    assert "if rec and not await may_read_file(user, rec):" in body
    assert 'if not ({"finance", "data_input"} & perms):' in body       # uploaded bills
    assert 'if "finance" not in perms:' in body                        # ledger attachments
    assert "on_queue = cd.get(\"reviewer_role\")" in body               # AI-draft previews


def test_the_task_rule_is_one_function():
    t = src("routers/tasks.py")
    assert "async def may_read_task(user: dict, t: dict) -> bool:" in t
    assert "if not await may_read_task(user, t):" in t
