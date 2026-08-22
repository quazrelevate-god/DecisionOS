"""Workflows request schemas (Epic 8 Sprint 5 -- consolidated from routers).
"""
from typing import Optional
from pydantic import BaseModel


class WorkflowCreateInput(BaseModel):
    type: str  # sales_dispatch | purchase_payment
    title: str
    detail: Optional[str] = ""
    amount: Optional[float] = None
    counterparty: Optional[str] = None
    contact_id: Optional[str] = None


class WorkflowAdvanceInput(BaseModel):
    stage: str
    note: Optional[str] = ""
    # WE-07 / WE-13 (2026-08-16): audited override. When override=True
    # the engine skips check_stage_ready but demands a non-empty reason
    # (rejected as 400 otherwise). The reason lands in wf.history +
    # audit_log so "why was this advanced past its contract?" is never
    # invisible.
    override: Optional[bool] = False
    reason: Optional[str] = ""
