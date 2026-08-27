"""Document ingestion: AI extraction + purchase classification + commit engine
(Epic 8 Sprint 4 -- from server.py).

Reads a bill/receipt/spreadsheet into structured records (Gemini/Claude),
classifies purchase bills into expense/asset/inventory, and commits contacts/
invoices/payments/tasks + ledger rows. routers.ledger writers, server's
CONTACT_TYPES, and llm_limits are imported deferred to avoid a cycle.
"""
import os
import re
import json
import asyncio
from datetime import datetime, timezone, timedelta

from fastapi import HTTPException
from emergentintegrations.llm.chat import LlmChat, UserMessage, FileContentWithMimeType

import time
from core import (
    db, logger, new_id, now_iso, tenant_role_keys,
    claude_chat, _extract_json, _est_tokens, log_usage,
    EMERGENT_LLM_KEY, VISION_MODEL, record_ai_call,
)
from services.vision import get_gemini_client, _gemini_doc_sync
from services.ai.validation import calibrate_doc_confidence
from core import model_for
from prompts import render


# Prompt text now lives in the registry (prompts/documents.py). The literal
# {company}/{currency} markers are still filled by .replace() in the callers.
_DOC_SYSTEM = render("documents.doc_extract")
_CSV_SYSTEM = render("documents.csv_map")


def _normalise_records(data: dict) -> dict:
    out = {}
    for k in ("contacts", "invoices", "payments", "tasks"):
        out[k] = data.get(k) if isinstance(data.get(k), list) else []
    return out


async def ai_extract_document(file_path: str, mime_type: str, session_id: str, currency: str = "INR", company: str = "") -> dict:
    system = _DOC_SYSTEM.replace("{currency}", currency).replace("{company}", company or "our company")
    user_text = "Extract the structured JSON from this document now."
    resp = None
    _t0 = time.perf_counter()
    _eng, _ti, _to = None, 0, 0
    # Prefer the user's own Gemini key via the official google-genai SDK.
    if get_gemini_client() is not None:
        try:
            resp, _gti, _gto = await asyncio.to_thread(_gemini_doc_sync, file_path, mime_type, system, user_text)
            await log_usage((session_id or "ocr").split("-")[0], "gemini", model=VISION_MODEL[1],
                            tokens_in=_gti, tokens_out=_gto, units=1, unit_type="document")
            _eng, _ti, _to = "gemini", _gti, _gto
        except Exception as e:
            logger.warning(f"Gemini OCR (user key) failed; falling back to Emergent key: {e}")
            resp = None
    # Fallback: Gemini via the Emergent universal key (keeps document capture working).
    if not resp:
        fc = FileContentWithMimeType(file_path=file_path, mime_type=mime_type)
        chat = LlmChat(api_key=EMERGENT_LLM_KEY, session_id=session_id,
                       system_message=system).with_model(*model_for("documents.doc_extract", "vision"))
        # FIX-002-B: guard.
        from services.ai.llm_limits import guarded_llm
        resp = await guarded_llm(chat.send_message(UserMessage(text=user_text, file_contents=[fc])),
                                  label="gemini:ocr-fallback")
        await log_usage((session_id or "ocr").split("-")[0], "gemini", model=VISION_MODEL[1],
                        tokens_in=_est_tokens(system + user_text), tokens_out=_est_tokens(resp or ""),
                        units=1, unit_type="document")
        _eng, _ti, _to = "emergent", _est_tokens(system + user_text), _est_tokens(resp or "")
    try:  # E3-06 robustness: a malformed OCR response must degrade, not crash the ingest
        data = _extract_json(resp)
        parse_ok = True
    except Exception as e:
        logger.warning(f"ai_extract_document parse failed: {e}")
        data, parse_ok = {}, False
    await record_ai_call(task="documents.doc_extract", model=VISION_MODEL[1], engine=_eng,
                         tokens_in=_ti, tokens_out=_to,
                         latency_ms=(time.perf_counter() - _t0) * 1000, ok=True, parse_ok=parse_ok,
                         session_id=session_id)
    records = _normalise_records(data)
    doc_type = data.get("doc_type", "other")
    # E3-06.6: replace the model's raw OCR confidence with a calibrated one + review flag.
    # The capture flow routes on this confidence, so a shaky scan auto-goes to review.
    raw_conf = data.get("confidence", 0.7)
    cal, reasons, needs_review = calibrate_doc_confidence(
        records, raw=raw_conf, parse_ok=parse_ok, doc_type=doc_type)
    return {
        "summary": data.get("summary", ""),
        "doc_type": doc_type,
        "confidence": cal,
        "confidence_raw": raw_conf,
        "review_reasons": reasons,
        "needs_review": needs_review,
        "records": records,
    }


