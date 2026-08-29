"""FIX-005-A (S3-02): plan / entitlement model for tenants.

Every tenant is on "unlimited free forever" today — no plan field,
no trial expiry, no seat limits, no feature flags. Blocks selling
and blocks any per-plan quota enforcement (S3-04).

Design:
  * `tenant.plan` — one of PLAN_KEYS. Defaults to PLAN_TRIAL for
    fresh registrations; existing tenants get PLAN_GRANDFATHERED
    via the backfill migration (so they stay on "no restrictions"
    until a human explicitly repositions them).
  * `tenant.trial_ends_at` — iso date. Only meaningful when
    plan == "trial". Read-only on the tenant doc; set by backend on
    plan transitions.
  * `tenant.seat_limit` — max number of ACTIVE memberships (RBAC-13).
    None = unlimited. Enforced in team.py create_user + register
    invite flow.
  * `tenant.feature_flags` — dict of {flag_key: bool}. Loose escape
    hatch for opting a tenant into features that aren't ready for
    everyone. `has_feature(tenant, "flag")` reader.
  * `tenant.usage_quotas` — dict of {resource: monthly_cap}. Set by
    the plan (see PLAN_DEFINITIONS below) but overridable per-tenant
    (e.g. we bumped a design partner's quota). None cap = unlimited.

Plans:
  trial          14-day free trial, small quotas, 3 seats
  starter        paid entry, moderate quotas, 10 seats
  business       paid growth, generous quotas, unlimited seats
  enterprise     custom, unlimited everything, feature_flags default on
  grandfathered  legacy tenants — treated as `business` but never
                 automatically downgraded

Contract:
  effective_plan(tenant) -> {key, seat_limit, quotas, features, ...}
    Merges plan defaults + tenant overrides. Every gate that needs a
    quota / seat cap calls this instead of reading raw fields.

  has_feature(tenant, flag_key) -> bool
  enforce_seat_limit(db, tenant_id) -> None (raises HTTPException if full)
  trial_expired(tenant) -> bool
"""
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, Optional

from fastapi import HTTPException


# Plan keys — used as tenant.plan value.
PLAN_TRIAL = "trial"
PLAN_STARTER = "starter"
PLAN_BUSINESS = "business"
PLAN_ENTERPRISE = "enterprise"
PLAN_GRANDFATHERED = "grandfathered"

PLAN_KEYS = (PLAN_TRIAL, PLAN_STARTER, PLAN_BUSINESS,
             PLAN_ENTERPRISE, PLAN_GRANDFATHERED)

# Trial window. New tenants get plan=trial + trial_ends_at = now + this.
TRIAL_DAYS = 14

