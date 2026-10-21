"""Requests — the rules (2026-10-21, docs/REQUESTS_PLAN.md).

An employee asks for something they need — material, a reimbursement, an
advance, travel, equipment, a repair, or anything else — in ONE request that
carries one or many items. They choose who says yes: their reporting manager
(the default) or the owner. Approval books an expense in Finance, and Finance
closes the request when it is paid or bought.

A request is not a task (work somebody must do) and not a decision (a
directive from above). It is a bottom-up ask that needs a yes and then
fulfilment, so it has its own record and its own short life:

    pending ── approve ──► approved ── fulfil / expense paid ──► fulfilled
       │ ▲
       │ └── respond ── info_requested ◄── request-info ──┘
       ├── reject (a reason is required) ──► rejected
       └── withdraw (the requester, before a decision) ──► cancelled

This module holds what the HTTP layer and Finance both need: the types, the
approver choice, who may read / decide / fulfil, the request number and the
hook that lets a paid expense close its request. The HTTP surface is
routers/staff_requests.py.
"""
from typing import Optional

from fastapi import HTTPException

from core import db, now_iso, user_perms, log_activity
from services.notifications import push_notification

COLLECTION = "requests"

# Each type names the expense category its approval books (snapped onto the
# company's own list by create_expense; unknown names fall to its keyword guess
# and then "Other"), and whether it must carry an amount. Equipment books
# "Asset Purchase", which is the one category create_expense also turns into a
# tracked asset — a laptop asked for and approved is a laptop on the register.
#
# `finance` — whether the request is about money at all. A GENERAL request is
# not (Yokesh, 2026-10-21): "can I take the van on Saturday", "a second
# monitor from the store room" — it needs a yes and nothing else. Its approval
# is the end of it: no expense is booked, Finance is not told and never lists
# it, and there is nothing to mark paid. It carries no amounts either; any
# typed in are dropped rather than left to suggest money is owed.
REQUEST_TYPES = {
    "purchase": {"label": "Purchase & materials", "expense_category": "Raw Material", "needs_amount": True, "stock": True, "finance": True},
    "reimbursement": {"label": "Expense reimbursement", "expense_category": "", "needs_amount": True, "stock": False, "finance": True},
    "advance": {"label": "Advance", "expense_category": "", "needs_amount": True, "stock": False, "finance": True},
    "travel": {"label": "Travel", "expense_category": "Logistics & Freight", "needs_amount": True, "stock": False, "finance": True},
    "equipment": {"label": "Equipment & assets", "expense_category": "Asset Purchase", "needs_amount": True, "stock": False, "finance": True},
    "repair": {"label": "Repairs & services", "expense_category": "Maintenance & Repairs", "needs_amount": True, "stock": False, "finance": True},
    "general": {"label": "General request", "expense_category": "", "needs_amount": False, "stock": False, "finance": False},
}
FINANCE_TYPES = tuple(k for k, v in REQUEST_TYPES.items() if v["finance"])


def goes_to_finance(kind: str) -> bool:
    """Approval books an expense and Finance pays it — every type but General."""
    return bool((REQUEST_TYPES.get(kind) or {}).get("finance"))

# A company's categories are its own words (AI-written at sign-up: "Raw
# Materials", "Machine Maintenance"), so the hint above is often not on its
# list. These are the words to look for in the company's own category names,
# in order, before create_expense falls back to its keyword guess and "Other".
# Kept narrow on purpose: staff travel is not freight, so Travel only takes a
# category that says travel.
CATEGORY_WORDS = {
    "purchase": ("raw material", "material", "purchase", "supplies", "stock"),
    "reimbursement": ("reimburse", "staff expense", "employee expense", "petty"),
    "advance": ("advance",),
    "travel": ("travel", "conveyance"),
    "equipment": ("asset purchase", "asset", "equipment"),
    "repair": ("repair", "maintenance", "servicing"),
    "general": (),
}

# Money paid to the employee themselves rather than to a supplier: the expense
# names them as the payee, so Finance knows who the cheque is for.
PAID_TO_REQUESTER = {"reimbursement", "advance", "travel"}

OPEN = ("pending", "info_requested")
DONE = ("approved", "fulfilled")
STATUSES = ("pending", "info_requested", "approved", "fulfilled", "rejected", "cancelled")

MAX_ITEMS = 50


