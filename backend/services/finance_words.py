"""The finance vocabulary rules and categories (moved from routers/ledger 2026-10-06 so
the calculated categoriser -- services/calculated -- can use them without importing a
router; routers/ledger re-exports every name)."""
from core import db


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
