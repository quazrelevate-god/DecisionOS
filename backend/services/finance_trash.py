"""Deleting Finance records, and taking a delete back (2026-10-22, client).

The pilot client imported a wrong file from Tally and could not take it out
again. Each record had to go one tap at a time, the tap deleted it on the spot,
and the delete that did exist got the books wrong as it went: a deleted payment
left its invoice marked received, a deleted invoice took a payment split
across two invoices with it, and a deleted expense left its supplier bill in
Bills to pay.

So every Finance delete goes through here, whichever door it comes in by —
one record, a selection, an import undone, or everything:

  plan_*()   work out what goes with what was asked for (a bill's expense, an
             expense's asset, a payment applied only to invoices that go) and
             what has to change on what stays (the balance of an invoice whose
             payment goes). Writes nothing; the confirmation shows it.
  remove()   copies those rows into finance_trash_rows under one batch, makes
             the changes, then deletes the rows from the books.
  restore()  puts a batch back, for KEEP_DAYS days. purge_expired() empties
             what is older.

ISSUED GST INVOICES ARE LEFT ALONE unless the owner asks for them by name
(include_issued). One raised and numbered in DecisionOS (kind "gst_invoice")
is a tax document already in the buyer's hands: the way to cancel it is a
credit note. Imported invoices are copies of another system's books and go
freely. A number DecisionOS issued is never issued again — it is kept in
retired_invoice_numbers after the invoice goes (routers/invoicing._next_number).
"""
import asyncio
import hashlib
import io
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

from core import db, logger, new_id, now_iso

TRASH = "finance_trash"
TRASH_ROWS = "finance_trash_rows"
RETIRED = "retired_invoice_numbers"
EXPORTS = "finance_exports"
KEEP_DAYS = 30
MAX_ITEMS = 1000                 # one selection; "everything" has its own door
EXPORT_LINK_MINUTES = 15
EXPORT_VALID_MINUTES = 60        # how long a downloaded copy unlocks Delete everything
_CHUNK = 500

# What a person can tick, and where it lives.
KINDS = {
    "invoice": ("invoices", {"type": "sales_invoice"}),
    "bill": ("invoices", {"type": "purchase_bill"}),
    "payment": ("payments", {}),
    "expense": ("expenses", {}),
    "asset": ("assets", {}),
    "inventory": ("inventory", {}),
}

# The rows a contact can be used by. An imported contact any of these still
# points at is kept when its import is undone.
_CONTACT_USERS = (
    ("invoices", "contact_id"), ("payments", "contact_id"), ("expenses", "vendor_id"),
    ("assets", "vendor_id"), ("inventory", "vendor_id"), ("tasks", "contact_id"),
    ("complaints", "contact_id"), ("workflows", "contact_id"), ("calendar_events", "contact_id"),
    ("crm_activities", "contact_id"),
)


def _num(x) -> float:
    try:
        return float(x or 0)
    except (TypeError, ValueError):
        return 0.0


def _r2(x) -> float:
    return round(float(x) + 0.0, 2)


def is_issued(inv: dict) -> bool:
    """A GST invoice raised and numbered in DecisionOS (routers/invoicing)."""
    return (inv or {}).get("type") == "sales_invoice" and (
        inv.get("kind") == "gst_invoice" or inv.get("source") == "invoice_builder")


def _apps(p: dict) -> list:
    """A payment's applications. One written before applications existed
    carries only invoice_id; it settled that invoice with all it had."""
    apps = [a for a in (p.get("applications") or []) if a.get("invoice_id")]
    if not apps and p.get("invoice_id"):
        apps = [{"invoice_id": p["invoice_id"], "amount": _num(p.get("applied") or p.get("amount"))}]
    return apps


def _match_status(amount, applied, was=None) -> str:
    if was == "standalone":
        return was
    if applied > 0.01 and applied + 0.01 >= _num(amount):
        return "matched"
    return "partial" if applied > 0.01 else "unmatched"


async def _find_in(coll: str, field: str, ids, extra: dict = None) -> list:
    """Rows whose `field` is one of `ids`, a chunk of ids at a time."""
    ids = [i for i in dict.fromkeys(ids) if i]
    out = []
    for n in range(0, len(ids), _CHUNK):
        q = {**(extra or {}), field: {"$in": ids[n:n + _CHUNK]}}
        out += await db[coll].find(q, {"_id": 0}).to_list(None)
    return out


def _plural(n: int, one: str, many: str = None) -> str:
    return f"{n} {one if n == 1 else (many or one + 's')}"


