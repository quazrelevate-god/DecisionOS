"""Finance + document-ingestion endpoints (Epic 8 Sprint 3 -- from server.py).

Document/CSV ingestion (OCR + AI-mapping -> review -> commit), invoices/payments
reads, and per-contact finance profile + rescore. The AI-extraction + record-
commit engine (ai_extract_document, ai_map_spreadsheet, commit_ingestion_records,
_classify_ingestion, _tenant_currency/_name, ai_score_contact) stays in server.
"""
import os
import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form

from core import db, get_current_user, require_perm, require_any_perm, new_id, now_iso, log_activity, logger
from services.tasks import enrich_tasks
from services.inbox import add_inbox_item
from services.ingestion import (
    ai_extract_document, ai_map_spreadsheet, combine_sheets, _normalise_records, commit_ingestion_records,
    _classify_ingestion, _tenant_currency, _tenant_name, DOC_MIME, upload_scope,
)

router = APIRouter(prefix="/api")


# Request models consolidated into models/ (Epic 8 Sprint 5).
from models.finance import (
    IngestCommitInput,
)


@router.post("/ingest/document")
async def ingest_document(file: UploadFile = File(...), source: str = Form("upload"),
                          user: dict = Depends(require_perm("data_input"))):
    ext = (file.filename or "file.pdf").split(".")[-1].lower()
    if ext not in DOC_MIME:
        raise HTTPException(status_code=400, detail="Upload a PDF or image (PNG/JPG/WEBP)")
    # FIX-002-E: obj_store with tenant prefix.
    from services.uploads import store_upload, download_to_temp
    ing_id = new_id()
    fname = f"ingest_{ing_id}.{ext}"
    data = await file.read()
    stored = await store_upload(user["tenant_id"], "ingestions", data, ext,
                                 content_type=DOC_MIME[ext], file_id=ing_id)
    doc = {
        "id": ing_id, "tenant_id": user["tenant_id"], "created_by": user["id"],
        "source": source if source in ("upload", "whatsapp") else "upload",
        "kind": "pdf" if ext == "pdf" else "image", "filename": file.filename or fname,
        "file_url": f"/api/files/{fname}",
        "storage_path": stored["storage_path"],  # FIX-002-E
        "status": "review", "created_at": now_iso(),
    }
    try:
        currency = await _tenant_currency(user["tenant_id"])
        company = await _tenant_name(user["tenant_id"])
        tmp_local = await download_to_temp(stored["storage_path"])
        try:
            result = await ai_extract_document(str(tmp_local), DOC_MIME[ext], f"ingest-{ing_id}", currency, company)
        finally:
            try:
                os.unlink(tmp_local)
            except Exception:
                pass
        doc.update({"summary": result["summary"], "doc_type": result["doc_type"],
                    "confidence": result["confidence"], "records": result["records"]})
    except Exception as e:
        logger.exception("ingest_document extraction failed")
        doc.update({"status": "failed", "error": str(e)[:300], "records": _normalise_records({})})
    await db.ingestions.insert_one(dict(doc))
    doc.pop("_id", None)
    inbox_id = await add_inbox_item(user["tenant_id"], user["id"], doc["source"],
                                    _classify_ingestion(doc), doc.get("summary") or doc["filename"],
                                    doc["filename"], "ingestion", ing_id,
                                    status="done" if doc["status"] == "failed" else "open")
    await db.ingestions.update_one({"id": ing_id}, {"$set": {"inbox_id": inbox_id}})
    doc["inbox_id"] = inbox_id
    return doc


