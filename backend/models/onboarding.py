"""Onboarding wizard request schemas (Epic 8 Sprint 5 -- consolidated from routers).
"""
from typing import List, Optional
from pydantic import BaseModel


class OnboardingSuggestInput(BaseModel):
    industry: str
    company_size: Optional[str] = None
    description: Optional[str] = None


class OSBlueprintGenInput(BaseModel):
    industry: str
    company_size: Optional[str] = None
    description: Optional[str] = None


class OSBlueprintInput(BaseModel):
    # WE-02 (2026-08-16): workflow_templates removed. The Settings UI
    # for it is gone; if a stale client still POSTs the field it's
    # silently ignored by Pydantic (extra fields are dropped by
    # default here), which is the safe migration behaviour.
    operational_task_templates: Optional[List[dict]] = None
    approval_rules: Optional[List[dict]] = None


class DraftCreateInput(BaseModel):
    email: Optional[str] = None


class DraftPatchInput(BaseModel):
    step: str
    data: dict
