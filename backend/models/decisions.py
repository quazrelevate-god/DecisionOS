"""Decisions request schemas (Epic 8 Sprint 5 -- consolidated from routers).
"""
from typing import Optional

from pydantic import BaseModel, Field


class DecisionProposalTaskInput(BaseModel):
    """ASK-32 Phase 3 — change a proposed task before approving."""
    assignee_id: Optional[str] = Field(None, max_length=64)
    due_date: Optional[str] = Field(None, max_length=10)  # "YYYY-MM-DD"; "" = no due date


class DecisionCommentInput(BaseModel):
    # E2-60: cap at 4000 chars (~1 A4 page of prose). Was unbounded --
    # a paste of a PDF-as-text bloated decisions.timeline[] AND every
    # participant's notification body.
    text: str = Field(..., min_length=1, max_length=4000)


class DecisionApproverInput(BaseModel):
    """ASK-32 2.5 — hand a waiting decision to someone else who can approve."""
    approver_id: str = Field(..., min_length=1, max_length=64)
