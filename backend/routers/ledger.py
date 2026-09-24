"""Finance / Ledger: Expenses, Assets & Inventory + roll-up from captured invoices/payments.

Foundation (db, LLM config, auth deps, helpers) comes from `core` — this module does
NOT import from `server`, so there is no circular dependency. Approved purchase
bills / outgoing payments auto-create Expenses, and every record ingested from an
API/document source is also written into the Company Brain (memory) so finance is
queryable alongside decisions.
"""
import asyncio
import json
import re
from pathlib import Path
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, File, Form, UploadFile, Query
from pydantic import BaseModel

from emergentintegrations.llm.chat import LlmChat, UserMessage, FileContentWithMimeType

from core import (
    db, claude_chat, EMERGENT_LLM_KEY, VISION_MODEL,
    _extract_json, new_id, now_iso, logger, log_usage, _est_tokens,
    get_current_user, user_perms, log_activity, require_perm,
)
# FIX-007-B (S4-10): Brain-context writes for finance events so
# "how did we settle the Kapoor invoice?" queries can find the answer.
import time
from services.ai import brain_context
from core import model_for, record_ai_call
from prompts import render

router = APIRouter(prefix="/api")

UPLOAD_DIR = Path(__file__).resolve().parent.parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

EXPENSE_CATEGORIES = [
    "Raw Material", "Salary & Wages", "Rent", "Utilities", "Logistics & Freight",
    "Marketing", "Professional Services", "Asset Purchase", "Maintenance & Repairs",
    "Taxes & Duties", "Office Supplies", "Other",
]
ASSET_CATEGORIES = ["Machinery", "Equipment", "Vehicle", "Furniture", "IT & Electronics", "Building", "Other"]

_CATEGORY_KEYWORDS = [
    ("Salary & Wages", ["salary", "wage", "payroll", "stipend", "bonus"]),
    ("Rent", ["rent", "lease"]),
    ("Utilities", ["electric", "power bill", "water bill", "gas bill", "internet", "broadband", "telephone", "utility"]),
    ("Logistics & Freight", ["freight", "transport", "courier", "shipping", "logistics", "cartage", "delivery"]),
    ("Marketing", ["advertis", "marketing", "promo", "campaign", "branding", "hoarding"]),
    ("Professional Services", ["consult", "audit", "legal", "lawyer", "accountant", "professional", "service fee", "retainer"]),
    ("Asset Purchase", ["machine", "machinery", "equipment", "vehicle", "laptop", "computer", "furniture", "plant", "generator"]),
    ("Maintenance & Repairs", ["repair", "maintenance", "amc", "spare part", "servicing"]),
    ("Taxes & Duties", ["gst", "tds", "income tax", "duty", "cess", "customs", "tax payment"]),
    ("Office Supplies", ["stationery", "office supplies", "printer", "cartridge", "toner"]),
    ("Raw Material", ["raw material", "yarn", "fabric", "cotton", "cloth", "thread", "dye", "chemical", "spindle", "material"]),
]


def guess_expense_category(text: str) -> str:
    t = (text or "").lower()
    for cat, kws in _CATEGORY_KEYWORDS:
        if any(k in t for k in kws):
            return cat
    return "Other"


_ASSET_KEYWORDS = [
    ("IT & Electronics", ["computer", "laptop", "desktop", "server", "switch", "router", "firewall",
                          "monitor", "printer", "scanner", "ups", "network", "cctv", "camera", "biometric",
                          "appliance", "rack", "patch panel", "cabling", "cable", "phone", "mobile", "tablet",
                          "hardware", "electronic", "poe", "nvr", "storage", "nas", "projector"]),
    ("Vehicle", ["vehicle", "truck", "van", "car", "bike", "scooter", "forklift", "tempo", "lorry", "trailer"]),
    ("Machinery", ["machine", "machinery", "cnc", "lathe", "mill", "press", "motor", "pump", "compressor",
                   "generator", "plant", "boiler", "turbine", "conveyor"]),
    ("Furniture", ["furniture", "chair", "table", "desk", "cabinet", "shelf", "sofa", "workstation", "cupboard"]),
    ("Building", ["building", "land", "property", "construction", "warehouse", "office space", "premises", "godown"]),
    ("Equipment", ["equipment", "tool", "instrument", "device", "kit", "apparatus", "meter", "gauge"]),
]


def guess_asset_category(text: str) -> str:
    t = (text or "").lower()
    for cat, kws in _ASSET_KEYWORDS:
        if any(k in t for k in kws):
            return cat
    return "Other"


async def get_finance_categories(tenant_id: str) -> dict:
    """The company's AI-generated finance categories (falls back to defaults for legacy tenants)."""
    t = await db.tenants.find_one({"id": tenant_id}, {"_id": 0, "finance_categories": 1})
    fc = (t or {}).get("finance_categories") or {}
    return {"expense": fc.get("expense") or list(EXPENSE_CATEGORIES),
            "asset": fc.get("asset") or list(ASSET_CATEGORIES)}


def _match_category(value, allowed, fallback="Other") -> str:
    """Case-insensitively snap a value onto the allowed list; else return fallback."""
    v = str(value or "").strip()
    if not v:
        return fallback
    for a in allowed:
        if a.lower() == v.lower():
            return a
    return fallback


async def ai_suggest_expense_category(text: str, tenant_id: str) -> str:
    text = (text or "").strip()
    if not text:
        return "Other"
    cats = (await get_finance_categories(tenant_id))["expense"]
    try:
        system = render("ledger.expense_cat", cats=", ".join(cats))
        chat = claude_chat(task="ledger.expense_cat", session_id=f"expcat-{tenant_id}", system_message=system).with_model(*model_for("ledger.expense_cat"))
        resp = await chat.send_message(UserMessage(text=text[:600]))
        data = _extract_json(resp) or {}
        matched = _match_category(data.get("category"), cats, "")
        if matched:
            return matched
    except Exception as e:  # noqa: BLE001
        logger.warning(f"AI expense categorization failed, using heuristic: {e}")
    return _match_category(guess_expense_category(text), cats, "Other")


async def _currency(tenant_id: str) -> str:
    t = await db.tenants.find_one({"id": tenant_id}, {"_id": 0, "currency": 1})
    return (t or {}).get("currency") or "INR"


# Indian scale words -> multiplier. lakh = 1e5, crore = 1e7.
_AMT_SCALE = {"lakh": 1e5, "lakhs": 1e5, "lac": 1e5, "lacs": 1e5,
              "crore": 1e7, "crores": 1e7, "cr": 1e7}


def parse_amount(x) -> float:
    """Tolerant money/quantity parse (E3-06.7): plain numbers pass through; strings may carry
    currency tokens (Rs / Rs. / ₹ / INR), Indian comma grouping (1,20,000), and scale words
    (lakh / crore / cr) -- so an OCR'd or typed '₹2.5 lakh' becomes 250000.0. Never raises."""
    if isinstance(x, (int, float)):
        return float(x)
    s = str(x or "").strip().lower()
    if not s:
        return 0.0
    s = re.sub(r"(₹|rs\.?|inr)", " ", s)          # drop currency tokens
    mult = 1.0
    m = re.search(r"\b(lakhs?|lacs?|crores?|cr)\b", s)  # detect + strip a scale word
    if m:
        mult = _AMT_SCALE.get(m.group(1), 1.0)
        s = s[:m.start()] + s[m.end():]
    s = s.replace(",", "")
    m2 = re.search(r"-?\d+(?:\.\d+)?", s)          # first number in what's left
    if not m2:
        return 0.0
    try:
        return float(m2.group(0)) * mult
    except ValueError:
        return 0.0


def _num(x) -> float:
    return parse_amount(x)


async def _write_brain(tenant_id: str, user_id: str, text: str, tag: str) -> None:
    """Mirror a finance record into the Company Brain (searchable memory)."""
    await db.memory.insert_one({
        "id": new_id(), "tenant_id": tenant_id, "text": text, "tag": tag,
        "created_by": user_id, "created_at": now_iso(),
    })


# --- Attachment + AI vision extraction from an uploaded bill/photo ----------
async def _save_upload_async(tenant_id: str, content: bytes, filename: str,
                             content_type: str = None) -> dict:
    """FIX-002-E: uploads go to obj_store under `decisionos/{tenant}/ledger/`.
    Returns storage_path so the caller can materialize to temp for OCR."""
    from services.uploads import store_upload
    ext = (filename.rsplit(".", 1)[-1] if "." in (filename or "") else "bin").lower()
    stored = await store_upload(tenant_id, "ledger", content, ext, content_type=content_type)
    # Keep the fname + url shape so existing frontends continue rendering the
    # attachment (the /api/files endpoint resolves storage_path via db lookup).
    fid = stored["file_id"]
    fname = f"ledger-{fid}.{ext}"
    return {
        "fname": fname,
        "storage_path": stored["storage_path"],
        "url": f"/api/files/{fname}",
        "filename": filename or fname,
    }


_LEDGER_FIELDS = {
    "expense": (
        "an EXPENSE (a bill, invoice, receipt, or a payment the company made)",
        '{"title": str, "amount": number, "vendor_name": str, "date": "YYYY-MM-DD", '
        '"category": "<one category>", "notes": str}',
    ),
    "asset": (
        "a company ASSET purchase (machinery, equipment, vehicle, furniture, IT/electronics, building)",
        '{"name": str, "purchase_amount": number, "vendor_name": str, "purchase_date": "YYYY-MM-DD", '
        '"category": "<one category>", "notes": str}',
    ),
    "inventory": (
        "an INVENTORY / stock item purchase",
        '{"item": str, "sku": str, "quantity": number, "unit": str, "unit_cost": number, '
        '"category": str, "vendor_name": str, "notes": str}',
    ),
    "income": (
        "a SALE or SERVICE INCOME the company EARNED — a sales invoice or service bill YOU issued to a CUSTOMER (money coming IN)",
        '{"title": str, "customer_name": str, "amount": number, "number": str, '
        '"date": "YYYY-MM-DD", "due_date": "YYYY-MM-DD", "notes": str}',
    ),
}


