"""Finance / Ledger: Expenses, Assets & Inventory + roll-up from captured invoices/payments.

Foundation (db, LLM config, auth deps, helpers) comes from `core` — this module does
NOT import from `server`, so there is no circular dependency. Approved purchase
bills / outgoing payments auto-create Expenses, and every record ingested from an
API/document source is also written into the Company Brain (memory) so finance is
queryable alongside decisions.
"""
import asyncio
import json
from pathlib import Path
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, File, Form, UploadFile
from pydantic import BaseModel

from emergentintegrations.llm.chat import LlmChat, UserMessage, FileContentWithMimeType

from core import (
    db, CLAUDE_KEY, claude_key, LLM_MODEL, EMERGENT_LLM_KEY, VISION_MODEL,
    _extract_json, new_id, now_iso, logger,
    get_current_user, user_perms, log_activity,
)

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


async def ai_suggest_expense_category(text: str, tenant_id: str) -> str:
    text = (text or "").strip()
    if not text:
        return "Other"
    try:
        system = (
            "You categorize a single business expense into EXACTLY one category from this list: "
            + ", ".join(EXPENSE_CATEGORIES) + ". "
            "Reply with ONLY JSON: {\"category\": \"<one of the categories>\"}."
        )
        chat = LlmChat(api_key=claude_key(), session_id=f"expcat-{tenant_id}", system_message=system).with_model(*LLM_MODEL)
        resp = await chat.send_message(UserMessage(text=text[:600]))
        data = _extract_json(resp) or {}
        if data.get("category") in EXPENSE_CATEGORIES:
            return data["category"]
    except Exception as e:  # noqa: BLE001
        logger.warning(f"AI expense categorization failed, using heuristic: {e}")
    return guess_expense_category(text)


async def _currency(tenant_id: str) -> str:
    t = await db.tenants.find_one({"id": tenant_id}, {"_id": 0, "currency": 1})
    return (t or {}).get("currency") or "INR"


def _num(x) -> float:
    try:
        return float(x or 0)
    except (TypeError, ValueError):
        return 0.0


async def _write_brain(tenant_id: str, user_id: str, text: str, tag: str) -> None:
    """Mirror a finance record into the Company Brain (searchable memory)."""
    await db.memory.insert_one({
        "id": new_id(), "tenant_id": tenant_id, "text": text, "tag": tag,
        "created_by": user_id, "created_at": now_iso(),
    })


# --- Attachment + AI vision extraction from an uploaded bill/photo ----------
def _save_upload_sync(content: bytes, filename: str) -> dict:
    ext = (filename.rsplit(".", 1)[-1] if "." in (filename or "") else "bin").lower()
    fname = f"ledger-{new_id()}.{ext}"
    (UPLOAD_DIR / fname).write_bytes(content)
    return {"fname": fname, "path": str(UPLOAD_DIR / fname), "url": f"/api/files/{fname}",
            "filename": filename or fname}


_LEDGER_FIELDS = {
    "expense": (
        "an EXPENSE (a bill, invoice, receipt, or a payment the company made)",
        '{"title": str, "amount": number, "vendor_name": str, "date": "YYYY-MM-DD", '
        '"category": one of [' + ", ".join(EXPENSE_CATEGORIES) + '], "notes": str}',
    ),
    "asset": (
        "a company ASSET purchase (machinery, equipment, vehicle, furniture, IT/electronics, building)",
        '{"name": str, "purchase_amount": number, "vendor_name": str, "purchase_date": "YYYY-MM-DD", '
        '"category": one of [' + ", ".join(ASSET_CATEGORIES) + '], "notes": str}',
    ),
    "inventory": (
        "an INVENTORY / stock item purchase",
        '{"item": str, "sku": str, "quantity": number, "unit": str, "unit_cost": number, '
        '"category": str, "vendor_name": str, "notes": str}',
    ),
}


