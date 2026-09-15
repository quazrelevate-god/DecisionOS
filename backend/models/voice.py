"""Voice / text-note capture request schemas (Epic 8 Sprint 5 -- from server.py).

TextNoteInput is the shared body for the text-capture endpoints in both the
voice-notes and meetings routers.
"""
from typing import List, Optional

from pydantic import BaseModel


class TextNoteInput(BaseModel):
    text: str
    title: Optional[str] = None
    language: Optional[str] = "auto"
    file_ids: Optional[List[str]] = None


class SubmitNoteInput(BaseModel):
    """ASK-32 1.6 — send a held (transcribed, reviewed) recording on to Dex."""
    text: Optional[str] = ""
    file_ids: Optional[List[str]] = None


# ---- Consolidated in Epic 8 Sprint 5 ----
class ClarifyInput(BaseModel):
    text: str