async def ai_extract_ledger_file(file_path: str, mime_type: str, kind: str, currency: str, typed: dict, categories=None) -> dict:
    """Read an uploaded bill/photo/PDF and return the fields for `kind`, honouring what the user already typed."""
    desc, shape = _LEDGER_FIELDS[kind]
    typed_clean = {k: v for k, v in (typed or {}).items() if v not in (None, "", 0, "0", 0.0)}
    cat_rule = ""
    if kind in ("expense", "asset") and categories:
        cat_rule = f'The "category" MUST be exactly one of: [{", ".join(categories)}]. Pick the closest fit. '
    system = render("ledger.ocr", desc=desc, currency=currency,
                    typed=json.dumps(typed_clean), cat_rule=cat_rule, shape=shape)
    resp = None
    _t0 = time.perf_counter()
    _eng, _ti, _to = None, 0, 0
    # Prefer the user's own Gemini key (same client server.py configures), else the Emergent vision key.
    try:
        from services.vision import _gemini_doc_sync, get_gemini_client
        if get_gemini_client() is not None:
            resp, _gti, _gto = await asyncio.to_thread(_gemini_doc_sync, file_path, mime_type, system, "Extract the JSON now.")
            await log_usage(f"ledger-ocr-{kind}", "gemini", model=VISION_MODEL[1],
                            tokens_in=_gti, tokens_out=_gto, units=1, unit_type="document")
            _eng, _ti, _to = "gemini", _gti, _gto
    except Exception as e:  # noqa: BLE001
        logger.warning(f"Ledger OCR (user gemini) failed, falling back to Emergent key: {e}")
        resp = None
    if not resp:
        fc = FileContentWithMimeType(file_path=file_path, mime_type=mime_type)
        chat = LlmChat(api_key=EMERGENT_LLM_KEY, session_id=f"ledger-ocr-{kind}-{new_id()}",
                       system_message=system).with_model(*model_for("ledger.ocr", "vision"))
        from services.ai.llm_limits import guarded_llm  # FIX-002-B
        resp = await guarded_llm(
            chat.send_message(UserMessage(text="Extract the JSON now.", file_contents=[fc])),
            label=f"gemini:ledger-ocr-{kind}")
        await log_usage(f"ledger-ocr-{kind}", "gemini", model=VISION_MODEL[1],
                        tokens_in=_est_tokens(system), tokens_out=_est_tokens(resp or ""),
                        units=1, unit_type="document")
        _eng, _ti, _to = "emergent", _est_tokens(system), _est_tokens(resp or "")
    try:  # E3-06 robustness: a malformed OCR response must degrade, not crash the ledger flow
        data = _extract_json(resp) or {}
        parse_ok = True
    except Exception as e:  # noqa: BLE001
        logger.warning(f"ai_extract_ledger_file parse failed: {e}")
        data, parse_ok = {}, False
    await record_ai_call(task="ledger.ocr", model=VISION_MODEL[1], engine=_eng,
                         tokens_in=_ti, tokens_out=_to,
                         latency_ms=(time.perf_counter() - _t0) * 1000, ok=True, parse_ok=parse_ok)
    return data


def _merge_typed(ai: dict, typed: dict) -> dict:
    """AI-extracted fields as the base; any non-empty typed value wins."""
    out = dict(ai or {})
    for k, v in (typed or {}).items():
        if v not in (None, "", 0, "0", 0.0):
            out[k] = v
    return out


# --- Create helpers (also used by the ingestion roll-up in server.py) -------
async def create_expense(tenant_id: str, user_id: str, data: dict, source: str = "manual", write_brain: Optional[bool] = None) -> dict:
    currency = data.get("currency") or await _currency(tenant_id)
    amount = _num(data.get("amount"))
    cats = (await get_finance_categories(tenant_id))["expense"]
    category = _match_category(data.get("category"), cats, "")
    if not category:
        category = _match_category(
            guess_expense_category(f"{data.get('title', '')} {data.get('vendor_name', '')} {data.get('notes', '')}"),
            cats, "Other")
    eid = new_id()
    # FIX-001-B: allow `awaiting_bill` status so a completed procurement workflow
    # can pre-create a placeholder expense that Finance later confirms by
    # uploading the actual bill (see server.py::advance_workflow). The two new
    # fields (workflow_id, workflow_type) let the Finance UI trace the expense
    # back to the source workflow card.
    doc = {
        "id": eid, "tenant_id": tenant_id, "title": (data.get("title") or "Expense").strip(),
        "amount": amount, "currency": currency, "category": category,
        "vendor_name": (data.get("vendor_name") or "").strip(), "vendor_id": data.get("vendor_id"),
        "date": data.get("date") or now_iso()[:10],
        "status": data.get("status") if data.get("status") in ("paid", "unpaid", "awaiting_bill") else "unpaid",
        "notes": (data.get("notes") or "").strip(), "source": source,
        # J7 (JOURNEY-1) — "pending" holds a high-value expense out of the books
        # until an owner approves it (see add_expense). None for everything else,
        # which is every expense written before this and most written after.
        "approval_status": data.get("approval_status") or None,
        "invoice_id": data.get("invoice_id"), "payment_id": data.get("payment_id"),
        "ingestion_id": data.get("ingestion_id"),
        "workflow_id": data.get("workflow_id"),
        "workflow_type": data.get("workflow_type"),
        "attachment": data.get("attachment"),
        "created_by": user_id, "created_at": now_iso(),
    }
    await db.expenses.insert_one(dict(doc))
    doc.pop("_id", None)
    if write_brain if write_brain is not None else (source != "manual"):
        vend = f" to {doc['vendor_name']}" if doc["vendor_name"] else ""
        await _write_brain(tenant_id, user_id,
                            f"Expense: {doc['title']} — {currency} {amount:,.0f} ({category}){vend} [{source}]", "expense")
        # FIX-007-B (S4-10): every expense that's brain-worthy (i.e.
        # auto-created from a workflow / ingestion / capture — anything
        # non-manual) ALSO drops a brain_context row so Dex + /ask can
        # cite it as a source. Manual expenses stay Brain-invisible
        # unless the caller explicitly requests write_brain=True.
        try:
            _vend_txt = f" to {doc['vendor_name']}" if doc.get("vendor_name") else ""
            await brain_context.record_context(
                tenant_id=tenant_id, kind="finance",
                title=f"Expense: {doc['title']}"[:220],
                outcome=doc.get("status") or "recorded",
                why=(f"{currency} {amount:,.0f} ({category}){_vend_txt} — {source}"
                      + (f"; notes: {doc['notes']}" if doc.get("notes") else ""))[:800],
                tags=["expense", category] if category else ["expense"],
                source_type="expense", source_id=eid,
                related_ids={"workflow_id": doc.get("workflow_id"),
                              "ingestion_id": doc.get("ingestion_id"),
                              "invoice_id": doc.get("invoice_id"),
                              "vendor_name": doc.get("vendor_name")},
                actor_id=user_id, actor_name="",
                department="finance", visibility="dept",
            )
        except Exception as _e:
            logger.warning(f"S4-10 expense brain_context failed for {eid}: {_e}")
    # An "Asset Purchase" expense also becomes a tracked Asset.
    #
    # J7-07 (JOURNEY-1) — AND THIS IS NOW THE ONLY PLACE THAT HAPPENS. The same
    # bill for the same machine was booked two different ways depending on how
    # it arrived: typed into Finance it became an expense AND an asset, but
    # photographed and filed through the capture inbox it became an asset
    # ALONE — so the money never showed up in what the company had spent. The
    # ingestion route calls this function now (services/ingestion.py), with the
    # asset's own name and category ridden in on `data` so the AI's reading of
    # the bill is not thrown away for a guess.
    if category == "Asset Purchase":
        _aname = (data.get("asset_name") or "").strip() or doc["title"]
        await create_asset(tenant_id, user_id, {
            "name": _aname,
            "category": (data.get("asset_category") or "").strip()
                        or guess_asset_category(f"{_aname} {doc['notes']}"),
            "purchase_amount": amount,
            "currency": currency, "purchase_date": doc["date"], "vendor_name": doc["vendor_name"],
            "expense_id": eid, "notes": data.get("asset_notes") or "Auto-created from expense",
        }, source=source)
    return doc


async def create_asset(tenant_id: str, user_id: str, data: dict, source: str = "manual", write_brain: Optional[bool] = None) -> dict:
    currency = data.get("currency") or await _currency(tenant_id)
    amt = _num(data.get("purchase_amount"))
    cats = (await get_finance_categories(tenant_id))["asset"]
    category = _match_category(data.get("category"), cats, "")
    if not category:
        category = _match_category(guess_asset_category(f"{data.get('name', '')} {data.get('notes', '')}"), cats, "Other")
    doc = {
        "id": new_id(), "tenant_id": tenant_id, "name": (data.get("name") or "Asset").strip(),
        "category": category,
        "purchase_amount": amt, "currency": currency,
        "purchase_date": data.get("purchase_date") or now_iso()[:10],
        "vendor_name": (data.get("vendor_name") or "").strip(), "vendor_id": data.get("vendor_id"),  # PILOT-1 E
        "status": data.get("status") if data.get("status") in ("active", "disposed", "maintenance") else "active",
        "notes": (data.get("notes") or "").strip(), "source": source, "expense_id": data.get("expense_id"),
        "attachment": data.get("attachment"),
        "created_by": user_id, "created_at": now_iso(),
    }
    await db.assets.insert_one(dict(doc))
    doc.pop("_id", None)
    if write_brain if write_brain is not None else (source != "manual"):
        vend = f" from {doc['vendor_name']}" if doc["vendor_name"] else ""
        await _write_brain(tenant_id, user_id,
                            f"Asset acquired: {doc['name']} — {currency} {amt:,.0f} ({doc['category']}){vend} [{source}]", "asset")
    return doc


async def create_inventory(tenant_id: str, user_id: str, data: dict, source: str = "manual", write_brain: Optional[bool] = None) -> dict:
    currency = data.get("currency") or await _currency(tenant_id)
    qty, unit_cost = _num(data.get("quantity")), _num(data.get("unit_cost"))
    doc = {
        "id": new_id(), "tenant_id": tenant_id, "item": (data.get("item") or "Item").strip(),
        "sku": (data.get("sku") or "").strip(), "quantity": qty, "unit": (data.get("unit") or "unit").strip(),
        "unit_cost": unit_cost, "currency": currency, "value": round(qty * unit_cost, 2),
        "category": (data.get("category") or "").strip(), "vendor_name": (data.get("vendor_name") or "").strip(),
        "vendor_id": data.get("vendor_id"),  # PILOT-1 E
        "notes": (data.get("notes") or "").strip(), "source": source,
        "attachment": data.get("attachment"),
        "created_by": user_id, "created_at": now_iso(),
    }
    await db.inventory.insert_one(dict(doc))
    doc.pop("_id", None)
    if write_brain if write_brain is not None else (source != "manual"):
        await _write_brain(tenant_id, user_id,
                            f"Inventory: {qty:g} {doc['unit']} of {doc['item']} @ {currency} {unit_cost:,.0f} "
                            f"= {currency} {doc['value']:,.0f} [{source}]", "inventory")
    return doc