# Per-plan defaults. Quotas are MONTHLY caps; None means unlimited.
# Resource keys line up with services/usage.py aggregations so the
# quota-enforcer (S3-04) can look them up directly.
PLAN_DEFINITIONS: Dict[str, Dict[str, Any]] = {
    PLAN_TRIAL: {
        "seat_limit": 3,
        "quotas": {
            "llm_tokens_total": 300_000,     # ~$1 of Sonnet 4.6 cost
            "stt_minutes": 30,
            "storage_bytes": 100 * 1024 * 1024,  # 100 MB
            "brain_docs": 20,
        },
        "features": {"whatsapp": False, "sso": False, "api_keys": False},
    },
    PLAN_STARTER: {
        "seat_limit": 10,
        "quotas": {
            "llm_tokens_total": 2_000_000,
            "stt_minutes": 300,
            "storage_bytes": 5 * 1024 * 1024 * 1024,   # 5 GB
            "brain_docs": 200,
        },
        "features": {"whatsapp": True, "sso": False, "api_keys": False},
    },
    PLAN_BUSINESS: {
        "seat_limit": None,   # unlimited
        "quotas": {
            "llm_tokens_total": 10_000_000,
            "stt_minutes": 2_000,
            "storage_bytes": 50 * 1024 * 1024 * 1024,
            "brain_docs": 2_000,
        },
        "features": {"whatsapp": True, "sso": False, "api_keys": True},
    },
    PLAN_ENTERPRISE: {
        "seat_limit": None,
        "quotas": {
            "llm_tokens_total": None,
            "stt_minutes": None,
            "storage_bytes": None,
            "brain_docs": None,
        },
        "features": {"whatsapp": True, "sso": True, "api_keys": True},
    },
    PLAN_GRANDFATHERED: {
        # Legacy tenants: same generous shape as business, retained
        # forever. They never auto-downgrade.
        "seat_limit": None,
        "quotas": {
            "llm_tokens_total": None,
            "stt_minutes": None,
            "storage_bytes": None,
            "brain_docs": None,
        },
        "features": {"whatsapp": True, "sso": False, "api_keys": True},
    },
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def effective_plan(tenant: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Merged plan view: base plan defaults + tenant-level overrides.

    Order:
      1. Base = PLAN_DEFINITIONS[tenant.plan or PLAN_TRIAL]
      2. Override seat_limit if `tenant.seat_limit_override` is set
      3. Override individual quotas from `tenant.usage_quotas`
      4. Override individual features from `tenant.feature_flags`

    Returns a dict shaped like:
      {"key": str, "trial_ends_at": iso|None, "trial_expired": bool,
       "seat_limit": int|None, "quotas": {...}, "features": {...}}
    """
    tenant = tenant or {}
    key = tenant.get("plan") or PLAN_TRIAL
    if key not in PLAN_KEYS:
        key = PLAN_TRIAL
    base = PLAN_DEFINITIONS[key]
    seat_limit = base["seat_limit"]
    if tenant.get("seat_limit_override") is not None:
        seat_limit = tenant.get("seat_limit_override")
    quotas = dict(base["quotas"])
    for k, v in (tenant.get("usage_quotas") or {}).items():
        if k in quotas:
            quotas[k] = v      # None allowed = unlimited override
    features = dict(base["features"])
    for k, v in (tenant.get("feature_flags") or {}).items():
        features[k] = bool(v)
    return {
        "key": key,
        "trial_ends_at": tenant.get("trial_ends_at"),
        "trial_expired": trial_expired(tenant),
        "seat_limit": seat_limit,
        "quotas": quotas,
        "features": features,
    }


def trial_expired(tenant: Optional[Dict[str, Any]]) -> bool:
    """True iff tenant is on trial and trial_ends_at is in the past."""
    if not tenant:
        return False
    if tenant.get("plan") != PLAN_TRIAL:
        return False
    ts = tenant.get("trial_ends_at")
    if not ts:
        return False
    try:
        end = datetime.fromisoformat(ts.replace("Z", "+00:00")) if isinstance(ts, str) else ts
        if not isinstance(end, datetime):
            return False
        if end.tzinfo is None:
            end = end.replace(tzinfo=timezone.utc)
    except Exception:
        return False
    return _now() > end


def has_feature(tenant: Optional[Dict[str, Any]], flag_key: str) -> bool:
    """Fast reader — bypasses effective_plan for a hot-path check."""
    if not tenant:
        return False
    return bool(effective_plan(tenant)["features"].get(flag_key))


def new_tenant_plan_fields() -> Dict[str, Any]:
    """Default plan fields set on a fresh tenant during registration.
    Trial for 14 days, no overrides."""
    return {
        "plan": PLAN_TRIAL,
        "trial_ends_at": (_now() + timedelta(days=TRIAL_DAYS)).isoformat(),
        "seat_limit_override": None,
        "usage_quotas": {},
        "feature_flags": {},
    }


async def enforce_seat_limit(db, tenant_id: str) -> None:
    """Raise HTTPException(402) when a tenant is at seat cap.
    Called by team.py create_user before insert.

    Uses the memberships collection (FIX-004-B) as the authoritative
    source of "active members" — status in LIVE_STATUSES.
    """
    from services.auth.membership import list_memberships_for_tenant, LIVE_STATUSES
    tenant = await db.tenants.find_one({"id": tenant_id}, {"_id": 0})
    ep = effective_plan(tenant or {})
    cap = ep["seat_limit"]
    if cap is None:
        return   # unlimited
    active = await list_memberships_for_tenant(db, tenant_id, statuses=LIVE_STATUSES)
    if len(active) >= cap:
        raise HTTPException(
            status_code=402,
            detail={
                "code": "seat_limit_reached",
                "message": (f"You've reached your plan's seat limit ({cap}). "
                             f"Upgrade to add more members, or remove an existing member first."),
                "seats_used": len(active),
                "seat_limit": cap,
                "plan": ep["key"],
            },
        )


def _seat_limit_error(cap, used, plan_key):
    return HTTPException(
        status_code=402,
        detail={
            "code": "seat_limit_reached",
            "message": (f"You've reached your plan's seat limit ({cap}). "
                         f"Upgrade to add more members, or remove an existing member first."),
            "seats_used": used, "seat_limit": cap, "plan": plan_key,
        },
    )


async def _seed_seats_used(db, tenant_id: str) -> None:
    """One-time lazy init of tenant.seats_used from the authoritative live ACTIVE
    membership count. The `$exists: False` filter makes concurrent seeders safe --
    only the first materialises the counter."""
    from services.auth.membership import list_memberships_for_tenant, LIVE_STATUSES
    live = len(await list_memberships_for_tenant(db, tenant_id, statuses=LIVE_STATUSES))
    await db.tenants.update_one(
        {"id": tenant_id, "seats_used": {"$exists": False}},
        {"$set": {"seats_used": live}})


async def reserve_seat(db, tenant_id: str) -> None:
    """Atomically reserve ONE active seat, or raise HTTPException(402) at the cap.

    BUG-12 fix: the old enforce_seat_limit COUNTED then the caller INSERTED, with
    no atomic step between -- so N parallel invites all passed the count and
    over-provisioned. Here the reservation is a single conditional `$inc` on
    tenant.seats_used ({seats_used: {$lt: cap}}), which Mongo applies atomically:
    exactly `cap - used` racing reservations succeed and the rest get 402.

    Fail-closed on drift: seats_used is maintained by the membership choke points
    (reserve on ->active, release on active->exit). If a release were ever missed,
    seats_used drifts HIGH and this over-blocks (safe); recount_seats() reconciles
    it back to the live truth. It can never drift low enough to over-provision as
    long as every ->active transition reserves.
    """
    tenant = await db.tenants.find_one({"id": tenant_id}, {"_id": 0})
    if tenant is None:
        return  # unknown tenant -> can't resolve a plan; don't gate
    ep = effective_plan(tenant)
    cap = ep["seat_limit"]
    if cap is None:
        return  # unlimited plan
    if tenant.get("seats_used") is None:
        await _seed_seats_used(db, tenant_id)
    # Atomic conditional increment: only succeeds while seats_used < cap. update_one
    # (rather than find_one_and_update) so in-memory test doubles support it too.
    res = await db.tenants.update_one(
        {"id": tenant_id, "seats_used": {"$lt": cap}},
        {"$inc": {"seats_used": 1}},
    )
    if getattr(res, "modified_count", 0) == 0:
        raise _seat_limit_error(cap, cap, ep["key"])


async def release_seat(db, tenant_id: str) -> None:
    """Atomically free one seat (floored at 0). Called when an ACTIVE membership
    leaves the active set (suspend / remove). Best-effort: a missed release only
    over-blocks and is corrected by recount_seats()."""
    await db.tenants.update_one(
        {"id": tenant_id, "seats_used": {"$gt": 0}},
        {"$inc": {"seats_used": -1}})


async def recount_seats(db, tenant_id: str) -> int:
    """Reconcile tenant.seats_used to the authoritative live ACTIVE count. Safe to
    run any time (e.g. when listing the team, or a periodic sweep) -- corrects any
    drift from a missed reserve/release."""
    from services.auth.membership import list_memberships_for_tenant, LIVE_STATUSES
    live = len(await list_memberships_for_tenant(db, tenant_id, statuses=LIVE_STATUSES))
    await db.tenants.update_one({"id": tenant_id}, {"$set": {"seats_used": live}})
    return live
