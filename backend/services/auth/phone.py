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


# ---------------------------------------------------------------------------
# 2026-09-20 — ONE MOBILE, SEVERAL COMPANIES.
#
# A founder may run more than one company here, and the confirmed mobile is
# what says they are the same person: the email is one per company (globally
# unique, `users.email_1`), the number is not. Onboarding asks about the number
# before it asks for an email, so a returning founder is shown what they
# already run instead of building a second OS and hitting the email wall at the
# end; the workspace switcher lists the same set.
#
# Both helpers below read the choices `find_tenant_choices_for_phone` returns,
# so the onboarding chooser, the sign-in picker and the switcher cannot drift
# apart.
# ---------------------------------------------------------------------------
async def split_live_and_pending(db, choices: list):
    """(live, pending) — pending = invited to that workspace, never signed in.

    Moved here from routers/auth_otp.py (2026-09-20) so signup can apply the
    same rule without a router importing another router. An invited member's
    first way in is their invite link (auth_otp.INVITE_FIRST), so a pending
    workspace is never offered as something to sign into.
    """
    from services.auth.membership import find_membership, STATUS_PENDING
    live, pending = [], []
    for c in choices:
        m = await find_membership(db, c["user_id"], c["tenant_id"])
        (pending if (m or {}).get("status") == STATUS_PENDING else live).append(c)
    return live, pending


async def has_credentials_elsewhere(db, user: dict) -> bool:
    """True when this mobile-only owner already has an email and a password on
    another of their own companies.

    A founder's SECOND company is mobile-only by design, so the full-screen
    "add an email and a password" gate (OwnerCredentialsGate) must not ask them
    for something they have. Answered wherever a session begins — register, OTP
    sign-in, /auth/me — so the gate sees the same answer however they arrived.
    """
    if not user or user.get("role") != "owner":
        return False
    if not (user.get("passwordless") or not user.get("email")):
        return False
    norm = user.get("phone_norm") or ""
    if not norm or not user.get("phone_verified_at"):
        return False
    return bool(await db.users.find_one(
        {"phone_norm": norm, "id": {"$ne": user.get("id")},
         "password_hash": {"$exists": True, "$ne": ""}, "email": {"$gt": ""}},
        {"_id": 0, "id": 1}))


async def identity_for_phone(db, norm: str):
    """The person this confirmed number belongs to, or None.

    The newest non-obsolete row that has been confirmed by a texted code
    (`phone_verified_at`). Used when a founder creates a SECOND company: their
    name comes from here and no email or password is asked for again. A number
    nobody has confirmed is not an identity — the first company still needs an
    email and a password.
    """
    if not isinstance(norm, str) or len(norm) < 10:
        return None
    return await db.users.find_one(
        {"phone_norm": norm, "phone_verified_at": {"$ne": None},
         "wa_phone_obsolete": {"$ne": True}},
        {"_id": 0, "id": 1, "tenant_id": 1, "name": 1, "email": 1,
         "password_hash": 1, "passwordless": 1, "phone": 1, "phone_norm": 1},
        sort=[("created_at", -1)],
    )


# ---------------------------------------------------------------------------
# 2026-09-19 — what counts as a mobile number we can sign someone in with.
#
# `norm_phone` above is deliberately forgiving: it is a LOOKUP key, and it has
# to find "+91 98200 10001" and "9820010001" as the same person. It is not a
# validator, and signup had been using nothing stricter than "8 digits" — so a
# founder could save a number that OTP sign-in then refused (too short), or a
# foreign number whose last ten digits are somebody else's Indian mobile.
#
# The product is India-first and every downstream consumer agrees: norm_phone
# keeps the last 10 digits, the APM gateway texts a bare 10-digit number, and
# WhatsApp routing matches on the same key. So the rule is an Indian mobile:
# ten digits starting 6-9, optionally written with +91, 91 or a leading 0.
# frontend/src/lib/phone.js mirrors this exactly — keep the two in step.
# ---------------------------------------------------------------------------
_INDIAN_MOBILE = re.compile(r"^[6-9]\d{9}$")


def valid_indian_mobile(raw) -> str:
    """Return the 10-digit number if `raw` is an Indian mobile, else "".

    Accepts spaces, dashes, brackets and dots in any arrangement, and one of
    the prefixes people actually type: +91 / 91 (12 digits) or 0 (11 digits).
    Anything else — a landline, a short number, another country's code — is
    refused rather than guessed at.
    """
    if not isinstance(raw, str):
        return ""
    digits = _NON_DIGITS.sub("", raw)
    if len(digits) == 12 and digits.startswith("91"):
        digits = digits[2:]
    elif len(digits) == 11 and digits.startswith("0"):
        digits = digits[1:]
    return digits if _INDIAN_MOBILE.match(digits) else ""


def display_indian_mobile(norm: str) -> str:
    """"+91 98765 43210" — how the number is written back on screen."""
    return f"+91 {norm[:5]} {norm[5:]}" if len(norm) == 10 else norm