async def create_income(tenant_id: str, user_id: str, data: dict, source: str = "manual") -> dict:
    """Record sale/service INCOME as a sales_invoice (money coming IN). If marked received/paid,
    also logs a payment (direction=in) so the 'received' total reflects real cash."""
    currency = data.get("currency") or await _currency(tenant_id)
    amount = _num(data.get("amount"))
    status = data.get("status") if data.get("status") in ("paid", "unpaid") else "unpaid"
    received = bool(data.get("received")) or status == "paid"
    inv_id = new_id()
    cust = (data.get("customer_name") or data.get("contact_name") or "").strip()
    doc = {
        "id": inv_id, "tenant_id": tenant_id, "type": "sales_invoice",
        "number": str(data.get("number") or "").strip(), "contact_id": data.get("contact_id"),
        "contact_name": cust, "title": (data.get("title") or "").strip(),
        "date": data.get("date") or now_iso()[:10], "due_date": data.get("due_date") or "",
        "amount": amount, "currency": currency, "status": "paid" if received else status,
        "amount_paid": amount if received else 0,
        "line_items": [], "purchase_type": "", "attachment": data.get("attachment"),
        "source": source, "created_by": user_id, "created_at": now_iso(),
    }
    await db.invoices.insert_one(dict(doc))
    doc.pop("_id", None)
    label = doc["title"] or ("Sale to " + cust if cust else "Sale")
    frm = f" from {cust}" if cust else ""
    await _write_brain(tenant_id, user_id,
                       f"Income: {label} — {currency} {amount:,.0f}{frm} [{source}]", "income")
    # FIX-007-B (S4-10): capture the invoice creation as a queryable
    # Brain event. Sales invoices are the mirror of expenses; the
    # tracker's gap called out "invoices" specifically.
    try:
        await brain_context.record_context(
            tenant_id=tenant_id, kind="finance",
            title=f"Invoice: {label}"[:220],
            outcome="paid" if received else (doc.get("status") or "unpaid"),
            why=(f"{currency} {amount:,.0f}{frm} — {source}"
                  + (f"; #{doc['number']}" if doc.get("number") else ""))[:800],
            tags=["invoice", "income"],
            source_type="invoice", source_id=inv_id,
            related_ids={"contact_name": cust or None,
                          "invoice_number": doc.get("number") or None},
            actor_id=user_id, actor_name="",
            department="finance", visibility="dept",
        )
    except Exception as _e:
        logger.warning(f"S4-10 invoice brain_context failed for {inv_id}: {_e}")
    if received:
        await db.payments.insert_one({
            "id": new_id(), "tenant_id": tenant_id, "direction": "in", "amount": amount,
            "date": doc["date"], "method": (data.get("method") or "").strip(),
            "reference": doc["number"], "contact_name": cust, "invoice_number": doc["number"],
            "invoice_id": inv_id, "applied": amount, "applications": [{"invoice_id": inv_id, "amount": amount, "at": now_iso()}],
            "match_status": "matched", "matched_by": "manual",
            "source": source, "created_by": user_id, "created_at": now_iso(),
        })
    return doc


# --- Payment ↔ invoice reconciliation --------------------------------------
def _norm_name(s) -> str:
    return " ".join(str(s or "").lower().split())


def _norm_num(s) -> str:
    return "".join(ch for ch in str(s or "").lower() if ch.isalnum())


def _parse_dt(s):
    from datetime import datetime
    try:
        return datetime.strptime(str(s or "")[:10], "%Y-%m-%d")
    except (ValueError, TypeError):
        return None


def _remaining(inv: dict) -> float:
    return round(_num(inv.get("amount")) - _num(inv.get("amount_paid")), 2)


async def _open_invoices(tenant_id: str, direction: str) -> list:
    inv_type = "sales_invoice" if direction == "in" else "purchase_bill"
    rows = await db.invoices.find(
        {"tenant_id": tenant_id, "type": inv_type, "status": {"$ne": "paid"}}, {"_id": 0}).to_list(3000)
    return [r for r in rows if _remaining(r) > 0.01]


async def _find_matching_invoice(tenant_id: str, direction: str, payment: dict):
    """Smart match: invoice NUMBER, else same party + exact amount + date within ~30 days.
    Returns the single matching invoice, or None if no confident/unambiguous match."""
    candidates = await _open_invoices(tenant_id, direction)
    if not candidates:
        return None
    amt = _num(payment.get("amount"))
    pnum = _norm_num(payment.get("invoice_number")) or _norm_num(payment.get("reference"))
    if pnum:
        num_matches = [c for c in candidates if _norm_num(c.get("number")) and _norm_num(c.get("number")) == pnum]
        if len(num_matches) == 1:
            return num_matches[0]
        if len(num_matches) > 1:
            return None  # ambiguous → human review
    pname = _norm_name(payment.get("contact_name"))
    if not pname or amt <= 0:
        return None
    pdate = _parse_dt(payment.get("date"))
    smart = []
    for c in candidates:
        if _norm_name(c.get("contact_name")) != pname:
            continue
        if abs(_remaining(c) - amt) > 0.01:  # exact settlement of the outstanding balance
            continue
        cdate = _parse_dt(c.get("date"))
        if pdate and cdate and abs((pdate - cdate).days) > 30:
            continue
        smart.append(c)
    return smart[0] if len(smart) == 1 else None


def _pay_remaining(p: dict) -> float:
    return round(_num(p.get("amount")) - _num(p.get("applied")), 2)


_APPLY_MAX_RETRIES = 5


async def _apply_payment_to_invoice(tenant_id: str, invoice: dict, payment: dict, matched_by: str, max_amount=None) -> float:
    """Allocate the payment's UNAPPLIED balance to this invoice, never overpaying it.
    Any leftover stays on the payment (surfaces in Needs-matching). Returns the amount applied.
    Mutates the passed invoice/payment dicts so callers can chain allocations in-memory.

    FIX (Epic 10 Testing T10-10.2): the invoice balance write is a COMPARE-AND-SET
    on the prior amount_paid, with a bounded re-read-and-retry when a concurrent
    payment moved the balance between our read and our write. Without this, two
    payments reconciling the same invoice from a stale snapshot both allocated the
    full outstanding balance (double-allocation / lost update). This mirrors the
    workflow engine's stage_version optimistic-concurrency pattern; the invoice's
    own amount_paid is the version. Contention on a single invoice is rare, so a
    small retry bound is plenty; exhausting it applies nothing this pass (the
    payment stays in Needs-matching) rather than risk an over-allocation."""
    total = _num(invoice.get("amount"))
    prior_paid = _num(invoice.get("amount_paid"))
    amt = 0.0
    for _attempt in range(_APPLY_MAX_RETRIES):
        inv_remaining = round(total - prior_paid, 2)
        amt = round(min(inv_remaining, _pay_remaining(payment)), 2)
        if max_amount is not None:
            amt = round(min(amt, _num(max_amount)), 2)
        if amt <= 0.01:
            invoice["amount_paid"] = prior_paid  # keep the passed dict truthful
            return 0.0
        new_paid = round(prior_paid + amt, 2)
        inv_status = "paid" if total > 0 and new_paid + 0.01 >= total else "partial"
        # CAS: only write if amount_paid is STILL what we computed against.
        cas = {"id": invoice["id"], "tenant_id": tenant_id}
        if prior_paid == 0:
            # a freshly-created invoice may store 0, null, or omit the field entirely
            cas["$or"] = [{"amount_paid": 0}, {"amount_paid": None}, {"amount_paid": {"$exists": False}}]
        else:
            cas["amount_paid"] = prior_paid
        res = await db.invoices.update_one(cas, {"$set": {"amount_paid": new_paid, "status": inv_status}})
        if res.modified_count == 1:
            invoice["amount_paid"] = new_paid
            break
        # lost the race -> re-read the live balance and retry against it
        fresh = await db.invoices.find_one(
            {"id": invoice["id"], "tenant_id": tenant_id}, {"_id": 0, "amount_paid": 1})
        if not fresh:
            return 0.0  # invoice vanished (deleted mid-reconcile) -> nothing to apply
        prior_paid = _num(fresh.get("amount_paid"))
    else:
        # extreme contention: give up this pass, leave the payment unmatched
        invoice["amount_paid"] = prior_paid
        return 0.0
    new_applied = round(_num(payment.get("applied")) + amt, 2)
    apps = list(payment.get("applications") or [])
    apps.append({"invoice_id": invoice["id"], "amount": amt, "at": now_iso()})
    pstatus = "matched" if new_applied + 0.01 >= _num(payment.get("amount")) else "partial"
    await db.payments.update_one({"id": payment["id"], "tenant_id": tenant_id},
                                 {"$set": {"applied": new_applied, "applications": apps,
                                           "match_status": pstatus, "matched_by": matched_by,
                                           "invoice_id": apps[0]["invoice_id"]}})
    payment["applied"] = new_applied
    payment["applications"] = apps
    return amt


async def reconcile_payment(tenant_id: str, payment: dict, matched_by: str = "auto"):
    """Try to auto-allocate a payment to an open invoice. Any unallocated balance stays on the
    payment (match_status 'unmatched'/'partial') so it surfaces in the Needs-matching queue."""
    payment.setdefault("applied", 0)
    payment.setdefault("applications", [])
    inv = await _find_matching_invoice(tenant_id, payment.get("direction"), payment)
    if not inv:
        await db.payments.update_one({"id": payment["id"], "tenant_id": tenant_id},
                                     {"$set": {"match_status": payment.get("match_status") or "unmatched"}})
        return None
    await _apply_payment_to_invoice(tenant_id, inv, payment, matched_by)
    # FIX-007-B (S4-10): payment-to-invoice reconciliation is one of the
    # most-asked finance questions ("did Kapoor's payment come in for
    # invoice #422?") — capture it as a Brain event so the answer's a
    # retrieval away.
    try:
        _cur = inv.get("currency") or ""
        _amt = _num(payment.get("amount"))
        _dir = "in" if payment.get("direction") == "in" else "out"
        _party = payment.get("contact_name") or inv.get("contact_name") or ""
        _party_txt = f" from {_party}" if _dir == "in" and _party else \
                      (f" to {_party}" if _party else "")
        await brain_context.record_context(
            tenant_id=tenant_id, kind="finance",
            title=(f"Payment reconciled: {_cur} {_amt:,.0f}{_party_txt}"
                    f" → invoice {inv.get('number') or inv['id']}")[:220],
            outcome=inv.get("status") or "matched",
            why=f"Auto-matched by {matched_by}. Invoice remaining: "
                 f"{_cur} {_num(inv.get('amount')) - _num(inv.get('amount_paid')):,.0f}",
            tags=["payment", "reconciliation", _dir],
            source_type="payment", source_id=payment.get("id") or "",
            related_ids={"invoice_id": inv.get("id"),
                          "invoice_number": inv.get("number"),
                          "contact_name": _party or None},
            actor_id="", actor_name=matched_by or "auto",
            department="finance", visibility="dept",
        )
    except Exception as _e:
        logger.warning(
            f"S4-10 payment reconciliation brain_context failed for "
            f"{payment.get('id')}: {_e}"
        )
    return inv


# --- Access control ---------------------------------------------------------
async def require_ledger(user: dict = Depends(get_current_user)) -> dict:
    """Finance is one permission (2026-09-16). This used to accept "ledger" OR
    "finance", which is how two toggles came to mean the same thing."""
    if user.get("role") == "owner":
        return user
    if "finance" in user_perms(user):
        return user
    raise HTTPException(status_code=403, detail="You don't have access to Finance")


# --- PILOT-1 E: the supplier / customer a finance record is FOR -------------
# The pilot client: "I have added Vendor, but not able to select when adding new
# expense." The expense form's supplier was a plain text box that never read
# CRM, so a supplier added there could not be picked. The finance forms now
# pick from the company's CRM contacts and keep the link (vendor_id /
# contact_id), while a new name can still be typed.
#
# CRM itself sits behind the `people` permission; a finance person without it
# must still be able to pick a supplier. So the pickers read a NARROW list —
# id, name, company, nothing else — behind Finance's own gate, and CRM stays
# closed to them.
PARTY_KINDS = {"vendor": ("vendor",), "customer": ("customer", "dealer")}


@router.get("/ledger/parties")
async def list_parties(kind: str = "vendor", q: Optional[str] = None,
                       limit: int = Query(200, ge=1, le=500), user: dict = Depends(require_ledger)):
    """Suppliers (kind=vendor) or buyers (kind=customer: customers and dealers)
    for a finance form's picker. Only what a picker needs to show."""
    types = PARTY_KINDS.get(kind)
    if not types:
        raise HTTPException(status_code=400, detail="kind must be vendor or customer")
    query = {"tenant_id": user["tenant_id"], "type": {"$in": list(types)}}
    if q and q.strip():
        rx = {"$regex": re.escape(q.strip()), "$options": "i"}
        query["$or"] = [{"name": rx}, {"company": rx}]
    rows = await db.contacts.find(query, {"_id": 0, "id": 1, "name": 1, "company": 1, "type": 1}) \
        .sort("name", 1).to_list(limit)
    return [{"id": r["id"], "name": r.get("name") or r.get("company") or "", "company": r.get("company") or "",
             "type": r.get("type")} for r in rows if r.get("id")]


