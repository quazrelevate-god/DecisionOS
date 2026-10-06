"""Company Brain request schemas (Epic 8 Sprint 5 -- consolidated).

AskInput is the legacy /ask body (still referenced by server's un-routed
_ask_ai_legacy). Brain / brain_router / brain_docs router shapes are
consolidated here in U8-05.6.
"""

from typing import Optional
from pydantic import BaseModel, Field


class AskInput(BaseModel):
    question: str


# ---- Consolidated in Epic 8 Sprint 5 ----
class AskRequest(BaseModel):
    question: str
    context_id: Optional[str] = None


class ExportRequest(BaseModel):
    context_id: str
    format: str = "csv"


class PatchInput(BaseModel):
    title: Optional[str] = Field(default=None, max_length=200)
    kind: Optional[str] = Field(default=None, max_length=40)
    tags: Optional[str] = Field(default=None, max_length=400)
    department: Optional[str] = Field(default=None, max_length=60)
    visibility: Optional[str] = Field(default=None, max_length=40)
    roles_allowed: Optional[str] = Field(default=None, max_length=400)
    summary: Optional[str] = Field(default=None, max_length=800)
