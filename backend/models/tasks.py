"""Pydantic request models for the Tasks domain.

Extracted from `server.py` in Phase B step 4 so both `routers/tasks.py`
and `routers/decisions.py` (which needs `TaskCreateInput` on
`POST /decisions/{id}/tasks`) can share the same definitions without
importing from `server.py`.
"""
from typing import List, Optional

from pydantic import BaseModel


class TaskCreateInput(BaseModel):
    title: str
    description: Optional[str] = ""
    assignee_role: Optional[str] = None
    assignee_id: Optional[str] = None
    priority: Optional[str] = "medium"
    due_in_days: Optional[int] = None
    # Operational-task fields (all optional; used by the My Work "New Task" form)
    task_type: Optional[str] = None
    op_category: Optional[str] = None
    support_id: Optional[str] = None
    due_date: Optional[str] = None   # ISO date e.g. "2026-06-15"
    due_time: Optional[str] = None   # "HH:MM"
    expected_output: Optional[str] = None
    approval_required: Optional[bool] = False
    approver_id: Optional[str] = None
    progress: Optional[int] = None
    evidence_required: Optional[bool] = False
    reference_file_ids: Optional[List[str]] = None


class TaskUpdateInput(BaseModel):
    status: Optional[str] = None
    assignee_id: Optional[str] = None
    assignee_role: Optional[str] = None
    priority: Optional[str] = None
    progress: Optional[int] = None
    evidence_required: Optional[bool] = None
