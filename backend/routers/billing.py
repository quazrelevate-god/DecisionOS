"""Billing router — Razorpay (S3-01, 2026-08-16).

Redirect-to-landing pattern per founder ask:
  * We do NOT embed Razorpay Checkout in our UI.
  * `/api/billing/checkout` returns a SIGNED redirect URL to the
    marketing landing page (BILLING_LANDING_URL). That page hosts
    the actual Razorpay Checkout / Payment Link and knows the
    tenant identity from a signed query string.
  * On successful payment, Razorpay POSTs `/api/billing/webhook`.
    We verify the HMAC-SHA256 signature (RAZORPAY_WEBHOOK_SECRET)
    and upgrade tenant.plan.

Endpoints:
  * GET  /api/billing/plans     — public plan catalogue (auth required
                                   so the client can pre-fill tenant
                                   context on the redirect)
  * GET  /api/billing/status    — current plan + trial state (thin
                                   wrapper on the existing /tenant/plan)
  * POST /api/billing/checkout  — {plan_key} -> {redirect_url, expires}
  * POST /api/billing/webhook   — Razorpay -> us. No auth; verified
                                   by HMAC signature.

Zero razorpay-python SDK dependency — signature verify uses stdlib
hmac + hashlib. When BILLING_LANDING_URL is unset, /checkout returns
503 so the module stays inert in dev/staging without half-wiring.
"""
import hmac
import hashlib
import json
from datetime import datetime, timezone, timedelta
from typing import Optional
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from config import (
    BILLING_LANDING_URL,
    BILLING_RETURN_URL,
    BILLING_SIGNING_SECRET,
    BILLING_PLAN_PRICES_INR_PAISE,
    RAZORPAY_KEY_ID,
    RAZORPAY_WEBHOOK_SECRET,
)
from core import db, get_current_user, log_activity, now_iso, require_role


router = APIRouter(prefix="/api/billing")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _sign_handoff(tenant_id: str, plan_key: str, expires_iso: str) -> str:
    """HMAC-SHA256 of the handoff payload so the landing page can
    trust the tenant identity without a round-trip back to us.
    Landing page verifies with the same BILLING_SIGNING_SECRET before
    calling Razorpay -- otherwise anyone could load
    `/pricing?plan=business&tenant_id=<victim>` and pay for someone
    else's workspace."""
    payload = f"{tenant_id}|{plan_key}|{expires_iso}"
    return hmac.new(
        BILLING_SIGNING_SECRET.encode("utf-8"),
        payload.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def _verify_razorpay_signature(body: bytes, signature: str) -> bool:
    """Standard Razorpay webhook verification -- HMAC-SHA256 of the
    raw request body using RAZORPAY_WEBHOOK_SECRET."""
    if not (signature and RAZORPAY_WEBHOOK_SECRET):
        return False
    expected = hmac.new(
        RAZORPAY_WEBHOOK_SECRET.encode("utf-8"),
        body,
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, signature)


def _plan_from_amount_paise(amount: int) -> Optional[str]:
    """Reverse-lookup which plan an amount corresponds to. Only used
    when the webhook payload doesn't carry plan_key in notes[] --
    good defence-in-depth so a customer paying the starter amount
    can't get bumped to business."""
    for plan_key, price in BILLING_PLAN_PRICES_INR_PAISE.items():
        if price and price == amount:
            return plan_key
    return None


# ---------------------------------------------------------------------------
# GET /api/billing/plans -- catalogue for the frontend/landing page
# ---------------------------------------------------------------------------
@router.get("/plans")
async def list_plans(user: dict = Depends(get_current_user)):
    """Public plan catalogue. Merges services/plans PLAN_DEFINITIONS
    with the env-configured prices so a single call gives everything
    the pricing landing page needs."""
    from services.plans import PLAN_DEFINITIONS, PLAN_TRIAL, PLAN_STARTER, PLAN_BUSINESS, PLAN_ENTERPRISE
    out = []
    for key, spec in PLAN_DEFINITIONS.items():
        if key in (PLAN_TRIAL,):
            continue  # trial isn't a purchasable plan
        price = BILLING_PLAN_PRICES_INR_PAISE.get(key, 0)
        out.append({
            "key": key,
            "name": key.title(),
            "price_inr_paise": price,
            "price_inr_display": f"Rs {price // 100:,}" if price else "Contact sales",
            "seat_limit": spec.get("seat_limit"),
            "quotas": spec.get("quotas") or {},
            "features": spec.get("features") or {},
            "is_talk_to_sales": key == PLAN_ENTERPRISE,
        })
    return {"plans": out}


# ---------------------------------------------------------------------------
# GET /api/billing/status -- thin wrapper on the existing /tenant/plan
# ---------------------------------------------------------------------------
@router.get("/status")
async def billing_status(user: dict = Depends(get_current_user)):
    from services.plans import effective_plan, trial_expired
    tenant = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})
    if not tenant:
        raise HTTPException(status_code=404, detail="Workspace not found")
    ep = effective_plan(tenant)
    ep["trial_expired"] = trial_expired(tenant)
    ep["billing_configured"] = bool(BILLING_LANDING_URL and RAZORPAY_KEY_ID)
    return ep


