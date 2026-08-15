"""CRM aggregation router — Sprint 8 (E2-67) + future Sprint 1 items.

Ships:
  * GET /api/crm/outstanding  ->  {contact_id: {receivables, payables}}
      Aggregates unpaid invoices per contact so the CRM card grid can
      render an "outstanding" pill without pulling every invoice to
      the client. Follows the same _inv_remaining semantics finance
      uses so the number matches the ledger.

Future homes for CRM-scoped endpoints as Sprint 1 batches ship:
  * GET /api/crm/activity/{contact_id}   (E2-08 activity timeline)
  * GET /api/crm/workflows/{contact_id}  (E2-07 workflow feed)
"""
from fastapi import APIRouter, Depends

from core import db, get_current_user


router = APIRouter(prefix="/api/crm")


def _remaining(inv: dict) -> float:
    """Remaining balance on an invoice. Mirrors server._inv_remaining
    exactly so CRM pills and finance rows show the same number."""
    return round(float(inv.get("amount") or 0)
                 - float(inv.get("amount_paid") or 0), 2)


@router.get("/outstanding")
async def outstanding_by_contact(user: dict = Depends(get_current_user)):
    """Per-contact outstanding totals. Returns:
      { contact_id: {"receivables": Rs unpaid customer invoices,
                     "payables":    Rs unpaid supplier bills,
                     "invoice_count": N, "oldest_days": D or None} }

    Only contacts with at least one unpaid invoice appear in the map
    -- CRM cards without an entry render no pill (fewer bytes, easier
    frontend logic). Grouping key is invoice.contact_id where present,
    else contact_name matched to contacts (denormalized-name fallback,
    same pattern /contacts/{id}/profile uses)."""
    from datetime import datetime, timezone
    tid = user["tenant_id"]

    # Build a name -> id lookup so we can attribute name-only invoices.
    name_to_id: dict = {}
    async for c in db.contacts.find({"tenant_id": tid},
                                     {"_id": 0, "id": 1, "name": 1, "company": 1}):
        cid = c["id"]
        for key in (c.get("name"), c.get("company")):
            if key:
                name_to_id.setdefault(key.strip().lower(), cid)

    out: dict = {}
    today = datetime.now(timezone.utc).date()

    async for inv in db.invoices.find(
        {"tenant_id": tid, "status": {"$ne": "paid"}},
        {"_id": 0, "type": 1, "contact_id": 1, "contact_name": 1,
         "amount": 1, "amount_paid": 1, "due_date": 1, "date": 1},
    ):
        remaining = _remaining(inv)
        if remaining <= 0.01:
            continue
        cid = inv.get("contact_id")
        if not cid:
            nm = (inv.get("contact_name") or "").strip().lower()
            cid = name_to_id.get(nm)
        if not cid:
            continue  # unattributable — skip; the finance page still shows it
        bucket = out.setdefault(cid, {
            "receivables": 0.0, "payables": 0.0,
            "invoice_count": 0, "oldest_days": None,
        })
        if inv.get("type") == "purchase_bill":
            bucket["payables"] += remaining
        else:
            # Default to receivable so misc invoice types don't get lost
            bucket["receivables"] += remaining
        bucket["invoice_count"] += 1
        due = str(inv.get("due_date") or inv.get("date") or "")[:10]
        if due:
            try:
                d = datetime.fromisoformat(due).date()
                days = (today - d).days
                if days >= 0 and (bucket["oldest_days"] is None
                                  or days > bucket["oldest_days"]):
                    bucket["oldest_days"] = days
            except (ValueError, TypeError):
                pass

    # Round the totals for wire consistency
    for cid, b in out.items():
        b["receivables"] = round(b["receivables"], 2)
        b["payables"] = round(b["payables"], 2)
    return out
