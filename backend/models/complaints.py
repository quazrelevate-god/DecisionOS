"""Complaints / memory request schemas (Epic 8 Sprint 5 -- consolidated from routers).
"""
from typing import Optional
from pydantic import BaseModel


class ComplaintInput(BaseModel):
    customer_id: Optional[str] = None
    text: str
    severity: Optional[str] = "medium"


class MemoryInput(BaseModel):
    text: str
    tag: Optional[str] = "note"