async def ai_extract_ledger_file(file_path: str, mime_type: str, kind: str, currency: str, typed: dict) -> dict:
    """Read an uploaded bill/photo/PDF and return the fields for `kind`, honouring what the user already typed."""
    desc, shape = _LEDGER_FIELDS[kind]
    typed_clean = {k: v for k, v in (typed or {}).items() if v not in (None, "", 0, "0", 0.0)}
    system = (
        f"You read a business document (image or PDF) and extract the details of {desc}. "
        f"Amounts are in {currency}. The user already typed these values: {json.dumps(typed_clean)}. "
        "PREFER the user's typed values when present and non-empty; fill every MISSING field from the document. "
        f"Reply with ONLY compact JSON in exactly this shape: {shape}. "
        "Use an empty string or 0 for anything you cannot determine. Never invent data."
    )
    resp = None
    # Prefer the user's own Gemini key (same client server.py configures), else the Emergent vision key.
    try:
        from server import get_gemini_client, _gemini_doc_sync
        if get_gemini_client() is not None:
            resp = await asyncio.to_thread(_gemini_doc_sync, file_path, mime_type, system, "Extract the JSON now.")
    except Exception as e:  # noqa: BLE001
        logger.warning(f"Ledger OCR (user gemini) failed, falling back to Emergent key: {e}")
        resp = None
    if not resp:
        fc = FileContentWithMimeType(file_path=file_path, mime_type=mime_type)
        chat = LlmChat(api_key=EMERGENT_LLM_KEY, session_id=f"ledger-ocr-{kind}-{new_id()}",
                       system_message=system).with_model(*VISION_MODEL)
        resp = await chat.send_message(UserMessage(text="Extract the JSON now.", file_contents=[fc]))
    return _extract_json(resp) or {}


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
    category = data.get("category") if data.get("category") in EXPENSE_CATEGORIES else \
        guess_expense_category(f"{data.get('title', '')} {data.get('vendor_name', '')} {data.get('notes', '')}")
    eid = new_id()
    doc = {
        "id": eid, "tenant_id": tenant_id, "title": (data.get("title") or "Expense").strip(),
        "amount": amount, "currency": currency, "category": category,
        "vendor_name": (data.get("vendor_name") or "").strip(), "vendor_id": data.get("vendor_id"),
        "date": data.get("date") or now_iso()[:10],
        "status": data.get("status") if data.get("status") in ("paid", "unpaid") else "unpaid",
        "notes": (data.get("notes") or "").strip(), "source": source,
        "invoice_id": data.get("invoice_id"), "payment_id": data.get("payment_id"),
        "ingestion_id": data.get("ingestion_id"),
        "attachment": data.get("attachment"),
        "created_by": user_id, "created_at": now_iso(),
    }
    await db.expenses.insert_one(dict(doc))
    doc.pop("_id", None)
    if write_brain if write_brain is not None else (source != "manual"):
        vend = f" to {doc['vendor_name']}" if doc["vendor_name"] else ""
        await _write_brain(tenant_id, user_id,
                            f"Expense: {doc['title']} — {currency} {amount:,.0f} ({category}){vend} [{source}]", "expense")
    # An "Asset Purchase" expense also becomes a tracked Asset.
    if category == "Asset Purchase":
        await create_asset(tenant_id, user_id, {
            "name": doc["title"], "category": "Equipment", "purchase_amount": amount,
            "currency": currency, "purchase_date": doc["date"], "vendor_name": doc["vendor_name"],
            "expense_id": eid, "notes": "Auto-created from expense",
        }, source=source)
    return doc


