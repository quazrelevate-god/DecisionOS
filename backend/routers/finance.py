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

from core import db, get_current_user, require_perm, new_id, now_iso, log_activity, logger
from services.tasks import enrich_tasks
from services.inbox import add_inbox_item
from services.ingestion import (
    ai_extract_document, ai_map_spreadsheet, combine_sheets, _normalise_records, commit_ingestion_records,
    _classify_ingestion, _tenant_currency, _tenant_name, DOC_MIME,
)
from services.ai.extraction import ai_score_contact

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
    ing = await db.ingestions.find_one({"id": ingestion_id, "tenant_id": user["tenant_id"]}, {"_id": 0})
    if not ing:
        raise HTTPException(status_code=404, detail="Ingestion not found")
    if ing.get("status") == "filed":
        raise HTTPException(status_code=400, detail="This upload has already been filed")
    created = await commit_ingestion_records(user["tenant_id"], user["id"], _normalise_records(inp.records),
                                             ingestion_id, ing.get("source", "upload"))
    await db.ingestions.update_one({"id": ingestion_id},
                                   {"$set": {"status": "filed", "records": _normalise_records(inp.records),
                                             "created_counts": created, "filed_at": now_iso()}})
    if ing.get("inbox_id"):
        await db.inbox.update_one({"id": ing["inbox_id"]}, {"$set": {"status": "done"}})
    label = ing.get("filename", "document")
    await log_activity(user["tenant_id"], user["id"], "data_ingested",
                       f"Filed data from '{label}' — {created['contacts']} contacts, {created['invoices']} invoices, {created['payments']} payments, {created['tasks']} tasks",
                       "ingestion", ingestion_id)
    return {"filed": True, "created": created}


@router.get("/ingest")
async def list_ingestions(user: dict = Depends(get_current_user)):
    return await db.ingestions.find({"tenant_id": user["tenant_id"]}, {"_id": 0}).sort("created_at", -1).to_list(50)


@router.get("/ingest/{ingestion_id}")
async def get_ingestion(ingestion_id: str, user: dict = Depends(get_current_user)):
    ing = await db.ingestions.find_one({"id": ingestion_id, "tenant_id": user["tenant_id"]}, {"_id": 0})
    if not ing:
        raise HTTPException(status_code=404, detail="Not found")
    return ing


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
# 360° Customer / Supplier profile  (Owner + Finance only)
# ---------------------------------------------------------------------------
@router.get("/contacts/{contact_id}/profile")
async def contact_profile(contact_id: str, user: dict = Depends(require_perm("finance"))):
    tid = user["tenant_id"]
    c = await db.contacts.find_one({"id": contact_id, "tenant_id": tid}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Contact not found")
    name = c.get("name") or ""
    name_rx = {"$regex": f"^{re.escape(name)}$", "$options": "i"}
    loose_rx = {"$regex": re.escape(name), "$options": "i"} if name else {"$exists": False}
    match_party = {"tenant_id": tid, "$or": [{"contact_id": contact_id}, {"contact_name": name_rx}]}

    invoices = await db.invoices.find(match_party, {"_id": 0}).sort("created_at", -1).to_list(500)
    payments = await db.payments.find(match_party, {"_id": 0}).sort("created_at", -1).to_list(500)
    complaints = await db.complaints.find({"tenant_id": tid, "customer_id": contact_id}, {"_id": 0}).sort("created_at", -1).to_list(200)
    workflows = await db.workflows.find({"tenant_id": tid, "contact_id": contact_id}, {"_id": 0}).sort("created_at", -1).to_list(200)
    tasks = await db.tasks.find({"tenant_id": tid, "title": loose_rx}, {"_id": 0}).sort("created_at", -1).to_list(200) if name else []
    decisions = await db.decisions.find(
        {"tenant_id": tid, "$or": [{"title": loose_rx}, {"summary": loose_rx}]}, {"_id": 0}
    ).sort("created_at", -1).to_list(100) if name else []

    total_billed = sum(float(i.get("amount") or 0) for i in invoices)
    total_paid = sum(float(p.get("amount") or 0) for p in payments)
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

    return {
        "contact": c,
        "summary": {"total_billed": round(total_billed, 2), "total_paid": round(total_paid, 2),
                    "outstanding": outstanding, "last_payment": last_payment,
                    "open_complaints": len([x for x in complaints if x.get("status") != "resolved"])},
        "invoices": invoices,
        "payments": payments,
        "complaints": complaints,
        "workflows": workflows,
        "pending_deliveries": pending_deliveries,
        "follow_ups": follow_ups,
        "tasks": await enrich_tasks(tasks),
        "decisions": decisions,
        "price_history": price_history,
        "ai_relationship": c.get("ai_relationship"),
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
    invoices = await db.invoices.find(match_party, {"_id": 0, "amount": 1}).to_list(500)
    payments = await db.payments.find(match_party, {"_id": 0, "amount": 1, "date": 1}).sort("created_at", -1).to_list(500)
    complaints = await db.complaints.find({"tenant_id": tid, "customer_id": contact_id}, {"_id": 0, "status": 1}).to_list(200)
    workflows = await db.workflows.find({"tenant_id": tid, "contact_id": contact_id}, {"_id": 0, "stage": 1}).to_list(200)
    total_billed = sum(float(i.get("amount") or 0) for i in invoices)
    total_paid = sum(float(p.get("amount") or 0) for p in payments)
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
    scores = await ai_score_contact(c, metrics, currency, session_id=f"contact-{contact_id}")
    if scores:
        scores["scored_at"] = now_iso()
        await db.contacts.update_one({"id": contact_id}, {"$set": {"ai_relationship": scores}})
    return {"ai_relationship": scores}
