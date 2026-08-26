"""CRM aggregation router.

Ships (Sprint 8):
  * GET /api/crm/outstanding      ->  per-contact unpaid invoice totals

Ships (Sprint 1 Batch C):
  * POST /api/crm/activity/{cid}  ->  log a manual activity (call/meeting/note/wa/email)
  * GET  /api/crm/activity/{cid}  ->  activity timeline for a contact
"""
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from core import db, get_current_user, new_id, now_iso, require_role, require_perm

# E2-08: allowed activity kinds. Kept small on purpose -- more kinds
# = harder to scan the timeline. `other` is the escape hatch.
CRM_ACTIVITY_KINDS = {"call", "meeting", "note", "whatsapp", "email", "other"}


router = APIRouter(prefix="/api/crm")


def _remaining(inv: dict) -> float:
    """Remaining balance on an invoice. Mirrors server._inv_remaining
    exactly so CRM pills and finance rows show the same number."""
    return round(float(inv.get("amount") or 0)
                 - float(inv.get("amount_paid") or 0), 2)


# Request models consolidated into models/ (Epic 8 Sprint 5).
from models.crm import (
    ActivityInput,
)


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


# ---------------------------------------------------------------------------
# Epic 2 Sprint 1 (E2-08): CRM activity timeline
# ---------------------------------------------------------------------------


@router.post("/activity/{contact_id}")
async def log_activity_for_contact(
    contact_id: str,
    inp: ActivityInput,
    user: dict = Depends(require_role("owner", "sales")),
):
    """Log a manual CRM activity against a contact. Owner + sales only
    (write path). Reads are open to anyone with `finance` perm since the
    360 profile is Owner/Finance-only anyway (E2-08 spec)."""
    tid = user["tenant_id"]
    contact = await db.contacts.find_one(
        {"id": contact_id, "tenant_id": tid}, {"_id": 0, "id": 1, "name": 1})
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    kind = inp.kind.strip().lower()
    if kind not in CRM_ACTIVITY_KINDS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid kind. Use one of: {sorted(CRM_ACTIVITY_KINDS)}",
        )
    text = inp.text.strip()[:2000]
    doc = {
        "id": new_id(), "tenant_id": tid, "contact_id": contact_id,
        "kind": kind, "text": text,
        "actor_id": user["id"], "actor_name": user.get("name") or "",
        "created_at": now_iso(),
    }
    await db.crm_activities.insert_one(dict(doc))
    doc.pop("_id", None)
    # Also bump contact.updated_at so the "last touched" pill on the
    # CRM card (E2-71) reflects the activity, not just profile edits.
    await db.contacts.update_one(
        {"id": contact_id, "tenant_id": tid},
        {"$set": {"updated_at": now_iso()}},
    )
    return doc


@router.get("/activity/{contact_id}")
async def list_activity_for_contact(
    contact_id: str,
    limit: int = 50,
    user: dict = Depends(require_perm("finance")),
):
    """Return recent CRM activities for a contact, newest first. Same
    permission gate as the 360 profile (finance) since these are the
    same eyes that see the invoices."""
    tid = user["tenant_id"]
    contact = await db.contacts.find_one(
        {"id": contact_id, "tenant_id": tid}, {"_id": 0, "id": 1})
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    limit = max(1, min(200, int(limit)))
    rows = await db.crm_activities.find(
        {"tenant_id": tid, "contact_id": contact_id}, {"_id": 0},
    ).sort("created_at", -1).to_list(limit)
    return rows
