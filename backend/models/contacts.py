"""Contacts / CRM request schemas (Epic 8 Sprint 5 -- consolidated from routers).
"""
from typing import List, Optional
from pydantic import BaseModel


class ContactInput(BaseModel):
    type: str = "customer"
    name: str
    company: Optional[str] = ""
    phone: Optional[str] = ""
    email: Optional[str] = ""
    address: Optional[str] = ""
    tax_id: Optional[str] = ""
    tags: Optional[List[str]] = None
    status: Optional[str] = "lead"
    assigned_id: Optional[str] = None
    notes: Optional[str] = ""
    birthday: Optional[str] = ""
    lifecycle_stage: Optional[str] = ""  # E2-03


class ContactUpdateInput(BaseModel):
    type: Optional[str] = None
    name: Optional[str] = None
    company: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    tax_id: Optional[str] = None
    tags: Optional[List[str]] = None
    status: Optional[str] = None
    assigned_id: Optional[str] = None
    notes: Optional[str] = None
    birthday: Optional[str] = None
    lifecycle_stage: Optional[str] = None  # E2-03
