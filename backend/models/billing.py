"""Billing / checkout request schemas (Epic 8 Sprint 5 -- consolidated from routers).
"""
from typing import Optional
from pydantic import BaseModel, Field


class CheckoutInput(BaseModel):
    plan_key: str = Field(..., description="One of starter, business")
    return_to: Optional[str] = Field(
        None, description="Path in this app to redirect back to after payment. Defaults to BILLING_RETURN_URL.")
