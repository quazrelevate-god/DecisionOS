"""Admin console -- billing & subscriptions (Epic 10 Sprint 4).

Platform revenue view for an India-first SME product on Razorpay: MRR + revenue,
per-tenant plan with admin override / comp, subscription lifecycle, Razorpay
reconciliation, and per-tenant payment history. Reads db.billing_events (recorded by
the Razorpay webhook) + tenant.plan; overrides are audited. Razorpay only -- no Stripe.
"""
from __future__ import annotations

from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core import db, get_platform_admin, now_iso
from config import BILLING_PLAN_PRICES_INR_PAISE
from services.plans import PLAN_KEYS
from routers.admin import log_admin_action

router = APIRouter(prefix="/api/admin")

_PAID_EVENTS = ("payment.captured", "subscription.charged", "order.paid")
_PAYING_PLANS = ("starter", "business", "enterprise")


class PlanOverrideInput(BaseModel):
    plan: Optional[str] = None
    seat_limit_override: Optional[int] = None
    reason: str = ""


def _rs(paise) -> float:
    return round((paise or 0) / 100.0, 2)


def _tname(t: dict) -> str:
    return t.get("company_name") or t.get("name") or t.get("id")


@router.get("/billing/overview")
async def billing_overview(admin: dict = Depends(get_platform_admin)):
    """MRR (recognised from active paid plans) + revenue + plan mix + recent payments."""
    # Plan distribution across tenants.
    cur = await db.tenants.aggregate([{"$group": {"_id": "$plan", "n": {"$sum": 1}}}])
    dist = {(r["_id"] or "none"): r["n"] for r in await cur.to_list(50)}

    # MRR = sum of list price for tenants on a paying plan.
    mrr_paise = sum(dist.get(p, 0) * (BILLING_PLAN_PRICES_INR_PAISE.get(p, 0) or 0) for p in _PAYING_PLANS)
    by_plan = [{"plan": p, "tenants": dist.get(p, 0),
                "price_inr": _rs(BILLING_PLAN_PRICES_INR_PAISE.get(p, 0)),
                "mrr_inr": _rs(dist.get(p, 0) * (BILLING_PLAN_PRICES_INR_PAISE.get(p, 0) or 0))}
               for p in PLAN_KEYS]

    # Revenue from recorded payments (all-time + 30d).
    async def revenue(cutoff_iso):
        match = {"event": {"$in": list(_PAID_EVENTS)}}
        if cutoff_iso:
            match["created_at"] = {"$gte": cutoff_iso}
        c = await db.billing_events.aggregate([
            {"$match": match},
            {"$group": {"_id": None, "amount": {"$sum": "$amount_paise"}, "n": {"$sum": 1}}}])
        r = await c.to_list(1)
        return {"revenue_inr": _rs(r[0]["amount"]) if r else 0.0, "payments": r[0]["n"] if r else 0}

    cutoff_30 = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    rev_all, rev_30 = await revenue(None), await revenue(cutoff_30)

    recent = await db.billing_events.find(
        {"event": {"$in": list(_PAID_EVENTS)}}, {"_id": 0, "raw": 0}
    ).sort("created_at", -1).to_list(15)

    paying = sum(dist.get(p, 0) for p in _PAYING_PLANS)
    total = sum(dist.values())
    return {
        "mrr_inr": _rs(mrr_paise), "arr_inr": _rs(mrr_paise * 12),
        "paying_tenants": paying, "total_tenants": total,
        "plan_distribution": dist, "by_plan": by_plan,
        "revenue": {"all_time": rev_all, "last_30d": rev_30},
        "recent_payments": recent,
        "razorpay_configured": bool(BILLING_PLAN_PRICES_INR_PAISE),
    }


