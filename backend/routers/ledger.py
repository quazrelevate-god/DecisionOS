"""Finance / Ledger: Expenses, Assets & Inventory + roll-up from captured invoices/payments.

Foundation (db, LLM config, auth deps, helpers) comes from `core` — this module does
NOT import from `server`, so there is no circular dependency. Approved purchase
bills / outgoing payments auto-create Expenses, and every record ingested from an
API/document source is also written into the Company Brain (memory) so finance is
queryable alongside decisions.
"""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from emergentintegrations.llm.chat import LlmChat, UserMessage

from core import (
    db, CLAUDE_KEY, LLM_MODEL,
    _extract_json, new_id, now_iso, logger,
    get_current_user, user_perms, log_activity,
)

router = APIRouter(prefix="/api")

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
        chat = LlmChat(api_key=CLAUDE_KEY, session_id=f"expcat-{tenant_id}", system_message=system).with_model(*LLM_MODEL)
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