class Plan:
    """What a delete will do. Built by the plan_* functions; nothing written."""

    def __init__(self, tenant_id: str, include_issued: bool = False):
        self.tid = tenant_id
        self.include_issued = include_issued
        self.rows = {}           # (coll, id) -> the row, in the order found
        self.asked = set()       # the keys somebody actually picked
        self.kept_issued = {}    # issued GST invoices left alone
        self.unapply = {}        # payment id -> (payment, [applications taken off])
        self.paid_back = {}      # kept invoice id -> amount taken off what it shows paid
        self.changes = []        # {"coll", "id", "now", "was"} on rows that stay
        self.kept = {}           # reason -> count (an import's contacts used elsewhere, ...)
        self.missing = 0
        self.touching = None     # payment id -> payment applied to an invoice in the plan (set by _expand)

    def add(self, coll: str, doc: dict, asked: bool = False) -> bool:
        key = (coll, doc["id"])
        if asked:
            self.asked.add(key)
        if key in self.rows:
            return False
        self.rows[key] = doc
        return True

    def has(self, coll: str, rid: str) -> bool:
        return (coll, rid) in self.rows

    def ids(self, coll: str) -> list:
        return [rid for (c, rid) in self.rows if c == coll]

    def docs(self, coll: str) -> list:
        return [d for (c, _), d in self.rows.items() if c == coll]

    def add_invoice(self, inv: dict, asked: bool = False) -> bool:
        if is_issued(inv) and not self.include_issued:
            self.kept_issued[inv["id"]] = inv
            return False
        return self.add("invoices", inv, asked)


# ── what goes with what ──────────────────────────────────────────────────────
async def _expand(plan: Plan) -> None:
    """Close the set over what always goes together, until nothing new joins.

    2026-10-29 (founder: deleting a sales invoice must not take long) — each
    pass asks only about the rows that joined in the pass before, and asks
    all of it at once. It used to put every question again on every pass,
    one after another: 15 round trips to the database before the confirm
    dialog could say anything, 4-8 seconds on a hosted database. A payment
    left out in one pass is asked about again when another invoice it
    settled joins, so nothing is missed by not repeating the questions."""
    tid = plan.tid
    scope = {"tenant_id": tid}
    seen_inv, seen_exp, seen_pay = set(), set(), set()
    plan.touching = {}   # kept for _consequences, which needs the same answer
    while True:
        inv_new = [i for i in plan.ids("invoices") if i not in seen_inv]
        exp_new = [e for e in plan.docs("expenses") if e["id"] not in seen_exp]
        pay_new = [p for p in plan.ids("payments") if p not in seen_pay]
        if not (inv_new or exp_new or pay_new):
            break
        seen_inv.update(inv_new)
        seen_exp.update(e["id"] for e in exp_new)
        seen_pay.update(pay_new)
        bills_wanted = [e["invoice_id"] for e in exp_new
                        if e.get("invoice_id") and not plan.has("invoices", e["invoice_id"])]
        exps_by_bill, stock_by_bill, bills, assets, exps_by_pay, touching = await asyncio.gather(
            # A supplier bill's booking: the expense (or stock) written from it.
            _find_in("expenses", "invoice_id", inv_new, scope),
            _find_in("inventory", "invoice_id", inv_new, scope),
            # An expense booked from a bill takes the bill: they are one purchase,
            # and a bill left behind stays in Bills to pay with nothing booked.
            _find_in("invoices", "id", bills_wanted, {**scope, "type": "purchase_bill"}),
            # The asset an "Asset Purchase" expense made.
            _find_in("assets", "expense_id", [e["id"] for e in exp_new], scope),
            # The expense booked from a supplier payment marked standalone.
            _find_in("expenses", "payment_id", pay_new, scope),
            _payments_touching(tid, inv_new),
        )
        for e in exps_by_bill:
            plan.add("expenses", e)
        for i in stock_by_bill:
            plan.add("inventory", i)
        for b in bills:
            plan.add_invoice(b)
        for a in assets:
            plan.add("assets", a)
        for e in exps_by_pay:
            plan.add("expenses", e)
        # A payment applied only to invoices that go has nothing left to settle.
        gone = set(plan.ids("invoices"))
        for p in touching:
            plan.touching.setdefault(p["id"], p)
            if not plan.has("payments", p["id"]) and all(a["invoice_id"] in gone for a in _apps(p)):
                plan.add("payments", p)


async def _payments_touching(tid: str, invoice_ids) -> list:
    """Payments applied to any of these invoices, by either field, in one query."""
    ids = [i for i in dict.fromkeys(invoice_ids) if i]
    found = {}
    for n in range(0, len(ids), _CHUNK):
        chunk = ids[n:n + _CHUNK]
        q = {"tenant_id": tid, "$or": [{"applications.invoice_id": {"$in": chunk}}, {"invoice_id": {"$in": chunk}}]}
        for p in await db.payments.find(q, {"_id": 0}).to_list(None):
            found.setdefault(p["id"], p)
    return list(found.values())


