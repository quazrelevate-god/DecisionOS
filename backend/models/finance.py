"""Finance / ledger / ingestion request schemas (Epic 8 Sprint 5 -- consolidated from routers).
"""
from typing import Optional
from pydantic import BaseModel


class IngestCommitInput(BaseModel):
    records: dict


class ExpenseInput(BaseModel):
    title: str
    amount: float
    category: Optional[str] = None
    vendor_name: Optional[str] = ""
    vendor_id: Optional[str] = None
    date: Optional[str] = None
    status: Optional[str] = "unpaid"
    currency: Optional[str] = None
    notes: Optional[str] = ""


class AssetInput(BaseModel):
    name: str
    category: Optional[str] = "Other"
    purchase_amount: float = 0
    currency: Optional[str] = None
    purchase_date: Optional[str] = None
    vendor_name: Optional[str] = ""
    status: Optional[str] = "active"
    notes: Optional[str] = ""


class InventoryInput(BaseModel):
    item: str
    sku: Optional[str] = ""
    quantity: float = 0
    unit: Optional[str] = "unit"
    unit_cost: float = 0
    currency: Optional[str] = None
    category: Optional[str] = ""
    vendor_name: Optional[str] = ""
    notes: Optional[str] = ""


class SuggestCategoryInput(BaseModel):
    text: str


class ExpensePatch(BaseModel):
    title: Optional[str] = None
    amount: Optional[float] = None
    category: Optional[str] = None
    vendor_name: Optional[str] = None
    date: Optional[str] = None
    status: Optional[str] = None
    notes: Optional[str] = None


class IncomeInput(BaseModel):
    title: Optional[str] = ""
    customer_name: Optional[str] = ""
    amount: float = 0
    number: Optional[str] = ""
    date: Optional[str] = None
    due_date: Optional[str] = None
    status: Optional[str] = "unpaid"
    currency: Optional[str] = None
    notes: Optional[str] = ""
    received: Optional[bool] = False


class LedgerAskInput(BaseModel):
    question: str
    scope: Optional[str] = "brief"