class NewPartyInput(BaseModel):
    kind: str = "vendor"
    name: str


@router.post("/ledger/parties")
async def add_party(inp: NewPartyInput, user: dict = Depends(require_ledger)):
    """J2-04 (JOURNEY-1) — ADD A SUPPLIER FROM THE EXPENSE FORM.

    A wholesaler typed the mill's name on her first bill, and it stayed a name:
    nothing in the app ever became a supplier, so the supplier page never
    counted her oil and the next bill was typed again from memory. The picker
    offered "use this name", and the only way to make it real was CRM — which
    Finance does not necessarily have.

    So this is the same narrow door GET /ledger/parties already is: behind
    Finance's own permission, and it creates a CONTACT WITH A NAME and nothing
    else. It does not open CRM, and it cannot edit anybody who is already
    there. A supplier is Active, not a Lead — you are adding them because you
    are paying them (J2-07)."""
    types = PARTY_KINDS.get(inp.kind)
    if not types:
        raise HTTPException(status_code=400, detail="kind must be vendor or customer")
    name = (inp.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Give the contact a name")
    tid = user["tenant_id"]
    ctype = "vendor" if inp.kind == "vendor" else "customer"
    existing = await db.contacts.find_one(
        {"tenant_id": tid, "type": {"$in": list(types)},
         "name": {"$regex": f"^{re.escape(name)}$", "$options": "i"}},
        {"_id": 0, "id": 1, "name": 1, "company": 1, "type": 1})
    if existing:                    # already there: link to them, don't duplicate
        return {**existing, "already_existed": True}
    cid = new_id()
    await db.contacts.insert_one({
        "id": cid, "tenant_id": tid, "type": ctype, "name": name, "company": "",
        "phone": "", "email": "", "address": "", "tax_id": "", "tags": [],
        "status": "active" if ctype == "vendor" else "lead",
        "assigned_id": None, "notes": f"Added from a {inp.kind} field in Finance.",
        "lifecycle_stage": "", "created_by": user["id"], "created_at": now_iso(),
    })
    await log_activity(tid, user["id"], "contact_added", f"Added {ctype} '{name}' from Finance", "contact", cid)
    return {"id": cid, "name": name, "company": "", "type": ctype, "already_existed": False}


async def _linked_party(tenant_id: str, contact_id: str, kind: str) -> Optional[dict]:
    """The CRM contact a record is being linked to, or None when none was sent.
    A link to someone who is not in this company's CRM, or not that kind of
    contact, is refused rather than stored: a record pointing at nobody is how
    a supplier's spend quietly stops adding up."""
    cid = (contact_id or "").strip()
    if not cid:
        return None
    c = await db.contacts.find_one({"id": cid, "tenant_id": tenant_id, "type": {"$in": list(PARTY_KINDS[kind])}},
                                   {"_id": 0, "id": 1, "name": 1, "company": 1})
    if not c:
        who = "supplier" if kind == "vendor" else "customer"
        raise HTTPException(status_code=400, detail=f"That {who} isn't in your CRM any more — pick again or type the name.")
    return {"id": c["id"], "name": c.get("name") or c.get("company") or ""}


# --- PILOT-1 F: a category added from the form it is needed in ----------------
# Categories are per company (tenant.finance_categories) and Settings > Money
# has always edited them — behind Manage Team, and nowhere near the expense
# being typed. Anyone with Finance access may now ADD one from the category
# list itself; renaming and removing stay in Settings behind Manage Team.
CATEGORY_NAME_MAX = 40


class NewCategoryInput(BaseModel):
    kind: str
    name: str


@router.post("/ledger/categories")
async def add_finance_category(inp: NewCategoryInput, user: dict = Depends(require_ledger)):
    from services.ai.generators import FINANCE_CATEGORY_CAPS
    kind = (inp.kind or "").strip().lower()
    if kind not in ("expense", "asset"):
        raise HTTPException(status_code=400, detail="kind must be expense or asset")
    name = " ".join(str(inp.name or "").split())
    if not name:
        raise HTTPException(status_code=400, detail="Give the category a name.")
    if len(name) > CATEGORY_NAME_MAX:
        raise HTTPException(status_code=400, detail=f"Keep the name under {CATEGORY_NAME_MAX} characters.")
    for _attempt in range(3):
        current = (await get_finance_categories(user["tenant_id"]))[kind]
        same = next((c for c in current if c.lower() == name.lower()), None)
        if same:
            # Already there (in any capitalisation): hand back the one that exists.
            return {"kind": kind, "category": same, "categories": current, "added": False}
        rest = [c for c in current if c.lower() != "other"]
        if len(rest) >= FINANCE_CATEGORY_CAPS[kind]:
            raise HTTPException(status_code=400, detail=(
                f"You already have {len(rest)} {kind} categories, the most there can be. "
                "Ask someone with Manage Team to rename or remove one in Settings."))
        updated = rest + [name, "Other"]
        # Written only if the list is still what was read, so two people adding
        # at the same moment both land (the loser re-reads and adds again).
        t = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0, "finance_categories": 1})
        stored = ((t or {}).get("finance_categories") or {}).get(kind)
        guard = {"id": user["tenant_id"], f"finance_categories.{kind}": stored} if stored else \
                {"id": user["tenant_id"], f"finance_categories.{kind}": {"$exists": False}}
        r = await db.tenants.update_one(guard, {"$set": {f"finance_categories.{kind}": updated}})
        if r.modified_count:
            await log_activity(user["tenant_id"], user["id"], "finance_category_added",
                               f"{user.get('name') or 'Someone'} added the {kind} category '{name}'")
            return {"kind": kind, "category": name, "categories": updated, "added": True}
    raise HTTPException(status_code=409, detail="The categories changed while saving — try again.")


# --- Input models -----------------------------------------------------------










# --- Expenses ---------------------------------------------------------------
# Request models consolidated into models/ (Epic 8 Sprint 5).
from models.finance import (
    ExpenseInput,
    ExpenseApprovalInput,
    AssetInput,
    InventoryInput,
    SuggestCategoryInput,
    ExpensePatch,
    IncomeInput,
    LedgerAskInput,
)


@router.get("/expenses")
async def list_expenses(user: dict = Depends(require_ledger),
                        limit: int = Query(1000, ge=1, le=2000), offset: int = Query(0, ge=0)):
    # S9 (U8-09.4): optional pagination. Defaults reproduce the prior response
    # (newest up to 1000); now index-backed by (tenant_id, created_at).
    return await db.expenses.find({"tenant_id": user["tenant_id"]}, {"_id": 0}) \
        .sort("created_at", -1).skip(offset).limit(limit).to_list(limit)


# J7 (JOURNEY-1) — THE HIGH-VALUE THRESHOLD APPLIES TO EVERY EXPENSE, HOWEVER
# IT IS ENTERED. The owner sets a figure (Settings -> high_value_threshold) and
# a WhatsApp capture above it waits for them. Typed into Finance by hand, the
# same figure went straight into the books: the audit put a Rs 6,00,000 expense
# through as a finance person and nobody was asked anything. A threshold that
# depends on which door the money came through is not a threshold.
#
# What it does NOT do: block the person, or lose what they typed. The expense
# is saved, marked, and left out of the totals until an owner says yes. An
# owner entering their own expense is not asked to approve themselves.
async def _needs_owner_approval(tenant_id: str, user: dict, amount) -> bool:
    if user.get("role") == "owner":
        return False
    try:
        amt = float(amount or 0)
    except (TypeError, ValueError):
        return False
    if amt <= 0:
        return False
    from services.captures import _capture_settings
    threshold, _signoff = await _capture_settings(tenant_id)
    return amt >= threshold


async def _tell_the_owners(tenant_id: str, user: dict, doc: dict) -> None:
    from services.notifications import push_notification, _approver_ids
    approvers = [a for a in await _approver_ids(tenant_id) if a and a != user["id"]]
    if not approvers:
        return
    await push_notification(
        tenant_id, approvers, 2,
        f"{user.get('name') or 'Somebody'} recorded a {doc.get('currency') or ''} "
        f"{_num(doc.get('amount')):,.0f} expense — '{doc.get('title')}'. It needs your approval "
        f"before it counts.",
        entity_type="expense", entity_id=doc["id"], ntype="approval",
        title=doc.get("title"), sender=user.get("name"),
    )


@router.post("/expenses")
async def add_expense(inp: ExpenseInput, user: dict = Depends(require_ledger)):
    data = inp.model_dump()
    held = await _needs_owner_approval(user["tenant_id"], user, data.get("amount"))
    if held:
        data["approval_status"] = "pending"
    doc = await create_expense(user["tenant_id"], user["id"], data, source="manual", write_brain=True)
    await log_activity(user["tenant_id"], user["id"], "expense_added", f"Added expense '{doc['title']}'", "expense", doc["id"])
    if held:
        await _tell_the_owners(user["tenant_id"], user, doc)
    return doc


@router.post("/expenses/{eid}/approval")
async def decide_expense(eid: str, inp: ExpenseApprovalInput,
                         user: dict = Depends(require_perm("approvals"))):
    """J7 — an owner (or anyone who may approve) says yes or no to a high-value
    expense. Yes puts it in the books; no leaves it on the list, marked, so the
    person who typed it can see what happened to it rather than finding it gone."""
    e = await db.expenses.find_one({"id": eid, "tenant_id": user["tenant_id"]}, {"_id": 0})
    if not e:
        raise HTTPException(status_code=404, detail="Expense not found")
    if e.get("approval_status") not in ("pending",):
        raise HTTPException(status_code=400, detail="This expense isn't waiting for approval")
    decision = "approved" if inp.approve else "rejected"
    await db.expenses.update_one(
        {"id": eid, "tenant_id": user["tenant_id"]},
        {"$set": {"approval_status": decision, "approved_by": user["id"],
                  "approved_at": now_iso(), "approval_note": (inp.note or "").strip() or None,
                  "updated_at": now_iso()}})
    await log_activity(user["tenant_id"], user["id"], f"expense_{decision}",
                       f"{decision.title()} expense '{e.get('title')}'", "expense", eid)
    if e.get("created_by") and e["created_by"] != user["id"]:
        from services.notifications import push_notification
        await push_notification(
            user["tenant_id"], [e["created_by"]], 1,
            f"{user.get('name')} {decision} your expense '{e.get('title')}'"
            + (f": {inp.note.strip()}" if (inp.note or "").strip() else ""),
            entity_type="expense", entity_id=eid, ntype=decision,
            title=e.get("title"), sender=user.get("name"))
    return await db.expenses.find_one({"id": eid, "tenant_id": user["tenant_id"]}, {"_id": 0})


ALLOWED_UPLOAD_MIMES = ("image/", "application/pdf")
MAX_UPLOAD_BYTES = 15 * 1024 * 1024  # 15 MB