def _cell_empty(v) -> bool:
    s = str(v).strip().lower()
    return s == "" or s == "nan"


def sanitize_table(headers: list, rows: list) -> tuple:
    """Clean a raw (headers, rows) table before the AI maps it (E3-06.3).

    Handles the mess real spreadsheets arrive in: pads ragged rows; relabels
    blank / pandas 'Unnamed: N' headers to column_N and de-dupes repeats; drops
    columns that are BOTH unlabelled and entirely empty; drops fully-empty rows.
    Pure + deterministic so it's unit-testable without a file. Returns (headers, rows)."""
    headers = list(headers or [])
    rows = [list(r) for r in (rows or [])]
    ncol = max([len(headers)] + [len(r) for r in rows]) if (headers or rows) else 0
    headers += [""] * (ncol - len(headers))
    rows = [r + [""] * (ncol - len(r)) for r in rows]

    col_empty = [all(_cell_empty(r[c]) for r in rows) if rows else True for c in range(ncol)]
    keep, clean, seen = [], [], {}
    for c in range(ncol):
        h = str(headers[c] or "").strip()
        auto = (h == "" or bool(re.match(r"^unnamed", h, re.I)))
        if auto and col_empty[c]:
            continue  # a truly empty, unlabelled column -> noise, drop it
        h = f"column_{c + 1}" if auto else h
        n = seen.get(h.lower(), 0)
        seen[h.lower()] = n + 1
        clean.append(f"{h}_{n + 1}" if n else h)
        keep.append(c)

    out_rows = []
    for r in rows:
        vals = [str(r[c]).strip() for c in keep]
        if any(not _cell_empty(v) for v in vals):
            out_rows.append(vals)
    return clean, out_rows


def combine_sheets(sheets: list) -> tuple:
    """Reduce a multi-sheet workbook to one (headers, rows) (E3-06.3).

    sheets = [(name, headers, rows), ...]. Sanitizes each, groups sheets that share
    the same header signature and concatenates them (so Jan/Feb/Mar tabs merge), then
    returns the largest group -- which drops cover/summary tabs while keeping the real
    data. Pure + testable."""
    groups = {}
    for _name, headers, rows in sheets:
        h, r = sanitize_table(headers, rows)
        if not r:
            continue
        g = groups.setdefault(tuple(h), [h, []])
        g[1].extend(r)
    if not groups:
        return [], []
    best = max(groups.values(), key=lambda g: len(g[1]))
    return best[0], best[1]


async def ai_map_spreadsheet(headers: list, rows: list, session_id: str, currency: str = "INR", company: str = "") -> dict:
    headers, rows = sanitize_table(headers, rows)  # E3-06.3: clean messy/unlabelled headers first
    payload = {"headers": headers, "rows": rows[:300]}
    system = _CSV_SYSTEM.replace("{currency}", currency).replace("{company}", company or "our company")
    chat = claude_chat(task="documents.csv_map", session_id=session_id,
                   system_message=system).with_model(*model_for("documents.csv_map"))
    resp = await chat.send_message(UserMessage(text=f"Spreadsheet data:\n{json.dumps(payload)}\n\nClassify and map to JSON now."))
    try:
        data = _extract_json(resp)
    except Exception as e:  # degrade like the other extractors instead of raising
        logger.warning(f"ai_map_spreadsheet parse failed: {e}")
        data = {}
    return {
        "summary": data.get("summary", ""),
        "entity": data.get("entity", ""),
        "records": _normalise_records(data),
    }


async def _tenant_currency(tenant_id: str) -> str:
    t = await db.tenants.find_one({"id": tenant_id}, {"_id": 0, "currency": 1})
    return (t or {}).get("currency", "INR")


