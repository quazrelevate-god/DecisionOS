"""Decisions request schemas (Epic 8 Sprint 5 -- consolidated from routers).
"""
from pydantic import BaseModel, Field


class DecisionCommentInput(BaseModel):
    # E2-60: cap at 4000 chars (~1 A4 page of prose). Was unbounded --
    # a paste of a PDF-as-text bloated decisions.timeline[] AND every
    # participant's notification body.
    text: str = Field(..., min_length=1, max_length=4000)
