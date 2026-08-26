"""Demo-workspace seeding (Epic 8 Sprint 7 -- U8-07.2).

Extracted verbatim from server.py. seed_demo builds the Sharma Textiles demo
tenant (users, contacts, decisions, tasks, workflows) on an empty database;
write_test_credentials drops a dev cheat-sheet file; fixup_demo_tenant patches
older demo tenants in place. All are startup-only and orchestrated by
bootstrap.lifecycle._bootstrap. server.py re-exports these names.
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

from core import db, logger, now_iso, new_id, hash_password
from models.workflows import WORKFLOW_STAGES

DEMO_EMAIL = os.environ.get("DEMO_EMAIL", "owner@sharma.com")
DEMO_PASSWORD = os.environ.get("DEMO_PASSWORD", "demo1234")


async def seed_demo():
    if await db.users.find_one({"email": DEMO_EMAIL}):
        return
    logger.info("Seeding Sharma demo workspace...")
    tid = new_id()
    await db.tenants.insert_one({
        "id": tid, "name": "Sharma Textiles Pvt Ltd", "created_at": now_iso(),
        "industry": "Textile Manufacturing", "company_size": "11-50", "region": "India", "currency": "INR",
        "roles": [{"key": "sales", "label": "Sales"}, {"key": "production", "label": "Production"},
                  {"key": "finance", "label": "Finance"}],
        "products": [{"name": "Cotton kurta sets", "description": "Festive apparel collection"},
                     {"name": "Silk dupattas", "description": "Premium woven accessories"},
                     {"name": "Bulk fabric rolls", "description": "Wholesale cotton & silk"}],
    })

    def mkuser(name, email, role, phone=""):
        uid = new_id()
        return uid, {"id": uid, "tenant_id": tid, "name": name, "email": email, "phone": phone,
                     "password_hash": hash_password(DEMO_PASSWORD), "role": role, "created_at": now_iso()}

    owner_id, owner = mkuser("Rajesh Sharma", DEMO_EMAIL, "owner", "+91 98200 10001")
    sales_id, sales = mkuser("Priya Nair", "sales@sharma.com", "sales", "+91 98200 10002")
    prod_id, prod = mkuser("Amit Verma", "production@sharma.com", "production", "+91 98200 10003")
    fin_id, fin = mkuser("Sunita Rao", "finance@sharma.com", "finance", "+91 98200 10004")
    await db.users.insert_many([owner, sales, prod, fin])

    # Decisions + tasks
    d1 = new_id()
    t1, t2 = new_id(), new_id()
    await db.tasks.insert_many([
        {"id": t1, "tenant_id": tid, "title": "Confirm cotton supplier rates for Q3", "description": "Negotiate bulk pricing with Gujarat mill.",
         "assignee_role": "production", "assignee_id": prod_id, "priority": "high", "status": "todo",
         "due_date": (datetime.now(timezone.utc) + timedelta(days=3)).isoformat(), "decision_id": d1, "source": "voice", "created_at": now_iso()},
        {"id": t2, "tenant_id": tid, "title": "Prepare revised quote for Delhi retailer", "description": "Include 8% festive discount.",
         "assignee_role": "sales", "assignee_id": sales_id, "priority": "medium", "status": "todo",
         "due_date": (datetime.now(timezone.utc) - timedelta(days=1)).isoformat(), "decision_id": d1, "source": "voice", "created_at": now_iso()},
    ])
    await db.decisions.insert_one({
        "id": d1, "tenant_id": tid, "voice_note_id": None,
        "title": "Push festive season stock and lock supplier rates",
        "summary": "Rajesh wants to prioritise festive inventory: lock cotton supplier rates for Q3 and send a discounted quote to the Delhi retailer this week.",
        "items": [{"title": "Lock Q3 cotton rates", "detail": "Avoid festive price spikes", "category": "procurement"},
                  {"title": "Discounted retailer quote", "detail": "8% festive discount for Delhi partner", "category": "sales"}],
        "workflow_events": [], "status": "approved", "created_by": owner_id, "created_at": now_iso(),
        "decided_at": now_iso(), "task_ids": [t1, t2],
    })

    d2 = new_id()
    t3 = new_id()
    await db.tasks.insert_one({"id": t3, "tenant_id": tid, "title": "Draft new hire JD for dispatch coordinator",
                               "description": "To handle rising dispatch volume.", "assignee_role": "owner", "assignee_id": owner_id,
                               "priority": "low", "status": "blocked", "due_date": None, "decision_id": d2, "source": "voice", "created_at": now_iso()})
    await db.decisions.insert_one({
        "id": d2, "tenant_id": tid, "voice_note_id": None, "title": "Hire a dispatch coordinator",
        "summary": "Dispatch volumes are up 30%. Rajesh is considering hiring a dedicated dispatch coordinator.",
        "items": [{"title": "Hire dispatch coordinator", "detail": "Handle 30% volume increase", "category": "hiring"}],
        "workflow_events": [], "status": "pending_approval", "created_by": owner_id, "created_at": now_iso(), "task_ids": [t3],
    })

    # Contacts (customers & vendors)
    c_kapoor, c_threads, c_gujarat, c_packwell = new_id(), new_id(), new_id(), new_id()
    await db.contacts.insert_many([
        {"id": c_kapoor, "tenant_id": tid, "type": "customer", "name": "Kapoor Retail", "company": "Kapoor Retail Pvt Ltd",
         "phone": "+91 98100 11223", "email": "orders@kapoorretail.in", "address": "Karol Bagh, New Delhi", "tax_id": "07AABCK1234M1Z5",
         "tags": ["wholesale", "festive"], "status": "active", "assigned_id": sales_id, "notes": "Largest festive-season buyer; prefers net-30 terms.",
         "created_by": owner_id, "created_at": now_iso()},
        {"id": c_threads, "tenant_id": tid, "type": "customer", "name": "Threads Boutique", "company": "Threads Boutique",
         "phone": "+91 98200 44556", "email": "hello@threadsboutique.in", "address": "Bandra, Mumbai", "tax_id": "27AAECT5678P1Z2",
         "tags": ["boutique", "premium"], "status": "active", "assigned_id": sales_id, "notes": "Small premium orders, quick payer.",
         "created_by": owner_id, "created_at": now_iso()},
        {"id": c_gujarat, "tenant_id": tid, "type": "vendor", "name": "Gujarat Cotton Mills", "company": "Gujarat Cotton Mills Ltd",
         "phone": "+91 79000 77889", "email": "sales@gujaratcotton.in", "address": "Ahmedabad, Gujarat", "tax_id": "24AAACG9012Q1Z8",
         "tags": ["raw-material", "cotton"], "status": "active", "assigned_id": prod_id, "notes": "Primary yarn supplier.",
         "created_by": owner_id, "created_at": now_iso()},
        {"id": c_packwell, "tenant_id": tid, "type": "vendor", "name": "PackWell Industries", "company": "PackWell Industries",
         "phone": "+91 22000 33445", "email": "accounts@packwell.in", "address": "Vasai, Maharashtra", "tax_id": "27AAFCP3456R1Z1",
         "tags": ["packaging"], "status": "active", "assigned_id": prod_id, "notes": "Branded boxes & packaging.",
         "created_by": owner_id, "created_at": now_iso()},
    ])

    # Workflows
    prod_stages = WORKFLOW_STAGES["production"]
    dist_stages = WORKFLOW_STAGES["distribution"]
    pp_stages = WORKFLOW_STAGES["purchase_payment"]
    await db.workflows.insert_many([
        {"id": new_id(), "tenant_id": tid, "type": "production", "title": "Order #4821 — Delhi Retailer (500 units)",
         "detail": "Cotton kurta sets, festive collection", "amount": 385000, "counterparty": "Kapoor Retail Pvt Ltd", "contact_id": c_kapoor,
         "stage": "in_production", "stages": prod_stages,
         "history": [{"stage": "order_received", "note": "PO received", "by": sales_id, "at": now_iso()},
                     {"stage": "confirmed", "note": "Advance paid", "by": sales_id, "at": now_iso()},
                     {"stage": "in_production", "note": "Batch started", "by": prod_id, "at": now_iso()}],
         "created_by": sales_id, "created_at": now_iso()},
        {"id": new_id(), "tenant_id": tid, "type": "distribution", "title": "Order #4822 — Mumbai Boutique (120 units)",
         "detail": "Silk dupattas", "amount": 96000, "counterparty": "Threads Boutique", "contact_id": c_threads,
         "stage": "dispatched", "stages": dist_stages,
         "history": [{"stage": "ready_to_dispatch", "note": "Packed", "by": prod_id, "at": now_iso()},
                     {"stage": "dispatched", "note": "Shipped via BlueDart", "by": sales_id, "at": now_iso()}],
         "created_by": sales_id, "created_at": now_iso()},
        {"id": new_id(), "tenant_id": tid, "type": "purchase_payment", "title": "PO #221 — Cotton yarn (2 tonnes)",
         "detail": "Q3 raw material stock", "amount": 240000, "counterparty": "Gujarat Cotton Mills Ltd", "contact_id": c_gujarat,
         "stage": "requested", "stages": pp_stages,
         "history": [{"stage": "requested", "note": "Awaiting owner approval", "by": prod_id, "at": now_iso()}],
         "created_by": prod_id, "created_at": now_iso()},
        {"id": new_id(), "tenant_id": tid, "type": "purchase_payment", "title": "PO #219 — Packaging boxes",
         "detail": "5000 branded boxes", "amount": 45000, "counterparty": "PackWell Industries", "contact_id": c_packwell,
         "stage": "payment_pending", "stages": pp_stages,
         "history": [{"stage": "requested", "note": "", "by": prod_id, "at": now_iso()},
                     {"stage": "approved", "note": "Approved by owner", "by": owner_id, "at": now_iso()},
                     {"stage": "received", "note": "Delivered", "by": prod_id, "at": now_iso()},
                     {"stage": "payment_pending", "note": "Invoice received", "by": fin_id, "at": now_iso()}],
         "created_by": prod_id, "created_at": now_iso()},
    ])

    await db.activity.insert_many([
        {"id": new_id(), "tenant_id": tid, "actor": owner_id, "kind": "decision_approved",
         "message": "Approved 'Push festive season stock and lock supplier rates'", "entity_type": "decision", "entity_id": d1, "created_at": now_iso()},
        {"id": new_id(), "tenant_id": tid, "actor": sales_id, "kind": "workflow_advanced",
         "message": "'Order #4822' → dispatched", "entity_type": "workflow", "entity_id": None, "created_at": now_iso()},
    ])
    logger.info("Demo workspace seeded.")


async def write_test_credentials():
    content = f"""# Test Credentials

