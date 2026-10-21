"""Requests — the HTTP surface (2026-10-21, docs/REQUESTS_PLAN.md).

Raise a request with one or many items, send it to your reporting manager (the
default) or the owner, and on approval it is booked as an expense in Finance.
The rules — types, approver choice, who may read / decide / fulfil — live in
services/staff_requests.py; this file is the doors and the side effects.

Every state change is an ATOMIC CLAIM: the update names the status it expects
to move from, so two people pressing Approve at the same moment produce one
approval and one expense, and a request withdrawn while its approver was
reading it cannot then be approved.
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from core import db, get_current_user, log_activity, new_id, now_iso, logger
from models.staff_requests import (
    RequestCreateInput,
    RequestFulfilInput,
    RequestNoteInput,
)
from services.notifications import push_notification
from services.staff_requests import (
    COLLECTION,
    DONE,
    OPEN,
    REQUEST_TYPES,
    approver_options,
    can_fulfil,
    goes_to_finance,
    clean_items,
    default_title,
    expense_data_for,
    is_owner,
    may_decide,
    may_read_request,
    money_words,
    next_number,
    resolve_approver,
    total_of,
    type_label,
    validate_new,
    view_query,
)

router = APIRouter(prefix="/api")

MAX_ATTACHMENTS = 10


def _shape(r: dict, user: dict) -> dict:
    """The request as a screen needs it: the record, its type's words, and what
    THIS person may do with it — so no screen re-derives a rule the server holds."""
    uid = user["id"]
    mine = r.get("requester_id") == uid
    status = r.get("status")
    return {
        **r,
        "type_label": type_label(r.get("type")),
        "can": {
            "decide": may_decide(user, r),
            "respond": mine and status == "info_requested",
            "withdraw": mine and status in OPEN,
            "fulfil": can_fulfil(user) and status == "approved" and goes_to_finance(r.get("type")),
        },
    }


async def _load(request_id: str, user: dict) -> dict:
    """A request this person may see. Anyone else gets "not found", the same as
    an id that does not exist, so a request's existence never leaks."""
    r = await db[COLLECTION].find_one({"id": request_id, "tenant_id": user["tenant_id"]}, {"_id": 0})
    if not r or not may_read_request(user, r):
        raise HTTPException(status_code=404, detail="Request not found")
    return r


async def _reload(r: dict) -> dict:
    return await db[COLLECTION].find_one({"id": r["id"], "tenant_id": r["tenant_id"]}, {"_id": 0})


def _entry(action: str, user: dict, note: str = "") -> dict:
    return {"action": action, "by": user["id"], "by_name": user.get("name"), "note": note or "", "at": now_iso()}


def _note(inp: Optional[RequestNoteInput], limit: int = 1000) -> str:
    return ((inp.note if inp else "") or "").strip()[:limit]


async def _own_files(tenant_id: str, user: dict, ids) -> list:
    """The attachments named in the form: files this person uploaded to this
    company. Anything else is ignored rather than attached — a request cannot
    adopt somebody else's file by naming its id."""
    ids = [str(i) for i in (ids or []) if i][:MAX_ATTACHMENTS]
    if not ids:
        return []
    rows = await db.files.find({"id": {"$in": ids}, "tenant_id": tenant_id, "is_deleted": False,
                                "uploaded_by": user["id"]}, {"_id": 0}).to_list(MAX_ATTACHMENTS)
    return [{"id": f["id"], "filename": f.get("original_filename") or "file",
             "content_type": f.get("content_type") or "", "size": f.get("size")} for f in rows]


async def _fulfiller_ids(tenant_id: str) -> list:
    """Who pays and buys: owners, and everyone whose access includes Finance —
    by what they can really open (role settings, membership, grants)."""
    from services.auth.membership import members_effective_perms
    people = await db.users.find({"tenant_id": tenant_id},
                                 {"_id": 0, "id": 1, "role": 1, "permissions": 1, "permissions_custom": 1}).to_list(500)
    perms = await members_effective_perms(db, tenant_id, people)
    return [p["id"] for p in people if p.get("role") == "owner" or "finance" in perms.get(p["id"], set())]