async def _consequences(plan: Plan) -> None:
    """What changes on the rows that stay, and the Brain notes that go."""
    tid = plan.tid
    scope = {"tenant_id": tid}
    gone_inv = set(plan.ids("invoices"))
    # A payment that goes but settled an invoice that stays: that invoice is
    # owed again. (Worked out from the plan itself; no database question.)
    for p in plan.docs("payments"):
        for a in _apps(p):
            if a["invoice_id"] not in gone_inv:
                plan.paid_back[a["invoice_id"]] = _r2(plan.paid_back.get(a["invoice_id"], 0) + _num(a.get("amount")))
    exps = plan.docs("expenses")
    pay_ids = [e["payment_id"] for e in exps if e.get("payment_id") and not plan.has("payments", e["payment_id"])]
    # 2026-10-29 — every question below is independent of the others, so they
    # go together (one round trip, not nine); the answers are applied in the
    # same order as before, so the preview reads the same.
    async def touching_payments():
        # _expand already asked, invoice by invoice as each joined; the plan's
        # invoices don't change after it, so its answer is this one.
        if plan.touching is not None:
            return list(plan.touching.values())
        return await _payments_touching(tid, gone_inv)

    (touching, stock_used, kept_invoices, reqs, standalone,
     bc_inv, bc_exp, bc_pay, bc_related) = await asyncio.gather(
        touching_payments(),
        # Stock-used entries go with their stock item.
        _find_in("stock_movements", "inventory_id", plan.ids("inventory"), scope),
        _find_in("invoices", "id", list(plan.paid_back), scope),
        _find_in("requests", "expense_id", [e["id"] for e in exps], scope),
        _find_in("payments", "id", pay_ids, {**scope, "match_status": "standalone"}),
        # The Brain's notes about these records, so Dex stops quoting them.
        _find_in("brain_context", "source_id", plan.ids("invoices"), {**scope, "source_type": "invoice"}),
        _find_in("brain_context", "source_id", plan.ids("expenses"), {**scope, "source_type": "expense"}),
        _find_in("brain_context", "source_id", plan.ids("payments"), {**scope, "source_type": "payment"}),
        _find_in("brain_context", "related_ids.invoice_id", list(gone_inv), scope),
    )
    for m in stock_used:
        plan.add("stock_movements", m)
    # A payment that stays but settled an invoice that goes: that part comes off.
    for p in touching:
        if plan.has("payments", p["id"]):
            continue
        off = [a for a in _apps(p) if a["invoice_id"] in gone_inv]
        if off:
            plan.unapply[p["id"]] = (p, off)
    # A supplier bill that stays and is no longer paid in full: the expense
    # booked from it was marked paid with it, and is unpaid again.
    unpaid_again = [inv["id"] for inv in kept_invoices
                    if inv.get("type") == "purchase_bill" and inv.get("status") == "paid"
                    and _num(inv.get("amount_paid")) - plan.paid_back[inv["id"]] + 0.01 < _num(inv.get("amount"))]
    if unpaid_again:
        for e in await _find_in("expenses", "invoice_id", unpaid_again, {**scope, "status": "paid"}):
            if not plan.has("expenses", e["id"]):
                plan.changes.append({"coll": "expenses", "id": e["id"],
                                     "now": {"status": "unpaid"}, "was": {"status": "paid"}})
    # A staff request whose booked expense goes says so (as the old delete did).
    for r in reqs:
        plan.changes.append({"coll": "requests", "id": r["id"],
                             "now": {"expense_id": None,
                                     "expense_error": "The expense booked for this request was deleted in Finance."},
                             "was": {"expense_id": r.get("expense_id"), "expense_error": r.get("expense_error")}})
    # A supplier payment marked standalone whose expense goes is unexplained
    # again: back to "to match".
    for p in standalone:
        plan.changes.append({"coll": "payments", "id": p["id"],
                             "now": {"match_status": _match_status(p.get("amount"), _num(p.get("applied")))},
                             "was": {"match_status": "standalone"}})
    for b in bc_inv + bc_exp + bc_pay + bc_related:
        plan.add("brain_context", b)


# ── the three ways in ────────────────────────────────────────────────────────
async def plan_items(tenant_id: str, items: list, include_issued: bool = False) -> Plan:
    if not items:
        raise HTTPException(status_code=400, detail="Pick at least one record to delete.")
    if len(items) > MAX_ITEMS:
        raise HTTPException(status_code=400, detail=f"Pick up to {MAX_ITEMS} records at a time.")
    plan = Plan(tenant_id, include_issued)
    by_kind = {}
    for it in items:
        kind, rid = (it or {}).get("kind"), (it or {}).get("id")
        if kind not in KINDS or not rid:
            raise HTTPException(status_code=400, detail="That isn't a Finance record.")
        by_kind.setdefault(kind, []).append(rid)
    found = await asyncio.gather(*(
        _find_in(KINDS[kind][0], "id", ids, {"tenant_id": tenant_id, **KINDS[kind][1]}) for kind, ids in by_kind.items()))
    for (kind, ids), docs in zip(by_kind.items(), found):
        coll = KINDS[kind][0]
        plan.missing += len(set(ids)) - len(docs)
        for d in docs:
            if coll == "invoices":
                plan.add_invoice(d, asked=True)
            else:
                plan.add(coll, d, asked=True)
    await _expand(plan)
    await _consequences(plan)
    return plan