async def _tenant_name(tenant_id: str) -> str:
    t = await db.tenants.find_one({"id": tenant_id}, {"_id": 0, "name": 1})
    return (t or {}).get("name", "") or ""


_CO_SUFFIXES = ("private limited", "pvt ltd", "pvt. ltd.", "pvt", "private ltd", "limited",
                "ltd", "llp", "inc", "incorporated", "corporation", "corp", "co", "company",
                "technologies", "enterprises", "industries", "and sons", "traders")


def _norm_company(s: str) -> str:
    s = re.sub(r"[^a-z0-9 ]", " ", (s or "").lower())
    tokens = [t for t in s.split() if t]
    while tokens and " ".join(tokens[-1:]) in _CO_SUFFIXES:
        tokens.pop()
    # also drop 2-word suffixes like "private limited"
    joined = " ".join(tokens)
    for suf in _CO_SUFFIXES:
        if joined.endswith(" " + suf):
            joined = joined[: -(len(suf) + 1)]
    return joined.strip()


def _purchase_class_sys(expense_cats=None, asset_cats=None) -> str:
    asset_list = ", ".join(asset_cats) if asset_cats else "Machinery, Equipment, Vehicle, Furniture, IT & Electronics, Building, Other"
    expense_list = ", ".join(expense_cats) if expense_cats else "Raw Material, Salary & Wages, Rent, Utilities, Logistics & Freight, Marketing, Professional Services, Asset Purchase, Maintenance & Repairs, Taxes & Duties, Office Supplies, Other"
    return render("documents.purchase_class", asset_list=asset_list, expense_list=expense_list)


async def ai_classify_purchase(text: str, expense_categories=None, asset_categories=None) -> dict:
    """Classify one purchase bill's WHAT-was-bought bucket from its text, using the company's own
    category lists when provided. Returns
    {purchase_type, asset_name, inventory_qty, inventory_unit, asset_category, expense_category}. Never raises."""
    text = (text or "").strip()
    if not text:
        return {"purchase_type": "unknown"}
    try:
        chat = claude_chat(task="documents.purchase_class", session_id=f"purchase-class-{new_id()}",
                           system_message=_purchase_class_sys(expense_categories, asset_categories)).with_model(*model_for("documents.purchase_class"))
        resp = await chat.send_message(UserMessage(text=text[:1500]))
        d = _extract_json(resp) or {}
    except Exception as e:  # noqa: BLE001
        logger.warning(f"ai_classify_purchase failed: {e}")
        d = {}
    pt = (d.get("purchase_type") or "").strip().lower()
    if pt not in ("expense", "asset", "inventory", "unknown"):
        pt = "unknown"
    return {"purchase_type": pt, "asset_name": (d.get("asset_name") or "").strip(),
            "inventory_qty": d.get("inventory_qty"), "inventory_unit": (d.get("inventory_unit") or "").strip(),
            "asset_category": (d.get("asset_category") or "").strip(),
            "expense_category": (d.get("expense_category") or "").strip()}


def _has_unclassified_purchase(records: dict, doc_type: str = "") -> bool:
    """True if any purchase bill in the records lacks a confident expense/asset/inventory bucket."""
    for inv in (records or {}).get("invoices", []):
        itype = inv.get("type") or ("purchase_bill" if doc_type == "purchase_bill" else "")
        if itype == "purchase_bill":
            pt = (inv.get("purchase_type") or "").strip().lower()
            if pt not in ("expense", "asset", "inventory"):
                return True
    return False


