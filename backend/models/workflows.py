"""Workflows request schemas + stage definitions (Epic 8 Sprint 5 / Sprint 7).

The WORKFLOW_STAGES / WORKFLOW_OWNER_ROLE stage maps were relocated here from
server.py in Sprint 7 (U8-07.2) so the demo seeder in bootstrap/ and the AI
workflow generator can share them without importing server. server.py re-exports
both names for backward-compatible `from server import WORKFLOW_STAGES`.
"""
from typing import Optional
from pydantic import BaseModel


# ---------------------------------------------------------------------------
# Workflow stage definitions
# ---------------------------------------------------------------------------
WORKFLOW_STAGES = {
    "production": ["order_received", "confirmed", "in_production", "ready"],
    "distribution": ["ready_to_dispatch", "dispatched", "in_transit", "delivered"],
    "purchase_payment": ["requested", "approved", "ordered", "received", "payment_pending", "paid"],
    # legacy (kept so pre-split cards still render/advance); AI no longer creates these
    "sales_dispatch": ["order_received", "confirmed", "in_production", "ready", "dispatched", "delivered"],
}
WORKFLOW_OWNER_ROLE = {
    "production": {"order_received": "sales", "confirmed": "sales", "in_production": "production", "ready": "production"},
    "distribution": {"ready_to_dispatch": "production", "dispatched": "sales", "in_transit": "sales", "delivered": "sales"},
    "purchase_payment": {"requested": "production", "approved": "owner", "ordered": "production",
                         "received": "production", "payment_pending": "finance", "paid": "finance"},
    "sales_dispatch": {"order_received": "sales", "confirmed": "sales", "in_production": "production",
                        "ready": "production", "dispatched": "sales", "delivered": "sales"},
}


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