async def _legacy_window(tenant_id: str, ing: dict):
    """Stock and tasks filed before 2026-10-22 do not carry their import's id.
    They were written in the moments before the import was marked filed, so
    those moments find them — and never reach back past the import filed
    before this one."""
    end = ing.get("filed_at")
    if not end:
        return None
    start = (datetime.fromisoformat(end) - timedelta(minutes=10)).isoformat()
    prev = await db.ingestions.find({"tenant_id": tenant_id, "status": {"$in": ["filed", "undone"]},
                                     "filed_at": {"$lt": end}, "id": {"$ne": ing["id"]}},
                                    {"_id": 0, "filed_at": 1}).sort("filed_at", -1).limit(1).to_list(1)
    if prev and prev[0].get("filed_at", "") > start:
        start = prev[0]["filed_at"]
    return start, end


async def plan_import(tenant_id: str, ing: dict) -> Plan:
    plan = Plan(tenant_id, include_issued=False)
    iid = ing["id"]
    scope = {"tenant_id": tenant_id, "ingestion_id": iid}
    for coll in ("invoices", "payments", "expenses", "inventory"):
        for d in await db[coll].find(scope, {"_id": 0}).to_list(None):
            if coll == "invoices":
                plan.add_invoice(d, asked=True)
            else:
                plan.add(coll, d, asked=True)
    counts = ing.get("created_counts") or {}
    window = None
    if counts.get("inventory") and not plan.ids("inventory"):
        window = window or await _legacy_window(tenant_id, ing)
        if window:
            for d in await db.inventory.find({
                    "tenant_id": tenant_id, "source": ing.get("source"), "ingestion_id": {"$exists": False},
                    "notes": {"$regex": "^From bill"},
                    "created_at": {"$gte": window[0], "$lte": window[1]}}, {"_id": 0}).to_list(None):
                plan.add("inventory", d, asked=True)
    await _expand(plan)
    # Follow-up tasks the import made: the ones nobody has started go.
    tasks = await db.tasks.find(scope, {"_id": 0}).to_list(None)
    if counts.get("tasks") and not tasks:
        window = window or await _legacy_window(tenant_id, ing)
        if window:
            tasks = await db.tasks.find({
                "tenant_id": tenant_id, "source": "ingest", "ingestion_id": {"$exists": False},
                "created_at": {"$gte": window[0], "$lte": window[1]}}, {"_id": 0}).to_list(None)
    for t in tasks:
        if t.get("status") == "todo":
            plan.add("tasks", t, asked=True)
        else:
            plan.kept["started_tasks"] = plan.kept.get("started_tasks", 0) + 1
    await _consequences(plan)
    # Contacts it added, unless something that stays still uses them.
    for c in await db.contacts.find(scope, {"_id": 0}).to_list(None):
        if await _contact_in_use(plan, c["id"]):
            plan.kept["used_contacts"] = plan.kept.get("used_contacts", 0) + 1
        else:
            plan.add("contacts", c, asked=True)
    return plan


async def _contact_in_use(plan: Plan, contact_id: str) -> bool:
    for coll, field in _CONTACT_USERS:
        for r in await db[coll].find({"tenant_id": plan.tid, field: contact_id}, {"_id": 0, "id": 1}).to_list(200):
            if not plan.has(coll, r.get("id")):
                return True
    return False


async def plan_everything(tenant_id: str, include_issued: bool = False) -> Plan:
    plan = Plan(tenant_id, include_issued)
    scope = {"tenant_id": tenant_id}
    for inv in await db.invoices.find(scope, {"_id": 0}).to_list(None):
        plan.add_invoice(inv, asked=True)
    for coll in ("expenses", "assets", "inventory", "stock_movements"):
        for d in await db[coll].find(scope, {"_id": 0}).to_list(None):
            plan.add(coll, d, asked=True)
    kept = set(plan.kept_issued)
    for p in await db.payments.find(scope, {"_id": 0}).to_list(None):
        # A payment on an issued invoice that stays, stays with it.
        if not any(a["invoice_id"] in kept for a in _apps(p)):
            plan.add("payments", p, asked=True)
    await _expand(plan)
    await _consequences(plan)
    return plan


# ── what the confirmation says ───────────────────────────────────────────────
_NOUN = {
    "sales_invoice": ("sales invoice", "sales invoices"),
    "purchase_bill": ("supplier bill", "supplier bills"),
    "in": ("payment received", "payments received"),
    "out": ("payment made", "payments made"),
    "expenses": ("expense", "expenses"),
    "assets": ("asset", "assets"),
    "inventory": ("stock item", "stock items"),
    "stock_movements": ("stock-used entry", "stock-used entries"),
    "contacts": ("contact", "contacts"),
    "tasks": ("follow-up task", "follow-up tasks"),
}
_ORDER = list(_NOUN)


