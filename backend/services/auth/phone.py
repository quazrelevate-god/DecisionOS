"""Phone-number normalization.

Extracted from `server.py` (was the private `_norm_phone`) into its own
module by FIX-002-A so:
  1. Every user-write site can call it directly instead of the underscore-
     private function inside server.py (which couldn't be imported cleanly
     from routers without a circular import).
  2. The normalization rule lives in ONE place — any future change (e.g.
     preserving country code, E.164 formatting) is one edit.

Rule: strip every non-digit character, then take the last 10 digits.
This matches the Indian mobile-number convention the app is designed
around: "+91 98200 10001", "9820010001", and "(98200) 10001" all
normalize to the same "9820010001" so a login attempt can find the user
regardless of how they typed it.

Contract:
  - Empty / None input -> "" (never raises).
  - Input shorter than 10 digits -> returns the digits as-is (callers
    upstream check len() >= 10 before treating it as valid).
  - Non-string input -> "" (safe for accidental dict/None).
"""
import re


_NON_DIGITS = re.compile(r"\D")


def norm_phone(p) -> str:
    """Normalize a phone number to its last 10 digits. Never raises.

    Same behavior as the former `_norm_phone` in server.py; kept
    identical so existing hashed OTP records (which key on this
    normalized form) still verify correctly.
    """
    if not isinstance(p, str):
        return ""
    return _NON_DIGITS.sub("", p)[-10:]


# ---------------------------------------------------------------------------
# FIX-003-A (S2-03): tenant-scoped phone identity.
#
# A phone number in an SME workspace is only unique WITHIN a tenant. The
# same phone can legitimately be registered in multiple tenants: think of
# an accountant/consultant who serves two client workspaces from one
# personal number, or a founder who runs their bakery workspace on the
# same phone they use as an employee at a friend's workshop.
#
# Every code path that maps `phone → user/tenant` MUST therefore either:
#   (a) accept an explicit tenant hint (OTP login flow: caller picks a
#       workspace when the phone matches more than one), or
#   (b) fall through to a deterministic rule that does NOT silently
#       favor one tenant over another (inbound WhatsApp routing: log a
#       cross-tenant collision and drop / fall back to WA_TENANT_ID
#       instead of orphaning the "losing" tenant's user).
#
# This helper is the single query point for (a) and (b). Callers should
# NEVER call `db.users.find_one({"phone_norm": ...})` directly for OTP
# or WhatsApp routing — that pattern is exactly the multi-tenant bug we
# just fixed.
# ---------------------------------------------------------------------------
async def find_tenant_choices_for_phone(db, norm: str) -> list:
    """List the tenants where this normalized phone is registered on a
    non-obsolete user.

    Returns one entry per distinct tenant_id, shaped for the ambiguity
    UI on `/auth/otp/request`:

        [{"tenant_id": "...", "tenant_name": "...",
          "user_id": "...", "user_name": "...", "role": "..."}, ...]

    Ordering: most recently created user first (so if only one is shown
    to the operator, it's the freshest membership — matches the login
    UX intuition of "the workspace I most recently joined").

    Notes:
      * `wa_phone_obsolete=True` users are excluded — those are the
        losers of a within-tenant same-number collision resolved by
        `resolve_wa_tenant`. They shouldn't be login candidates either.
      * Reads `db.tenants.name` in one round-trip using distinct
        tenant_ids so we can render the ambiguity picker without an
        N+1 fetch.
      * Uses the FIX-002-A `users_phone_norm_partial` index — this is
        an exact-match on an indexed field, not a collection scan.
    """
    if not isinstance(norm, str) or len(norm) < 10:
        return []
    users = await db.users.find(
        {"phone_norm": norm, "wa_phone_obsolete": {"$ne": True}},
        {"_id": 0, "id": 1, "tenant_id": 1, "name": 1,
         "role": 1, "created_at": 1},
    ).sort("created_at", -1).to_list(50)
    if not users:
        return []

    # De-duplicate by tenant_id — the same tenant can legitimately have
    # more than one row here if two employees in the SAME workspace
    # share a phone (rare but seen). Keep the newest per tenant; the
    # WhatsApp routing path resolves the intra-tenant duplicate
    # separately.
    seen = set()
    picked = []
    for u in users:
        tid = u.get("tenant_id")
        if not tid or tid in seen:
            continue
        seen.add(tid)
        picked.append(u)

    tenant_ids = [u["tenant_id"] for u in picked]
    tmap = {}
    if tenant_ids:
        async for t in db.tenants.find(
            {"id": {"$in": tenant_ids}}, {"_id": 0, "id": 1, "name": 1},
        ):
            tmap[t["id"]] = t.get("name") or ""

    return [
        {
            "tenant_id": u["tenant_id"],
            "tenant_name": tmap.get(u["tenant_id"], ""),
            "user_id": u.get("id"),
            "user_name": u.get("name"),
            "role": u.get("role"),
        }
        for u in picked
    ]