def type_label(kind: str) -> str:
    return (REQUEST_TYPES.get(kind) or {}).get("label") or "Request"


def money_words(amount: float) -> str:
    """₹1,23,456 — Indian grouping for messages."""
    try:
        n = float(amount or 0)
    except (TypeError, ValueError):
        return "₹0"
    whole = int(round(n))
    s = str(abs(whole))
    if len(s) > 3:
        head, tail = s[:-3], s[-3:]
        parts = []
        while len(head) > 2:
            parts.insert(0, head[-2:])
            head = head[:-2]
        if head:
            parts.insert(0, head)
        s = ",".join(parts) + "," + tail
    return ("-" if whole < 0 else "") + "₹" + s


# ───────────────────────── what a request says ─────────────────────────
def clean_items(items, kind: Optional[str] = None) -> list:
    """Rows with a name, cleaned. Empty rows (an unused line in the form) are
    dropped rather than refused — the form always carries one spare. A request
    that is not about money (General) keeps its items and loses any amounts."""
    out = []
    for it in items or []:
        get = it.get if isinstance(it, dict) else (lambda k, d=None, _it=it: getattr(_it, k, d))
        name = str(get("name", "") or "").strip()[:200]
        if not name:
            continue
        try:
            amount = round(float(get("amount", 0) or 0), 2)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail=f"The amount for '{name}' isn't a number.")
        if amount < 0:
            raise HTTPException(status_code=400, detail=f"The amount for '{name}' can't be below zero.")
        qty = get("quantity", None)
        if qty in ("", None):
            qty = None
        else:
            try:
                qty = float(qty)
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail=f"The quantity for '{name}' isn't a number.")
            if qty < 0:
                raise HTTPException(status_code=400, detail=f"The quantity for '{name}' can't be below zero.")
            qty = int(qty) if qty == int(qty) else round(qty, 3)
        if kind is not None and not goes_to_finance(kind):
            amount = 0.0
        out.append({"name": name, "quantity": qty,
                    "unit": str(get("unit", "") or "").strip()[:20], "amount": amount})
    if len(out) > MAX_ITEMS:
        raise HTTPException(status_code=400, detail=f"A request can hold up to {MAX_ITEMS} items. Split it into two.")
    return out


def total_of(items: list) -> float:
    return round(sum(float(i.get("amount") or 0) for i in items or []), 2)


def default_title(items: list) -> str:
    if not items:
        return "Request"
    first = items[0]["name"]
    return first if len(items) == 1 else f"{first} and {len(items) - 1} more"


def validate_new(kind: str, items: list, needed_by: Optional[str]) -> None:
    if kind not in REQUEST_TYPES:
        raise HTTPException(status_code=400, detail="Choose what kind of request this is.")
    if not items:
        raise HTTPException(status_code=400, detail="Add at least one item — what do you need?")
    if REQUEST_TYPES[kind]["needs_amount"] and total_of(items) <= 0:
        raise HTTPException(status_code=400, detail="Add the amount for at least one item, so the approver knows what it costs.")
    if needed_by:
        from datetime import date
        try:
            date.fromisoformat(str(needed_by)[:10])
        except ValueError:
            raise HTTPException(status_code=400, detail="The 'needed by' date isn't a date.")


# ───────────────────────── who says yes ─────────────────────────
async def _live_person(tenant_id: str, user_id: Optional[str]) -> Optional[dict]:
    """A member of this company who can be asked: their row, and a live
    membership (a removed or not-yet-joined person is never an approver)."""
    if not user_id:
        return None
    from services.auth.membership import find_membership, LIVE_STATUSES
    p = await db.users.find_one({"id": user_id, "tenant_id": tenant_id}, {"_id": 0, "id": 1, "name": 1, "role": 1})
    if not p:
        return None
    if not await find_membership(db, user_id, tenant_id, statuses=LIVE_STATUSES):
        # Accounts from before memberships carry no row; only a row that exists
        # and is not live is a refusal.
        any_row = await find_membership(db, user_id, tenant_id)
        if any_row:
            return None
    return p


async def _an_owner(tenant_id: str, not_id: str) -> Optional[dict]:
    owners = await db.users.find({"tenant_id": tenant_id, "role": "owner", "id": {"$ne": not_id}},
                                 {"_id": 0, "id": 1, "name": 1, "role": 1}).sort("name", 1).to_list(10)
    for o in owners:
        if await _live_person(tenant_id, o["id"]):
            return o
    return None