def _noun_key(coll: str, doc: dict) -> str:
    if coll == "invoices":
        return doc.get("type") if doc.get("type") in _NOUN else "sales_invoice"
    if coll == "payments":
        return "out" if doc.get("direction") == "out" else "in"
    return coll


def _parts(plan: Plan, asked: bool) -> list:
    n = {}
    for (coll, rid), doc in plan.rows.items():
        if coll == "brain_context" or ((coll, rid) in plan.asked) != asked:
            continue
        k = _noun_key(coll, doc)
        n[k] = n.get(k, 0) + 1
    return [{"key": k, "n": n[k], "label": _plural(n[k], *_NOUN[k])} for k in _ORDER if n.get(k)]


def counts(plan: Plan) -> dict:
    out = {}
    for (coll, _), doc in plan.rows.items():
        if coll != "brain_context":
            k = _noun_key(coll, doc)
            out[k] = out.get(k, 0) + 1
    return out


def label_for(plan: Plan) -> str:
    """What was asked for, in a few words: "expense Sai Logistics — Bill 51",
    "3 expenses", "12 records"."""
    asked = _parts(plan, True)
    if len(asked) == 1 and asked[0]["n"] == 1:
        key = next(k for k in plan.rows if k in plan.asked)
        doc = plan.rows[key]
        name = (f"#{doc['number']}" if doc.get("number") else "") or doc.get("title") or doc.get("name") \
            or doc.get("item") or doc.get("contact_name") or ""
        noun = _NOUN[_noun_key(key[0], doc)][0]
        return f"{noun} {name}".strip()[:160]
    if len(asked) == 1:
        return asked[0]["label"]
    return _plural(sum(p["n"] for p in asked), "record")


def done_text(plan: Plan, label: str, undo_import: bool = False) -> str:
    if undo_import:
        n = sum(counts(plan).values())
        return f"Undid {label} — {_plural(n, 'record')} taken out"
    also = [p["label"] for p in _parts(plan, False)]
    return f"Deleted {label}" + (f", and {', '.join(also)} with it" if also else "")


def summary(plan: Plan) -> dict:
    """The confirmation, in words."""
    effects = []
    if plan.unapply:
        effects.append(f"{_plural(len(plan.unapply), 'payment')} that also settled other records "
                       f"{'stays' if len(plan.unapply) == 1 else 'stay'}; the part for these goes back to Needs matching.")
    if plan.paid_back:
        effects.append(f"{_plural(len(plan.paid_back), 'invoice or bill', 'invoices or bills')} that "
                       f"{'stays' if len(plan.paid_back) == 1 else 'stay'} will show money due again, "
                       f"because a payment that settled {'it' if len(plan.paid_back) == 1 else 'them'} goes.")
    reqs = sum(1 for c in plan.changes if c["coll"] == "requests")
    if reqs:
        effects.append(f"{_plural(reqs, 'staff request')} booked to these will say {'its' if reqs == 1 else 'their'} "
                       f"expense was deleted.")
    standalone = sum(1 for c in plan.changes if c["coll"] == "payments")
    if standalone:
        effects.append(f"{_plural(standalone, 'supplier payment')} will go back to Supplier payments to match.")
    if plan.kept.get("used_contacts"):
        n = plan.kept["used_contacts"]
        effects.append(f"{_plural(n, 'contact')} it added {'is' if n == 1 else 'are'} kept — used elsewhere since.")
    if plan.kept.get("started_tasks"):
        n = plan.kept["started_tasks"]
        effects.append(f"{_plural(n, 'follow-up task')} already started {'is' if n == 1 else 'are'} kept.")
    kept = [{"id": i["id"], "number": i.get("number") or "", "contact_name": i.get("contact_name") or "",
             "amount": _num(i.get("amount")), "currency": i.get("currency") or ""}
            for i in plan.kept_issued.values()]
    return {
        "asked": _parts(plan, True),
        "also": _parts(plan, False),
        "counts": counts(plan),
        "total": sum(counts(plan).values()),
        "effects": effects,
        "kept_issued": kept,
        "missing": plan.missing,
        "restore_days": KEEP_DAYS,
    }


# ── doing it ─────────────────────────────────────────────────────────────────
async def _shift_paid(tid: str, invoice_id: str, delta: float) -> None:
    inv = await db.invoices.find_one({"id": invoice_id, "tenant_id": tid}, {"_id": 0})
    if not inv:
        return
    paid = max(0.0, _r2(_num(inv.get("amount_paid")) + delta))
    total = _num(inv.get("amount"))
    sets = {"amount_paid": paid}
    if inv.get("status") in (None, "", "paid", "partial", "unpaid"):
        sets["status"] = "paid" if total > 0 and paid + 0.01 >= total else ("partial" if paid > 0.01 else "unpaid")
    await db.invoices.update_one({"id": invoice_id, "tenant_id": tid}, {"$set": sets})