async def _book_expense(r: dict, actor: dict) -> Optional[dict]:
    """Approval books the money. A failure here must not undo the approval —
    the request stays approved and says the expense still has to be added, so
    Finance can add it by hand rather than the yes being lost."""
    from routers.ledger import create_expense
    from services.finance_words import get_finance_categories
    try:
        cats = (await get_finance_categories(r["tenant_id"]))["expense"]
        exp = await create_expense(r["tenant_id"], actor["id"], expense_data_for(r, cats), source="request", write_brain=False)
    except Exception as e:  # noqa: BLE001 — logged, said on the request, never raised
        logger.warning(f"[requests] expense booking failed for {r.get('number')}: {e}")
        await db[COLLECTION].update_one({"id": r["id"], "tenant_id": r["tenant_id"]},
                                        {"$set": {"expense_error": "The expense could not be booked automatically. Add it in Finance."}})
        return None
    await db[COLLECTION].update_one(
        {"id": r["id"], "tenant_id": r["tenant_id"]},
        {"$set": {"expense_id": exp["id"], "expense_category": exp.get("category"), "expense_error": None}})
    return exp


async def _tell_finance(r: dict, actor: dict) -> None:
    ids = [i for i in await _fulfiller_ids(r["tenant_id"]) if i not in (actor["id"], r.get("requester_id"))]
    if not ids:
        return
    await push_notification(
        r["tenant_id"], ids, 2,
        f"{r.get('requester_name')}'s request {r.get('number')} — {r.get('title')} ({money_words(r.get('total'))}) "
        f"was approved by {actor.get('name')}. It's in Finance as an expense to pay.",
        entity_type="request", entity_id=r["id"], ntype="assigned",
        title=r.get("title"), sender=actor.get("name"))


# ───────────────────────── reads ─────────────────────────
@router.get("/requests/approver-options")
async def request_approver_options(user: dict = Depends(get_current_user)):
    """Who the form offers to send this person's request to (their own manager
    and an owner) — about the caller only."""
    return {**await approver_options(user["tenant_id"], user),
            "types": [{"key": k, "label": v["label"], "needs_amount": v["needs_amount"], "stock": v["stock"], "finance": v["finance"]}
                      for k, v in REQUEST_TYPES.items()]}


@router.get("/requests")
async def list_requests(view: str = "mine", user: dict = Depends(get_current_user)):
    """mine · approvals (waiting on me) · fulfil (Finance: approved and done) ·
    all (the owner). The rows are narrowed by services.staff_requests.view_query."""
    rows = await db[COLLECTION].find(view_query(user, view), {"_id": 0}).sort("created_at", -1).to_list(500)
    return [_shape(r, user) for r in rows]


@router.get("/requests/{request_id}")
async def get_request(request_id: str, user: dict = Depends(get_current_user)):
    return _shape(await _load(request_id, user), user)


