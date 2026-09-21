"""Pydantic request models for the Tasks domain.

Extracted from `server.py` in Phase B step 4 so both `routers/tasks.py`
and `routers/decisions.py` (which needs `TaskCreateInput` on
`POST /decisions/{id}/tasks`) can share the same definitions without
importing from `server.py`.
"""
from typing import List, Optional

from pydantic import BaseModel, Field


class TaskCreateInput(BaseModel):
    title: str
    description: Optional[str] = ""
    assignee_role: Optional[str] = None
    assignee_id: Optional[str] = None
    # ASK-26: the people on the task alongside the lead (assignee_id). The
    # lead stays the one approvals, hand-offs and reassign act on.
    co_assignee_ids: Optional[List[str]] = None
    priority: Optional[str] = "medium"
    due_in_days: Optional[int] = None
    # Operational-task fields (all optional; used by the My Work "New Task" form)
    task_type: Optional[str] = None
    op_category: Optional[str] = None
    # ASK-28 TK-06: "supporting employee" (support_id) is gone — helpers
    # (co_assignee_ids) are the one way to put more people on a task. Older
    # app builds that still send support_id are not refused: unknown fields
    # are ignored.
    due_date: Optional[str] = None   # ISO date e.g. "2026-06-15"
    due_time: Optional[str] = None   # "HH:MM"
    expected_output: Optional[str] = None
    approval_required: Optional[bool] = False
    approver_id: Optional[str] = None
    # ASK-28 TK-05: when the approval happens — "start" (before work starts, the
    # default) or "close" (before it's marked done). Ignored without approval.
    approval_stage: Optional[str] = None
    progress: Optional[int] = None
    evidence_required: Optional[bool] = False
    reference_file_ids: Optional[List[str]] = None
    # FUP-50 (2026-08-15): finance metadata that carries forward from
    # decisions -> tasks -> auto-drafted invoices when the task
    # completes. Missing until now, so any task that came from a
    # decision like "raise Rs 5L GST invoice for X" lost the amount
    # + contact link by the time it reached MyWork.
    contact_id: Optional[str] = None
    contact_name: Optional[str] = None
    amount: Optional[float] = None
    # WE-01 (2026-08-16): workflow linkage. Every task can point at its
    # parent workflow card + the specific stage that owns it. Both null
    # for ad-hoc tasks (call the accountant, follow up on invoice).
    # Router validates both against the tenant on write; stage_key
    # without workflow_id is rejected as semantically invalid.
    workflow_id: Optional[str] = None
    stage_key: Optional[str] = None
    # D1 (2026-09-21): work that comes back. There was no notion of a repeating
    # task anywhere in the product — every GST filing, salary run and stock
    # count was typed again from scratch. "day" | "week" | "month", every
    # `repeat_interval` of them, optionally stopping on `repeat_until`. A
    # repeating task needs a due date: the date is what the repeat moves.
    repeat_every: Optional[str] = None
    repeat_interval: Optional[int] = None
    repeat_until: Optional[str] = None
    # D3 (2026-09-21): work that cannot start until other work is finished.
    # "Pack the order" after "Check stock". There was no way to say this, so
    # either the second task sat in someone's list looking ignorable, or it was
    # not created until somebody remembered to create it.
    depends_on: Optional[List[str]] = None


class TaskUpdateInput(BaseModel):
    # PILOT-1 B (2026-09-21): a task's NAME and DESCRIPTION can be changed.
    # There was no field for either, so a PATCH that sent a title was dropped
    # without a word and the drawer could only show the name it was born with —
    # the pilot client could not fix a typo in a task they had made for
    # themselves. Who may change them: the person who asked for the task,
    # their manager and the owner (services/tasks.task_edit_rights "wording",
    # the same people as the priority). Someone doing a task another person
    # gave them does not rewrite what they were asked to do.
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    assignee_id: Optional[str] = None
    assignee_role: Optional[str] = None
    # ASK-26: the whole list, replacing the stored one ([] clears it).
    co_assignee_ids: Optional[List[str]] = None
    priority: Optional[str] = None
    progress: Optional[int] = None
    evidence_required: Optional[bool] = None
    # ASK-28 TK-07: "Waiting on" — {"user_id": ...} (a colleague) or
    # {"name": "Kumar Fabrics"} (free text); {} stops waiting.
    waiting_on: Optional[dict] = None
    # B2 (2026-09-21): rescheduling. There was NO due-date field here and no
    # other route that set one, so a date, once given, was permanent — the
    # only way to move a deadline was to delete the task and type it again,
    # losing its checklist, its notes and its whole timeline with it. That is
    # the single most common act in running a company's work.
    #   "2026-10-02"  set or move the date        ""   drop the date entirely
    #   due_time "HH:MM" sets the hour; ""  clears it, keeping the day.
    # null (the default) means "not sent" — unchanged, as for every field here.
    due_date: Optional[str] = None
    due_time: Optional[str] = None
    # D1: stop a routine without cancelling the piece of work in hand. Closing
    # this task then brings nothing after it.
    stop_repeating: Optional[bool] = None


class TaskReassignInput(BaseModel):
    assignee_id: Optional[str] = None
    assignee_role: Optional[str] = None


class TaskRejectInput(BaseModel):
    """Also used by /clarify (`reason` doubles as clarification text)."""
    reason: Optional[str] = ""


class ExecStep(BaseModel):
    id: Optional[str] = None
    text: str
    done: Optional[bool] = False


class ExecPlanInput(BaseModel):
    steps: List[ExecStep]
    status: Optional[str] = None


class StepAskInput(BaseModel):
    step_text: str


class TaskUpdateNoteInput(BaseModel):
    # E2-60: cap at 4000 chars (~1 A4 page of prose). Was unbounded.
    text: str = Field(..., min_length=1, max_length=4000)
    step_id: Optional[str] = None
    action: str = "note"  # "note" | "handoff" | "escalate"
    to_id: Optional[str] = None      # member id (handoff to a person)
    to_role: Optional[str] = None    # role key (handoff to a team)


class RespondInput(BaseModel):
    text: str
