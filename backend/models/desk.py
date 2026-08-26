"""Decision Desk request schemas (Epic 8 Sprint 5 -- consolidated from routers).
"""
from typing import Optional
from pydantic import BaseModel


class NudgeInput(BaseModel):
    channel: Optional[str] = "auto"  # future: 'whatsapp' | 'email' | 'auto'
