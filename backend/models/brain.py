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


class AgentRequest(BaseModel):
    question: str = Field(max_length=800)
    conversation_id: Optional[str] = Field(default=None, max_length=64)  # E3-12.1 agent memory


class SuggestedTaskInput(BaseModel):
    """Shape returned by the synthesizer's `suggested_tasks` list — plus optional
    source refs so we can close the loop back into `brain_context`."""
    title: str = Field(max_length=200)
    why: str = Field(default="", max_length=500)
    priority: Optional[str] = Field(default="medium", max_length=20)
    source_kind: Optional[str] = Field(default=None, max_length=40)   # e.g. "document" / "context"
    source_ref: Optional[str] = Field(default=None, max_length=64)    # doc_id or context_id
    source_label: Optional[str] = Field(default=None, max_length=200)
    question: Optional[str] = Field(default=None, max_length=400)     # what founder asked
