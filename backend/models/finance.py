"""Finance / ledger / ingestion request schemas (Epic 8 Sprint 5 -- consolidated from routers).
"""
from typing import List, Optional
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


class ExpenseApprovalInput(BaseModel):
    """J7 (JOURNEY-1) — an owner's answer on a high-value expense."""
    approve: bool
    note: Optional[str] = ""


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


# --- Audit 2026-10-08: F-02 record a payment, F-03 a real invoice, F-04 stock used --------
class RecordPaymentInput(BaseModel):
    """Money received against a sales invoice, or paid against a purchase bill."""
    amount: float
    date: Optional[str] = None
    method: Optional[str] = ""        # bank transfer / UPI / cash / cheque / card
    reference: Optional[str] = ""     # UTR, cheque no.
    notes: Optional[str] = ""


class InvoiceLineInput(BaseModel):
    description: str
    hsn: Optional[str] = ""
    qty: float = 1
    unit: Optional[str] = ""
    rate: float = 0
    gst_rate: float = 0


class GstInvoiceInput(BaseModel):
    contact_id: Optional[str] = None
    customer_name: str
    customer_gstin: Optional[str] = ""
    customer_address: Optional[str] = ""
    place_of_supply: Optional[str] = ""   # a state, or "Export (outside India)"
    currency: Optional[str] = None
    number: Optional[str] = ""            # blank = the next number in the series
    date: Optional[str] = None
    due_date: Optional[str] = None
    items: List[InvoiceLineInput] = []
    notes: Optional[str] = ""


class StockUseInput(BaseModel):
    quantity: float
    date: Optional[str] = None
    note: Optional[str] = ""
