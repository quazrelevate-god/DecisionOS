"""Invoices, payments against them, and stock used (product audit 2026-10-08).

  F-02  POST /invoices/{id}/payments   record money received on a sales invoice,
                                       or paid on a purchase bill — full or part
  F-03  POST /invoices/gst             a GST / export invoice with line items
        GET  /invoices/next-number     the next number in the company's series
        GET  /invoices/{id}/pdf        the invoice as a PDF to send
  F-04  POST /inventory/{id}/use       stock taken out to make or fulfil an
                                       order — its cost reaches profit
        GET  /stock-used               what was used, for the profit figure

Before this, an owner who got a bank transfer could not record it (payments
came only from WhatsApp or an uploaded receipt), no screen produced the
invoice a buyer is owed, and stock never reached profit because nothing
recorded it being used. The payment path reuses the ledger's own
compare-and-set allocation (routers.ledger._apply_payment_to_invoice), so a
manual payment and a reconciled one can never double-pay the same invoice.
"""
import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response

from core import db, log_activity, new_id, now_iso
from models.finance import GstInvoiceInput, RecordPaymentInput, StockUseInput
from routers.ledger import (
    _apply_payment_to_invoice, _currency, _num, _remaining, require_ledger,
)
from services import invoicing

router = APIRouter(prefix="/api")

_METHODS = {"bank transfer", "upi", "cash", "cheque", "card", "other", ""}


def _day(s: Optional[str]) -> str:
    s = (s or "").strip()[:10]
    return s if re.fullmatch(r"\d{4}-\d{2}-\d{2}", s) else now_iso()[:10]


# --- F-02: record a payment ------------------------------------------------------------
@router.post("/invoices/{iid}/payments")
async def record_invoice_payment(iid: str, inp: RecordPaymentInput, user: dict = Depends(require_ledger)):
    tid = user["tenant_id"]
    inv = await db.invoices.find_one({"id": iid, "tenant_id": tid}, {"_id": 0})
    if not inv or inv.get("type") not in ("sales_invoice", "purchase_bill"):
        raise HTTPException(status_code=404, detail="Invoice not found")
    if inv.get("status") == "draft":
        raise HTTPException(status_code=400, detail="This invoice is still a draft. Finish it before recording a payment.")
    amount = round(_num(inp.amount), 2)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Enter the amount that was paid.")
    due = _remaining(inv)
    if due <= 0.01:
        raise HTTPException(status_code=400, detail="This invoice is already fully paid.")
    if amount > due + 0.01:
        raise HTTPException(status_code=400, detail=f"That is more than the {due:,.2f} still due on this invoice.")
    method = (inp.method or "").strip().lower()
    if method not in _METHODS:
        method = "other"
    incoming = inv["type"] == "sales_invoice"
    pay = {
        "id": new_id(), "tenant_id": tid, "direction": "in" if incoming else "out",
        "amount": amount, "date": _day(inp.date), "method": method,
        "reference": (inp.reference or "").strip()[:80], "notes": (inp.notes or "").strip()[:500],
        "contact_id": inv.get("contact_id"), "contact_name": inv.get("contact_name") or "",
        "invoice_number": inv.get("number") or "", "invoice_id": None,
        "currency": inv.get("currency") or await _currency(tid),
        "applied": 0, "applications": [], "match_status": "unmatched",
        "source": "manual", "created_by": user["id"], "created_at": now_iso(),
    }
    await db.payments.insert_one(dict(pay))
    applied = await _apply_payment_to_invoice(tid, inv, pay, "manual", max_amount=amount)
    if applied <= 0.01:
        # Someone else's payment settled it a moment ago: undo ours, say so.
        await db.payments.delete_one({"id": pay["id"], "tenant_id": tid})
        raise HTTPException(status_code=409, detail="This invoice was just paid by another entry. Refresh to see it.")
    fresh = await db.invoices.find_one({"id": iid, "tenant_id": tid}, {"_id": 0})
    # A bill paid in full: the expense booked from it is paid too.
    if not incoming and fresh and fresh.get("status") == "paid":
        await db.expenses.update_many({"tenant_id": tid, "invoice_id": iid}, {"$set": {"status": "paid"}})
    who = inv.get("contact_name") or ("the buyer" if incoming else "the supplier")
    await log_activity(tid, user["id"], "payment_recorded",
                       f"{user.get('name') or 'Someone'} recorded {'a receipt of' if incoming else 'a payment of'} "
                       f"{pay['currency']} {amount:,.2f} {'from' if incoming else 'to'} {who}"
                       f" on {inv.get('number') or inv.get('title') or 'an invoice'}", "invoice", iid)
    fresh["balance"] = _remaining(fresh)
    stored = await db.payments.find_one({"id": pay["id"], "tenant_id": tid}, {"_id": 0})
    return {"invoice": fresh, "payment": stored or pay}