# ───────────────────────── raise ─────────────────────────
@router.post("/requests")
async def create_request(inp: RequestCreateInput, user: dict = Depends(get_current_user)):
    tid = user["tenant_id"]
    items = clean_items(inp.items, inp.type)
    validate_new(inp.type, items, inp.needed_by)
    attachments = await _own_files(tid, user, inp.attachment_ids)
    approver_id, approver_name, kind = await resolve_approver(tid, user, inp.approver_choice)
    now = now_iso()
    rid = new_id()
    title = (inp.title or "").strip()[:160] or default_title(items)
    history = [_entry("submitted", user, (inp.reason or "").strip()[:2000])]
    if kind == "owner" and (inp.approver_choice or "manager") == "manager":
        history.append({**_entry("routed", user), "by_name": "DecisionOS",
                        "note": "No reporting manager is set, so it went to the owner."})
    self_owner = kind == "self"
    if self_owner:
        history.append({**_entry("approved", user),
                        "note": "Recorded — an owner's own request needs nobody else's approval."})
    money = goes_to_finance(inp.type)
    doc = {
        "id": rid, "tenant_id": tid, "number": await next_number(tid),
        "type": inp.type, "title": title, "items": items, "total": total_of(items),
        "needed_by": (inp.needed_by or "")[:10] or None,
        "reason": (inp.reason or "").strip()[:2000],
        "attachments": attachments, "attachment_ids": [a["id"] for a in attachments],
        "requester_id": user["id"], "requester_name": user.get("name"), "requester_role": user.get("role"),
        "approver_id": approver_id, "approver_name": approver_name,
        "approver_kind": "owner" if self_owner else kind,
        "status": "approved" if self_owner else "pending",
        "info_note": None, "reply_note": None,
        "decided_at": now if self_owner else None,
        "decided_by": user["id"] if self_owner else None,
        "decided_by_name": user.get("name") if self_owner else None,
        "decision_note": None,
        "expense_id": None, "expense_error": None,
        "fulfilled_at": None, "fulfilled_by": None, "fulfilled_by_name": None, "fulfil_note": None,
        "stock_item_ids": [],
        "created_at": now, "updated_at": now,
        "history": history,
    }
    await db[COLLECTION].insert_one(dict(doc))
    label = type_label(inp.type)
    if self_owner:
        if money:
            await _book_expense(doc, user)
            await _tell_finance(doc, user)
        await log_activity(tid, user["id"], "request_recorded",
                           f"{user.get('name')} recorded request {doc['number']} — {title}", "request", rid)
    else:
        await push_notification(
            tid, [approver_id], 2,
            f"{user.get('name')} asks: {title} — " + (f"{money_words(doc['total'])} ({label})." if money else f"{label}."),
            entity_type="request", entity_id=rid, ntype="approval", title=title, sender=user.get("name"))
        await log_activity(tid, user["id"], "request_raised",
                           f"{user.get('name')} raised request {doc['number']} — {title}", "request", rid)
    return _shape(await _reload(doc), user)


# ───────────────────────── decide ─────────────────────────
def _refuse_decide(user: dict, r: dict) -> None:
    if r.get("requester_id") == user["id"]:
        raise HTTPException(status_code=403, detail="You can't decide your own request.")
    if r.get("status") not in OPEN:
        raise HTTPException(status_code=409, detail="This request has already been decided.")
    raise HTTPException(status_code=403,
                        detail=f"Only {r.get('approver_name') or 'the approver'} or an owner can decide this request.")


async def _claim(r: dict, frm, sets: dict, entry: dict) -> bool:
    res = await db[COLLECTION].update_one(
        {"id": r["id"], "tenant_id": r["tenant_id"], "status": {"$in": list(frm)}},
        {"$set": {**sets, "updated_at": now_iso()}, "$push": {"history": entry}})
    return bool(getattr(res, "modified_count", 0))


@router.post("/requests/{request_id}/approve")
async def approve_request(request_id: str, inp: RequestNoteInput, user: dict = Depends(get_current_user)):
    r = await _load(request_id, user)
    if not may_decide(user, r):
        _refuse_decide(user, r)
    note = _note(inp)
    now = now_iso()
    if not await _claim(r, OPEN, {"status": "approved", "decided_at": now, "decided_by": user["id"],
                                  "decided_by_name": user.get("name"), "decision_note": note or None},
                        _entry("approved", user, note)):
        raise HTTPException(status_code=409, detail="This request has already been decided.")
    r = await _reload(r)
    # A General request ends here: approved is done, nothing goes to Finance.
    money = goes_to_finance(r.get("type"))
    if money:
        await _book_expense(r, user)
    await push_notification(
        r["tenant_id"], [r["requester_id"]], 2,
        (f"{user.get('name')} approved your request {r['number']} ({money_words(r['total'])})." if money
         else f"{user.get('name')} approved your request {r['number']} — {r.get('title')}.")
        + (f" “{note}”" if note else "") + (" Finance takes it from here." if money else ""),
        entity_type="request", entity_id=r["id"], ntype="approved", title=r.get("title"), sender=user.get("name"))
    if money:
        await _tell_finance(r, user)
    await log_activity(r["tenant_id"], user["id"], "request_approved",
                       f"{user.get('name')} approved request {r['number']} — {r.get('title')}", "request", r["id"])
    return _shape(await _reload(r), user)