## Demo Workspace — Sharma Textiles Pvt Ltd
Owner:      {DEMO_EMAIL} / {DEMO_PASSWORD}  (role: owner)
Sales:      sales@sharma.com / {DEMO_PASSWORD}  (role: sales)
Production: production@sharma.com / {DEMO_PASSWORD}  (role: production)
Finance:    finance@sharma.com / {DEMO_PASSWORD}  (role: finance)

## Auth endpoints
POST /api/auth/register   {{company_name, name, email, password}}
POST /api/auth/login      {{email, password}}
GET  /api/auth/me         (Bearer token)

Auth: JWT Bearer token returned by login/register, send as `Authorization: Bearer <token>`.
"""
    creds_path = Path("/app/memory/test_credentials.md")
    creds_path.parent.mkdir(exist_ok=True)
    creds_path.write_text(content)


async def fixup_demo_tenant():
    """Ensure the seeded Sharma demo reflects its industry-aware profile + has contacts (idempotent)."""
    owner = await db.users.find_one({"email": DEMO_EMAIL}, {"_id": 0, "id": 1, "tenant_id": 1})
    if not owner:
        return
    tid = owner["tenant_id"]
    await db.tenants.update_one({"id": tid}, {"$set": {
        "industry": "Textile Manufacturing", "company_size": "11-50", "region": "India", "currency": "INR",
        "roles": [{"key": "sales", "label": "Sales"}, {"key": "production", "label": "Production"},
                  {"key": "finance", "label": "Finance"}],
        "products": [{"name": "Cotton kurta sets", "description": "Festive apparel collection"},
                     {"name": "Silk dupattas", "description": "Premium woven accessories"},
                     {"name": "Bulk fabric rolls", "description": "Wholesale cotton & silk"}],
    }})
    if await db.contacts.count_documents({"tenant_id": tid}) > 0:
        return
    sales = await db.users.find_one({"email": "sales@sharma.com"}, {"_id": 0, "id": 1})
    prod = await db.users.find_one({"email": "production@sharma.com"}, {"_id": 0, "id": 1})
    sales_id = sales["id"] if sales else owner["id"]
    prod_id = prod["id"] if prod else owner["id"]
    c_kapoor, c_threads, c_gujarat, c_packwell = new_id(), new_id(), new_id(), new_id()
    await db.contacts.insert_many([
        {"id": c_kapoor, "tenant_id": tid, "type": "customer", "name": "Kapoor Retail", "company": "Kapoor Retail Pvt Ltd",
         "phone": "+91 98100 11223", "email": "orders@kapoorretail.in", "address": "Karol Bagh, New Delhi", "tax_id": "07AABCK1234M1Z5",
         "tags": ["wholesale", "festive"], "status": "active", "assigned_id": sales_id, "notes": "Largest festive-season buyer; prefers net-30 terms.",
         "created_by": owner["id"], "created_at": now_iso()},
        {"id": c_threads, "tenant_id": tid, "type": "customer", "name": "Threads Boutique", "company": "Threads Boutique",
         "phone": "+91 98200 44556", "email": "hello@threadsboutique.in", "address": "Bandra, Mumbai", "tax_id": "27AAECT5678P1Z2",
         "tags": ["boutique", "premium"], "status": "active", "assigned_id": sales_id, "notes": "Small premium orders, quick payer.",
         "created_by": owner["id"], "created_at": now_iso()},
        {"id": c_gujarat, "tenant_id": tid, "type": "vendor", "name": "Gujarat Cotton Mills", "company": "Gujarat Cotton Mills Ltd",
         "phone": "+91 79000 77889", "email": "sales@gujaratcotton.in", "address": "Ahmedabad, Gujarat", "tax_id": "24AAACG9012Q1Z8",
         "tags": ["raw-material", "cotton"], "status": "active", "assigned_id": prod_id, "notes": "Primary yarn supplier.",
         "created_by": owner["id"], "created_at": now_iso()},
        {"id": c_packwell, "tenant_id": tid, "type": "vendor", "name": "PackWell Industries", "company": "PackWell Industries",
         "phone": "+91 22000 33445", "email": "accounts@packwell.in", "address": "Vasai, Maharashtra", "tax_id": "27AAFCP3456R1Z1",
         "tags": ["packaging"], "status": "active", "assigned_id": prod_id, "notes": "Branded boxes & packaging.",
         "created_by": owner["id"], "created_at": now_iso()},
    ])
    links = {
        "Order #4821": (c_kapoor, "Kapoor Retail Pvt Ltd"),
        "Order #4822": (c_threads, "Threads Boutique"),
        "PO #221": (c_gujarat, "Gujarat Cotton Mills Ltd"),
        "PO #219": (c_packwell, "PackWell Industries"),
    }
    for prefix, (cid, name) in links.items():
        await db.workflows.update_one(
            {"tenant_id": tid, "title": {"$regex": f"^{prefix}"}},
            {"$set": {"contact_id": cid, "counterparty": name}},
        )
    logger.info("Demo contacts seeded & linked.")