@router.post("/ingest/csv")
async def ingest_csv(file: UploadFile = File(...), user: dict = Depends(require_perm("data_input"))):
    import pandas as pd
    ext = (file.filename or "file.csv").split(".")[-1].lower()
    if ext not in ("csv", "xlsx", "xls"):
        raise HTTPException(status_code=400, detail="Upload a CSV or Excel (.xlsx) file")
    ing_id = new_id()
    # FIX-002-E: obj_store with tenant prefix. pandas needs a filesystem
    # path so we materialize to temp for the read.
    from services.uploads import store_upload, download_to_temp
    fname = f"ingest_{ing_id}.{ext}"
    data = await file.read()
    stored = await store_upload(user["tenant_id"], "ingestions", data, ext,
                                 content_type=file.content_type, file_id=ing_id)
    tmp_local = await download_to_temp(stored["storage_path"])
    try:
        if ext in ("xlsx", "xls"):
            # E3-06.3: read EVERY sheet (pandas defaults to only the first) and
            # combine same-schema sheets, so multi-sheet workbooks aren't silently
            # truncated to one tab.
            book = pd.read_excel(tmp_local, sheet_name=None)
            sheets = []
            for sname, sdf in book.items():
                sdf = sdf.fillna("")
                sheets.append((sname, [str(c) for c in sdf.columns], sdf.astype(str).values.tolist()))
            headers, rows = combine_sheets(sheets)
            if len(book) > 1:
                logger.info(f"ingest_csv: workbook has {len(book)} sheets -> combined to {len(rows)} rows")
        else:
            df = pd.read_csv(tmp_local).fillna("")
            headers = [str(c) for c in df.columns]
            rows = df.astype(str).values.tolist()
    except Exception as e:
        try:
            os.unlink(tmp_local)
        except Exception:
            pass
        raise HTTPException(status_code=400, detail=f"Could not read the file: {str(e)[:150]}")
    finally:
        try:
            os.unlink(tmp_local)
        except Exception:
            pass
    doc = {
        "id": ing_id, "tenant_id": user["tenant_id"], "created_by": user["id"], "source": "csv",
        "kind": ext, "filename": file.filename or fname, "file_url": f"/api/files/{fname}",
        "storage_path": stored["storage_path"],  # FIX-002-E
        "status": "review", "row_count": len(rows), "created_at": now_iso(),
    }
    try:
        currency = await _tenant_currency(user["tenant_id"])
        company = await _tenant_name(user["tenant_id"])
        result = await ai_map_spreadsheet(headers, rows, f"ingest-{ing_id}", currency, company)
        doc.update({"summary": result["summary"], "entity": result["entity"], "records": result["records"]})
    except Exception as e:
        logger.exception("ingest_csv mapping failed")
        doc.update({"status": "failed", "error": str(e)[:300], "records": _normalise_records({})})
    await db.ingestions.insert_one(dict(doc))
    doc.pop("_id", None)
    inbox_id = await add_inbox_item(user["tenant_id"], user["id"], "csv",
                                    _classify_ingestion(doc), doc.get("summary") or doc["filename"],
                                    doc["filename"], "ingestion", ing_id,
                                    status="done" if doc["status"] == "failed" else "open")
    await db.ingestions.update_one({"id": ing_id}, {"$set": {"inbox_id": inbox_id}})
    doc["inbox_id"] = inbox_id
    return doc




@router.post("/ingest/{ingestion_id}/commit")
async def commit_ingestion(ingestion_id: str, inp: IngestCommitInput,
                           user: dict = Depends(require_perm("data_input"))):
    # BUG-16: only an upload this person may see (their own, or any for the
    # owner and Finance) — any Data Input holder could file anyone's by id.
    ing = await db.ingestions.find_one({**upload_scope(user), "id": ingestion_id}, {"_id": 0})
    if not ing:
        raise HTTPException(status_code=404, detail="Ingestion not found")
    if ing.get("status") == "filed":
        raise HTTPException(status_code=400, detail="This upload has already been filed")
    if ing.get("status") == "discarded":
        raise HTTPException(status_code=400, detail="This upload was discarded")
    if ing.get("status") == "undone":
        raise HTTPException(status_code=400, detail="This import was undone. Put it back from Recently deleted, or upload the file again.")
    created = await commit_ingestion_records(user["tenant_id"], user["id"], _normalise_records(inp.records),
                                             ingestion_id, ing.get("source", "upload"))
    await db.ingestions.update_one({"id": ingestion_id},
                                   {"$set": {"status": "filed", "records": _normalise_records(inp.records),
                                             "created_counts": created, "filed_at": now_iso()}})
    if ing.get("inbox_id"):
        await db.inbox.update_one({"id": ing["inbox_id"]}, {"$set": {"status": "done"}})
    label = ing.get("filename", "document")
    await log_activity(user["tenant_id"], user["id"], "data_ingested",
                       # Audit F-06 -- only what was filed, with the right plural.
                       f"Filed data from '{label}'" + (" — " + ", ".join(
                           f"{created[k]} {k if created[k] != 1 else k[:-1]}"
                           for k in ("contacts", "invoices", "payments", "tasks") if created.get(k)) if any(
                           created.get(k) for k in ("contacts", "invoices", "payments", "tasks")) else ""),
                       "ingestion", ingestion_id)
    return {"filed": True, "created": created}


