"""Pydantic models for Requests (2026-10-21, docs/REQUESTS_PLAN.md).

An employee asks for something they need in ONE request carrying one or many
items; the person they choose approves it; approval books an expense in Finance.
"""
from typing import List, Optional

from pydantic import BaseModel, Field


class RequestItemInput(BaseModel):
    name: str
    # Quantity and unit matter for things that are bought (they become stock
    # when the request is fulfilled); a reimbursement line has neither.
    quantity: Optional[float] = None
    unit: Optional[str] = ""
    # The line's amount in the company's currency — the whole line, not a
    # unit price, because that is how people write what they need.
    amount: Optional[float] = 0


class RequestCreateInput(BaseModel):
    type: str
    title: Optional[str] = ""
    items: List[RequestItemInput] = Field(default_factory=list)
    needed_by: Optional[str] = None             # ISO date
    reason: Optional[str] = ""
    # The requester's choice in the form: "manager" (their reporting manager,
    # the default) or "owner".
    approver_choice: Optional[str] = "manager"
    # Files uploaded first through POST /api/files (a bill, a photo, a quote).
    attachment_ids: List[str] = Field(default_factory=list)


class RequestNoteInput(BaseModel):
    note: Optional[str] = ""


class RequestFulfilInput(BaseModel):
    note: Optional[str] = ""
    # Mark the expense this request booked as paid (the default: fulfilling a
    # request is paying for it or buying it).
    mark_paid: Optional[bool] = True
    # Purchase requests: put the items that carry a quantity into stock.
    add_to_stock: Optional[bool] = False