async def commit_ingestion_records(tenant_id: str, user_id: str, records: dict, ingestion_id: str, source: str) -> dict:
    from routers.ledger import create_expense, create_asset, create_inventory, guess_asset_category
    from models.contacts import CONTACT_TYPES
    # Validate BEFORE writing anything — an unclassified purchase must be classified first,
    # otherwise we'd leave orphaned contacts committed before the 400 fires.
    if _has_unclassified_purchase(records):
        raise HTTPException(
            status_code=400,
            detail="Please classify each purchase bill as Expense, Asset, or Inventory before filing.")
    created = {"contacts": 0, "invoices": 0, "payments": 0, "tasks": 0, "expenses": 0, "assets": 0, "inventory": 0}
    currency = await _tenant_currency(tenant_id)
    own_norm = _norm_company(await _tenant_name(tenant_id))
    troles = await tenant_role_keys(tenant_id)
    followup_role = "finance" if "finance" in troles else ("sales" if "sales" in troles else None)
    name_to_id = {}

    def _is_own(name: str) -> bool:
        n = _norm_company(name)
        return bool(own_norm) and bool(n) and (n == own_norm or n in own_norm or own_norm in n)

    async def resolve_contact(name: str, ctype: str = "customer"):
        name = (name or "").strip()
        if not name or _is_own(name):
            return None
        key = name.lower()
        if key in name_to_id:
            return name_to_id[key]
        existing = await db.contacts.find_one(
            {"tenant_id": tenant_id, "name": {"$regex": f"^{re.escape(name)}$", "$options": "i"}},
            {"_id": 0, "id": 1})
        if existing:
            name_to_id[key] = existing["id"]
            return existing["id"]
        cid = new_id()
        ctype = ctype if ctype in CONTACT_TYPES else ("vendor" if ctype in ("vendor", "supplier") else "customer")
        await db.contacts.insert_one({
            "id": cid, "tenant_id": tenant_id, "type": ctype, "name": name,
            "company": "", "phone": "", "email": "", "address": "", "tax_id": "",
            "tags": ["imported"], "status": "active", "assigned_id": None, "notes": "",
            "created_by": user_id, "created_at": now_iso(), "source": source, "ingestion_id": ingestion_id,
        })
        name_to_id[key] = cid
        created["contacts"] += 1
        return cid

    for c in records.get("contacts", []):
        name = (c.get("name") or "").strip()
        if not name or _is_own(name):
            continue
        ctype = c.get("type") if c.get("type") in CONTACT_TYPES else ("vendor" if c.get("type") == "supplier" else "customer")
        key = name.lower()
        existing = await db.contacts.find_one(
            {"tenant_id": tenant_id, "name": {"$regex": f"^{re.escape(name)}$", "$options": "i"}}, {"_id": 0, "id": 1})
        if existing:
            name_to_id[key] = existing["id"]
            continue
        cid = new_id()
        await db.contacts.insert_one({
            "id": cid, "tenant_id": tenant_id, "type": ctype, "name": name,
            "company": c.get("company", "") or "", "phone": c.get("phone", "") or "",
            "email": c.get("email", "") or "", "address": c.get("address", "") or "",
            "tax_id": c.get("tax_id", "") or "", "tags": ["imported"], "status": "active",
            "assigned_id": None, "notes": "", "created_by": user_id, "created_at": now_iso(),
            "source": source, "ingestion_id": ingestion_id,
        })
        name_to_id[key] = cid
        created["contacts"] += 1

    for inv in records.get("invoices", []):
        itype = inv.get("type") if inv.get("type") in ("sales_invoice", "purchase_bill") else "sales_invoice"
        ctype = "customer" if itype == "sales_invoice" else "vendor"
        cid = await resolve_contact(inv.get("contact_name"), ctype)
        try:
            amount = float(inv.get("amount") or 0)
        except (TypeError, ValueError):
            amount = 0.0
        inv_id = new_id()
        purchase_type = (inv.get("purchase_type") or "").strip().lower()
        if itype == "purchase_bill" and purchase_type not in ("expense", "asset", "inventory"):
            # No silent fallback: an unclassified purchase must be reviewed & classified by a human first.
            raise HTTPException(
                status_code=400,
                detail="Please classify this purchase bill as Expense, Asset, or Inventory before filing.")
        await db.invoices.insert_one({
            "id": inv_id, "tenant_id": tenant_id, "type": itype,
            "number": str(inv.get("number") or ""), "contact_id": cid,
            "contact_name": (inv.get("contact_name") or "").strip(),
            "date": inv.get("date", "") or "", "due_date": inv.get("due_date", "") or "",
            "amount": amount, "currency": inv.get("currency") or currency,
            "status": "unpaid", "line_items": inv.get("line_items") if isinstance(inv.get("line_items"), list) else [],
            "purchase_type": purchase_type if itype == "purchase_bill" else "",
            "source": source, "ingestion_id": ingestion_id, "created_by": user_id, "created_at": now_iso(),
        })
        created["invoices"] += 1
        # A purchase bill (money we OWE) is segregated by WHAT was bought: asset, inventory, or expense.
        if itype == "purchase_bill":
            vend = (inv.get("contact_name") or "Vendor").strip()
            li_text = " ".join(str(li.get("description", "")) for li in (inv.get("line_items") or []) if isinstance(li, dict))
            inv_cur = inv.get("currency") or currency
            if purchase_type == "asset":
                _aname = (inv.get("asset_name") or li_text[:60] or f"Asset from {vend}").strip()
                await create_asset(tenant_id, user_id, {
                    "name": _aname,
                    "category": inv.get("asset_category") or guess_asset_category(f"{_aname} {li_text}"),
                    "purchase_amount": amount, "currency": inv_cur,
                    "purchase_date": inv.get("date") or "", "vendor_name": vend,
                    "notes": f"From bill {inv.get('number') or ''} · {li_text[:150]}".strip(),
                }, source=source)
                created["assets"] = created.get("assets", 0) + 1
            elif purchase_type == "inventory":
                try:
                    qty = float(inv.get("inventory_qty") or 0) or 1
                except (TypeError, ValueError):
                    qty = 1
                await create_inventory(tenant_id, user_id, {
                    "item": (li_text[:60] or f"Stock from {vend}").strip(),
                    "quantity": qty, "unit": (inv.get("inventory_unit") or "unit").strip(),
                    "unit_cost": round(amount / qty, 2) if qty else amount,
                    "currency": inv_cur, "vendor_name": vend,
                    "notes": f"From bill {inv.get('number') or ''}".strip(),
                }, source=source)
                created["inventory"] = created.get("inventory", 0) + 1
            else:
                await create_expense(tenant_id, user_id, {
                    "title": f"{vend} — Bill {inv.get('number') or ''}".strip(),
                    "amount": amount, "currency": inv_cur,
                    "vendor_name": vend, "vendor_id": cid,
                    "date": inv.get("date") or "", "status": "unpaid",
                    "invoice_id": inv_id, "ingestion_id": ingestion_id, "notes": li_text[:200],
                }, source=source)
                created["expenses"] += 1

    for p in records.get("payments", []):
        _raw_dir = str(p.get("direction") or "").strip().lower()
        direction = "out" if _raw_dir in ("out", "outgoing", "outbound", "debit", "paid", "sent") else "in"
        ctype = "customer" if direction == "in" else "vendor"
        cid = await resolve_contact(p.get("contact_name"), ctype)
        try:
            amount = float(p.get("amount") or 0)
        except (TypeError, ValueError):
            amount = 0.0
        pay_id = new_id()
        await db.payments.insert_one({
            "id": pay_id, "tenant_id": tenant_id, "direction": direction, "amount": amount,
            "date": p.get("date", "") or "", "method": p.get("method", "") or "",
            "reference": p.get("reference", "") or "", "contact_id": cid,
            "contact_name": (p.get("contact_name") or "").strip(),
            "invoice_number": str(p.get("invoice_number") or ""), "currency": currency,
            "source": source, "ingestion_id": ingestion_id, "created_by": user_id, "created_at": now_iso(),
        })
        created["payments"] += 1
        pay_doc = {"id": pay_id, "direction": direction, "amount": amount, "applied": 0, "applications": [],
                   "date": p.get("date") or "", "contact_name": (p.get("contact_name") or "").strip(),
                   "invoice_number": str(p.get("invoice_number") or ""), "reference": p.get("reference") or ""}
        from routers.ledger import reconcile_payment
        # Auto-allocate against an open invoice/bill. Anything left unlinked (either direction)
        # waits in the Needs-matching queue — supplier payments no longer silently create an expense.
        await reconcile_payment(tenant_id, pay_doc, matched_by="auto")

    for t in records.get("tasks", []):
        title = (t.get("title") or "").strip()
        if not title:
            continue
        due = None
        if isinstance(t.get("due_in_days"), int):
            due = (datetime.now(timezone.utc) + timedelta(days=t["due_in_days"])).isoformat()
        await db.tasks.insert_one({
            "id": new_id(), "tenant_id": tenant_id, "title": title, "description": "",
            "assignee_role": followup_role, "assignee_id": None,
            "priority": t.get("priority", "medium") if t.get("priority") in ("low", "medium", "high") else "medium",
            "status": "todo", "due_date": due, "decision_id": None,
            "source": "ingest", "created_at": now_iso(),
        })
        created["tasks"] += 1

    return created