# --- F-03: a GST / export invoice ------------------------------------------------------
async def _next_number(tid: str, tenant: dict, on: Optional[str] = None) -> str:
    prefix = (tenant.get("invoice_prefix") or invoicing.default_prefix(tenant.get("name") or "")).strip().strip("/")
    fy = invoicing.financial_year(on)
    stem = f"{prefix}/{fy}/"
    # The next free number in this series, counting the ones already typed by hand.
    nums = [int(m.group(1)) for n in await db.invoices.distinct(
        "number", {"tenant_id": tid, "type": "sales_invoice"})
        for m in [re.fullmatch(re.escape(stem) + r"(\d+)", str(n or ""))] if m]
    return f"{stem}{(max(nums) + 1 if nums else 1):03d}"


@router.get("/invoices/next-number")
async def next_invoice_number(user: dict = Depends(require_ledger)):
    tid = user["tenant_id"]
    t = await db.tenants.find_one({"id": tid}, {"_id": 0, "name": 1, "invoice_prefix": 1, "state": 1,
                                                "gst": 1, "address": 1, "currency": 1})
    t = t or {}
    return {"number": await _next_number(tid, t), "seller_state": t.get("state") or "",
            "seller_ready": bool(t.get("gst") and t.get("address") and t.get("state")),
            "currency": t.get("currency") or "INR",
            "states": list(invoicing.STATES) + [invoicing.EXPORT], "gst_rates": list(invoicing.GST_RATES)}


@router.post("/invoices/gst")
async def create_gst_invoice(inp: GstInvoiceInput, user: dict = Depends(require_ledger)):
    tid = user["tenant_id"]
    tenant = await db.tenants.find_one({"id": tid}, {"_id": 0}) or {}
    cust = (inp.customer_name or "").strip()
    if not cust:
        raise HTTPException(status_code=400, detail="Who is this invoice for? Add the buyer's name.")
    currency = (inp.currency or tenant.get("currency") or "INR").strip().upper()[:3]
    pos = invoicing._norm_state(inp.place_of_supply) or (invoicing.EXPORT if currency != "INR" else tenant.get("state") or "")
    calc = invoicing.compute_invoice([i.model_dump() for i in inp.items], seller_state=tenant.get("state"),
                                     place_of_supply=pos, currency=currency)
    if not calc["line_items"]:
        raise HTTPException(status_code=400, detail="Add at least one line: what you sold, how many, and the rate.")
    date = _day(inp.date)
    number = (inp.number or "").strip()[:40] or await _next_number(tid, tenant, date)
    if await db.invoices.find_one({"tenant_id": tid, "type": "sales_invoice", "number": number}, {"_id": 1}):
        raise HTTPException(status_code=409, detail=f"Invoice {number} already exists. Use the next number.")
    gstin = (inp.customer_gstin or "").strip().upper()
    if gstin and not re.fullmatch(r"\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]", gstin):
        raise HTTPException(status_code=400, detail="That GSTIN doesn't look right — it is 15 characters, like 33ABCDE1234F1Z5.")
    first = calc["line_items"][0]["description"]
    more = len(calc["line_items"]) - 1
    doc = {
        "id": new_id(), "tenant_id": tid, "type": "sales_invoice", "kind": "gst_invoice",
        "number": number, "contact_id": inp.contact_id, "contact_name": cust,
        "customer_gstin": gstin, "customer_address": (inp.customer_address or "").strip()[:400],
        "place_of_supply": pos, "title": first + (f" + {more} more" if more else ""),
        "date": date, "due_date": _day(inp.due_date) if inp.due_date else "",
        "currency": currency, "status": "unpaid", "amount_paid": 0,
        "purchase_type": "", "notes": (inp.notes or "").strip()[:1000],
        "source": "invoice_builder", "created_by": user["id"], "created_at": now_iso(),
        **calc,
    }
    await db.invoices.insert_one(dict(doc))
    doc.pop("_id", None)
    await log_activity(tid, user["id"], "invoice_created",
                       f"{user.get('name') or 'Someone'} raised invoice {number} to {cust} for {currency} {doc['amount']:,.2f}",
                       "invoice", doc["id"])
    doc["balance"] = _remaining(doc)
    return doc


