"""Seed test data for iteration 71 UI testing."""
import asyncio, uuid, os
from motor.motor_asyncio import AsyncIOMotorClient
from datetime import datetime

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

TAG = "TEST_ITER71"

async def main():
    c = AsyncIOMotorClient(MONGO_URL)
    db = c[DB_NAME]
    owner = await db.users.find_one({"email": "owner@sharma.com"}, {"_id": 0, "tenant_id": 1, "id": 1})
    tid = owner["tenant_id"]
    uid = owner["id"]
    now = datetime.utcnow().isoformat()

    # Cleanup any prior TEST_ITER71
    await db.invoices.delete_many({"tenant_id": tid, "tag": TAG})
    await db.payments.delete_many({"tenant_id": tid, "tag": TAG})

    # Two open sales invoices in db.invoices with type=sales_invoice
    inv_a = {"id": str(uuid.uuid4()), "tenant_id": tid, "user_id": uid, "tag": TAG,
             "type": "sales_invoice", "title": "TEST_ITER71 Sale A", "contact_name": "Acme Traders",
             "number": "TEST-A-71", "amount": 10000, "status": "unpaid",
             "amount_paid": 0, "created_at": now, "date": "2026-01-05"}
    inv_b = {"id": str(uuid.uuid4()), "tenant_id": tid, "user_id": uid, "tag": TAG,
             "type": "sales_invoice", "title": "TEST_ITER71 Sale B", "contact_name": "Beta Corp",
             "number": "TEST-B-71", "amount": 8000, "status": "unpaid",
             "amount_paid": 0, "created_at": now, "date": "2026-01-06"}
    await db.invoices.insert_many([inv_a, inv_b])

    # Unmatched IN payment (15000) - matches to 10000 invoice, leaves 5000 remaining
    pay_in = {"id": str(uuid.uuid4()), "tenant_id": tid, "tag": TAG,
              "direction": "in", "amount": 15000, "contact_name": "Acme Traders",
              "invoice_number": "", "applied": 0, "applications": [],
              "match_status": "unmatched", "date": "2026-01-07", "created_at": now}
    await db.payments.insert_one(pay_in)

    # Purchase bill (payables) + unmatched OUT payment
    pb = {"id": str(uuid.uuid4()), "tenant_id": tid, "user_id": uid, "tag": TAG,
          "type": "purchase_bill", "vendor_name": "Supplier X",
          "number": "TEST-PB-71", "amount": 6000, "status": "unpaid",
          "amount_paid": 0, "created_at": now, "date": "2026-01-04"}
    await db.invoices.insert_one(pb)
    pay_out = {"id": str(uuid.uuid4()), "tenant_id": tid, "tag": TAG,
               "direction": "out", "amount": 4000, "contact_name": "Supplier X",
               "invoice_number": "", "applied": 0, "applications": [],
               "match_status": "unmatched", "date": "2026-01-08", "created_at": now}
    await db.payments.insert_one(pay_out)

    print("SEED OK", {"tenant_id": tid, "pay_in": pay_in["id"], "pay_out": pay_out["id"],
                      "inv_a": inv_a["id"], "inv_b": inv_b["id"], "pb": pb["id"]})

asyncio.run(main())
