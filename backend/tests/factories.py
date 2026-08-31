"""Reusable test-data factories (Epic 10 T10-11.9).

Build a realistic tenant for a given industry -- owner + team, contacts,
sales/purchase invoices, in/out payments, and operational tasks -- so scenario
tests (Sprint 5 multi-niche, Sprint 6 team-scale) stop hand-rolling seed data and
share one deterministic, niche-aware generator.

Everything is DETERMINISTIC (index-derived, no randomness) so a test that seeds a
niche gets the same tenant every run. Docs are written directly into the same
collections the app reads (tenants/users/memberships/contacts/invoices/payments/
tasks), shaped to match the real read paths (finance_signals, operating_score).

Usage:
    from tests.factories import build_niche_tenant, NICHES
    async def scenario(db):
        t = await build_niche_tenant(db, "textile", tenant_id="t1")
        # t = {tenant_id, industry, roles, user_ids, contact_ids,
        #      invoice_ids, payment_ids, task_ids}
"""
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

from core import new_id, now_iso
from services.auth.membership import create_membership, STATUS_ACTIVE


def _iso_days(offset: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(days=offset)).isoformat()


# --- Niche presets ----------------------------------------------------------
# Each preset is grounded in the industry so the seeded tenant reads as that kind
# of business. `members` are non-owner roles; contacts/sales/purchases/tasks are
# templates expanded by the builder.
NICHES: Dict[str, Dict[str, Any]] = {
    "textile": {
        "industry": "Textile & Apparel",
        "roles": ["sales", "production", "procurement", "finance"],
        "contacts": [("Brand Kart", "customer"), ("Sri Yarn Mills", "vendor"),
                     ("ColorDye Chem", "vendor"), ("FashionHub Retail", "customer")],
        "sales": [42000, 88000, 15000],       # sales invoices (INR)
        "purchases": [30000, 12000],           # purchase bills (yarn, dye)
        "tasks": ["Weekly yarn order status check", "Dye lot colour match before dispatch",
                  "Pre-dispatch quality sign-off"],
    },
    "logistics": {
        "industry": "Logistics & Transport",
        "roles": ["dispatch", "fleet", "compliance", "finance"],
        "contacts": [("DairyFresh Co", "customer"), ("PharmaChain Ltd", "customer"),
                     ("FuelPoint", "vendor"), ("TyreWorld", "vendor")],
        "sales": [120000, 65000, 90000],
        "purchases": [40000, 18000],
        "tasks": ["Assign reefer vehicle to booking", "Temperature logging check in transit",
                  "Capture signed POD on delivery"],
    },
    "restaurant": {
        "industry": "Restaurant / Food & Beverage",
        "roles": ["kitchen", "service", "purchase"],
        "contacts": [("Swiggy", "customer"), ("Zomato", "customer"),
                     ("Green Grocers", "vendor"), ("MeatMart", "vendor")],
        "sales": [8000, 12000, 5000, 9000],
        "purchases": [6000, 4000],
        "tasks": ["Morning prep against expected covers", "Reconcile aggregator orders at close",
                  "End-of-day wastage log"],
    },
    "clinic": {
        "industry": "Healthcare",
        "roles": ["front_desk", "pharmacy"],
        "contacts": [("Walk-in Patients", "customer"), ("MedSupply Distributors", "vendor")],
        "sales": [1500, 800, 2200],
        "purchases": [9000],
        "tasks": ["Send follow-up reminders to chronic patients", "Reorder low pharmacy stock"],
    },
    "retail": {
        "industry": "Retail / E-commerce",
        "roles": ["purchase", "inventory", "store", "ecommerce"],
        "contacts": [("Online Shoppers", "customer"), ("Outlet Walk-ins", "customer"),
                     ("Apparel Wholesalers", "vendor")],
        "sales": [25000, 18000, 32000],
        "purchases": [50000, 22000],
        "tasks": ["Transfer stock to the 3 outlets", "Weekly fast-moving SKU stock-out review",
                  "Process online returns and exchanges"],
    },
    "electronics": {
        "industry": "Manufacturing",
        "roles": ["procurement", "production", "inventory", "sales", "quality"],
        "contacts": [("OEM Buyers Pvt Ltd", "customer"), ("Chip Distributors", "vendor"),
                     ("PCB Fab House", "vendor")],
        "sales": [180000, 95000],
        "purchases": [120000, 60000],     # component BOM, high-value
        "tasks": ["BOM cost roll-up per build", "Component inventory reorder point check",
                  "Finished-goods asset stock count"],
    },
    "pharma": {
        "industry": "Pharmaceuticals",
        "roles": ["sales", "warehouse", "compliance", "finance"],
        "contacts": [("City Chemists", "customer"), ("Hospital Supply Chain", "customer"),
                     ("API Manufacturer", "vendor")],
        "sales": [236000, 118000],        # GST-inclusive gross (18%) -- handled as-is, no GST math
        "purchases": [88500],
        "tasks": ["Batch + expiry check before dispatch", "Schedule-H compliance filing",
                  "Cold-storage stock reconciliation"],
    },
    "consulting": {
        "industry": "Professional Services",
        "roles": ["delivery", "accounts"],
        "contacts": [("Retainer Client A", "customer"), ("Retainer Client B", "customer"),
                     ("Project Client C", "customer")],
        "sales": [50000, 50000, 75000],   # recurring retainers + a project fee; NO inventory
        "purchases": [],                   # services business -- no goods purchased
        "tasks": ["Monthly retainer invoice run", "Timesheet review before billing",
                  "Renew expiring retainer agreements"],
    },
    "construction": {
        "industry": "Construction",
        "roles": ["projects", "procurement", "site", "finance"],
        "contacts": [("Township Developer", "customer"), ("Steel Supplier", "vendor"),
                     ("Cement Depot", "vendor")],
        "sales": [1000000, 750000],        # large staged/milestone contracts
        "purchases": [300000, 150000],
        "tasks": ["Raise milestone completion invoice", "Reconcile staged client payment",
                  "Site material requisition approval"],
    },
    "agriculture": {
        "industry": "Agriculture",
        "roles": ["farming", "sales", "finance"],
        "contacts": [("Mandi Trader", "customer"), ("Food Processor", "customer"),
                     ("Seed & Fertilizer Co", "vendor")],
        "sales": [220000, 40000],          # seasonal, lumpy
        "purchases": [90000, 30000],
        "tasks": ["Harvest-season dispatch planning", "Seasonal input procurement",
                  "Commodity price tracking"],
    },
}