async def _set_applications(tid: str, pid: str, apps: list, delta: float) -> None:
    p = await db.payments.find_one({"id": pid, "tenant_id": tid}, {"_id": 0})
    if not p:
        return
    applied = max(0.0, _r2(_num(p.get("applied")) + delta))
    await db.payments.update_one({"id": pid, "tenant_id": tid}, {"$set": {
        "applications": apps, "applied": applied,
        "match_status": _match_status(p.get("amount"), applied, p.get("match_status")),
        "invoice_id": apps[0]["invoice_id"] if apps else None}})


async def remove(plan: Plan, user: dict, *, kind: str, label: str, ingestion_id: str = None) -> dict:
    tid = plan.tid
    if not any(c != "brain_context" for c, _ in plan.rows):
        if plan.kept_issued:
            raise HTTPException(status_code=409, detail=(
                "GST invoices issued from DecisionOS are kept. To cancel one, issue a credit note."))
        raise HTTPException(status_code=404, detail="Nothing to delete — it may already be gone.")
    now = datetime.now(timezone.utc)
    bid = new_id()
    batch = {
        "id": bid, "tenant_id": tid, "kind": kind, "label": label[:160], "status": "removing",
        "ingestion_id": ingestion_id, "counts": counts(plan), "summary": summary(plan)["asked"],
        "deleted_by": user["id"], "deleted_by_name": user.get("name") or "",
        "deleted_at": now.isoformat(), "restore_until": (now + timedelta(days=KEEP_DAYS)).isoformat(),
        "unapplied": [{"payment_id": pid, "apps": off} for pid, (_, off) in plan.unapply.items()],
        "paid_back": [{"invoice_id": iid, "amount": amt} for iid, amt in plan.paid_back.items()],
        "changes": plan.changes,
    }
    # 1. A copy of every row first, so nothing is lost whatever fails next.
    #    (2026-10-29: the batch and its rows are written together, and nothing
    #    below starts until both are in.)
    rows = [{"id": new_id(), "batch_id": bid, "tenant_id": tid, "coll": c, "row_id": rid, "doc": d}
            for (c, rid), d in plan.rows.items()]
    await asyncio.gather(
        db[TRASH].insert_one(dict(batch)),
        *(db[TRASH_ROWS].insert_many([dict(r) for r in rows[n:n + _CHUNK]]) for n in range(0, len(rows), _CHUNK)))

    # 2. What stays is put right, and 3. what goes comes out of the books. The
    #    two touch different rows (a row that stays is never one that goes), so
    #    they run together instead of one write after another.
    async def unapply(pid, off):
        p = await db.payments.find_one({"id": pid, "tenant_id": tid}, {"_id": 0})
        if p:
            gone = {a["invoice_id"] for a in off}
            left = [a for a in (p.get("applications") or []) if a.get("invoice_id") not in gone]
            await _set_applications(tid, pid, left, -sum(_num(a.get("amount")) for a in off))

    writes = [unapply(pid, off) for pid, (_, off) in plan.unapply.items()]
    writes += [_shift_paid(tid, iid, -amt) for iid, amt in plan.paid_back.items()]
    writes += [db[ch["coll"]].update_one({"id": ch["id"], "tenant_id": tid}, {"$set": ch["now"]}) for ch in plan.changes]
    writes += [db[RETIRED].update_one({"tenant_id": tid, "number": inv["number"]},
                                      {"$setOnInsert": {"tenant_id": tid, "number": inv["number"],
                                                        "invoice_id": inv["id"], "retired_at": now_iso()}},
                                      upsert=True)
               for inv in plan.docs("invoices") if is_issued(inv) and inv.get("number")]
    by_coll = {}
    for c, rid in plan.rows:
        by_coll.setdefault(c, []).append(rid)
    writes += [db[c].delete_many({"tenant_id": tid, "id": {"$in": ids[n:n + _CHUNK]}})
               for c, ids in by_coll.items() for n in range(0, len(ids), _CHUNK)]
    await asyncio.gather(*writes)

    finish = [db[TRASH].update_one({"id": bid}, {"$set": {"status": "removed"}}),
              _record(tid, user, "finance_deleted", f"{user.get('name') or 'Someone'} deleted {label}", bid,
                      {"kind": kind, "counts": batch["counts"]})]
    if ingestion_id:
        finish.append(db.ingestions.update_one({"id": ingestion_id, "tenant_id": tid}, {"$set": {
            "status": "undone", "undone_at": now_iso(), "undone_by": user["id"], "undo_batch_id": bid}}))
    await asyncio.gather(*finish)
    return {"batch_id": bid, "label": label, "counts": batch["counts"], "restore_until": batch["restore_until"]}


