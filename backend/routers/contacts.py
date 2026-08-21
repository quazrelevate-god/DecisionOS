"""Contact / CRM endpoints (Epic 8 Sprint 3 -- extracted from server.py).

Buyer/supplier contact CRUD with a denormalized-name cascade into invoices,
payments and workflows on rename. enrich_contacts + CONTACT_TYPES/STATUS/
LIFECYCLE_STAGES stay in server (shared with dashboard/ingestion) for now.
"""
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core import db, logger, new_id, now_iso, log_activity, require_perm, require_role
from server import CONTACT_TYPES, CONTACT_STATUS, LIFECYCLE_STAGES, enrich_contacts  # shared; server-side for now

router = APIRouter(prefix="/api")


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


@router.get("/contacts")
async def list_contacts(type: Optional[str] = None, status: Optional[str] = None, q: Optional[str] = None,
                        user: dict = Depends(require_perm("people"))):
    query = {"tenant_id": user["tenant_id"]}
    if type:
        query["type"] = type
    if status:
        query["status"] = status
    if q:
        rx = {"$regex": q, "$options": "i"}
        query["$or"] = [{"name": rx}, {"company": rx}, {"email": rx}, {"phone": rx}]
    contacts = await db.contacts.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)
    return await enrich_contacts(contacts)


@router.post("/contacts")
async def create_contact(inp: ContactInput, user: dict = Depends(require_role("owner", "sales"))):
    if inp.type not in CONTACT_TYPES:
        raise HTTPException(status_code=400, detail="Invalid contact type")
    status = inp.status if inp.status in CONTACT_STATUS else "lead"
    cid = new_id()
    # E2-03: accept lifecycle_stage from the union of customer +
    # supplier stages. Empty string means unset (unfamiliar contact).
    stage = (inp.lifecycle_stage or "").strip().lower()
    if stage and stage not in LIFECYCLE_STAGES:
        stage = ""
    doc = {
        "id": cid, "tenant_id": user["tenant_id"], "type": inp.type, "name": inp.name,
        "company": inp.company or "", "phone": inp.phone or "", "email": inp.email or "",
        "address": inp.address or "", "tax_id": inp.tax_id or "", "tags": inp.tags or [],
        "status": status, "assigned_id": inp.assigned_id, "notes": inp.notes or "",
        "birthday": inp.birthday or "", "lifecycle_stage": stage,
        "created_by": user["id"], "created_at": now_iso(),
    }
    await db.contacts.insert_one(doc)
    await log_activity(user["tenant_id"], user["id"], "contact_added", f"Added {inp.type} '{inp.name}'", "contact", cid)
    doc.pop("_id", None)
    return (await enrich_contacts([doc]))[0]


@router.patch("/contacts/{contact_id}")
async def update_contact(contact_id: str, inp: ContactUpdateInput, user: dict = Depends(require_role("owner", "sales"))):
    c = await db.contacts.find_one({"id": contact_id, "tenant_id": user["tenant_id"]})
    if not c:
        raise HTTPException(status_code=404, detail="Not found")
    updates = {k: v for k, v in inp.model_dump().items() if v is not None}
    if "type" in updates and updates["type"] not in CONTACT_TYPES:
        updates.pop("type")
    if "status" in updates and updates["status"] not in CONTACT_STATUS:
        updates.pop("status")
    # E2-03: normalise + validate lifecycle_stage against the union.
    # Empty string is a legit value (means "unset" / no stage yet).
    if "lifecycle_stage" in updates:
        s = (updates["lifecycle_stage"] or "").strip().lower()
        updates["lifecycle_stage"] = s if s in LIFECYCLE_STAGES else ""
    # FIX-003-C (S2-09): denormalized-name cascade. `contact_name` is
    # copied at write time into invoices, payments, and workflows
    # (workflows.counterparty). Without a cascade, renaming a contact
    # only updates the contacts collection — every existing invoice /
    # payment / workflow keeps the old name in its display column,
    # search index, and any exported report. Cascade on the rename to
    # keep the reads consistent.
    old_name = (c.get("name") or "").strip()
    new_name = str(updates.get("name") or "").strip()
    name_changed = ("name" in updates and new_name and new_name != old_name)
    if updates:
        await db.contacts.update_one({"id": contact_id}, {"$set": updates})
    if name_changed:
        tid = user["tenant_id"]
        # Match by contact_id where present (recent rows) and by exact
        # old_name where contact_id is missing (legacy rows written
        # before contact_id backfill). Every update is tenant-scoped
        # so nothing crosses workspaces.
        cascade_query_by_id = {"tenant_id": tid, "contact_id": contact_id}
        cascade_query_by_name = {"tenant_id": tid, "contact_id": {"$in": [None, ""]},
                                  "contact_name": old_name} if old_name else None
        for coll_name, name_field in (
            ("invoices", "contact_name"),
            ("payments", "contact_name"),
        ):
            try:
                await db[coll_name].update_many(cascade_query_by_id,
                                                {"$set": {name_field: new_name}})
                if cascade_query_by_name:
                    await db[coll_name].update_many(cascade_query_by_name,
                                                    {"$set": {name_field: new_name}})
            except Exception:
                logger.exception(f"[FIX-003-C] contact_name cascade failed on {coll_name}")
        # workflows.counterparty is the denormalized display for the
        # linked contact. Same match strategy.
        try:
            await db.workflows.update_many(
                {"tenant_id": tid, "contact_id": contact_id},
                {"$set": {"counterparty": new_name}},
            )
            if old_name:
                await db.workflows.update_many(
                    {"tenant_id": tid, "contact_id": {"$in": [None, ""]},
                     "counterparty": old_name},
                    {"$set": {"counterparty": new_name}},
                )
        except Exception:
            logger.exception("[FIX-003-C] counterparty cascade failed on workflows")
    c = await db.contacts.find_one({"id": contact_id}, {"_id": 0})
    return (await enrich_contacts([c]))[0]


@router.delete("/contacts/{contact_id}")
async def delete_contact(contact_id: str, user: dict = Depends(require_role("owner", "sales"))):
    res = await db.contacts.delete_one({"id": contact_id, "tenant_id": user["tenant_id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"deleted": True}