@router.get("/ingest")
# 2026-10-03 RBAC audit: uploaded bills and their amounts were readable by any
# member. The Finance inbox they belong to is opened by Finance or Data Input.
# BUG-16 (2026-10-21): the Money Inbox's Pending and Filed list these (?status=
# review / filed), so it is scoped as they are: the company's uploads for the
# owner and Finance, your own for anyone else (services.ingestion.upload_scope),
# with who uploaded each.
async def list_ingestions(status: Optional[str] = None,
                          user: dict = Depends(require_any_perm("finance", "data_input"))):
    q = upload_scope(user)
    if status == "filed":
        # 2026-10-22 — an import that was undone stays on Filed, saying so,
        # with the way to put it back (services/finance_trash).
        q["status"] = {"$in": ["filed", "undone"]}
    elif status in ("review", "failed", "discarded", "undone"):
        q["status"] = status
    rows = await db.ingestions.find(q, {"_id": 0}).sort("created_at", -1).to_list(50)
    ids = list({r["created_by"] for r in rows if r.get("created_by")})
    names = {u["id"]: u.get("name") for u in await db.users.find(
        {"id": {"$in": ids}, "tenant_id": user["tenant_id"]}, {"_id": 0, "id": 1, "name": 1}).to_list(len(ids) or 1)} if ids else {}
    for r in rows:
        r["created_by_name"] = names.get(r.get("created_by"))
    return rows


@router.get("/ingest/{ingestion_id}")
async def get_ingestion(ingestion_id: str, user: dict = Depends(require_any_perm("finance", "data_input"))):
    ing = await db.ingestions.find_one({**upload_scope(user), "id": ingestion_id}, {"_id": 0})
    if not ing:
        raise HTTPException(status_code=404, detail="Not found")
    return ing


@router.post("/ingest/{ingestion_id}/discard")
async def discard_ingestion(ingestion_id: str, user: dict = Depends(require_any_perm("finance", "data_input"))):
    """BUG-16 — Discard on the review panel used to close the panel and leave
    the upload waiting, unseen. Now it leaves the Inbox's Pending for good.
    A filed upload is not discarded: what it filed is already in the books."""
    ing = await db.ingestions.find_one({**upload_scope(user), "id": ingestion_id}, {"_id": 0})
    if not ing:
        raise HTTPException(status_code=404, detail="Not found")
    if ing.get("status") in ("filed", "undone"):
        raise HTTPException(status_code=400, detail="This upload has already been filed")
    await db.ingestions.update_one({"id": ingestion_id, "tenant_id": user["tenant_id"]}, {"$set": {
        "status": "discarded", "discarded_at": now_iso(), "discarded_by": user["id"]}})
    if ing.get("inbox_id"):
        await db.inbox.update_one({"id": ing["inbox_id"], "tenant_id": user["tenant_id"]}, {"$set": {"status": "done"}})
    return {"discarded": True}


@router.get("/invoices")
async def list_invoices(type: Optional[str] = None, user: dict = Depends(require_perm("finance"))):
    query = {"tenant_id": user["tenant_id"]}
    if type in ("sales_invoice", "purchase_bill"):
        query["type"] = type
    return await db.invoices.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)


@router.get("/payments")
async def list_payments(user: dict = Depends(require_perm("finance"))):
    return await db.payments.find({"tenant_id": user["tenant_id"]}, {"_id": 0}).sort("created_at", -1).to_list(500)


# ---------------------------------------------------------------------------
# Unified Inbox feed
# ---------------------------------------------------------------------------
# Inbox endpoints moved to routers/inbox.py in Phase B step 6.
# `push_inbox()` (the writer) stays in this module — many domain workflows still call it inline.


