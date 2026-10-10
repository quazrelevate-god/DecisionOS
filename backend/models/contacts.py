"""Contacts / CRM request schemas + domain constants (Epic 8 Sprint 5 / Sprint 10).

The CONTACT_TYPES / CONTACT_STATUS / LIFECYCLE_STAGES vocabularies moved here from
server.py in Sprint 10 (U8-10.3) so the contacts router + ingestion service share
them without importing server -- part of retiring the last server re-export shims.
"""
from typing import List, Optional
from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Contact vocabulary (shared by the contacts router + ingestion + CRM).
# ---------------------------------------------------------------------------
CONTACT_TYPES = ("customer", "dealer", "vendor")
CONTACT_STATUS = ("lead", "active", "inactive")

# E2-03 relationship lifecycle stages. The enum differs by contact type --
# customers have a sales-funnel journey, suppliers a procurement one -- but the
# backend accepts any value in the UNION so one validator covers both; the CRM
# frontend renders type-appropriate options. Empty string = "unset".
CUSTOMER_STAGES = ["lead", "qualified", "active", "at_risk", "churned"]
SUPPLIER_STAGES = ["prospect", "active", "preferred", "on_hold", "retired"]
LIFECYCLE_STAGES = list({*CUSTOMER_STAGES, *SUPPLIER_STAGES}) + [""]


# Audit C-07 (2026-10-09) -- AN EXPORT BUYER IS NOT A RUPEE CUSTOMER. A UK
# buyer had no country, no currency, no payment terms, no credit limit and one
# phone number for a firm with a buyer and an accounts desk -- and their page
# showed the money in rupees. These are the trading terms of the relationship.
class ContactPerson(BaseModel):
    name: str = Field("", max_length=80)
    role: Optional[str] = Field("", max_length=60)      # "Accounts", "Merchandiser"
    phone: Optional[str] = Field("", max_length=30)
    email: Optional[str] = Field("", max_length=120)


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
    # Audit C-07 -- trading terms.
    country: Optional[str] = Field("", max_length=60)
    currency: Optional[str] = Field("", max_length=3)            # ISO code; "" = the company's
    payment_terms_days: Optional[int] = Field(None, ge=0, le=365)
    credit_limit: Optional[float] = Field(None, ge=0)
    contact_people: Optional[List[ContactPerson]] = None
    # Audit C-05 (2026-10-08): "Add anyway" after being told one by this name
    # already exists (two firms can share a name).
    allow_duplicate: bool = False


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
    # Audit C-07 -- trading terms (None = leave as is).
    country: Optional[str] = Field(None, max_length=60)
    currency: Optional[str] = Field(None, max_length=3)
    payment_terms_days: Optional[int] = Field(None, ge=0, le=365)
    credit_limit: Optional[float] = Field(None, ge=0)
    contact_people: Optional[List[ContactPerson]] = None