@router.post("/requests/{request_id}/reject")
async def reject_request(request_id: str, inp: RequestNoteInput, user: dict = Depends(get_current_user)):
    r = await _load(request_id, user)
    if not may_decide(user, r):
        _refuse_decide(user, r)
    note = _note(inp)
    if not note:
        raise HTTPException(status_code=400, detail="Say why — it helps them raise a better request.")
    now = now_iso()
    if not await _claim(r, OPEN, {"status": "rejected", "decided_at": now, "decided_by": user["id"],
                                  "decided_by_name": user.get("name"), "decision_note": note},
                        _entry("rejected", user, note)):
        raise HTTPException(status_code=409, detail="This request has already been decided.")
    await push_notification(
        r["tenant_id"], [r["requester_id"]], 2,
        f"{user.get('name')} turned down your request {r['number']}: {note}",
        entity_type="request", entity_id=r["id"], ntype="request_rejected", title=r.get("title"), sender=user.get("name"))
    await log_activity(r["tenant_id"], user["id"], "request_rejected",
                       f"{user.get('name')} rejected request {r['number']}", "request", r["id"])
    return _shape(await _reload(r), user)


@router.post("/requests/{request_id}/request-info")
async def ask_about_request(request_id: str, inp: RequestNoteInput, user: dict = Depends(get_current_user)):
    r = await _load(request_id, user)
    if not may_decide(user, r):
        _refuse_decide(user, r)
    note = _note(inp)
    if not note:
        raise HTTPException(status_code=400, detail="Write your question first.")
    if not await _claim(r, ("pending",), {"status": "info_requested", "info_note": note,
                                          "info_by": user["id"], "info_by_name": user.get("name")},
                        _entry("info_requested", user, note)):
        raise HTTPException(status_code=409, detail="You've already asked — the request is waiting on their answer.")
    await push_notification(
        r["tenant_id"], [r["requester_id"]], 2,
        f"{user.get('name')} has a question about your request {r['number']}: {note}",
        entity_type="request", entity_id=r["id"], ntype="clarification", title=r.get("title"), sender=user.get("name"))
    await log_activity(r["tenant_id"], user["id"], "request_info_requested",
                       f"{user.get('name')} asked about request {r['number']}", "request", r["id"])
    return _shape(await _reload(r), user)


# ───────────────────────── the requester's side ─────────────────────────
def _own(r: dict, user: dict) -> None:
    if r.get("requester_id") != user["id"]:
        raise HTTPException(status_code=403, detail="Only the person who raised this request can do that.")


@router.post("/requests/{request_id}/respond")
async def respond_to_request_question(request_id: str, inp: RequestNoteInput, user: dict = Depends(get_current_user)):
    r = await _load(request_id, user)
    _own(r, user)
    reply = _note(inp)
    if not reply:
        raise HTTPException(status_code=400, detail="Write your answer first.")
    if not await _claim(r, ("info_requested",), {"status": "pending", "reply_note": reply, "replied_at": now_iso()},
                        _entry("replied", user, reply)):
        raise HTTPException(status_code=409, detail="This request isn't waiting on an answer from you.")
    if r.get("approver_id"):
        await push_notification(
            r["tenant_id"], [r["approver_id"]], 2,
            f"{user.get('name')} answered your question on request {r['number']}: {reply[:160]}",
            entity_type="request", entity_id=r["id"], ntype="approval", title=r.get("title"), sender=user.get("name"))
    await log_activity(r["tenant_id"], user["id"], "request_replied",
                       f"{user.get('name')} answered a question on request {r['number']}", "request", r["id"])
    return _shape(await _reload(r), user)


