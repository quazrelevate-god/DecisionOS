"""CRM activity request schemas (Epic 8 Sprint 5 -- consolidated from routers).
"""
from typing import Optional
from pydantic import BaseModel, Field


class ActivityInput(BaseModel):
    kind: str = Field(..., description="call | meeting | note | whatsapp | email | other")
    text: str = Field(..., min_length=1, max_length=2000)