async def create_asset(tenant_id: str, user_id: str, data: dict, source: str = "manual", write_brain: Optional[bool] = None) -> dict:
    currency = data.get("currency") or await _currency(tenant_id)
    amt = _num(data.get("purchase_amount"))
    doc = {
        "id": new_id(), "tenant_id": tenant_id, "name": (data.get("name") or "Asset").strip(),
        "category": data.get("category") if data.get("category") in ASSET_CATEGORIES else "Other",
        "purchase_amount": amt, "currency": currency,
        "purchase_date": data.get("purchase_date") or now_iso()[:10],
        "vendor_name": (data.get("vendor_name") or "").strip(),
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


# --- Access control ---------------------------------------------------------
async def require_ledger(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") == "owner":
        return user
    perms = user_perms(user)
    if "ledger" in perms or "finance" in perms:
        return user
    raise HTTPException(status_code=403, detail="You don't have access to the Ledger")


# --- Input models -----------------------------------------------------------
class ExpenseInput(BaseModel):
    title: str
    amount: float
    category: Optional[str] = None
    vendor_name: Optional[str] = ""
    vendor_id: Optional[str] = None
    date: Optional[str] = None
    status: Optional[str] = "unpaid"
    currency: Optional[str] = None
    notes: Optional[str] = ""


class AssetInput(BaseModel):
    name: str
    category: Optional[str] = "Other"
    purchase_amount: float = 0
    currency: Optional[str] = None
    purchase_date: Optional[str] = None
    vendor_name: Optional[str] = ""
    status: Optional[str] = "active"
    notes: Optional[str] = ""


class InventoryInput(BaseModel):
    item: str
    sku: Optional[str] = ""
    quantity: float = 0
    unit: Optional[str] = "unit"
    unit_cost: float = 0
    currency: Optional[str] = None
    category: Optional[str] = ""
    vendor_name: Optional[str] = ""
    notes: Optional[str] = ""


class SuggestCategoryInput(BaseModel):
    text: str


class ExpensePatch(BaseModel):
    title: Optional[str] = None
    amount: Optional[float] = None
    category: Optional[str] = None
    vendor_name: Optional[str] = None
    date: Optional[str] = None
    status: Optional[str] = None
    notes: Optional[str] = None


# --- Expenses ---------------------------------------------------------------
@router.get("/expenses")
async def list_expenses(user: dict = Depends(require_ledger)):
    return await db.expenses.find({"tenant_id": user["tenant_id"]}, {"_id": 0}).sort("created_at", -1).to_list(1000)


@router.post("/expenses")
async def add_expense(inp: ExpenseInput, user: dict = Depends(require_ledger)):
    doc = await create_expense(user["tenant_id"], user["id"], inp.model_dump(), source="manual", write_brain=True)
    await log_activity(user["tenant_id"], user["name"], "expense_added", f"Added expense '{doc['title']}'", "expense", doc["id"])
    return doc


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
        saved = await asyncio.to_thread(_save_upload_sync, content, file.filename)
        attachment = {"filename": saved["filename"], "url": saved["url"], "mime": mime}
        try:
            currency = await _currency(tenant_id)
            ai = await ai_extract_ledger_file(saved["path"], mime or "application/octet-stream", kind, currency, typed)
            data = _merge_typed(ai, typed)
        except Exception as e:  # noqa: BLE001
            logger.warning(f"Ledger {kind} OCR failed, using typed values: {e}")
        data["attachment"] = attachment
    return data, attachment


@router.post("/expenses/with-file")
async def add_expense_with_file(
    title: str = Form(""), amount: str = Form(""), vendor_name: str = Form(""),
    category: str = Form(""), date: str = Form(""), status: str = Form("unpaid"),
    notes: str = Form(""), file: Optional[UploadFile] = File(None),
    user: dict = Depends(require_ledger),
):
    typed = {"title": title.strip(), "amount": _num(amount), "vendor_name": vendor_name.strip(),
             "category": category, "date": date, "status": status, "notes": notes.strip()}
    data, _ = await _read_attachment(file, "expense", user["tenant_id"], typed)
    if not (str(data.get("title") or "").strip()) and not _num(data.get("amount")):
        raise HTTPException(status_code=400, detail="Add a title/amount or attach a readable bill")
    doc = await create_expense(user["tenant_id"], user["id"], data, source="manual", write_brain=True)
    await log_activity(user["tenant_id"], user["name"], "expense_added", f"Added expense '{doc['title']}'", "expense", doc["id"])
    return doc


@router.patch("/expenses/{eid}")
async def update_expense(eid: str, inp: ExpensePatch, user: dict = Depends(require_ledger)):
    updates = {k: v for k, v in inp.model_dump().items() if v is not None}
    if updates.get("category") and updates["category"] not in EXPENSE_CATEGORIES:
        updates.pop("category")
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")
    r = await db.expenses.update_one({"id": eid, "tenant_id": user["tenant_id"]}, {"$set": updates})
    if not r.matched_count:
        raise HTTPException(status_code=404, detail="Expense not found")
    return await db.expenses.find_one({"id": eid}, {"_id": 0})


@router.delete("/expenses/{eid}")
async def delete_expense(eid: str, user: dict = Depends(require_ledger)):
    await db.expenses.delete_one({"id": eid, "tenant_id": user["tenant_id"]})
    return {"ok": True}


@router.post("/expenses/suggest-category")
async def suggest_category(inp: SuggestCategoryInput, user: dict = Depends(require_ledger)):
    return {"category": await ai_suggest_expense_category(inp.text, user["tenant_id"])}


# --- Assets -----------------------------------------------------------------
@router.get("/assets")
async def list_assets(user: dict = Depends(require_ledger)):
    return await db.assets.find({"tenant_id": user["tenant_id"]}, {"_id": 0}).sort("created_at", -1).to_list(1000)


@router.post("/assets")
async def add_asset(inp: AssetInput, user: dict = Depends(require_ledger)):
    doc = await create_asset(user["tenant_id"], user["id"], inp.model_dump(), source="manual", write_brain=True)
    await log_activity(user["tenant_id"], user["name"], "asset_added", f"Added asset '{doc['name']}'", "asset", doc["id"])
    return doc


@router.post("/assets/with-file")
async def add_asset_with_file(
    name: str = Form(""), purchase_amount: str = Form(""), vendor_name: str = Form(""),
    category: str = Form("Other"), purchase_date: str = Form(""), status: str = Form("active"),
    notes: str = Form(""), file: Optional[UploadFile] = File(None),
    user: dict = Depends(require_ledger),
):
    typed = {"name": name.strip(), "purchase_amount": _num(purchase_amount), "vendor_name": vendor_name.strip(),
             "category": category, "purchase_date": purchase_date, "status": status, "notes": notes.strip()}
    data, _ = await _read_attachment(file, "asset", user["tenant_id"], typed)
    if not (str(data.get("name") or "").strip()):
        raise HTTPException(status_code=400, detail="Add an asset name or attach a readable bill")
    doc = await create_asset(user["tenant_id"], user["id"], data, source="manual", write_brain=True)
    await log_activity(user["tenant_id"], user["name"], "asset_added", f"Added asset '{doc['name']}'", "asset", doc["id"])
    return doc


@router.patch("/assets/{aid}")
async def update_asset(aid: str, inp: AssetInput, user: dict = Depends(require_ledger)):
    updates = inp.model_dump()
    if updates.get("category") not in ASSET_CATEGORIES:
        updates.pop("category", None)
    r = await db.assets.update_one({"id": aid, "tenant_id": user["tenant_id"]}, {"$set": updates})
    if not r.matched_count:
        raise HTTPException(status_code=404, detail="Asset not found")
    return await db.assets.find_one({"id": aid}, {"_id": 0})


@router.delete("/assets/{aid}")
async def delete_asset(aid: str, user: dict = Depends(require_ledger)):
    await db.assets.delete_one({"id": aid, "tenant_id": user["tenant_id"]})
    return {"ok": True}


# --- Inventory --------------------------------------------------------------
@router.get("/inventory")
async def list_inventory(user: dict = Depends(require_ledger)):
    return await db.inventory.find({"tenant_id": user["tenant_id"]}, {"_id": 0}).sort("created_at", -1).to_list(1000)


@router.post("/inventory")
async def add_inventory(inp: InventoryInput, user: dict = Depends(require_ledger)):
    doc = await create_inventory(user["tenant_id"], user["id"], inp.model_dump(), source="manual", write_brain=True)
    await log_activity(user["tenant_id"], user["name"], "inventory_added", f"Added inventory '{doc['item']}'", "inventory", doc["id"])
    return doc


@router.post("/inventory/with-file")
async def add_inventory_with_file(
    item: str = Form(""), sku: str = Form(""), quantity: str = Form(""), unit: str = Form("unit"),
    unit_cost: str = Form(""), category: str = Form(""), vendor_name: str = Form(""),
    notes: str = Form(""), file: Optional[UploadFile] = File(None),
    user: dict = Depends(require_ledger),
):
    typed = {"item": item.strip(), "sku": sku.strip(), "quantity": _num(quantity), "unit": unit.strip() or "unit",
             "unit_cost": _num(unit_cost), "category": category.strip(), "vendor_name": vendor_name.strip(), "notes": notes.strip()}
    data, _ = await _read_attachment(file, "inventory", user["tenant_id"], typed)
    if not (str(data.get("item") or "").strip()):
        raise HTTPException(status_code=400, detail="Add an item name or attach a readable bill")
    doc = await create_inventory(user["tenant_id"], user["id"], data, source="manual", write_brain=True)
    await log_activity(user["tenant_id"], user["name"], "inventory_added", f"Added inventory '{doc['item']}'", "inventory", doc["id"])
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
    await db.inventory.delete_one({"id": iid, "tenant_id": user["tenant_id"]})
    return {"ok": True}


# --- Dashboard summary (monthly, by-category, by-vendor, paid/outstanding) --
@router.get("/ledger/summary")
async def ledger_summary(user: dict = Depends(require_ledger)):
    tid = user["tenant_id"]
    currency = await _currency(tid)
    expenses = await db.expenses.find({"tenant_id": tid}, {"_id": 0}).to_list(5000)
    assets = await db.assets.find({"tenant_id": tid}, {"_id": 0}).to_list(5000)
    inventory = await db.inventory.find({"tenant_id": tid}, {"_id": 0}).to_list(5000)

    total = sum(_num(e.get("amount")) for e in expenses)
    paid = sum(_num(e.get("amount")) for e in expenses if e.get("status") == "paid")
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
    return {
        "currency": currency,
        "totals": {
            "total_spend": round(total, 2), "paid": round(paid, 2), "outstanding": round(total - paid, 2),
            "expense_count": len(expenses),
            "asset_count": len(assets), "asset_value": round(sum(_num(a.get("purchase_amount")) for a in assets), 2),
            "inventory_count": len(inventory), "inventory_value": round(sum(_num(i.get("value")) for i in inventory), 2),
        },
        "by_category": [{"category": k, "amount": round(v, 2)} for k, v in sorted(by_cat.items(), key=lambda x: -x[1])],
        "by_vendor": [{"vendor": k, "amount": round(v, 2)} for k, v in sorted(by_vendor.items(), key=lambda x: -x[1])[:8]],
        "by_month": [{"month": m, "amount": round(by_month[m], 2)} for m in months],
        "categories": EXPENSE_CATEGORIES, "asset_categories": ASSET_CATEGORIES,
    }


# --- AI Finance Brief + per-tab AI Analysis + Ask AI ------------------------
SCOPES = ("brief", "overview", "expenses", "assets", "inventory")

_SCOPE_FOCUS = {
    "brief": "the company's OVERALL financial health across spend, cash outflow, assets and inventory — a crisp executive brief for the founder.",
    "overview": "overall spending trends, month-over-month movement, and category/vendor concentration.",
    "expenses": "expenses only: unpaid/outstanding bills, vendor and category concentration, unusual or duplicate-looking spend.",
    "assets": "assets only: total asset value, category mix, items in maintenance or disposed, and renewal/utilisation risks.",
    "inventory": "inventory only: stock-value concentration, high-value or slow items, and vendor dependence.",
}


async def _finance_context(tid: str, scope: str) -> dict:
    currency = await _currency(tid)
    expenses = await db.expenses.find({"tenant_id": tid}, {"_id": 0}).sort("created_at", -1).to_list(2000)
    assets = await db.assets.find({"tenant_id": tid}, {"_id": 0}).sort("created_at", -1).to_list(2000)
    inventory = await db.inventory.find({"tenant_id": tid}, {"_id": 0}).sort("created_at", -1).to_list(2000)
    total = sum(_num(e.get("amount")) for e in expenses)
    paid = sum(_num(e.get("amount")) for e in expenses if e.get("status") == "paid")
    by_cat, by_vendor, by_month, unpaid = {}, {}, {}, []
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
    return ctx


async def _generate_analysis(tid: str, scope: str) -> dict:
    ctx = await _finance_context(tid, scope)
    focus = _SCOPE_FOCUS.get(scope, _SCOPE_FOCUS["overview"])
    system = (
        "You are a sharp CFO advisor for a small business. Analyse the finance data and focus on " + focus + " "
        f"All amounts are in {ctx['currency']}; today is {ctx['today']}. Be specific — cite real numbers, vendors and categories. "
        'Return ONLY JSON: {"headline": "ONE short punchy line, max 12 words, summarising the finance state", '
        '"insights": [{"level": "high|medium|low", "title": "punchy one-liner, max 10 words, include the key number", '
        '"detail": "1-2 sentences: why it matters + what to check", '
        '"action": "a short imperative task title to act on it, max 10 words"}]}. '
        "Blend the most urgent problems AND recommended actions into this ONE list, ranked most-urgent-first, MAX 6 items. "
        "Every insight MUST have a concrete `action`. If data is thin, say so in the headline and keep the list short."
    )
    data = {}
    try:
        chat = LlmChat(api_key=claude_key(), session_id=f"ledger-ai-{scope}-{new_id()}", system_message=system).with_model(*LLM_MODEL)
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


class LedgerAskInput(BaseModel):
    question: str
    scope: Optional[str] = "brief"


@router.post("/ledger/ask")
async def ledger_ask(inp: LedgerAskInput, user: dict = Depends(require_ledger)):
    q = (inp.question or "").strip()
    if not q:
        raise HTTPException(status_code=400, detail="Ask a question")
    scope = inp.scope if inp.scope in SCOPES else "brief"
    ctx = await _finance_context(user["tenant_id"], scope)
    system = (
        "You are a finance assistant for a small business owner. Answer ONLY from the finance data provided, "
        f"concisely (1-4 sentences), citing real numbers and vendors. Amounts are in {ctx['currency']}, today is {ctx['today']}. "
        "If the data doesn't contain the answer, say so plainly."
    )
    try:
        chat = LlmChat(api_key=claude_key(), session_id=f"ledger-ask-{user['tenant_id']}-{new_id()}", system_message=system).with_model(*LLM_MODEL)
        resp = await chat.send_message(UserMessage(text=f"Finance data:\n{json.dumps(ctx)}\n\nQuestion: {q}"))
        answer = (resp or "").strip()
    except Exception as e:  # noqa: BLE001
        logger.warning(f"Ledger ask failed: {e}")
        raise HTTPException(status_code=502, detail="AI is busy, please try again")
    return {"answer": answer or "I couldn't find an answer in your finance data."}