async def _read_attachment(file: Optional[UploadFile], kind: str, tenant_id: str, typed: dict) -> tuple:
    """Save an optional upload and, when present, AI-extract fields from it. Returns (data, attachment)."""
    data = dict(typed)
    attachment = None
    if file is not None and (file.filename or ""):
        mime = file.content_type or ""
        if not any(mime.startswith(m) for m in ALLOWED_UPLOAD_MIMES):
            raise HTTPException(status_code=415, detail="Only image or PDF bills are supported")
        content = await file.read()
        if len(content) > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail="File is too large (max 15 MB)")
        # FIX-002-E: obj_store with tenant prefix; materialize to temp for OCR.
        saved = await _save_upload_async(tenant_id, content, file.filename, content_type=mime)
        attachment = {"filename": saved["filename"], "url": saved["url"], "mime": mime,
                      "storage_path": saved["storage_path"]}
        from services.uploads import download_to_temp
        import os as _os
        tmp = await download_to_temp(saved["storage_path"])
        try:
            currency = await _currency(tenant_id)
            cats = None
            if kind in ("expense", "asset"):
                fc = await get_finance_categories(tenant_id)
                cats = fc["expense"] if kind == "expense" else fc["asset"]
            ai = await ai_extract_ledger_file(str(tmp), mime or "application/octet-stream", kind, currency, typed, categories=cats)
            data = _merge_typed(ai, typed)
        except Exception as e:  # noqa: BLE001
            logger.warning(f"Ledger {kind} OCR failed, using typed values: {e}")
        finally:
            try:
                _os.unlink(tmp)
            except Exception:
                pass
        data["attachment"] = attachment
    return data, attachment


@router.post("/expenses/with-file")
async def add_expense_with_file(
    title: str = Form(""), amount: str = Form(""), vendor_name: str = Form(""),
    category: str = Form(""), date: str = Form(""), status: str = Form("unpaid"),
    notes: str = Form(""), file: Optional[UploadFile] = File(None),
    vendor_id: str = Form(""),   # PILOT-1 E: the CRM supplier picked in the form
    user: dict = Depends(require_ledger),
):
    typed = {"title": title.strip(), "amount": _num(amount), "vendor_name": vendor_name.strip(),
             "category": category, "date": date, "status": status, "notes": notes.strip()}
    party = await _linked_party(user["tenant_id"], vendor_id, "vendor")
    if party:
        typed.update(vendor_id=party["id"], vendor_name=party["name"])
    data, _ = await _read_attachment(file, "expense", user["tenant_id"], typed)
    if not (str(data.get("title") or "").strip()) and not _num(data.get("amount")):
        raise HTTPException(status_code=400, detail="Add a title/amount or attach a readable bill")
    # J7 — the same threshold as the typed route above; a bill photographed
    # into this form is the same money as one typed into that one.
    held = await _needs_owner_approval(user["tenant_id"], user, data.get("amount"))
    if held:
        data["approval_status"] = "pending"
    doc = await create_expense(user["tenant_id"], user["id"], data, source="manual", write_brain=True)
    await log_activity(user["tenant_id"], user["id"], "expense_added", f"Added expense '{doc['title']}'", "expense", doc["id"])
    if held:
        await _tell_the_owners(user["tenant_id"], user, doc)
    return doc


@router.patch("/expenses/{eid}")
async def update_expense(eid: str, inp: ExpensePatch, user: dict = Depends(require_ledger)):
    updates = {k: v for k, v in inp.model_dump().items() if v is not None}
    if updates.get("category"):
        cats = (await get_finance_categories(user["tenant_id"]))["expense"]
        if updates["category"] not in cats:
            updates.pop("category")
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")
    r = await db.expenses.update_one({"id": eid, "tenant_id": user["tenant_id"]}, {"$set": updates})
    if not r.matched_count:
        raise HTTPException(status_code=404, detail="Expense not found")
    return await db.expenses.find_one({"id": eid}, {"_id": 0})


@router.delete("/expenses/{eid}")
async def delete_expense(eid: str, user: dict = Depends(require_ledger)):
    # E2-65: 404 on non-existent / cross-tenant id -- was silently returning
    # 200 with deleted_count=0, so the UI showed "Deleted!" toast for
    # nothing. Now the toast reflects reality.
    r = await db.expenses.delete_one({"id": eid, "tenant_id": user["tenant_id"]})
    if not r.deleted_count:
        raise HTTPException(status_code=404, detail="Expense not found")
    return {"ok": True}


@router.post("/expenses/suggest-category")
async def suggest_category(inp: SuggestCategoryInput, user: dict = Depends(require_ledger)):
    return {"category": await ai_suggest_expense_category(inp.text, user["tenant_id"])}


# --- Assets -----------------------------------------------------------------
@router.get("/assets")
async def list_assets(user: dict = Depends(require_ledger),
                      limit: int = Query(1000, ge=1, le=2000), offset: int = Query(0, ge=0)):
    return await db.assets.find({"tenant_id": user["tenant_id"]}, {"_id": 0}) \
        .sort("created_at", -1).skip(offset).limit(limit).to_list(limit)


@router.post("/assets")
async def add_asset(inp: AssetInput, user: dict = Depends(require_ledger)):
    doc = await create_asset(user["tenant_id"], user["id"], inp.model_dump(), source="manual", write_brain=True)
    await log_activity(user["tenant_id"], user["id"], "asset_added", f"Added asset '{doc['name']}'", "asset", doc["id"])
    return doc


@router.post("/assets/with-file")
async def add_asset_with_file(
    name: str = Form(""), purchase_amount: str = Form(""), vendor_name: str = Form(""),
    category: str = Form(""), purchase_date: str = Form(""), status: str = Form("active"),
    notes: str = Form(""), file: Optional[UploadFile] = File(None),
    vendor_id: str = Form(""),   # PILOT-1 E
    user: dict = Depends(require_ledger),
):
    typed = {"name": name.strip(), "purchase_amount": _num(purchase_amount), "vendor_name": vendor_name.strip(),
             "category": category, "purchase_date": purchase_date, "status": status, "notes": notes.strip()}
    party = await _linked_party(user["tenant_id"], vendor_id, "vendor")
    if party:
        typed.update(vendor_id=party["id"], vendor_name=party["name"])
    data, _ = await _read_attachment(file, "asset", user["tenant_id"], typed)
    if not (str(data.get("name") or "").strip()):
        raise HTTPException(status_code=400, detail="Add an asset name or attach a readable bill")
    doc = await create_asset(user["tenant_id"], user["id"], data, source="manual", write_brain=True)
    await log_activity(user["tenant_id"], user["id"], "asset_added", f"Added asset '{doc['name']}'", "asset", doc["id"])
    return doc


@router.patch("/assets/{aid}")
async def update_asset(aid: str, inp: AssetInput, user: dict = Depends(require_ledger)):
    updates = inp.model_dump()
    cats = (await get_finance_categories(user["tenant_id"]))["asset"]
    if updates.get("category") not in cats:
        updates.pop("category", None)
    r = await db.assets.update_one({"id": aid, "tenant_id": user["tenant_id"]}, {"$set": updates})
    if not r.matched_count:
        raise HTTPException(status_code=404, detail="Asset not found")
    return await db.assets.find_one({"id": aid}, {"_id": 0})


@router.delete("/assets/{aid}")
async def delete_asset(aid: str, user: dict = Depends(require_ledger)):
    # E2-65: 404 on non-existent / cross-tenant id.
    r = await db.assets.delete_one({"id": aid, "tenant_id": user["tenant_id"]})
    if not r.deleted_count:
        raise HTTPException(status_code=404, detail="Asset not found")
    return {"ok": True}


# --- Inventory --------------------------------------------------------------
@router.get("/inventory")
async def list_inventory(user: dict = Depends(require_ledger),
                         limit: int = Query(1000, ge=1, le=2000), offset: int = Query(0, ge=0)):
    return await db.inventory.find({"tenant_id": user["tenant_id"]}, {"_id": 0}) \
        .sort("created_at", -1).skip(offset).limit(limit).to_list(limit)


@router.post("/inventory")
async def add_inventory(inp: InventoryInput, user: dict = Depends(require_ledger)):
    doc = await create_inventory(user["tenant_id"], user["id"], inp.model_dump(), source="manual", write_brain=True)
    await log_activity(user["tenant_id"], user["id"], "inventory_added", f"Added inventory '{doc['item']}'", "inventory", doc["id"])
    return doc


@router.post("/inventory/with-file")
async def add_inventory_with_file(
    item: str = Form(""), sku: str = Form(""), quantity: str = Form(""), unit: str = Form("unit"),
    unit_cost: str = Form(""), category: str = Form(""), vendor_name: str = Form(""),
    notes: str = Form(""), file: Optional[UploadFile] = File(None),
    vendor_id: str = Form(""),   # PILOT-1 E
    user: dict = Depends(require_ledger),
):
    typed = {"item": item.strip(), "sku": sku.strip(), "quantity": _num(quantity), "unit": unit.strip() or "unit",
             "unit_cost": _num(unit_cost), "category": category.strip(), "vendor_name": vendor_name.strip(), "notes": notes.strip()}
    party = await _linked_party(user["tenant_id"], vendor_id, "vendor")
    if party:
        typed.update(vendor_id=party["id"], vendor_name=party["name"])
    data, _ = await _read_attachment(file, "inventory", user["tenant_id"], typed)
    if not (str(data.get("item") or "").strip()):
        raise HTTPException(status_code=400, detail="Add an item name or attach a readable bill")
    doc = await create_inventory(user["tenant_id"], user["id"], data, source="manual", write_brain=True)
    await log_activity(user["tenant_id"], user["id"], "inventory_added", f"Added inventory '{doc['item']}'", "inventory", doc["id"])
    return doc


@router.patch("/inventory/{iid}")
async def update_inventory(iid: str, inp: InventoryInput, user: dict = Depends(require_ledger)):
    updates = inp.model_dump()
    updates["value"] = round(_num(updates.get("quantity")) * _num(updates.get("unit_cost")), 2)
    r = await db.inventory.update_one({"id": iid, "tenant_id": user["tenant_id"]}, {"$set": updates})
    if not r.matched_count:
        raise HTTPException(status_code=404, detail="Inventory item not found")
    return await db.inventory.find_one({"id": iid}, {"_id": 0})


@router.delete("/inventory/{iid}")
async def delete_inventory(iid: str, user: dict = Depends(require_ledger)):
    # E2-65: 404 on non-existent / cross-tenant id.
    r = await db.inventory.delete_one({"id": iid, "tenant_id": user["tenant_id"]})
    if not r.deleted_count:
        raise HTTPException(status_code=404, detail="Inventory item not found")
    return {"ok": True}


# --- Revenue (sale/service income — money coming IN) ------------------------