async def approver_options(tenant_id: str, requester: dict) -> dict:
    """What the form offers: the requester's reporting manager (the default)
    and an owner. An owner's own request needs nobody's yes — it is recorded."""
    rid = requester["id"]
    if requester.get("role") == "owner":
        return {"self_owner": True, "manager": None, "owner": None, "default": "self"}
    manager = None
    mid = requester.get("reporting_manager_id")
    if not mid:
        row = await db.users.find_one({"id": rid, "tenant_id": tenant_id}, {"_id": 0, "reporting_manager_id": 1})
        mid = (row or {}).get("reporting_manager_id")
    if mid and mid != rid:
        manager = await _live_person(tenant_id, mid)
    owner = await _an_owner(tenant_id, rid)
    pick = lambda p: {"id": p["id"], "name": p.get("name") or "", "is_owner": p.get("role") == "owner"} if p else None  # noqa: E731
    return {"self_owner": False, "manager": pick(manager), "owner": pick(owner),
            "default": "manager" if manager else ("owner" if owner else "none")}


async def resolve_approver(tenant_id: str, requester: dict, choice: Optional[str]) -> tuple:
    """(approver_id, approver_name, approver_kind) for the choice made in the
    form. "manager" with no manager set falls to an owner — said in the
    request's history so nobody wonders why. (None, None, "self") means an
    owner raising their own request: it is recorded already approved."""
    opts = await approver_options(tenant_id, requester)
    if opts["self_owner"]:
        return None, None, "self"
    choice = choice if choice in ("manager", "owner") else "manager"
    if choice == "manager" and opts["manager"]:
        return opts["manager"]["id"], opts["manager"]["name"], "manager"
    if opts["owner"]:
        return opts["owner"]["id"], opts["owner"]["name"], "owner"
    if opts["manager"]:
        return opts["manager"]["id"], opts["manager"]["name"], "manager"
    raise HTTPException(status_code=409, detail="There is nobody in this company who can approve your request yet.")


# ───────────────────────── who may do what ─────────────────────────
def is_owner(user: dict) -> bool:
    return user.get("role") == "owner"


def can_fulfil(user: dict) -> bool:
    """Finance pays and buys; an owner can do anything Finance can."""
    return is_owner(user) or "finance" in user_perms(user)


def acts_for(user: dict, approver_id: Optional[str]) -> bool:
    """The named approver, or the person they handed their approvals to while
    away (RBAC-26 acting_as, resolved onto the user as `_acting_for`)."""
    return bool(approver_id) and (approver_id == user.get("id") or approver_id in (user.get("_acting_for") or []))


def may_read_request(user: dict, r: dict) -> bool:
    if not r or r.get("tenant_id") != user.get("tenant_id"):
        return False
    if is_owner(user) or r.get("requester_id") == user.get("id") or acts_for(user, r.get("approver_id")):
        return True
    # Finance sees what it has to pay — never a General request, which has nothing.
    return can_fulfil(user) and r.get("status") in DONE and goes_to_finance(r.get("type"))


def may_decide(user: dict, r: dict) -> bool:
    """Approve, reject or ask a question. Never on your own request."""
    if r.get("status") not in OPEN or r.get("requester_id") == user.get("id"):
        return False
    return is_owner(user) or acts_for(user, r.get("approver_id"))


def view_query(user: dict, view: str) -> dict:
    """The rows a list may show this person — narrowed here, never by the client."""
    tid, uid = user["tenant_id"], user["id"]
    q: dict = {"tenant_id": tid}
    if view == "approvals":
        q["status"] = {"$in": list(OPEN)}
        q["requester_id"] = {"$ne": uid}
        if not is_owner(user):
            q["approver_id"] = {"$in": [uid, *(user.get("_acting_for") or [])]}
    elif view == "fulfil":
        q["status"] = {"$in": list(DONE)}
        q["type"] = {"$in": list(FINANCE_TYPES)}
        if not can_fulfil(user):
            q["requester_id"] = uid
    elif view == "all" and is_owner(user):
        pass
    else:
        q["requester_id"] = uid
    return q


