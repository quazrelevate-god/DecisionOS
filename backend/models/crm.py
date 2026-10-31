"""CRM activity request schemas (Epic 8 Sprint 5 -- consolidated from routers).
"""
from typing import List

from pydantic import BaseModel, Field


class ActivityInput(BaseModel):
    kind: str = Field(..., description="call | meeting | note | whatsapp | email | other")
    text: str = Field(..., min_length=1, max_length=2000)


class LinkItem(BaseModel):
    kind: str = Field(..., max_length=12)         # task | decision | workflow
    id: str = Field(..., max_length=64)
    contact_id: str = Field(..., max_length=64)


class LinkSuggestionsInput(BaseModel):
    """Epic 11 S12 — the old-data review: the ticked rows, linked in one go."""
    links: List[LinkItem] = Field(..., max_length=5000)
