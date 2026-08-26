"""Platform-admin request schemas (Epic 8 Sprint 5 -- consolidated from routers).
"""
from typing import Optional
from pydantic import BaseModel


class AdminLoginInput(BaseModel):
    email: str
    password: str


class AiKeysInput(BaseModel):
    anthropic: Optional[str] = None
    openai: Optional[str] = None
    gemini: Optional[str] = None
    sarvam: Optional[str] = None
    wa_access_token: Optional[str] = None
    wa_phone_number_id: Optional[str] = None
