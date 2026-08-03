"""Pydantic models + constants for the Inbox domain."""
from pydantic import BaseModel


# Canonical inbox item classifications — mirrored by the frontend chip filter.
INBOX_CLASSES = (
    "customer", "supplier", "invoice", "payment",
    "complaint", "task", "approval", "reminder", "decision",
)


class InboxStatusInput(BaseModel):
    status: str  # "open" | "done" | "dismissed"
