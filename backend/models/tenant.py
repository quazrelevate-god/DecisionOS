"""Tenant configuration + settings request schemas (Epic 8 Sprint 5 --
consolidated from server.py).

RoleItem / ProductItem are the small tenant-config value objects (also reused
by the registration shape); TenantUpdateInput / InviteInput are the settings
surface request bodies.
"""
from typing import List, Optional

from pydantic import BaseModel


class RoleItem(BaseModel):
    key: str
    label: str


class ProductItem(BaseModel):
    name: str
    description: Optional[str] = ""


class TenantUpdateInput(BaseModel):
    name: Optional[str] = None
    industry: Optional[str] = None
    company_size: Optional[str] = None
    region: Optional[str] = None
    currency: Optional[str] = None
    gst: Optional[str] = None
    phone: Optional[str] = None
    branches: Optional[str] = None
    products: Optional[List[ProductItem]] = None


class InviteInput(BaseModel):
    phones: List[str]


# ---- Consolidated in Epic 8 Sprint 5 ----
class LexiconInput(BaseModel):
    lexicon: dict


class OperatingModelInput(BaseModel):
    operating_model: dict


class FinanceCategoriesInput(BaseModel):
    finance_categories: dict


class TenantSettingsInput(BaseModel):
    high_value_threshold: Optional[float] = None
    require_owner_signoff: Optional[bool] = None
    currency: Optional[str] = None


class RoleLabelInput(BaseModel):
    label: str


class RolePermissionsInput(BaseModel):
    permissions: List[str]


class AiConsentGrantInput(BaseModel):
    version: Optional[str] = None
    # Optional acknowledgment fields — not persisted, just make the
    # frontend contract explicit that the user was shown the doc.
    acknowledged: Optional[bool] = None


class TenantAIKeysInput(BaseModel):
    # Provider -> key. Empty / missing = fall back to platform pool.
    keys: dict


class OwnerExclusionsInput(BaseModel):
    exclusions: List[str]
