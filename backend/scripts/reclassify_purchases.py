#!/usr/bin/env python3
"""
Re-classify historical PURCHASE bills into the correct ledger bucket
(Expense / Asset / Inventory) using the same AI classifier the app uses.

WHY: purchase bills captured before the segregation logic existed were all
dumped into Expenses. This script re-runs the AI over every filed purchase
bill and MOVES the mis-booked ones — deleting the wrong Expense (and any
auto-created Asset from it), creating the correct Asset / Inventory record,
and updating `invoice.purchase_type`. Bills the AI still can't classify are
tagged `needs_reclassification=True` and left untouched for manual review.

────────────────────────────────────────────────────────────────────────────
RUN IT AGAINST **PRODUCTION** (decisionos.biz):
  This script talks to whatever database `MONGO_URL` / `DB_NAME` point to.
  To fix the DEPLOYED data you must run it with the PRODUCTION values set,
  e.g. inside the deployed backend environment (where prod MONGO_URL is set):

      cd /app/backend && python scripts/reclassify_purchases.py --all-tenants --dry-run
      cd /app/backend && python scripts/reclassify_purchases.py --all-tenants

  Or target a single workspace by owner email:

      python scripts/reclassify_purchases.py --email owner@yourco.com

  ALWAYS run with --dry-run first to preview the changes, then re-run without
  it to apply them.

  (If you can't get shell access to production, the same fix is one click away:
   log in as the owner on decisionos.biz → Ledger → "Fix old purchases".)
────────────────────────────────────────────────────────────────────────────
"""
import argparse
import asyncio
import os
import sys
from pathlib import Path

# Make the backend package importable regardless of where this is launched from.
BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from dotenv import load_dotenv
load_dotenv(BACKEND_DIR / ".env")

from core import db  # noqa: E402  (uses MONGO_URL / DB_NAME from env)


def _num(x) -> float:
    try:
        return float(x or 0)
    except (TypeError, ValueError):
        return 0.0


async def _owner_for(tenant_id: str):
    return await db.users.find_one({"tenant_id": tenant_id, "role": "owner"},
                                   {"_id": 0, "id": 1, "name": 1})


async def preview_tenant(tenant_id: str) -> dict:
    """Read-only: report what WOULD change for one tenant, without writing."""
    from server import ai_classify_purchase  # lazy: pulls AI + full app config
    bills = await db.invoices.find({"tenant_id": tenant_id, "type": "purchase_bill"},
                                   {"_id": 0}).to_list(10000)
    summary = {"reviewed": 0, "to_asset": 0, "to_inventory": 0,
               "kept_expense": 0, "unknown": 0, "unchanged": 0, "changes": []}
    for inv in bills:
        summary["reviewed"] += 1
        li = " ".join(str(x.get("description", "")) for x in (inv.get("line_items") or [])
                      if isinstance(x, dict))
        text = (f"Vendor: {inv.get('contact_name', '')}. Bill no: {inv.get('number', '')}. "
                f"Items: {li}. Amount: {inv.get('amount')} {inv.get('currency', '')}")
        result = await ai_classify_purchase(text)
        new_type = result.get("purchase_type", "unknown")
        old_type = (inv.get("purchase_type") or "expense").strip().lower() or "expense"
        if new_type == "unknown":
            summary["unknown"] += 1
        elif new_type == old_type:
            summary["unchanged"] += 1
        else:
            key = {"asset": "to_asset", "inventory": "to_inventory"}.get(new_type, "kept_expense")
            summary[key] += 1
            summary["changes"].append(
                f"    • {inv.get('contact_name', 'Vendor')} #{inv.get('number', '?')} "
                f"({_num(inv.get('amount')):,.0f}): {old_type} → {new_type}  [{li[:50]}]")
    return summary


async def apply_tenant(tenant_id: str) -> dict:
    """Actually move the mis-booked bills for one tenant (reuses the app endpoint logic)."""
    from routers.ledger import reclassify_purchases
    owner = await _owner_for(tenant_id)
    if not owner:
        return {"error": "no owner user found for tenant"}
    user = {"id": owner["id"], "tenant_id": tenant_id, "role": "owner",
            "name": owner.get("name") or "Owner"}
    return await reclassify_purchases(user)


async def resolve_tenants(args) -> list:
    if args.tenant:
        return [args.tenant]
    if args.email:
        u = await db.users.find_one({"email": args.email.lower().strip()}, {"_id": 0, "tenant_id": 1})
        if not u:
            print(f"❌ No user found with email {args.email}")
            return []
        return [u["tenant_id"]]
    if args.all_tenants:
        rows = await db.tenants.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(10000)
        return [r["id"] for r in rows]
    return []


async def main():
    ap = argparse.ArgumentParser(description="Re-classify historical purchase bills into the right ledger bucket.")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--all-tenants", action="store_true", help="Every workspace in the database")
    g.add_argument("--tenant", help="A single tenant/workspace id")
    g.add_argument("--email", help="Target the workspace owned by this owner email")
    ap.add_argument("--dry-run", action="store_true", help="Preview changes without writing anything")
    args = ap.parse_args()

    dbname = os.environ.get("DB_NAME", "?")
    print(f"➡  Database: {dbname}   Mode: {'DRY-RUN (no writes)' if args.dry_run else 'APPLY (will modify data)'}\n")

    tenant_ids = await resolve_tenants(args)
    if not tenant_ids:
        print("Nothing to do.")
        return

    grand = {"reviewed": 0, "to_asset": 0, "to_inventory": 0, "kept_expense": 0, "unknown": 0, "unchanged": 0}
    for tid in tenant_ids:
        t = await db.tenants.find_one({"id": tid}, {"_id": 0, "name": 1})
        name = (t or {}).get("name") or tid
        if args.dry_run:
            s = await preview_tenant(tid)
        else:
            s = await apply_tenant(tid)
        if s.get("error"):
            print(f"⚠  {name}: {s['error']}")
            continue
        for k in grand:
            grand[k] += s.get(k, 0)
        print(f"🏢 {name}: reviewed {s['reviewed']} | → asset {s['to_asset']} | "
              f"→ inventory {s['to_inventory']} | kept expense {s['kept_expense']} | "
              f"unknown {s['unknown']} | unchanged {s['unchanged']}")
        for line in s.get("changes", []):
            print(line)

    print("\n────────────────────────────────────────────")
    print(f"TOTAL across {len(tenant_ids)} workspace(s): reviewed {grand['reviewed']} | "
          f"→ asset {grand['to_asset']} | → inventory {grand['to_inventory']} | "
          f"kept expense {grand['kept_expense']} | unknown {grand['unknown']} | unchanged {grand['unchanged']}")
    if args.dry_run:
        print("\nThis was a DRY-RUN — no data changed. Re-run without --dry-run to apply.")
    else:
        print("\n✅ Applied. Open the Ledger to see the corrected Assets / Inventory / Expenses.")


if __name__ == "__main__":
    asyncio.run(main())
