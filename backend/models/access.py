"""Access / delegation request schemas (Epic 8 Sprint 5 -- consolidated from routers).
"""
from typing import Optional
from pydantic import BaseModel, Field


class ActingAsInput(BaseModel):
    delegate_user_id: str
    from_date: str = Field(..., description="ISO date, YYYY-MM-DD or ISO datetime")
    to_date: str
    reason: Optional[str] = ""


class TempGrantInput(BaseModel):
    perm: str
    expires_at: str = Field(..., description="ISO datetime, e.g. 2026-09-15T00:00:00+00:00")
    reason: Optional[str] = ""