async def restore(tenant_id: str, batch_id: str, user: dict) -> dict:
    tid = tenant_id
    batch = await db[TRASH].find_one({"id": batch_id, "tenant_id": tid}, {"_id": 0})
    if not batch:
        raise HTTPException(status_code=404, detail="That delete isn't here any more.")
    if batch.get("status") == "restored":
        raise HTTPException(status_code=409, detail="That's already been put back.")
    if batch.get("status") != "removed" or batch.get("restore_until", "") < now_iso():
        raise HTTPException(status_code=410, detail=f"It's been more than {KEEP_DAYS} days, so it can't be put back.")
    rows = await db[TRASH_ROWS].find({"batch_id": batch_id, "tenant_id": tid}, {"_id": 0}).to_list(None)
    by_coll = {}
    for r in rows:
        by_coll.setdefault(r["coll"], []).append(r["doc"])
    for c, docs in by_coll.items():
        have = set()
        for n in range(0, len(docs), _CHUNK):
            have |= set(await db[c].distinct("id", {"tenant_id": tid, "id": {"$in": [d["id"] for d in docs[n:n + _CHUNK]]}}))
        fresh = [dict(d) for d in docs if d["id"] not in have]
        for n in range(0, len(fresh), _CHUNK):
            await db[c].insert_many(fresh[n:n + _CHUNK])
    for u in batch.get("unapplied") or []:
        p = await db.payments.find_one({"id": u["payment_id"], "tenant_id": tid}, {"_id": 0})
        if p:
            await _set_applications(tid, p["id"], list(p.get("applications") or []) + list(u["apps"]),
                                    sum(_num(a.get("amount")) for a in u["apps"]))
    for pb in batch.get("paid_back") or []:
        await _shift_paid(tid, pb["invoice_id"], pb["amount"])
    for ch in batch.get("changes") or []:
        # Only where it is still as the delete left it.
        await db[ch["coll"]].update_one({"id": ch["id"], "tenant_id": tid, **ch["now"]}, {"$set": ch["was"]})
    if batch.get("ingestion_id"):
        await db.ingestions.update_one({"id": batch["ingestion_id"], "tenant_id": tid},
                                       {"$set": {"status": "filed"},
                                        "$unset": {"undone_at": "", "undone_by": "", "undo_batch_id": ""}})
    await db[TRASH_ROWS].delete_many({"batch_id": batch_id, "tenant_id": tid})
    await db[TRASH].update_one({"id": batch_id}, {"$set": {
        "status": "restored", "restored_at": now_iso(), "restored_by": user["id"],
        "restored_by_name": user.get("name") or ""}})
    await _record(tid, user, "finance_restored", f"{user.get('name') or 'Someone'} put back {batch.get('label')}",
                  batch_id, {"counts": batch.get("counts")})
    return {"restored": True, "label": batch.get("label"), "counts": batch.get("counts")}


async def list_trash(tenant_id: str) -> list:
    await purge_expired(tenant_id)
    since = (datetime.now(timezone.utc) - timedelta(days=KEEP_DAYS)).isoformat()
    rows = await db[TRASH].find(
        {"tenant_id": tenant_id, "status": {"$in": ["removed", "restored"]}, "deleted_at": {"$gte": since}},
        {"_id": 0, "unapplied": 0, "paid_back": 0, "changes": 0}).sort("deleted_at", -1).to_list(100)
    return rows


async def purge_expired(tenant_id: str = None) -> int:
    """Empty deletes older than KEEP_DAYS. The batch row stays as a record."""
    q = {"status": "removed", "restore_until": {"$lt": now_iso()}}
    if tenant_id:
        q["tenant_id"] = tenant_id
    n = 0
    for b in await db[TRASH].find(q, {"_id": 0, "id": 1, "tenant_id": 1}).to_list(500):
        await db[TRASH_ROWS].delete_many({"batch_id": b["id"], "tenant_id": b["tenant_id"]})
        await db[TRASH].update_one({"id": b["id"]}, {"$set": {"status": "purged", "purged_at": now_iso()},
                                                     "$unset": {"unapplied": "", "paid_back": "", "changes": ""}})
        n += 1
    return n


async def numbers_in_use(tenant_id: str, on=None) -> list:
    """Sales-invoice numbers that must not be issued again: retired ones, and
    the ones in a delete that can still be put back. `on` is the caller's
    database (routers/invoicing passes its own)."""
    on = db if on is None else on
    retired = await on[RETIRED].distinct("number", {"tenant_id": tenant_id})
    held = await on[TRASH_ROWS].distinct("doc.number", {"tenant_id": tenant_id, "coll": "invoices",
                                                        "doc.type": "sales_invoice"})
    return [n for n in {*retired, *held} if n]


async def deleted_number(tenant_id: str, number: str, on=None) -> str:
    """"retired" for a number DecisionOS issued and that was deleted,
    "deleted" for one in a delete that can still be put back, else ""."""
    on = db if on is None else on
    if await on[RETIRED].find_one({"tenant_id": tenant_id, "number": number}, {"_id": 1}):
        return "retired"
    if await on[TRASH_ROWS].find_one({"tenant_id": tenant_id, "coll": "invoices", "doc.type": "sales_invoice",
                                      "doc.number": number}, {"_id": 1}):
        return "deleted"
    return ""


