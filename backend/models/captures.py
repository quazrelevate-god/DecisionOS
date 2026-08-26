"""Capture review request schemas (Epic 8 Sprint 5 -- consolidated from routers).
"""
from typing import Optional
from pydantic import BaseModel


class CaptureEditInput(BaseModel):
    classification: Optional[str] = None
    reviewer_role: Optional[str] = None
    assignee_id: Optional[str] = None
    priority: Optional[str] = None
    due_date: Optional[str] = None
    summary: Optional[str] = None
    text: Optional[str] = None
    records: Optional[dict] = None


class CaptureActionInput(BaseModel):
    note: Optional[str] = ""
    reason: Optional[str] = ""
    reviewer_role: Optional[str] = None
    assignee_id: Optional[str] = None