@router.get("/billing/tenants")
async def billing_tenants(admin: dict = Depends(get_platform_admin), plan: Optional[str] = None):
    """Per-tenant plan + entitlement + last payment + lifetime revenue."""
    q = {}
    if plan:
        q["plan"] = plan
    tenants = await db.tenants.find(
        q, {"_id": 0, "id": 1, "name": 1, "company_name": 1, "plan": 1,
            "seat_limit": 1, "seat_limit_override": 1, "created_at": 1, "suspended": 1}
    ).sort("created_at", -1).to_list(2000)
    # last payment + lifetime revenue per tenant.
    _pcur = await db.billing_events.aggregate([
        {"$match": {"event": {"$in": list(_PAID_EVENTS)}}},
        {"$group": {"_id": "$tenant_id", "lifetime": {"$sum": "$amount_paise"},
                    "last": {"$max": "$created_at"}, "payments": {"$sum": 1}}}])
    pay = await _pcur.to_list(5000)
    pmap = {r["_id"]: r for r in pay}
    out = []
    for t in tenants:
        p = pmap.get(t["id"], {})
        out.append({
            "id": t["id"], "name": _tname(t), "plan": t.get("plan") or "none",
            "seat_limit_override": t.get("seat_limit_override"),
            "suspended": bool(t.get("suspended")),
            "created_at": t.get("created_at"),
            "lifetime_revenue_inr": _rs(p.get("lifetime", 0)),
            "last_payment": p.get("last"), "payments": p.get("payments", 0),
        })
    return {"tenants": out}


@router.patch("/billing/tenants/{tenant_id}/plan")
async def billing_set_plan(tenant_id: str, payload: PlanOverrideInput,
                           admin: dict = Depends(get_platform_admin)):
    """Admin plan override / comp: set a tenant's plan and/or seat-limit override
    (e.g. grant a free plan, bump seats). Audited with the reason."""
    t = await db.tenants.find_one({"id": tenant_id}, {"_id": 0, "id": 1, "name": 1, "company_name": 1, "plan": 1})
    if not t:
        raise HTTPException(status_code=404, detail="Workspace not found")
    sets = {}
    changes = []
    if payload.plan is not None:
        if payload.plan not in PLAN_KEYS:
            raise HTTPException(status_code=422, detail=f"plan must be one of {list(PLAN_KEYS)}")
        sets["plan"] = payload.plan
        changes.append(f"plan {t.get('plan')}->{payload.plan}")
    if payload.seat_limit_override is not None:
        sets["seat_limit_override"] = max(0, int(payload.seat_limit_override))
        changes.append(f"seats={sets['seat_limit_override']}")
    if not sets:
        raise HTTPException(status_code=422, detail="Nothing to change")
    sets["plan_updated_at"] = now_iso()
    sets["plan_updated_by"] = admin.get("email")
    await db.tenants.update_one({"id": tenant_id}, {"$set": sets})
    await log_admin_action(
        admin, "billing_plan_override",
        f"{_tname(t)}: {', '.join(changes)}. Reason: {(payload.reason or '—').strip()[:200]}",
        "tenant", tenant_id)
    return {"status": "ok", **{k: v for k, v in sets.items() if not k.startswith("plan_updated")}}


@router.get("/billing/tenants/{tenant_id}/payments")
async def billing_tenant_payments(tenant_id: str, admin: dict = Depends(get_platform_admin)):
    """Payment / billing-event history for one workspace."""
    rows = await db.billing_events.find(
        {"tenant_id": tenant_id}, {"_id": 0, "raw": 0}).sort("created_at", -1).to_list(200)
    total = sum(r.get("amount_paise", 0) for r in rows if r.get("event") in _PAID_EVENTS)
    for r in rows:
        r["amount_inr"] = _rs(r.get("amount_paise", 0))
    return {"payments": rows, "lifetime_revenue_inr": _rs(total)}


@router.get("/billing/reconciliation")
async def billing_reconciliation(admin: dict = Depends(get_platform_admin)):
    """Razorpay reconciliation: events grouped by type, and any events that never
    resolved to a tenant (notes missing tenant_id) -- the manual-review queue."""
    _ecur = await db.billing_events.aggregate([
        {"$group": {"_id": "$event", "n": {"$sum": 1}, "amt": {"$sum": "$amount_paise"}}}])
    by_event = {r["_id"]: {"count": r["n"], "amount_inr": _rs(r["amt"])} for r in await _ecur.to_list(50)}
    unmatched = await db.billing_events.find(
        {"$or": [{"tenant_id": ""}, {"tenant_id": None}]}, {"_id": 0, "raw": 0}
    ).sort("created_at", -1).to_list(100)
    failed = await db.billing_events.find(
        {"event": {"$in": ["payment.failed", "subscription.halted"]}}, {"_id": 0, "raw": 0}
    ).sort("created_at", -1).to_list(50)
    return {"by_event": by_event, "unmatched": unmatched, "unmatched_count": len(unmatched),
            "failed_or_halted": failed}