# ───────────────────────── numbering ─────────────────────────
async def next_number(tenant_id: str) -> str:
    """REQ-0001, REQ-0002 … per company. The counter lives on the tenant and is
    moved with a single atomic increment, so two requests raised in the same
    second can never share a number (the unique index is the backstop)."""
    from pymongo import ReturnDocument
    t = await db.tenants.find_one_and_update(
        {"id": tenant_id}, {"$inc": {"request_seq": 1}},
        projection={"_id": 0, "request_seq": 1}, return_document=ReturnDocument.AFTER)
    n = int((t or {}).get("request_seq") or 1)
    return f"REQ-{n:04d}"


# ───────────────────────── the expense it books ─────────────────────────
def pick_category(kind: str, categories) -> str:
    """The expense category for a request of this kind, in the company's own
    words: the type's hint when the company has it, else the first of its
    categories that names what the type is about, else the hint (which
    create_expense then snaps or guesses)."""
    hint = (REQUEST_TYPES.get(kind) or {}).get("expense_category") or ""
    cats = [c for c in (categories or []) if c]
    by_lower = {c.lower(): c for c in cats}
    if hint and hint.lower() in by_lower:
        return by_lower[hint.lower()]
    for word in CATEGORY_WORDS.get(kind, ()):
        for c in cats:
            if word in c.lower():
                return c
    return hint


def expense_data_for(r: dict, categories=None) -> dict:
    """What create_expense is given when a request is approved. The request
    number leads the title so the two can be matched at a glance, and
    `request_id` links them for good. `categories` is the company's expense
    list, so the category is one of its own."""
    from shared.due import today_ist
    kind = r.get("type") or "general"
    meta = REQUEST_TYPES.get(kind) or REQUEST_TYPES["general"]
    lines = "; ".join(
        f"{i['name']}" + (f" × {i['quantity']}{(' ' + i['unit']) if i.get('unit') else ''}" if i.get("quantity") else "")
        + (f" ({money_words(i['amount'])})" if i.get("amount") else "")
        for i in (r.get("items") or []))
    notes = (f"Request {r.get('number')} from {r.get('requester_name') or 'a team member'}, "
             f"approved by {r.get('decided_by_name') or r.get('approver_name') or 'the approver'}. "
             f"Items: {lines}." + (f" Reason: {r['reason']}" if r.get("reason") else ""))
    data = {
        "title": f"{r.get('number')} · {r.get('title') or type_label(kind)}"[:200],
        "amount": r.get("total") or 0,
        "category": pick_category(kind, categories) if categories is not None else meta["expense_category"],
        "vendor_name": (r.get("requester_name") or "") if kind in PAID_TO_REQUESTER else "",
        "status": "unpaid",
        "date": today_ist(),
        "notes": notes[:1500],
        "request_id": r["id"],
    }
    if kind == "equipment":
        data["asset_name"] = r.get("title") or default_title(r.get("items") or [])
        data["asset_notes"] = f"From request {r.get('number')}"
    return data


# ───────────────────────── Finance closes it ─────────────────────────
async def close_from_expense(tenant_id: str, expense: dict, actor: dict) -> bool:
    """An expense booked by a request was marked paid in Finance: the request is
    done. Only an APPROVED request moves (one already fulfilled, or withdrawn,
    is left alone), and only once — the status is the guard."""
    rid = (expense or {}).get("request_id")
    if not rid:
        return False
    now = now_iso()
    res = await db[COLLECTION].update_one(
        {"id": rid, "tenant_id": tenant_id, "status": "approved"},
        {"$set": {"status": "fulfilled", "fulfilled_at": now, "fulfilled_by": actor.get("id"),
                  "fulfilled_by_name": actor.get("name"), "updated_at": now},
         "$push": {"history": {"action": "fulfilled", "by": actor.get("id"), "by_name": actor.get("name"),
                               "note": "Marked paid in Finance", "at": now}}})
    if not getattr(res, "modified_count", 0):
        return False
    r = await db[COLLECTION].find_one({"id": rid, "tenant_id": tenant_id}, {"_id": 0})
    if r and r.get("requester_id") and r["requester_id"] != actor.get("id"):
        await push_notification(
            tenant_id, [r["requester_id"]], 1,
            f"Your request {r.get('number')} is done — {actor.get('name') or 'Finance'} marked it paid.",
            entity_type="request", entity_id=rid, ntype="status",
            title=r.get("title"), sender=actor.get("name"))
    await log_activity(tenant_id, actor.get("id"), "request_fulfilled",
                       f"Request {(r or {}).get('number')} fulfilled (expense paid)", "request", rid)
    return True
