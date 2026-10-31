"""CRM aggregation router.

Ships (Sprint 8):
  * GET /api/crm/outstanding      ->  per-contact unpaid invoice totals

Ships (Sprint 1 Batch C):
  * POST /api/crm/activity/{cid}  ->  log a manual activity (call/meeting/note/wa/email)
  * GET  /api/crm/activity/{cid}  ->  activity timeline for a contact
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from core import db, get_current_user, new_id, now_iso, require_role, require_perm, may_see_contact, crm_types

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
    LinkSuggestionsInput,
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
    tid = user["tenant_id"]
    # 2026-10-03 RBAC audit: what each customer and supplier owes was given to
    # any member, CRM access or not. Now only for the contacts this person
    # may open (crm_types) -- the same cards the pill is drawn on.
    visible = crm_types(user)
    if not visible:
        return {}

    # Build a name -> id lookup so we can attribute name-only invoices.
    name_to_id: dict = {}
    async for c in db.contacts.find({"tenant_id": tid, "type": {"$in": list(visible)}},
                                     {"_id": 0, "id": 1, "name": 1, "company": 1}):
        cid = c["id"]
        for key in (c.get("name"), c.get("company")):
            if key:
                name_to_id.setdefault(key.strip().lower(), cid)

    out: dict = {}
    today = datetime.now(timezone.utc).date()
    from shared.money import in_base
    base = ((await db.tenants.find_one({"id": tid}, {"_id": 0, "currency": 1})) or {}).get("currency") or "INR"

    async for inv in db.invoices.find(
        {"tenant_id": tid, "status": {"$ne": "paid"}},
        {"_id": 0, "type": 1, "contact_id": 1, "contact_name": 1,
         "amount": 1, "amount_paid": 1, "due_date": 1, "date": 1, "currency": 1, "fx_rate": 1},
    ):
        # Audit 2026-10-08: the pill sums in the company's currency; a foreign
        # invoice with no exchange rate yet is not added in at face value.
        remaining = in_base(_remaining(inv), inv, base)
        if remaining is None or remaining <= 0.01:
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

    allowed = set(name_to_id.values())
    out = {cid: b for cid, b in out.items() if cid in allowed}
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
    user: dict = Depends(get_current_user),
):
    """Log a manual CRM activity against a contact. Anyone with People access
    (write path; RBAC P1 2026-09-15 — was the owner/sales role names). Reads are open to anyone with `finance` perm since the
    360 profile is Owner/Finance-only anyway (E2-08 spec)."""
    tid = user["tenant_id"]
    contact = await db.contacts.find_one(
        {"id": contact_id, "tenant_id": tid}, {"_id": 0, "id": 1, "name": 1, "type": 1})
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    # J7-04 / J8-01 — writing on a contact needs that SIDE of CRM, not "people":
    # a salesperson logs a call with her buyer; she does not touch suppliers.
    if not may_see_contact(user, contact.get("type")):
        raise HTTPException(status_code=403, detail="You don't have access to this contact")
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
    user: dict = Depends(get_current_user),
):
    """Return recent CRM activities for a contact, newest first. Same
    permission gate as the 360 profile: Finance, or (Epic 11 S12, 2026-10-31,
    when the profile opened to CRM) this side of CRM -- the people who log them."""
    from core.permissions import user_perms
    tid = user["tenant_id"]
    contact = await db.contacts.find_one(
        {"id": contact_id, "tenant_id": tid}, {"_id": 0, "id": 1, "type": 1})
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    if "finance" not in user_perms(user) and not may_see_contact(user, contact.get("type")):
        raise HTTPException(status_code=403, detail="You don't have access to this feature")
    limit = max(1, min(200, int(limit)))
    rows = await db.crm_activities.find(
        {"tenant_id": tid, "contact_id": contact_id}, {"_id": 0},
    ).sort("created_at", -1).to_list(limit)
    return rows


# ---------------------------------------------------------------------------
# Epic 11 S12 — old data: a review list, never silent changes
# ---------------------------------------------------------------------------
_SCAN_CAP = 5000


async def _require_crm(user: dict = Depends(get_current_user)) -> dict:
    if not crm_types(user):
        raise HTTPException(status_code=403, detail="You don't have access to Contacts")
    return user


@router.get("/link-suggestions")
async def link_suggestions(user: dict = Depends(_require_crm)):
    """Work written before Sprint 12 names its customers and suppliers only in
    words: "these tasks name Nippon Audiotronix -- link them?". A suggestion is
    made only where ONE record's whole name appears (services/parties.scan:
    never a team member's name, never generic words), grouped by the record,
    for the person to tick and approve in one go. Nothing changes until then."""
    from services import parties
    tid = user["tenant_id"]
    allowed = set(crm_types(user))
    bk = await parties.book(db, tid)
    groups: dict = {}

    def _add(c, kind, row, title):
        if c.get("type") not in allowed:
            return
        g = groups.setdefault(c["id"], {"contact": parties.public(c), "items": []})
        g["items"].append({"kind": kind, "id": row["id"], "title": title[:200],
                           "status": row.get("status") or row.get("stage") or "",
                           "created_at": row.get("created_at") or ""})

    async for t in db.tasks.find({"tenant_id": tid, "contact_id": {"$in": [None, ""]}},
                                 {"_id": 0, "id": 1, "title": 1, "description": 1, "status": 1, "created_at": 1}
                                 ).sort("created_at", -1).limit(_SCAN_CAP):
        found = bk.scan(f"{t.get('title') or ''} {t.get('description') or ''}")
        if len(found) == 1:
            _add(found[0], "task", t, t.get("title") or "")
    async for d in db.decisions.find({"tenant_id": tid, "contact_ids": {"$in": [None, []]}},
                                     {"_id": 0, "id": 1, "title": 1, "summary": 1, "status": 1, "created_at": 1}
                                     ).sort("created_at", -1).limit(_SCAN_CAP):
        found = bk.scan(f"{d.get('title') or ''} {d.get('summary') or ''}")
        if len(found) == 1:
            _add(found[0], "decision", d, d.get("title") or d.get("summary") or "")
    async for w in db.workflows.find({"tenant_id": tid, "contact_id": {"$in": [None, ""]},
                                      "counterparty": {"$nin": [None, ""]}},
                                     {"_id": 0, "id": 1, "title": 1, "counterparty": 1, "stage": 1, "created_at": 1}
                                     ).limit(_SCAN_CAP):
        ans = bk.find(w.get("counterparty"))
        if ans.get("status") == "linked":
            _add(bk.by_id[ans["contact_id"]], "workflow", w, w.get("title") or w.get("counterparty") or "")
    out = sorted(groups.values(), key=lambda g: (-len(g["items"]), g["contact"]["name"].lower()))
    return {"groups": out, "count": sum(len(g["items"]) for g in out)}


@router.post("/link-suggestions")
async def apply_link_suggestions(inp: LinkSuggestionsInput, user: dict = Depends(_require_crm)):
    """The ticked rows, linked. Each is checked again: still in this company,
    still unlinked (a link somebody made meanwhile is never replaced), and a
    record on a side of CRM this person holds."""
    tid = user["tenant_id"]
    allowed = set(crm_types(user))
    ids = list({x.contact_id for x in inp.links})
    contacts = {c["id"]: c async for c in db.contacts.find(
        {"tenant_id": tid, "id": {"$in": ids}}, {"_id": 0, "id": 1, "name": 1, "company": 1, "type": 1})}
    linked = {"task": 0, "decision": 0, "workflow": 0}
    for x in inp.links:
        c = contacts.get(x.contact_id)
        if not c or c.get("type") not in allowed or x.kind not in linked:
            continue
        name = c.get("name") or c.get("company") or ""
        if x.kind == "task":
            r = await db.tasks.update_one({"id": x.id, "tenant_id": tid, "contact_id": {"$in": [None, ""]}},
                                          {"$set": {"contact_id": c["id"], "contact_name": name}})
        elif x.kind == "decision":
            r = await db.decisions.update_one({"id": x.id, "tenant_id": tid, "contact_ids": {"$in": [None, []]}},
                                              {"$set": {"contact_ids": [c["id"]]}})
        else:
            r = await db.workflows.update_one({"id": x.id, "tenant_id": tid, "contact_id": {"$in": [None, ""]}},
                                              {"$set": {"contact_id": c["id"]}})
        linked[x.kind] += r.modified_count
    return {"linked": linked, "count": sum(linked.values())}