# ---------------------------------------------------------------------------
# 360° Customer / Supplier profile
# ---------------------------------------------------------------------------
@router.get("/contacts/{contact_id}/profile")
async def contact_profile(contact_id: str, user: dict = Depends(get_current_user)):
    """Epic 11 S12 (2026-10-31) -- the page reads LINKS, not names, and opens for
    CRM access too. It found tasks and decisions by searching titles for the
    name, so "Ravi Traders" showed the employee Ravi's work, and it opened only
    with Finance access although it is the CRM's page. Now: the tasks, decisions,
    meetings and workflows carrying this record (the old-data review links the
    rest), for anyone who may see this side of CRM. The money -- invoices,
    payments, bills, totals, prices -- stays with Finance."""
    from core.permissions import may_see_contact, user_perms
    tid = user["tenant_id"]
    c = await db.contacts.find_one({"id": contact_id, "tenant_id": tid}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Contact not found")
    money = "finance" in user_perms(user)
    if not money and not may_see_contact(user, c.get("type")):
        raise HTTPException(status_code=403, detail="You don't have access to this feature")
    name = c.get("name") or ""
    name_rx = {"$regex": f"^{re.escape(name)}$", "$options": "i"}
    match_party = {"tenant_id": tid, "$or": [{"contact_id": contact_id}, {"contact_name": name_rx}]}

    invoices = await db.invoices.find(match_party, {"_id": 0}).sort("created_at", -1).to_list(500) if money else []
    payments = await db.payments.find(match_party, {"_id": 0}).sort("created_at", -1).to_list(500) if money else []
    complaints = await db.complaints.find({"tenant_id": tid, "customer_id": contact_id}, {"_id": 0}).sort("created_at", -1).to_list(200)
    workflows = await db.workflows.find({"tenant_id": tid, "contact_id": contact_id}, {"_id": 0}).sort("created_at", -1).to_list(200)
    tasks = await db.tasks.find({"tenant_id": tid, "contact_id": contact_id}, {"_id": 0}).sort("created_at", -1).to_list(200)
    decisions = await db.decisions.find(
        {"tenant_id": tid, "contact_ids": contact_id}, {"_id": 0}).sort("created_at", -1).to_list(100)
    meetings = await db.calendar_events.find(
        {"tenant_id": tid, "contact_id": contact_id}, {"_id": 0}).sort("date", -1).to_list(100)

    # J2-04 (JOURNEY-1) — A SUPPLIER'S PAGE COUNTS WHAT YOU PAID THEM, not only
    # the bills that arrived with a document. A wholesaler's oil supplier showed
    # nothing at all: her expenses named him (vendor_name, vendor_id) but this
    # page read invoices and payments only, and a typed expense is neither.
    expenses = await db.expenses.find(
        {"tenant_id": tid, "approval_status": {"$nin": ["pending", "rejected"]},
         "$or": [{"vendor_id": contact_id}, {"vendor_name": name_rx}]},
        {"_id": 0}).sort("created_at", -1).to_list(500) if money and (name or contact_id) else []
    # An expense raised FROM a bill is that bill; counting both would double it.
    billed_ids = {i.get("id") for i in invoices}
    direct_expenses = [e for e in expenses if e.get("invoice_id") not in billed_ids]
    total_expensed = sum(float(e.get("amount") or 0) for e in direct_expenses)

    # Audit 2026-10-08: in the company's currency (no rate yet = left out).
    from shared.money import total_in_base
    _base = ((await db.tenants.find_one({"id": tid}, {"_id": 0, "currency": 1})) or {}).get("currency") or "INR"
    total_billed = total_in_base(invoices, _base, lambda i: i.get("amount")) + total_expensed
    total_paid = total_in_base(payments, _base, lambda p: p.get("amount"))
    # Audit C-07 (2026-10-09) -- a UK buyer's page in pounds. When the contact
    # trades in its own currency and every invoice and payment with it is in
    # that currency, the totals are counted in it, as written; anything mixed
    # stays in the company's currency (converted, as above).
    summary_currency = _base
    _cc = (c.get("currency") or "").upper()
    if _cc and _cc != _base.upper() and not direct_expenses and all(
            (x.get("currency") or _base).upper() == _cc for x in invoices + payments):
        total_billed = sum(float(i.get("amount") or 0) for i in invoices)
        total_paid = sum(float(p.get("amount") or 0) for p in payments)
        summary_currency = _cc
    outstanding = round(total_billed - total_paid, 2)
    last_payment = payments[0].get("date") if payments else None

    # follow-ups = reminder tasks + open workflows
    follow_ups = [t for t in tasks if t.get("source") in ("reminder", "ingest")]
    # FIX-001-F: dynamic terminal stages per tenant (salon 'served', bakery 'settled', etc.).
    from services.workflows import tenant_terminal_stages
    _term_stages_360 = set(await tenant_terminal_stages(tid))
    pending_deliveries = [w for w in workflows if w.get("stage") not in _term_stages_360]

    # price history for suppliers, from purchase bill line items
    price_history = []
    if c.get("type") == "vendor":
        for inv in invoices:
            for li in (inv.get("line_items") or []):
                if li.get("description"):
                    price_history.append({"item": li.get("description"), "rate": li.get("rate"),
                                          "date": inv.get("date") or inv.get("created_at", "")[:10]})

    if not money:   # Epic 11 S12: CRM access sees the relationship, not the money
        c = {k: v for k, v in c.items() if k not in ("credit_limit", "payment_terms_days", "ai_relationship")}
    return {
        "contact": c,
        "money": money,
        "meetings": meetings,
        "summary": {"total_billed": round(total_billed, 2), "total_paid": round(total_paid, 2),
                    "outstanding": outstanding, "last_payment": last_payment,
                    "currency": summary_currency,   # audit C-07
                    # over the credit limit the contact was given, if any
                    "over_credit_limit": bool(c.get("credit_limit")) and summary_currency == (_cc or _base)
                    and outstanding > float(c.get("credit_limit") or 0),
                    "open_complaints": len([x for x in complaints if x.get("status") != "resolved"])},
        "invoices": invoices,
        "expenses": direct_expenses,     # J2-04: what was paid to them without a bill on file
        "payments": payments,
        "complaints": complaints,
        "workflows": workflows,
        "pending_deliveries": pending_deliveries,
        "follow_ups": follow_ups,
        "tasks": await enrich_tasks(tasks),
        "decisions": decisions,
        "price_history": price_history,
        "ai_relationship": c.get("ai_relationship") if money else None,
    }


@router.post("/contacts/{contact_id}/rescore")
async def rescore_contact(contact_id: str, user: dict = Depends(require_perm("finance"))):
    tid = user["tenant_id"]
    c = await db.contacts.find_one({"id": contact_id, "tenant_id": tid}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Contact not found")
    name = c.get("name") or ""
    name_rx = {"$regex": f"^{re.escape(name)}$", "$options": "i"}
    match_party = {"tenant_id": tid, "$or": [{"contact_id": contact_id}, {"contact_name": name_rx}]}
    invoices = await db.invoices.find(match_party, {"_id": 0, "amount": 1, "currency": 1, "fx_rate": 1}).to_list(500)
    payments = await db.payments.find(match_party, {"_id": 0, "amount": 1, "date": 1, "currency": 1, "fx_rate": 1}).sort("created_at", -1).to_list(500)
    complaints = await db.complaints.find({"tenant_id": tid, "customer_id": contact_id}, {"_id": 0, "status": 1}).to_list(200)
    workflows = await db.workflows.find({"tenant_id": tid, "contact_id": contact_id}, {"_id": 0, "stage": 1}).to_list(200)
    from shared.money import total_in_base
    _base = ((await db.tenants.find_one({"id": tid}, {"_id": 0, "currency": 1})) or {}).get("currency") or "INR"
    total_billed = total_in_base(invoices, _base, lambda i: i.get("amount"))
    total_paid = total_in_base(payments, _base, lambda p: p.get("amount"))
    # FIX-001-F: dynamic terminal stages per tenant.
    from services.workflows import tenant_terminal_stages
    _term_stages_rs = set(await tenant_terminal_stages(tid))
    metrics = {
        "outstanding": round(total_billed - total_paid, 2), "total_billed": round(total_billed, 2),
        "total_paid": round(total_paid, 2), "last_payment": payments[0].get("date") if payments else None,
        "open_complaints": len([x for x in complaints if x.get("status") != "resolved"]),
        "pending_deliveries": len([w for w in workflows if w.get("stage") not in _term_stages_rs]),
        "invoice_count": len(invoices), "payment_count": len(payments),
    }
    currency = await _tenant_currency(tid)
    # 2026-10-06 — a formula over the books and complaints (services/calculated), not AI.
    from services.calculated import score_contact
    scores = score_contact(c, metrics, currency)
    if scores:
        scores["scored_at"] = now_iso()
        await db.contacts.update_one({"id": contact_id}, {"$set": {"ai_relationship": scores}})
    return {"ai_relationship": scores}
