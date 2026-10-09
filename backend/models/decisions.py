"""Decisions request schemas (Epic 8 Sprint 5 -- consolidated from routers).
"""
from typing import Dict, Optional

from pydantic import BaseModel, Field


class DecisionEditInput(BaseModel):
    """2026-09-27 (Yokesh) — the words of a decision, before it is decided.

    Dex writes the title and the summary from what was said, and it mishears:
    a name, a fabric, a number. Until now they could not be corrected — the
    founder approved the misspelling and lived with it, because the decision
    is what the Brain, the Journal and every later search read. Both are
    optional; one left out is left alone."""
    title: Optional[str] = Field(None, max_length=200)
    summary: Optional[str] = Field(None, max_length=4000)


class DecisionProposalTaskInput(BaseModel):
    """ASK-32 Phase 3 — change a proposed task before approving.
    ASK-50 — and the three things New Task asks that a proposal could not say:
    priority, proof, and approval. Every field is optional; one left out is
    left as it is (services.proposal_task_settings holds the rules)."""
    # 2026-09-27 — and the task's own name. A decision can propose several,
    # and Dex names them from speech: "Complete Tiruppur dispatch paperwork"
    # for what the founder calls the packing list. Renaming it afterwards in
    # My Work is a second job on work that is already somebody's.
    title: Optional[str] = Field(None, max_length=200)
    # Audit C-14 (2026-10-09): use the task already on the card (True) or add
    # this one as new (False). Only meaningful when the proposal found a match.
    use_existing: Optional[bool] = None
    assignee_id: Optional[str] = Field(None, max_length=64)
    due_date: Optional[str] = Field(None, max_length=10)  # "YYYY-MM-DD"; "" = no due date
    priority: Optional[str] = Field(None, max_length=10)  # "low" | "medium" | "high"
    evidence_required: Optional[bool] = None
    approval_required: Optional[bool] = None
    approval_stage: Optional[str] = Field(None, max_length=10)  # "start" | "close"
    approver_id: Optional[str] = Field(None, max_length=64)  # "" = the usual approver


class DecisionCommentInput(BaseModel):
    # E2-60: cap at 4000 chars (~1 A4 page of prose). Was unbounded --
    # a paste of a PDF-as-text bloated decisions.timeline[] AND every
    # participant's notification body.
    text: str = Field(..., min_length=1, max_length=4000)


class DecisionApproverInput(BaseModel):
    """ASK-32 2.5 — hand a waiting decision to someone else who can approve."""
    approver_id: str = Field(..., min_length=1, max_length=64)


class DecisionApproveInput(BaseModel):
    """2026-09-21 -- work left behind: what happens to the open tasks on a
    stage a card this decision moves will leave. task id -> "done" |
    "not_needed" | "keep". A task not named is kept (carried to where the card
    lands). The body is optional: approving with no choices keeps everything."""
    resolutions: Optional[Dict[str, str]] = None