async def seed_tenant(db, *, tenant_id: str, name: str, industry: str,
                      roles: List[str], plan: str = "starter",
                      member_roles: Optional[List[str]] = None) -> Dict[str, Any]:
    """Insert a tenant + owner + owner membership, plus one active member per
    member_role. Returns {tenant_id, owner_id, user_ids}."""
    await db.tenants.insert_one({
        "id": tenant_id, "name": name, "industry": industry, "plan": plan,
        "roles": [{"key": r, "label": r.replace("_", " ").title()} for r in roles],
        "created_at": now_iso(),
    })
    owner_id = new_id()
    await db.users.insert_one({"id": owner_id, "tenant_id": tenant_id, "name": f"{name} Owner",
                               "role": "owner", "created_at": now_iso()})
    await create_membership(db, user_id=owner_id, tenant_id=tenant_id, role="owner",
                            status=STATUS_ACTIVE)
    user_ids = [owner_id]
    for i, role in enumerate(member_roles or []):
        uid = new_id()
        await db.users.insert_one({"id": uid, "tenant_id": tenant_id, "name": f"{role.title()} {i}",
                                   "role": role, "created_at": now_iso()})
        await create_membership(db, user_id=uid, tenant_id=tenant_id, role=role, status=STATUS_ACTIVE)
        user_ids.append(uid)
    return {"tenant_id": tenant_id, "owner_id": owner_id, "user_ids": user_ids}