DOC_MIME = {"pdf": "application/pdf", "png": "image/png", "jpg": "image/jpeg",
            "jpeg": "image/jpeg", "webp": "image/webp"}


def _classify_ingestion(doc: dict) -> str:
    dt = doc.get("doc_type")
    if dt in ("sales_invoice", "purchase_bill"):
        return "invoice"
    if dt == "payment":
        return "payment"
    if dt == "purchase_order":
        return "task"
    ent = doc.get("entity")
    if ent == "customers":
        return "customer"
    if ent == "vendors":
        return "supplier"
    if ent == "invoices":
        return "invoice"
    if ent == "payments":
        return "payment"
    recs = doc.get("records") or {}
    if recs.get("invoices"):
        return "invoice"
    if recs.get("payments"):
        return "payment"
    if recs.get("contacts"):
        return "customer"
    return "task"


# A re-uploaded bill keeps its own invoice date; a recurring identical bill (rent,
# subscriptions) lands weeks/months later. Only the former is a duplicate, so the
# amount+contact signal is gated to this window. Env-overridable.
INVOICE_DUP_WINDOW_DAYS = int(os.environ.get("INVOICE_DUP_WINDOW_DAYS", "7"))


def _norm_inv_num(n) -> str:
    """Normalize an invoice number for duplicate comparison: casefold + drop every
    non-alphanumeric, so 'INV-001', 'INV 001', 'inv/001' and 'inv001' all match
    (OCR and manual entry vary the separators)."""
    return re.sub(r"[^a-z0-9]", "", str(n or "").lower())