@router.get("/invoices/{iid}/pdf")
async def invoice_pdf(iid: str, user: dict = Depends(require_ledger)):
    tid = user["tenant_id"]
    inv = await db.invoices.find_one({"id": iid, "tenant_id": tid, "type": "sales_invoice"}, {"_id": 0})
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    seller = await db.tenants.find_one({"id": tid}, {"_id": 0, "name": 1, "address": 1, "state": 1, "gst": 1,
                                                     "phone": 1, "support_email": 1, "bank_name": 1,
                                                     "bank_account": 1, "bank_ifsc": 1, "upi_id": 1,
                                                     "invoice_terms": 1}) or {}
    pdf = invoicing.invoice_pdf(inv, seller)
    name = re.sub(r"[^A-Za-z0-9_-]+", "-", inv.get("number") or "invoice").strip("-") or "invoice"
    return Response(pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{name}.pdf"'})


# --- F-04: stock used ---------------------------------------------------------------------
@router.post("/inventory/{iid}/use")
async def use_stock(iid: str, inp: StockUseInput, user: dict = Depends(require_ledger)):
    tid = user["tenant_id"]
    item = await db.inventory.find_one({"id": iid, "tenant_id": tid}, {"_id": 0})
    if not item:
        raise HTTPException(status_code=404, detail="Stock item not found")
    qty = round(_num(inp.quantity), 3)
    have = _num(item.get("quantity"))
    if qty <= 0:
        raise HTTPException(status_code=400, detail="Enter how much was used.")
    if qty > have + 1e-9:
        raise HTTPException(status_code=400, detail=f"Only {have:g} {item.get('unit') or ''} in stock.".replace("  ", " "))
    unit_cost = _num(item.get("unit_cost"))
    left = round(have - qty, 3)
    # Compare-and-set on the quantity: two people using the same stock at once
    # cannot both take the last of it.
    res = await db.inventory.update_one({"id": iid, "tenant_id": tid, "quantity": item.get("quantity")},
                                        {"$set": {"quantity": left, "value": round(left * unit_cost, 2)}})
    if not res.modified_count:
        raise HTTPException(status_code=409, detail="The stock changed while you were typing. Refresh and try again.")
    mv = {"id": new_id(), "tenant_id": tid, "inventory_id": iid, "item": item.get("item"),
          "quantity": qty, "unit": item.get("unit"), "unit_cost": unit_cost, "value": round(qty * unit_cost, 2),
          "currency": item.get("currency"), "date": _day(inp.date), "note": (inp.note or "").strip()[:300],
          "created_by": user["id"], "created_at": now_iso()}
    await db.stock_movements.insert_one(dict(mv))
    mv.pop("_id", None)
    await log_activity(tid, user["id"], "stock_used",
                       f"{user.get('name') or 'Someone'} used {qty:g} {item.get('unit') or ''} of {item.get('item')}",
                       "inventory", iid)
    return {"movement": mv, "item": {**item, "quantity": left, "value": round(left * unit_cost, 2)}}


@router.get("/stock-used")
async def list_stock_used(user: dict = Depends(require_ledger)):
    rows = await db.stock_movements.find({"tenant_id": user["tenant_id"]}, {"_id": 0}).sort("date", -1).to_list(3000)
    return {"movements": rows, "total": round(sum(_num(r.get("value")) for r in rows), 2)}