# ---------------------------------------------------------------------------
# POST /api/billing/checkout -- handoff to landing page
# ---------------------------------------------------------------------------
class CheckoutInput(BaseModel):
    plan_key: str = Field(..., description="One of starter, business")
    return_to: Optional[str] = Field(
        None, description="Path in this app to redirect back to after payment. Defaults to BILLING_RETURN_URL.")


@router.post("/checkout")
async def checkout(inp: CheckoutInput,
                   user: dict = Depends(require_role("owner"))):
    """Owner-only. Returns a signed URL to the pricing landing page
    with tenant identity + selected plan pre-filled. Frontend does
    `window.location.href = response.redirect_url`."""
    if not BILLING_LANDING_URL:
        raise HTTPException(
            status_code=503,
            detail="Billing not configured. Set BILLING_LANDING_URL + RAZORPAY_KEY_ID env vars.",
        )
    from services.plans import PLAN_KEYS
    plan_key = inp.plan_key.lower().strip()
    if plan_key not in PLAN_KEYS or plan_key in ("trial", "grandfathered"):
        raise HTTPException(status_code=400,
                             detail=f"Invalid plan_key. Purchasable plans: starter, business, enterprise.")
    tid = user["tenant_id"]
    # 15-minute handoff window; landing page must complete Checkout
    # before this expires.
    expires = (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat()
    sig = _sign_handoff(tid, plan_key, expires)
    return_to = inp.return_to or BILLING_RETURN_URL
    qs = urlencode({
        "tenant_id": tid,
        "plan": plan_key,
        "expires": expires,
        "sig": sig,
        "return_to": return_to,
        "email": user.get("email") or "",  # pre-fill on Razorpay Checkout
        "name": user.get("name") or "",
    })
    separator = "&" if "?" in BILLING_LANDING_URL else "?"
    url = f"{BILLING_LANDING_URL}{separator}{qs}"
    await log_activity(
        tid, user["id"], "billing_checkout_started",
        f"Started checkout for plan '{plan_key}'",
        "tenant", tid,
    )
    return {"redirect_url": url, "expires_at": expires, "plan_key": plan_key}


# ---------------------------------------------------------------------------
# POST /api/billing/webhook -- Razorpay pings us
# ---------------------------------------------------------------------------
@router.post("/webhook")
async def razorpay_webhook(request: Request):
    """No auth -- verified by HMAC signature. Razorpay POSTs raw JSON
    and includes the signature in the X-Razorpay-Signature header."""
    body = await request.body()
    sig = request.headers.get("X-Razorpay-Signature") or ""
    if not _verify_razorpay_signature(body, sig):
        raise HTTPException(status_code=401, detail="Invalid signature")

    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Malformed JSON")

    event = payload.get("event") or ""
    # We only care about the terminal success/failure events. Everything
    # else (payment.authorized, order.paid intermediate, etc.) we log
    # and ignore.
    if event not in ("payment.captured", "subscription.charged",
                     "payment.failed", "subscription.halted"):
        return {"ok": True, "ignored": event}

    # Extract tenant_id + plan_key from notes[]. Landing page MUST
    # attach these when creating the Razorpay order/subscription:
    #   notes: {tenant_id: "...", plan_key: "starter"}
    entity = ((payload.get("payload") or {}).get("payment") or
              (payload.get("payload") or {}).get("subscription") or {})
    body_ent = entity.get("entity") or {}
    notes = body_ent.get("notes") or {}
    tenant_id = notes.get("tenant_id") or ""
    plan_key = notes.get("plan_key") or ""
    if not tenant_id:
        # Some Razorpay flows put notes on the order, not payment.
        # Fall back to amount-based lookup for defence-in-depth.
        amount_paise = int(body_ent.get("amount") or 0)
        plan_key = plan_key or (_plan_from_amount_paise(amount_paise) or "")
    if not tenant_id:
        return {"ok": True, "unmatched": "no tenant_id in notes"}

    # Idempotency -- Razorpay retries webhooks. Key on payment.id or
    # subscription.id + event so a re-delivery is a no-op.
    # S5-05 audit fix (2026-08-16): the find_one -> insert_one pattern
    # races if the same webhook fires twice in quick succession. The
    # unique index on billing_events.idempotency_key (see server.py
    # _bootstrap) is the belt; catching DuplicateKeyError below is the
    # braces. Both are required -- neither on its own is safe under
    # concurrent Razorpay retries.
    from pymongo.errors import DuplicateKeyError
    entity_id = body_ent.get("id") or ""
    idempotency_key = f"razorpay:{event}:{entity_id}"
    existing = await db.billing_events.find_one(
        {"idempotency_key": idempotency_key}, {"_id": 0, "idempotency_key": 1})
    if existing:
        return {"ok": True, "already_processed": True}

    try:
        await db.billing_events.insert_one({
            "idempotency_key": idempotency_key,
            "tenant_id": tenant_id,
            "event": event,
            "plan_key": plan_key,
            "amount_paise": int(body_ent.get("amount") or 0),
            "razorpay_entity_id": entity_id,
            "created_at": now_iso(),
            "raw": body_ent,
        })
    except DuplicateKeyError:
        # Race: another replica processed this webhook between our
        # find_one and insert_one. Not an error -- return the same
        # already-processed response the fast path returns.
        return {"ok": True, "already_processed": True, "raced": True}

    if event in ("payment.captured", "subscription.charged"):
        if not plan_key:
            return {"ok": True, "logged_only": True}
        # Upgrade tenant.plan. Reset trial fields since they're now
        # on a paid plan.
        from services.plans import PLAN_KEYS
        if plan_key not in PLAN_KEYS:
            return {"ok": True, "invalid_plan": plan_key}
        await db.tenants.update_one(
            {"id": tenant_id},
            {"$set": {
                "plan": plan_key,
                "plan_activated_at": now_iso(),
                "trial_ends_at": None,
            }},
        )
        await log_activity(
            tenant_id, "system", "plan_upgraded",
            f"Plan upgraded to '{plan_key}' via Razorpay ({event})",
            "tenant", tenant_id,
        )
        return {"ok": True, "upgraded_to": plan_key}

    # payment.failed / subscription.halted -- just log; don't downgrade
    # automatically. Founder decides how to handle dunning.
    await log_activity(
        tenant_id, "system", "plan_payment_issue",
        f"Payment issue: {event} on plan '{plan_key}'",
        "tenant", tenant_id,
    )
    return {"ok": True, "logged": event}