def _norm_contact(n) -> str:
    return re.sub(r"\s+", " ", str(n or "").strip().lower())


def _days_between(d1: str, d2: str):
    """Absolute day gap between two YYYY-MM-DD strings, or None if either won't parse."""
    try:
        a = datetime.strptime((d1 or "")[:10], "%Y-%m-%d")
        b = datetime.strptime((d2 or "")[:10], "%Y-%m-%d")
        return abs((a - b).days)
    except (ValueError, TypeError):
        return None


def _dup_reason(inv: dict, cand: dict, window_days: int = INVOICE_DUP_WINDOW_DAYS):
    """Pure duplicate decision between an incoming invoice and one already on file.
    Returns 'number' | 'amount_window' | None. Kept pure (no DB) so the false-positive
    traps -- cross-vendor number reuse and recurring identical bills -- are exhaustively
    unit-testable. E3-06.2."""
    inum, cnum = _norm_inv_num(inv.get("number")), _norm_inv_num(cand.get("number"))
    iname, cname = _norm_contact(inv.get("contact_name")), _norm_contact(cand.get("contact_name"))
    # Rule 1 -- same normalized number, unique only per vendor: require the same contact
    # (or an unknown contact on either side, where we can't scope and accept the weaker match).
    if inum and inum == cnum and (not iname or not cname or iname == cname):
        return "number"
    # Rule 2 -- same amount + same vendor within a short window: a re-upload, not a recurring bill.
    try:
        iamt, camt = float(inv.get("amount") or 0), float(cand.get("amount") or 0)
    except (TypeError, ValueError):
        iamt = camt = 0.0
    if iamt and iamt == camt and iname and iname == cname:
        gap = _days_between((inv.get("date") or "")[:10], (cand.get("date") or "")[:10])
        if gap is None or gap <= window_days:
            return "amount_window"
    return None


async def _candidate_invoices(tenant_id: str, inv: dict):
    """Fetch the small pool of already-filed invoices worth comparing against `inv`:
    the same vendor's invoices when the vendor is known, else (number-only case) a
    capped tenant-wide pool. Bounded so the Python-side comparison stays cheap."""
    proj = {"_id": 0, "id": 1, "number": 1, "amount": 1, "contact_name": 1, "date": 1}
    cname_raw = (inv.get("contact_name") or "").strip()
    if cname_raw:
        return await db.invoices.find(
            {"tenant_id": tenant_id, "contact_name": {"$regex": f"^{re.escape(cname_raw)}$", "$options": "i"}},
            proj).to_list(500)
    if _norm_inv_num(inv.get("number")):  # no vendor -> number rule only, over a capped pool
        return await db.invoices.find({"tenant_id": tenant_id}, proj).to_list(500)
    return []