async def seed_contacts(db, tenant_id: str, specs: List) -> List[str]:
    """specs = [(name, type), ...] -> customers/vendors. Returns contact ids."""
    ids = []
    for i, (nm, typ) in enumerate(specs):
        cid = new_id()
        await db.contacts.insert_one({
            "id": cid, "tenant_id": tenant_id, "type": typ, "name": nm, "company": nm,
            "status": "active", "created_at": now_iso(),
        })
        ids.append(cid)
    return ids


async def seed_finance(db, tenant_id: str, *, sales: List[int], purchases: List[int]) -> Dict[str, List[str]]:
    """Seed sales invoices (some paid, some overdue), purchase bills, and matching
    in/out payments -- shaped for finance_signals + operating_score read paths."""
    inv_ids, pay_ids = [], []
    for i, amt in enumerate(sales):
        iid = new_id()
        paid = (i % 3 == 0)                       # every 3rd sale is fully paid
        overdue = (not paid) and (i % 2 == 1)     # some unpaid are overdue
        await db.invoices.insert_one({
            "id": iid, "tenant_id": tenant_id, "type": "sales_invoice",
            "amount": amt, "amount_paid": amt if paid else 0,
            "status": "paid" if paid else "open",
            "due_date": _iso_days(-5 if overdue else 10), "created_at": now_iso(),
        })
        inv_ids.append(iid)
        if paid:
            pid = new_id()
            await db.payments.insert_one({
                "id": pid, "tenant_id": tenant_id, "direction": "in", "amount": amt,
                "applied": amt, "date": _iso_days(-2), "created_at": now_iso(),
                "finance_ref": {"invoice_id": iid, "invoice_type": "sales_invoice"},
            })
            pay_ids.append(pid)
    for i, amt in enumerate(purchases):
        iid = new_id()
        await db.invoices.insert_one({
            "id": iid, "tenant_id": tenant_id, "type": "purchase_bill",
            "amount": amt, "amount_paid": 0, "status": "open",
            "due_date": _iso_days(7), "created_at": now_iso(),
        })
        inv_ids.append(iid)
        # an out-payment (supplier) -- must NOT be counted as customer collection
        pid = new_id()
        await db.payments.insert_one({
            "id": pid, "tenant_id": tenant_id, "direction": "out", "amount": amt // 2,
            "applied": amt // 2, "date": _iso_days(-1), "created_at": now_iso(),
        })
        pay_ids.append(pid)
    return {"invoice_ids": inv_ids, "payment_ids": pay_ids}


async def seed_tasks(db, tenant_id: str, titles: List[str], assignee_ids: List[str]) -> List[str]:
    ids = []
    for i, title in enumerate(titles):
        tid = new_id()
        await db.tasks.insert_one({
            "id": tid, "tenant_id": tenant_id, "title": title,
            "status": "done" if i % 2 == 0 else "todo",
            "assignee_id": assignee_ids[i % len(assignee_ids)] if assignee_ids else None,
            "priority": "medium", "created_at": now_iso(),
        })
        ids.append(tid)
    return ids


async def build_niche_tenant(db, niche: str, *, tenant_id: Optional[str] = None) -> Dict[str, Any]:
    """Assemble a full, realistic tenant for `niche` (see NICHES). One call ->
    tenant + team + contacts + finance + tasks, all grounded in the industry."""
    if niche not in NICHES:
        raise ValueError(f"unknown niche {niche!r}; known: {sorted(NICHES)}")
    p = NICHES[niche]
    tid = tenant_id or new_id()
    t = await seed_tenant(db, tenant_id=tid, name=f"{niche.title()} Co", industry=p["industry"],
                          roles=p["roles"], member_roles=p["roles"][:3])
    contact_ids = await seed_contacts(db, tid, p["contacts"])
    fin = await seed_finance(db, tid, sales=p["sales"], purchases=p["purchases"])
    task_ids = await seed_tasks(db, tid, p["tasks"], t["user_ids"])
    return {
        "tenant_id": tid, "industry": p["industry"], "roles": p["roles"],
        "user_ids": t["user_ids"], "owner_id": t["owner_id"],
        "contact_ids": contact_ids, "invoice_ids": fin["invoice_ids"],
        "payment_ids": fin["payment_ids"], "task_ids": task_ids,
    }