async def _record(tid: str, user: dict, action: str, text: str, batch_id: str, meta: dict) -> None:
    # core.log_activity's row, written through this module's own db so that a
    # test's database catches it rather than whatever core is bound to. The
    # activity row and the audit row go together (2026-10-29).
    async def activity():
        try:
            await db.activity.insert_one({
                "id": new_id(), "tenant_id": tid, "actor": user["id"], "kind": action, "message": text,
                "entity_type": "finance_trash", "entity_id": batch_id, "created_at": now_iso()})
        except Exception as e:  # noqa: BLE001
            logger.warning(f"finance_trash activity log failed: {e}")

    async def audit():
        try:
            from services import audit_log
            await audit_log.record(db, action=action, actor_id=user["id"], actor_email=user.get("email"),
                                   tenant_id=tid, entity_type="finance_trash", entity_id=batch_id, meta=meta)
        except Exception as e:  # noqa: BLE001
            logger.warning(f"finance_trash audit failed: {e}")

    await asyncio.gather(activity(), audit())


# ── a copy of the books, before everything goes ──────────────────────────────
def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def new_export_link(tenant_id: str, user: dict) -> dict:
    """A one-time link to the books as a spreadsheet. Fetching it is what
    proves a copy was taken (export_was_downloaded); the app saves it through
    the share sheet (frontend lib/native/files)."""
    token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    eid = new_id()
    await db[EXPORTS].insert_one({
        "id": eid, "tenant_id": tenant_id, "user_id": user["id"], "token_hash": _hash(token),
        "created_at": now.isoformat(), "expires_at": (now + timedelta(minutes=EXPORT_LINK_MINUTES)).isoformat(),
        "downloaded_at": None})
    return {"export_id": eid, "path": f"/api/finance/export/{token}",
            "expires_at": (now + timedelta(minutes=EXPORT_LINK_MINUTES)).isoformat()}


async def take_export(token: str) -> dict:
    ex = await db[EXPORTS].find_one({"token_hash": _hash(token or "")}, {"_id": 0})
    if not ex or ex.get("expires_at", "") < now_iso():
        raise HTTPException(status_code=404, detail="This download link has expired. Make a new one in Finance.")
    await db[EXPORTS].update_one({"id": ex["id"]}, {"$set": {"downloaded_at": now_iso()}})
    return ex


async def export_was_downloaded(tenant_id: str, export_id: str, user: dict) -> bool:
    ex = await db[EXPORTS].find_one({"id": export_id or "", "tenant_id": tenant_id, "user_id": user["id"]}, {"_id": 0})
    if not ex or not ex.get("downloaded_at"):
        return False
    since = (datetime.now(timezone.utc) - timedelta(minutes=EXPORT_VALID_MINUTES)).isoformat()
    return ex["downloaded_at"] >= since


_SHEETS = (
    ("Sales invoices", "invoices", {"type": "sales_invoice"},
     ["number", "date", "due_date", "contact_name", "title", "amount", "amount_paid", "status", "currency", "source"]),
    ("Supplier bills", "invoices", {"type": "purchase_bill"},
     ["number", "date", "due_date", "contact_name", "amount", "amount_paid", "status", "purchase_type", "currency", "source"]),
    ("Payments received", "payments", {"direction": "in"},
     ["date", "contact_name", "amount", "applied", "method", "reference", "invoice_number", "match_status", "currency", "source"]),
    ("Payments made", "payments", {"direction": "out"},
     ["date", "contact_name", "amount", "applied", "method", "reference", "invoice_number", "match_status", "currency", "source"]),
    ("Expenses", "expenses", {},
     ["date", "title", "vendor_name", "category", "amount", "status", "approval_status", "currency", "notes", "source"]),
    ("Assets", "assets", {},
     ["purchase_date", "name", "category", "vendor_name", "purchase_amount", "status", "currency", "notes", "source"]),
    ("Stock", "inventory", {},
     ["item", "sku", "quantity", "unit", "unit_cost", "value", "category", "vendor_name", "currency", "notes", "source"]),
    ("Stock used", "stock_movements", {},
     ["date", "item", "quantity", "unit", "unit_cost", "value", "note"]),
)


async def export_workbook(tenant_id: str) -> bytes:
    import pandas as pd
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as xw:
        for title, coll, extra, cols in _SHEETS:
            rows = await db[coll].find({"tenant_id": tenant_id, **extra}, {"_id": 0}).to_list(None)
            df = pd.DataFrame([{c: r.get(c) for c in cols} for r in rows], columns=cols)
            df.to_excel(xw, sheet_name=title, index=False)
    return buf.getvalue()