async def _find_duplicate_invoice(tenant_id: str, records: dict):
    """Return an already-filed invoice that looks like a duplicate of one in `records`, else None.

    E3-06.2 hardening. A duplicate is the SAME bill filed twice (double-entry risk). We match
    on what a re-upload preserves (normalized number, or amount+vendor+near-date) while dodging
    two false-positive traps handled in _dup_reason: per-vendor number reuse and recurring
    identical bills. Never raises -- a failed check must not break the ingest/capture flow."""
    for inv in (records or {}).get("invoices", []):
        try:
            for cand in await _candidate_invoices(tenant_id, inv):
                if _dup_reason(inv, cand):
                    return cand
        except Exception as e:  # never break the capture/ingest flow
            logger.warning(f"_find_duplicate_invoice check failed: {e}")
    return None


def _payment_dup_reason(pay: dict, cand: dict, window_days: int = INVOICE_DUP_WINDOW_DAYS):
    """Pure duplicate decision between an incoming payment and one already on file (E3-06.5).
    Returns 'reference' | 'invoice_amount' | 'amount_window' | None. Mirrors _dup_reason but for
    payments: a transaction reference (UTR/cheque/txn id) is globally unique so it's the strongest
    signal; else the same invoice paid the same amount; else amount+party within a window (a
    re-upload, not a recurring EMI/subscription)."""
    pref, cref = _norm_inv_num(pay.get("reference")), _norm_inv_num(cand.get("reference"))
    if pref and pref == cref:
        return "reference"
    try:
        pamt, camt = float(pay.get("amount") or 0), float(cand.get("amount") or 0)
    except (TypeError, ValueError):
        pamt = camt = 0.0
    pinv, cinv = _norm_inv_num(pay.get("invoice_number")), _norm_inv_num(cand.get("invoice_number"))
    if pinv and pinv == cinv and pamt and pamt == camt:
        return "invoice_amount"
    pname, cname = _norm_contact(pay.get("contact_name")), _norm_contact(cand.get("contact_name"))
    if pamt and pamt == camt and pname and pname == cname:
        gap = _days_between((pay.get("date") or "")[:10], (cand.get("date") or "")[:10])
        if gap is None or gap <= window_days:
            return "amount_window"
    return None


async def _candidate_payments(tenant_id: str, pay: dict):
    """Fetch the small pool of filed payments worth comparing against `pay`: those sharing its
    party or its transaction reference. Empty when neither is known (can't dedup reliably)."""
    proj = {"_id": 0, "id": 1, "reference": 1, "amount": 1, "contact_name": 1, "date": 1, "invoice_number": 1}
    clauses = []
    cname = (pay.get("contact_name") or "").strip()
    ref = (pay.get("reference") or "").strip()
    if cname:
        clauses.append({"contact_name": {"$regex": f"^{re.escape(cname)}$", "$options": "i"}})
    if ref:
        clauses.append({"reference": {"$regex": f"^{re.escape(ref)}$", "$options": "i"}})
    if not clauses:
        return []
    return await db.payments.find({"tenant_id": tenant_id, "$or": clauses}, proj).to_list(500)


async def _find_duplicate_payment(tenant_id: str, records: dict):
    """Return an already-filed payment that looks like a duplicate of one in `records`, else None
    (E3-06.5). Same double-entry protection as invoices, for money going out/in. Never raises."""
    for pay in (records or {}).get("payments", []):
        try:
            for cand in await _candidate_payments(tenant_id, pay):
                if _payment_dup_reason(pay, cand):
                    return cand
        except Exception as e:  # never break the capture/ingest flow
            logger.warning(f"_find_duplicate_payment check failed: {e}")
    return None


async def _find_duplicate_record(tenant_id: str, records: dict):
    """Duplicate check across BOTH money records in a capture: an invoice OR a payment filed
    twice. Returns the first duplicate found (a dict with 'id'), else None. E3-06.5."""
    return (await _find_duplicate_invoice(tenant_id, records)
            or await _find_duplicate_payment(tenant_id, records))