@router.get("/revenue")
async def list_revenue(user: dict = Depends(require_ledger)):
    tid = user["tenant_id"]
    currency = await _currency(tid)
    invoices = await db.invoices.find({"tenant_id": tid, "type": "sales_invoice"}, {"_id": 0}).sort("created_at", -1).to_list(3000)
    payments = await db.payments.find({"tenant_id": tid, "direction": "in"}, {"_id": 0}).sort("created_at", -1).to_list(3000)
    # JOURNEY-1 — each invoice says whether it is overdue by the Desk's own
    # rule, so the tile and the page it opens can never disagree again.
    from datetime import datetime as _dt, timezone as _tz
    from services.finance_signals import days_past_due, receivable_overdue
    now = _dt.now(_tz.utc)
    for i in invoices:
        i["balance"] = _remaining(i)
        i["overdue"] = receivable_overdue(i, now)
        i["days_past_due"] = days_past_due(i, now)
    billed = sum(_num(i.get("amount")) for i in invoices)
    received = sum(_num(p.get("amount")) for p in payments)
    outstanding = sum(_remaining(i) for i in invoices if i.get("status") != "paid")
    # Payments (or leftover balances) we couldn't confidently link → surfaced for human matching.
    unmatched = [{**p, "remaining": _pay_remaining(p)} for p in payments
                 if _pay_remaining(p) > 0.01 and p.get("match_status") != "standalone"]
    open_invoices = [i for i in invoices if i.get("status") != "paid" and _remaining(i) > 0.01]
    return {
        "currency": currency,
        "totals": {"billed": round(billed, 2), "received": round(received, 2),
                   "outstanding": round(outstanding, 2),
                   "invoice_count": len(invoices), "payment_count": len(payments),
                   "unmatched_count": len(unmatched)},
        "invoices": invoices, "payments": payments,
        "unmatched_payments": unmatched,
        "open_invoices": [{"id": i["id"], "number": i.get("number"), "title": i.get("title"),
                           "contact_name": i.get("contact_name"), "amount": _num(i.get("amount")),
                           "balance": _remaining(i), "date": i.get("date")} for i in open_invoices],
    }


# J1-11 (JOURNEY-1) — A PURCHASE THE OWNER APPROVED LEAVES A TRACE IN MONEY.
# A founder approved "a second press brake, Rs 18 lakh" on his first day and
# Money showed nothing at all, anywhere. It was not a bug in the books: the
# purchase is a commitment, not a bill, and the expense is written when the
# procurement workflow reaches its last stage (FIX-001-B). But between the
# approval and the bill — which for a machine is weeks — the money was invisible.
#
# So Money now READS the commitment rather than booking it: open purchase
# workflows carrying an amount, listed as approved and not yet billed. Nothing
# is created, no total moves, and the row disappears the moment the real
# expense exists, because that is the same workflow_id.
_BUY_WORDS = {"purchase", "purchases", "purchasing", "procurement", "procure", "buy", "buying",
              "vendor", "vendors", "supplier", "suppliers", "supply", "sourcing",
              "material", "materials", "raw", "stock", "inventory", "capex"}


def _is_purchase_pipeline(*names) -> bool:
    words = set()
    for n in names:
        words |= {w for w in re.split(r"[^a-z]+", str(n or "").lower()) if w}
    return bool(words & _BUY_WORDS)


async def _committed_purchases(tid: str) -> list:
    """Approved purchase workflows with an amount and no bill yet."""
    out = []
    wfs = await db.workflows.find(
        {"tenant_id": tid, "amount": {"$gt": 0}},
        {"_id": 0, "id": 1, "type": 1, "title": 1, "amount": 1, "counterparty": 1,
         "stage": 1, "stages": 1, "decision_id": 1, "created_at": 1},
    ).sort("created_at", -1).to_list(300)
    for w in wfs:
        stages = w.get("stages") or []
        if stages and w.get("stage") == stages[-1]:
            continue                      # finished: the expense is the trace now
        if not _is_purchase_pipeline(w.get("type"), w.get("title")):
            continue
        if await db.expenses.find_one({"tenant_id": tid, "workflow_id": w["id"]}, {"_id": 1}):
            continue                      # already in the books
        out.append({
            "id": w["id"], "title": w.get("title") or "Purchase",
            "amount": _num(w.get("amount")), "counterparty": w.get("counterparty") or "",
            "stage": w.get("stage") or "", "decision_id": w.get("decision_id"),
            "date": (w.get("created_at") or "")[:10],
        })
    return out


@router.get("/payables")
async def list_payables(user: dict = Depends(require_ledger)):
    """Supplier side: open purchase bills + supplier payments needing manual matching."""
    tid = user["tenant_id"]
    currency = await _currency(tid)
    bills = await db.invoices.find({"tenant_id": tid, "type": "purchase_bill"}, {"_id": 0}).sort("created_at", -1).to_list(3000)
    payments = await db.payments.find({"tenant_id": tid, "direction": "out"}, {"_id": 0}).sort("created_at", -1).to_list(3000)
    for b in bills:
        b["balance"] = _remaining(b)
    unmatched = [{**p, "remaining": _pay_remaining(p)} for p in payments
                 if _pay_remaining(p) > 0.01 and p.get("match_status") != "standalone"]
    open_bills = [b for b in bills if b.get("status") != "paid" and _remaining(b) > 0.01]
    committed = await _committed_purchases(tid)
    return {
        "currency": currency,
        "totals": {"unmatched_count": len(unmatched), "open_bill_count": len(open_bills),
                   "payable_outstanding": round(sum(_remaining(b) for b in open_bills), 2)},
        "unmatched_payments": unmatched,
        "open_invoices": [{"id": b["id"], "number": b.get("number"), "title": b.get("title"),
                           "contact_name": b.get("contact_name"), "amount": _num(b.get("amount")),
                           "balance": _remaining(b), "date": b.get("date")} for b in open_bills],
        # J1-11 — approved, not yet billed. Read, never booked (see above).
        "committed": committed,
    }


async def _do_match_payment(tid: str, user: dict, pid: str, invoice_id: str) -> dict:
    pay = await db.payments.find_one({"id": pid, "tenant_id": tid}, {"_id": 0})
    if not pay:
        raise HTTPException(status_code=404, detail="Payment not found")
    inv = await db.invoices.find_one({"id": invoice_id, "tenant_id": tid}, {"_id": 0})
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    applied = await _apply_payment_to_invoice(tid, inv, pay, "manual")
    leftover = _pay_remaining(pay)
    await log_activity(tid, user["id"], "payment_matched",
                       f"Matched {applied:,.0f} of a payment to {inv.get('number') or inv.get('title') or 'invoice'}"
                       + (f" ({leftover:,.0f} still to match)" if leftover > 0.01 else ""), "payment", pid)
    return {"ok": True, "applied": applied, "payment_remaining": leftover, "invoice_status": pay.get("match_status")}


async def _do_standalone_payment(tid: str, user: dict, pid: str) -> dict:
    pay = await db.payments.find_one({"id": pid, "tenant_id": tid}, {"_id": 0})
    if not pay:
        raise HTTPException(status_code=404, detail="Payment not found")
    remaining = _pay_remaining(pay)
    await db.payments.update_one({"id": pid, "tenant_id": tid}, {"$set": {"match_status": "standalone"}})
    # A supplier payment not tied to any bill is genuine spend → book its unallocated part as an expense.
    if pay.get("direction") == "out" and remaining > 0.01:
        existing = await db.expenses.find_one({"tenant_id": tid, "payment_id": pid})
        if not existing:
            await create_expense(tid, user["id"], {
                "title": f"Payment to {(pay.get('contact_name') or 'Vendor').strip()}".strip(),
                "amount": remaining, "vendor_name": (pay.get("contact_name") or "").strip(),
                "date": pay.get("date") or "", "status": "paid",
                "payment_id": pid, "notes": pay.get("reference") or "",
            }, source="manual")
    return {"ok": True}


@router.post("/revenue/payment/{pid}/match")
async def match_payment(pid: str, body: dict, user: dict = Depends(require_ledger)):
    return await _do_match_payment(user["tenant_id"], user, pid, (body or {}).get("invoice_id"))


@router.post("/revenue/payment/{pid}/standalone")
async def mark_payment_standalone(pid: str, user: dict = Depends(require_ledger)):
    return await _do_standalone_payment(user["tenant_id"], user, pid)


@router.post("/payables/payment/{pid}/match")
async def match_payable(pid: str, body: dict, user: dict = Depends(require_ledger)):
    return await _do_match_payment(user["tenant_id"], user, pid, (body or {}).get("invoice_id"))


@router.post("/payables/payment/{pid}/standalone")
async def mark_payable_standalone(pid: str, user: dict = Depends(require_ledger)):
    return await _do_standalone_payment(user["tenant_id"], user, pid)


@router.post("/revenue")
async def add_revenue(inp: IncomeInput, user: dict = Depends(require_ledger)):
    if not (inp.title or "").strip() and not _num(inp.amount) and not (inp.customer_name or "").strip():
        raise HTTPException(status_code=400, detail="Add a title, customer or amount")
    doc = await create_income(user["tenant_id"], user["id"], inp.model_dump(), source="manual")
    await log_activity(user["tenant_id"], user["id"], "income_added",
                       f"Recorded income '{doc.get('title') or doc.get('contact_name') or 'Sale'}'", "invoice", doc["id"])
    return doc


@router.post("/revenue/with-file")
async def add_revenue_with_file(
    title: str = Form(""), customer_name: str = Form(""), amount: str = Form(""),
    number: str = Form(""), date: str = Form(""), due_date: str = Form(""),
    status: str = Form("unpaid"), received: str = Form("false"), notes: str = Form(""),
    file: Optional[UploadFile] = File(None),
    contact_id: str = Form(""),   # PILOT-1 E: the CRM customer picked in the form
    user: dict = Depends(require_ledger),
):
    typed = {"title": title.strip(), "customer_name": customer_name.strip(), "amount": _num(amount),
             "number": number.strip(), "date": date, "due_date": due_date,
             "status": status, "notes": notes.strip()}
    party = await _linked_party(user["tenant_id"], contact_id, "customer")
    if party:
        typed.update(contact_id=party["id"], customer_name=party["name"])
    data, _ = await _read_attachment(file, "income", user["tenant_id"], typed)
    data["received"] = str(received).lower() in ("true", "1", "yes", "on")
    if not (str(data.get("title") or "").strip()) and not _num(data.get("amount")) and not (str(data.get("customer_name") or "").strip()):
        raise HTTPException(status_code=400, detail="Add a title/amount or attach a readable invoice")
    doc = await create_income(user["tenant_id"], user["id"], data, source="manual")
    await log_activity(user["tenant_id"], user["id"], "income_added",
                       f"Recorded income '{doc.get('title') or doc.get('contact_name') or 'Sale'}'", "invoice", doc["id"])
    return doc


@router.delete("/revenue/invoice/{iid}")
async def delete_revenue_invoice(iid: str, user: dict = Depends(require_ledger)):
    # E2-65: 404 if the invoice doesn't exist (or isn't a sales invoice
    # or isn't in this tenant). The payments-cascade still runs after
    # so a valid delete cleans linked receipts too.
    r = await db.invoices.delete_one(
        {"id": iid, "tenant_id": user["tenant_id"], "type": "sales_invoice"})
    if not r.deleted_count:
        raise HTTPException(status_code=404, detail="Sales invoice not found")
    await db.payments.delete_many(
        {"tenant_id": user["tenant_id"], "invoice_id": iid, "direction": "in"})
    return {"ok": True}


@router.delete("/revenue/payment/{pid}")
async def delete_revenue_payment(pid: str, user: dict = Depends(require_ledger)):
    # E2-65: 404 on non-existent / wrong-direction id.
    r = await db.payments.delete_one(
        {"id": pid, "tenant_id": user["tenant_id"], "direction": "in"})
    if not r.deleted_count:
        raise HTTPException(status_code=404, detail="Payment not found")
    return {"ok": True}


