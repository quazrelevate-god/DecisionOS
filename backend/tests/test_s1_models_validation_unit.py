"""Epic 10 Testing -- Sprint 1 (unit). T10-01.11 (models).

Pure unit tests over the Pydantic REQUEST models: required fields, type
coercion, and the explicit Field constraints they enforce. (Enum/domain
validation -- e.g. status in a fixed set -- is enforced in the routers, not the
models, and is covered by the S2/S3 functional lane.) No DB, no server.
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import pytest
from pydantic import ValidationError

from models.tasks import TaskCreateInput, TaskUpdateInput
from models.contacts import ContactInput
from models.decisions import DecisionCommentInput


# --- required fields ---------------------------------------------------------
def test_task_create_requires_title():
    with pytest.raises(ValidationError):
        TaskCreateInput()  # no title
    t = TaskCreateInput(title="Do the thing")
    assert t.title == "Do the thing"
    assert t.priority == "medium"  # default


def test_contact_requires_name():
    with pytest.raises(ValidationError):
        ContactInput()  # no name
    c = ContactInput(name="Kapoor Retail")
    assert c.name == "Kapoor Retail"
    assert c.type == "customer" and c.status == "lead"  # defaults


# --- type coercion -----------------------------------------------------------
def test_task_amount_coerces_numeric_string():
    t = TaskCreateInput(title="x", amount="1500")
    assert t.amount == 1500.0 and isinstance(t.amount, float)


def test_task_amount_rejects_non_numeric():
    with pytest.raises(ValidationError):
        TaskCreateInput(title="x", amount="not-a-number")


def test_task_progress_coerces_int_and_bool_flags():
    t = TaskCreateInput(title="x", progress="40", approval_required="true", evidence_required=1)
    assert t.progress == 40
    assert t.approval_required is True and t.evidence_required is True


def test_task_reference_file_ids_must_be_list():
    with pytest.raises(ValidationError):
        TaskCreateInput(title="x", reference_file_ids="not-a-list-but-a-string-of-len>1")


# --- DecisionCommentInput Field constraints (min/max length) ----------------
def test_comment_rejects_empty_text():
    with pytest.raises(ValidationError):
        DecisionCommentInput(text="")


def test_comment_accepts_normal_text():
    assert DecisionCommentInput(text="looks good").text == "looks good"


def test_comment_rejects_over_max_length():
    with pytest.raises(ValidationError):
        DecisionCommentInput(text="x" * 4001)


def test_comment_accepts_at_max_length():
    assert len(DecisionCommentInput(text="x" * 4000).text) == 4000


# --- optional-everything update models ---------------------------------------
def test_task_update_all_optional():
    """A patch model must accept an empty body (partial update)."""
    u = TaskUpdateInput()
    assert u.status is None


def test_task_update_coerces_provided_fields():
    u = TaskUpdateInput(status="done")
    assert u.status == "done"
