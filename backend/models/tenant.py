"""Tenant configuration + settings request schemas (Epic 8 Sprint 5 --
consolidated from server.py).

RoleItem / ProductItem are the small tenant-config value objects (also reused
by the registration shape); TenantUpdateInput / InviteInput are the settings
surface request bodies.
"""
from typing import List, Optional

from pydantic import BaseModel, Field


class RoleItem(BaseModel):
    key: str
    label: str


class ProductItem(BaseModel):
    name: str
    description: Optional[str] = ""


class TenantUpdateInput(BaseModel):
    name: Optional[str] = None
    # 2026-09-20 — where support and receipts for THIS company go. A company
    # address, not a sign-in: it carries no password, is not unique across
    # workspaces, and a founder running two companies may well use the same one
    # for both. Their sign-in email stays on their own user row.
    support_email: Optional[str] = None
    industry: Optional[str] = None
    company_size: Optional[str] = None
    region: Optional[str] = None
    currency: Optional[str] = None
    gst: Optional[str] = None
    phone: Optional[str] = None
    branches: Optional[str] = None
    products: Optional[List[ProductItem]] = None
    # Audit F-03 (2026-10-08): what a GST invoice's header and footer need.
    address: Optional[str] = None
    state: Optional[str] = None          # GST state -- decides CGST+SGST vs IGST
    bank_name: Optional[str] = None
    bank_account: Optional[str] = None
    bank_ifsc: Optional[str] = None
    upi_id: Optional[str] = None
    invoice_prefix: Optional[str] = None
    invoice_terms: Optional[str] = None
    # Audit B-12 (2026-10-08): the two defaults an invoice asks for every time.
    payment_terms_days: Optional[int] = Field(default=None, ge=0, le=365)   # due = date + N
    default_gst_rate: Optional[float] = None                                # one of invoicing.GST_RATES


class InvoiceLogoInput(BaseModel):
    """Audit B-12: the company logo on its invoices, as a data URL (PNG/JPEG)."""
    data_url: str = Field(..., max_length=400_000)


class InviteInput(BaseModel):
    phones: List[str]


# ---- Consolidated in Epic 8 Sprint 5 ----
class LexiconInput(BaseModel):
    lexicon: dict


class OperatingModelInput(BaseModel):
    operating_model: dict


class StageWorkTask(BaseModel):
    title: str
    role: Optional[str] = ""
    evidence_required: Optional[bool] = False


class StageWorkFill(BaseModel):
    """The work an owner kept for ONE stage, after reviewing the suggestion."""
    pipeline_key: str
    stage_key: str
    tasks: List[StageWorkTask] = []


class StageWorkApplyInput(BaseModel):
    fills: List[StageWorkFill]


class FinanceCategoriesInput(BaseModel):
    finance_categories: dict


class TenantSettingsInput(BaseModel):
    high_value_threshold: Optional[float] = None
    require_owner_signoff: Optional[bool] = None
    currency: Optional[str] = None
    # 2026-09-16 (RBAC P2): overdue work — days late before the doer's manager,
    # then the owner, hears; and whether owners also get the alert by email.
    # D2: days of warning before a task's due date (0 = no warning).
    due_soon_days: Optional[int] = None
    followup_manager_days: Optional[int] = None
    followup_owner_days: Optional[int] = None
    owner_alert_email: Optional[bool] = None


class TenantAIKeyInput(BaseModel):
    key: str


class RoleLabelInput(BaseModel):
    label: str


class RolePermissionsInput(BaseModel):
    permissions: List[str]
    # 2026-09-15: also make everyone in the role follow it (clears their own lists).
    apply_to_members: Optional[bool] = False


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
    # Audit B-10 (2026-10-09): the only owner switching an area off for
    # themselves says so first.
    confirm_self: bool = False