# --- Full finance re-sync: reclassify + re-categorize + recompute outstanding ---
async def _recategorize_expenses(tid: str, fc: dict) -> int:
    """Re-tag expenses whose category is missing / 'Other' / not in the company list."""
    changed = 0
    exps = await db.expenses.find({"tenant_id": tid}, {"_id": 0}).to_list(5000)
    for e in exps:
        cur = (e.get("category") or "").strip()
        if cur in fc["expense"] and cur != "Other":
            continue  # already a good company category
        text = f"{e.get('title', '')} {e.get('vendor_name', '')} {e.get('notes', '')}"
        newcat = await ai_suggest_expense_category(text, tid)
        if newcat and newcat != cur:
            await db.expenses.update_one({"id": e["id"], "tenant_id": tid}, {"$set": {"category": newcat}})
            changed += 1
    return changed


async def _recategorize_assets(tid: str, fc: dict) -> int:
    """Snap asset categories onto the company list using the keyword heuristic (no AI cost)."""
    changed = 0
    assets = await db.assets.find({"tenant_id": tid}, {"_id": 0}).to_list(5000)
    for a in assets:
        cur = (a.get("category") or "").strip()
        if cur in fc["asset"] and cur != "Other":
            continue
        newcat = _match_category(guess_asset_category(f"{a.get('name', '')} {a.get('notes', '')}"), fc["asset"], "Other")
        if newcat != cur:
            await db.assets.update_one({"id": a["id"], "tenant_id": tid}, {"$set": {"category": newcat}})
            changed += 1
    return changed


async def _recompute_outstanding(tid: str) -> dict:
    """Rebuild allocations and recompute each invoice's amount_paid / status so Outstanding
    (receivable & payable) is correct. Preserves prior allocations & 'standalone' payments,
    caps per-invoice (no overpay), then auto-matches any leftover balances."""
    stats = {"payments_matched": 0, "payments_unmatched": 0, "invoices_settled": 0, "invoices_partial": 0}
    invoices = await db.invoices.find({"tenant_id": tid, "type": {"$in": ["sales_invoice", "purchase_bill"]}}, {"_id": 0}).to_list(8000)
    invs = {i["id"]: {**i, "amount_paid": 0} for i in invoices}
    await db.invoices.update_many({"tenant_id": tid, "type": {"$in": ["sales_invoice", "purchase_bill"]}},
                                  {"$set": {"amount_paid": 0, "status": "unpaid"}})
    payments = await db.payments.find({"tenant_id": tid}, {"_id": 0}).to_list(8000)

    # Legacy: an out-payment already booked as its own expense stays standalone (avoid double-count).
    for p in payments:
        if p.get("direction") == "out" and p.get("match_status") != "standalone" and not (p.get("applications") or p.get("invoice_id")):
            if await db.expenses.find_one({"tenant_id": tid, "payment_id": p["id"]}):
                p["match_status"] = "standalone"

    for p in payments:
        # Capture the payment's prior allocation intent BEFORE clearing it.
        orig_apps = list(p.get("applications") or [])
        if not orig_apps and p.get("invoice_id"):
            orig_apps = [{"invoice_id": p["invoice_id"], "amount": _num(p.get("amount"))}]
        p["applied"] = 0
        p["applications"] = []
        await db.payments.update_one({"id": p["id"], "tenant_id": tid},
                                     {"$set": {"applied": 0, "applications": [], "invoice_id": None}})
        for a in orig_apps:
            inv = invs.get(a.get("invoice_id"))
            if inv:
                await _apply_payment_to_invoice(tid, inv, p, p.get("matched_by") or "auto", max_amount=_num(a.get("amount")))
        if p.get("match_status") == "standalone":
            await db.payments.update_one({"id": p["id"], "tenant_id": tid}, {"$set": {"match_status": "standalone"}})

    # Auto-match any leftover (non-standalone) balances against still-open invoices.
    for p in payments:
        if p.get("match_status") == "standalone":
            continue
        if _pay_remaining(p) <= 0.01:
            if _num(p.get("applied")) > 0.01:
                stats["payments_matched"] += 1
            continue
        probe = {"amount": _pay_remaining(p), "direction": p.get("direction"),
                 "contact_name": p.get("contact_name"), "invoice_number": p.get("invoice_number"),
                 "reference": p.get("reference"), "date": p.get("date")}
        inv = await _find_matching_invoice(tid, p.get("direction"), probe)
        if inv and inv["id"] in invs:
            await _apply_payment_to_invoice(tid, invs[inv["id"]], p, "auto")
        if _pay_remaining(p) <= 0.01:
            stats["payments_matched"] += 1
        else:
            await db.payments.update_one({"id": p["id"], "tenant_id": tid},
                                         {"$set": {"match_status": "partial" if _num(p.get("applied")) > 0.01 else "unmatched"}})
            stats["payments_unmatched"] += 1

    for inv in invs.values():
        if inv.get("status") == "paid" or (_num(inv.get("amount")) > 0 and _num(inv.get("amount_paid")) + 0.01 >= _num(inv.get("amount"))):
            stats["invoices_settled"] += 1
        elif _num(inv.get("amount_paid")) > 0.01:
            stats["invoices_partial"] += 1
    return stats


async def resync_finance(tid: str, uid: str, user_name: str = "System") -> dict:
    """The full 'Fix Mis-booked Purchases' engine: (1) re-classify purchase bills into the right
    bucket with company categories, (2) re-categorize expenses & assets onto the company categories,
    (3) recompute payment matching & outstanding balances."""
    from services.ingestion import ai_classify_purchase
    fc = await get_finance_categories(tid)
    bills = await db.invoices.find({"tenant_id": tid, "type": "purchase_bill"}, {"_id": 0}).to_list(5000)
    summary = {"reviewed": 0, "to_asset": 0, "to_inventory": 0, "kept_expense": 0, "unknown": 0, "unchanged": 0,
               "expenses_recategorized": 0, "assets_recategorized": 0,
               "payments_matched": 0, "payments_unmatched": 0, "invoices_settled": 0, "invoices_partial": 0}
    # STEP 1 — reclassify purchase bills into expense / asset / inventory.
    for inv in bills:
        summary["reviewed"] += 1
        li = " ".join(str(x.get("description", "")) for x in (inv.get("line_items") or []) if isinstance(x, dict))
        text = (f"Vendor: {inv.get('contact_name', '')}. Bill no: {inv.get('number', '')}. "
                f"Items: {li}. Amount: {inv.get('amount')} {inv.get('currency', '')}")
        result = await ai_classify_purchase(text, expense_categories=fc["expense"], asset_categories=fc["asset"])
        new_type = result.get("purchase_type", "unknown")
        old_type = (inv.get("purchase_type") or "expense").strip().lower() or "expense"
        exp = await db.expenses.find_one({"tenant_id": tid, "invoice_id": inv["id"]}, {"_id": 0})
        currency = inv.get("currency") or await _currency(tid)
        amount = _num(inv.get("amount"))
        vend = (inv.get("contact_name") or "Vendor").strip()

        if new_type == "unknown":
            await db.invoices.update_one({"id": inv["id"], "tenant_id": tid},
                                         {"$set": {"purchase_type": "unknown", "needs_reclassification": True}})
            summary["unknown"] += 1
            continue
        if new_type == old_type:
            await db.invoices.update_one({"id": inv["id"], "tenant_id": tid},
                                         {"$set": {"purchase_type": new_type, "needs_reclassification": False}})
            summary["unchanged"] += 1
            continue

        if new_type in ("asset", "inventory") and exp:
            await db.assets.delete_many({"tenant_id": tid, "expense_id": exp["id"]})
            await db.expenses.delete_one({"id": exp["id"], "tenant_id": tid})

        if new_type == "asset":
            _name = (result.get("asset_name") or li[:60] or f"Asset from {vend}").strip()
            await create_asset(tid, uid, {
                "name": _name,
                "category": result.get("asset_category") or guess_asset_category(f"{_name} {li}"),
                "purchase_amount": amount, "currency": currency,
                "purchase_date": inv.get("date") or "", "vendor_name": vend,
                "notes": f"Reclassified from bill {inv.get('number') or ''} · {li[:150]}".strip(),
            }, source="reclassify")
            summary["to_asset"] += 1
        elif new_type == "inventory":
            try:
                qty = float(result.get("inventory_qty") or 0) or 1
            except (TypeError, ValueError):
                qty = 1
            await create_inventory(tid, uid, {
                "item": (li[:60] or f"Stock from {vend}").strip(), "quantity": qty,
                "unit": (result.get("inventory_unit") or "unit").strip(),
                "unit_cost": round(amount / qty, 2) if qty else amount, "currency": currency,
                "vendor_name": vend, "notes": f"Reclassified from bill {inv.get('number') or ''}".strip(),
            }, source="reclassify")
            summary["to_inventory"] += 1
        else:  # expense
            if not exp:
                await create_expense(tid, uid, {
                    "title": f"{vend} — Bill {inv.get('number') or ''}".strip(), "amount": amount,
                    "currency": currency, "vendor_name": vend, "vendor_id": inv.get("contact_id"),
                    "date": inv.get("date") or "", "status": "unpaid",
                    "invoice_id": inv["id"], "notes": li[:200],
                }, source="reclassify")
            summary["kept_expense"] += 1

        await db.invoices.update_one({"id": inv["id"], "tenant_id": tid},
                                     {"$set": {"purchase_type": new_type, "needs_reclassification": False}})

    # STEP 2 — re-categorize expenses & assets onto the company categories.
    summary["expenses_recategorized"] = await _recategorize_expenses(tid, fc)
    summary["assets_recategorized"] = await _recategorize_assets(tid, fc)

    # STEP 3 — rebuild payment matching + recompute outstanding balances.
    summary.update(await _recompute_outstanding(tid))

    await db.ledger_ai.delete_many({"tenant_id": tid})
    # E2-62: log_activity actor is uid (user id), consistent with every
    # other router. user_name is kept as the fn param for its message
    # body but is no longer the actor field.
    await log_activity(tid, uid, "finance_resynced",
                       f"Finance re-sync: reviewed {summary['reviewed']} bills "
                       f"({summary['to_asset']}→asset, {summary['to_inventory']}→inventory), "
                       f"re-categorized {summary['expenses_recategorized']} expenses, "
                       f"settled {summary['invoices_settled']} invoices", "ledger", "resync")
    return summary


# --- Re-classify historical purchase bills (fix mis-booked expenses) --------
@router.post("/ledger/reclassify-purchases")
async def reclassify_purchases(user: dict = Depends(require_ledger)):
    """Owner-only 'Fix Mis-booked Purchases': re-classify purchase bills into the right bucket,
    re-categorize expenses/assets onto the company categories, and recompute outstanding balances."""
    if user.get("role") != "owner":
        raise HTTPException(status_code=403, detail="Only the owner can re-run purchase classification")
    return await resync_finance(user["tenant_id"], user["id"], user.get("name") or "Owner")