@router.post("/requests/{request_id}/withdraw")
async def withdraw_request(request_id: str, inp: RequestNoteInput, user: dict = Depends(get_current_user)):
    r = await _load(request_id, user)
    _own(r, user)
    note = _note(inp, 500)
    if not await _claim(r, OPEN, {"status": "cancelled", "withdrawn_at": now_iso(), "withdrawn_note": note or None},
                        _entry("withdrawn", user, note)):
        detail = ("This request is already closed." if r.get("status") not in DONE
                  else "It's already approved — ask Finance or your approver to stop it." if goes_to_finance(r.get("type"))
                  else "It's already approved — ask your approver if it should be undone.")
        raise HTTPException(status_code=409, detail=detail)
    if r.get("approver_id"):
        await push_notification(
            r["tenant_id"], [r["approver_id"]], 1,
            f"{user.get('name')} withdrew request {r['number']} — {r.get('title')}" + (f": {note}" if note else ""),
            entity_type="request", entity_id=r["id"], ntype="request_withdrawn", title=r.get("title"),
            sender=user.get("name"))
    await log_activity(r["tenant_id"], user["id"], "request_withdrawn",
                       f"{user.get('name')} withdrew request {r['number']}", "request", r["id"])
    return _shape(await _reload(r), user)


# ───────────────────────── Finance ─────────────────────────
@router.post("/requests/{request_id}/fulfil")
async def fulfil_request(request_id: str, inp: RequestFulfilInput, user: dict = Depends(get_current_user)):
    """Paid or bought: the request is done. By default the expense it booked is
    marked paid; a purchase can also put its items into stock."""
    r = await _load(request_id, user)
    if not can_fulfil(user):
        raise HTTPException(status_code=403, detail="Only Finance or an owner can mark a request done.")
    if not goes_to_finance(r.get("type")):
        raise HTTPException(status_code=409, detail="A general request has nothing to pay — its approval closed it.")
    note = ((inp.note or "") if inp else "").strip()[:1000]
    now = now_iso()
    if not await _claim(r, ("approved",), {"status": "fulfilled", "fulfilled_at": now, "fulfilled_by": user["id"],
                                           "fulfilled_by_name": user.get("name"), "fulfil_note": note or None},
                        _entry("fulfilled", user, note)):
        raise HTTPException(status_code=409, detail="Only an approved request can be marked done.")
    tid = r["tenant_id"]
    if (inp.mark_paid if inp else True) and r.get("expense_id"):
        await db.expenses.update_one(
            {"id": r["expense_id"], "tenant_id": tid, "status": {"$in": ["unpaid", "awaiting_bill"]}},
            {"$set": {"status": "paid", "paid_at": now, "updated_at": now}})
    stock_ids = []
    if inp and inp.add_to_stock and (REQUEST_TYPES.get(r.get("type")) or {}).get("stock"):
        from routers.ledger import create_inventory
        for it in r.get("items") or []:
            qty = it.get("quantity")
            if not qty:
                continue
            unit_cost = round(float(it.get("amount") or 0) / float(qty), 2) if qty else 0
            row = await create_inventory(tid, user["id"], {
                "item": it["name"], "quantity": qty, "unit": it.get("unit") or "unit", "unit_cost": unit_cost,
                "notes": f"From request {r['number']}",
            }, source="request")
            stock_ids.append(row["id"])
        if stock_ids:
            await db[COLLECTION].update_one({"id": r["id"], "tenant_id": tid}, {"$set": {"stock_item_ids": stock_ids}})
    if r.get("requester_id") and r["requester_id"] != user["id"]:
        await push_notification(
            tid, [r["requester_id"]], 1,
            f"Your request {r['number']} is done — {user.get('name')} marked it paid."
            + (f" “{note}”" if note else ""),
            entity_type="request", entity_id=r["id"], ntype="status", title=r.get("title"), sender=user.get("name"))
    await log_activity(tid, user["id"], "request_fulfilled",
                       f"{user.get('name')} marked request {r['number']} done"
                       + (f", {len(stock_ids)} item(s) into stock" if stock_ids else ""), "request", r["id"])
    return _shape(await _reload(r), user)


__all__ = ["router", "is_owner"]