# --- Dashboard summary (monthly, by-category, by-vendor, paid/outstanding) --
@router.get("/ledger/summary")
async def ledger_summary(user: dict = Depends(require_ledger)):
    tid = user["tenant_id"]
    currency = await _currency(tid)
    # J7 (JOURNEY-1): an expense waiting for an owner's approval is not spend
    # yet, and one they turned down never will be. Both stay on the Expenses
    # list, marked, so the person who typed it can see what happened to it —
    # they are simply not counted. An approved one joins these totals at once.
    expenses = await db.expenses.find(
        {"tenant_id": tid, "approval_status": {"$nin": ["pending", "rejected"]}}, {"_id": 0}).to_list(5000)
    assets = await db.assets.find({"tenant_id": tid}, {"_id": 0}).to_list(5000)
    inventory = await db.inventory.find({"tenant_id": tid}, {"_id": 0}).to_list(5000)
    sales = await db.invoices.find({"tenant_id": tid, "type": "sales_invoice"}, {"_id": 0}).to_list(5000)
    pays_in = await db.payments.find({"tenant_id": tid, "direction": "in"}, {"_id": 0}).to_list(5000)

    total = sum(_num(e.get("amount")) for e in expenses)
    paid = sum(_num(e.get("amount")) for e in expenses if e.get("status") == "paid")
    revenue_billed = sum(_num(s.get("amount")) for s in sales)
    revenue_received = sum(_num(p.get("amount")) for p in pays_in)
    revenue_outstanding = sum(_remaining(s) for s in sales if s.get("status") != "paid")
    by_cat, by_vendor, by_month = {}, {}, {}
    for e in expenses:
        amt = _num(e.get("amount"))
        by_cat[e.get("category") or "Other"] = by_cat.get(e.get("category") or "Other", 0) + amt
        v = e.get("vendor_name") or "Unspecified"
        by_vendor[v] = by_vendor.get(v, 0) + amt
        m = (e.get("date") or e.get("created_at", ""))[:7]
        if m:
            by_month[m] = by_month.get(m, 0) + amt
    months = sorted(by_month.keys())[-6:]
    fc = await get_finance_categories(tid)
    return {
        "currency": currency,
        "totals": {
            "total_spend": round(total, 2), "paid": round(paid, 2), "outstanding": round(total - paid, 2),
            "expense_count": len(expenses),
            "asset_count": len(assets), "asset_value": round(sum(_num(a.get("purchase_amount")) for a in assets), 2),
            "inventory_count": len(inventory), "inventory_value": round(sum(_num(i.get("value")) for i in inventory), 2),
            "revenue_billed": round(revenue_billed, 2), "revenue_received": round(revenue_received, 2),
            "revenue_outstanding": round(revenue_outstanding, 2), "sales_count": len(sales),
            "net_profit": round(revenue_billed - total, 2),
        },
        "by_category": [{"category": k, "amount": round(v, 2)} for k, v in sorted(by_cat.items(), key=lambda x: -x[1])],
        "by_vendor": [{"vendor": k, "amount": round(v, 2)} for k, v in sorted(by_vendor.items(), key=lambda x: -x[1])[:8]],
        "by_month": [{"month": m, "amount": round(by_month[m], 2)} for m in months],
        "categories": fc["expense"], "asset_categories": fc["asset"],
    }


# --- AI Finance Brief + per-tab AI Analysis + Ask AI ------------------------
SCOPES = ("brief", "overview", "expenses", "assets", "inventory", "revenue")

_SCOPE_FOCUS = {
    "brief": "the company's OVERALL financial health: PROFIT (revenue earned vs money spent), cash actually received vs outstanding receivables, and where the money is going — a crisp executive brief for the founder.",
    "overview": "overall spending trends, month-over-month movement, and category/vendor concentration.",
    "expenses": "expenses only: unpaid/outstanding bills, vendor and category concentration, unusual or duplicate-looking spend.",
    "assets": "assets only: total asset value, category mix, items in maintenance or disposed, and renewal/utilisation risks.",
    "inventory": "inventory only: stock-value concentration, high-value or slow items, and vendor dependence.",
    "revenue": "income only: sales/service revenue billed vs received, outstanding receivables to chase, top customers, and revenue trend.",
}


async def _finance_context(tid: str, scope: str) -> dict:
    currency = await _currency(tid)
    expenses = await db.expenses.find({"tenant_id": tid}, {"_id": 0}).sort("created_at", -1).to_list(2000)
    assets = await db.assets.find({"tenant_id": tid}, {"_id": 0}).sort("created_at", -1).to_list(2000)
    inventory = await db.inventory.find({"tenant_id": tid}, {"_id": 0}).sort("created_at", -1).to_list(2000)
    sales = await db.invoices.find({"tenant_id": tid, "type": "sales_invoice"}, {"_id": 0}).sort("created_at", -1).to_list(2000)
    pays_in = await db.payments.find({"tenant_id": tid, "direction": "in"}, {"_id": 0}).sort("created_at", -1).to_list(2000)
    total = sum(_num(e.get("amount")) for e in expenses)
    paid = sum(_num(e.get("amount")) for e in expenses if e.get("status") == "paid")
    revenue_billed = sum(_num(s.get("amount")) for s in sales)
    revenue_received = sum(_num(p.get("amount")) for p in pays_in)
    revenue_outstanding = sum(_remaining(s) for s in sales if s.get("status") != "paid")
    by_cat, by_vendor, by_month, unpaid = {}, {}, {}, []
    by_customer, unpaid_sales = {}, []
    for s in sales:
        amt = _num(s.get("amount"))
        cn = s.get("contact_name") or "Unspecified"
        by_customer[cn] = by_customer.get(cn, 0) + amt
        if s.get("status") != "paid":
            unpaid_sales.append({"title": s.get("title") or s.get("number"), "customer": cn,
                                 "amount": amt, "due_date": s.get("due_date"), "date": s.get("date")})
    for e in expenses:
        amt = _num(e.get("amount"))
        by_cat[e.get("category") or "Other"] = by_cat.get(e.get("category") or "Other", 0) + amt
        v = e.get("vendor_name") or "Unspecified"
        by_vendor[v] = by_vendor.get(v, 0) + amt
        m = (e.get("date") or e.get("created_at", ""))[:7]
        if m:
            by_month[m] = by_month.get(m, 0) + amt
        if e.get("status") != "paid":
            unpaid.append({"title": e.get("title"), "vendor": e.get("vendor_name"), "amount": amt, "date": e.get("date")})

    def _top(d, n=8):
        return sorted(({"name": k, "amount": round(val, 2)} for k, val in d.items()), key=lambda x: -x["amount"])[:n]

    ctx = {
        "currency": currency, "today": now_iso()[:10],
        "totals": {
            "total_spend": round(total, 2), "paid": round(paid, 2), "outstanding": round(total - paid, 2),
            "expense_count": len(expenses), "asset_count": len(assets),
            "asset_value": round(sum(_num(a.get("purchase_amount")) for a in assets), 2),
            "inventory_count": len(inventory), "inventory_value": round(sum(_num(i.get("value")) for i in inventory), 2),
            "revenue_billed": round(revenue_billed, 2), "revenue_received": round(revenue_received, 2),
            "revenue_outstanding": round(revenue_outstanding, 2), "sales_count": len(sales),
            "net_profit": round(revenue_billed - total, 2),
        },
        "by_category": _top(by_cat), "by_vendor": _top(by_vendor),
        "by_month": [{"month": m, "amount": round(by_month[m], 2)} for m in sorted(by_month)[-6:]],
    }
    if scope in ("expenses", "brief", "overview"):
        ctx["top_unpaid"] = sorted(unpaid, key=lambda x: -x["amount"])[:12]
    if scope in ("assets", "brief"):
        ctx["assets"] = [{"name": a.get("name"), "category": a.get("category"),
                          "value": _num(a.get("purchase_amount")), "status": a.get("status")} for a in assets[:30]]
    if scope in ("inventory", "brief"):
        ctx["inventory"] = [{"item": i.get("item"), "qty": _num(i.get("quantity")), "unit": i.get("unit"),
                             "value": _num(i.get("value")), "vendor": i.get("vendor_name")} for i in inventory[:30]]
    if scope in ("revenue", "brief"):
        ctx["top_customers"] = _top(by_customer)
        ctx["outstanding_receivables"] = sorted(unpaid_sales, key=lambda x: -x["amount"])[:12]
    return ctx


async def _generate_analysis(tid: str, scope: str) -> dict:
    ctx = await _finance_context(tid, scope)
    focus = _SCOPE_FOCUS.get(scope, _SCOPE_FOCUS["overview"])
    system = render("ledger.analysis", focus=focus, currency=ctx['currency'], today=ctx['today'])
    data = {}
    try:
        chat = claude_chat(task="ledger.analysis", session_id=f"ledger-ai-{scope}-{new_id()}", system_message=system).with_model(*model_for("ledger.analysis"))
        resp = await chat.send_message(UserMessage(text=f"Finance data:\n{json.dumps(ctx)}\n\nProduce the JSON now."))
        data = _extract_json(resp) or {}
    except Exception as e:  # noqa: BLE001
        logger.warning(f"Ledger AI analysis ({scope}) failed: {e}")
    insights = []
    for it in (data.get("insights") or []):
        if not isinstance(it, dict) or not (it.get("title") or "").strip():
            continue
        insights.append({
            "level": it.get("level") if it.get("level") in ("high", "medium", "low") else "medium",
            "title": (it.get("title") or "").strip(),
            "detail": (it.get("detail") or "").strip(),
            "action": (it.get("action") or it.get("title") or "").strip(),
        })
    result = {
        "scope": scope,
        "headline": (data.get("headline") or "").strip() or "Not enough data yet — add expenses, assets or inventory to unlock insights.",
        "insights": insights[:6],
        "generated_at": now_iso(),
    }
    await db.ledger_ai.update_one({"tenant_id": tid, "scope": scope},
                                  {"$set": {**result, "tenant_id": tid}}, upsert=True)
    return result


@router.get("/ledger/ai/{scope}")
async def get_ledger_ai(scope: str, user: dict = Depends(require_ledger)):
    if scope not in SCOPES:
        raise HTTPException(status_code=404, detail="Unknown scope")
    cached = await db.ledger_ai.find_one({"tenant_id": user["tenant_id"], "scope": scope}, {"_id": 0})
    return cached or await _generate_analysis(user["tenant_id"], scope)


@router.post("/ledger/ai/{scope}/refresh")
async def refresh_ledger_ai(scope: str, user: dict = Depends(require_ledger)):
    if scope not in SCOPES:
        raise HTTPException(status_code=404, detail="Unknown scope")
    return await _generate_analysis(user["tenant_id"], scope)




@router.post("/ledger/ask")
async def ledger_ask(inp: LedgerAskInput, user: dict = Depends(require_ledger)):
    q = (inp.question or "").strip()
    if not q:
        raise HTTPException(status_code=400, detail="Ask a question")
    scope = inp.scope if inp.scope in SCOPES else "brief"
    ctx = await _finance_context(user["tenant_id"], scope)
    system = render("ledger.ask", currency=ctx['currency'], today=ctx['today'])
    try:
        chat = claude_chat(task="ledger.ask", session_id=f"ledger-ask-{user['tenant_id']}-{new_id()}", system_message=system).with_model(*model_for("ledger.ask"))
        resp = await chat.send_message(UserMessage(text=f"Finance data:\n{json.dumps(ctx)}\n\nQuestion: {q}"))
        answer = (resp or "").strip()
    except Exception as e:  # noqa: BLE001
        logger.warning(f"Ledger ask failed: {e}")
        raise HTTPException(status_code=502, detail="AI is busy, please try again")
    return {"answer": answer or "I couldn't find an answer in your finance data."}
