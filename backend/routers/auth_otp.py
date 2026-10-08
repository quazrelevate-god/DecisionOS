"""Auth OTP + invite endpoints (Epic 8 Sprint 3 -- extracted from server.py).

Phone-OTP login (multi-tenant-aware request + verify -> session cookie) and the
public invite-link resolve/start flow. OTP infra (_issue_otp, _hash_otp,
_apm_send_and_fetch_otp, OTP_MAX_ATTEMPTS) + _norm_phone stay in server.
"""
import re
from services.tenant_ai_keys import TENANT_PUBLIC
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Response

from core import db, now_iso, create_token, set_auth_cookie, login_response
from services.otp import _issue_otp, consume_otp
from models.auth import OtpRequestInput, OtpVerifyInput
from services.whatsapp import _norm_phone

router = APIRouter(prefix="/api")

# 2026-09-19 — a member's number is their whole sign-in, so the first sign-in
# has to come through the invite link the manager sent. Otherwise a number
# mistyped on the Team page would open the account to whoever owns it: they'd
# ask for a code on the sign-in page and it would arrive on their phone. With
# this rule that stranger gets nothing without the link, and the real member —
# who has the link but whose code went astray — tells the manager, who fixes it.
INVITE_FIRST = ("Open the invite link you were sent to sign in the first time. "
                "After that, your mobile number is all you need.")


async def _split_by_invite(choices):
    """(live, pending): pending = invited here and not yet signed in.

    2026-09-20 — the rule itself moved to services/auth/phone.py so onboarding
    can ask the same question about a number it has just confirmed. This stays
    as the name the rest of this router already calls.
    """
    from services.auth.phone import split_live_and_pending
    return await split_live_and_pending(db, choices)


def _no_longer(gone: list) -> str:
    """JOURNEY-1 — what a person removed from a company hears at sign-in,
    instead of a code and then an empty Desk."""
    name = (gone[0].get("tenant_name") if gone else "") or "this company"
    return (f"You're no longer part of {name} on DecisionOS. "
            "If that's a mistake, ask the owner to add you again.")


async def _split_three(choices):
    from services.auth.phone import split_by_membership
    return await split_by_membership(db, choices)


# --- Audit A-03 (2026-10-08): the sign-in page says nothing about a number to
# somebody who cannot read its texts. -----------------------------------------
# It used to: "No account is registered with this mobile number" for a
# stranger's number and a code for a customer's, and for a number in two
# companies it listed both companies and the person's name before any code.
# Anyone could type numbers and learn who uses DecisionOS, where, and under
# what name. Now an unknown number gets the same answer as a known one (no code
# goes out), a number in several companies is texted ONE code, and the
# companies are shown only after that code is read back -- to the person
# holding the phone.
ANY_COMPANY = "login:any"          # the OTP scope for "which company comes after"
SENT = "If this number has an account, we've texted it a code."
_PICK_PURPOSE = "login_pick"
_PICK_TTL_S = 600


def _pick_key():
    import hashlib
    from config import JWT_SECRET
    return hashlib.sha256(f"{JWT_SECRET}|{_PICK_PURPOSE}".encode()).hexdigest()


def _issue_pick_token(norm: str) -> str:
    """'This browser read a code texted to `norm`' -- good for ten minutes, for
    choosing which of its companies to open, and for nothing else."""
    import jwt
    from datetime import timedelta
    from config import JWT_ALGORITHM
    now = datetime.now(timezone.utc)
    return jwt.encode({"sub": norm, "purpose": _PICK_PURPOSE, "iat": now,
                       "exp": now + timedelta(seconds=_PICK_TTL_S)}, _pick_key(), algorithm=JWT_ALGORITHM)


def _read_pick_token(token) -> str:
    import jwt
    from config import JWT_ALGORITHM
    if not token or not isinstance(token, str):
        return ""
    try:
        payload = jwt.decode(token, _pick_key(), algorithms=[JWT_ALGORITHM])
    except Exception:
        return ""
    sub = payload.get("sub")
    return sub if payload.get("purpose") == _PICK_PURPOSE and isinstance(sub, str) else ""


def _sent(resp: dict) -> dict:
    """One shape for every 'code sent' answer: no company id rides along, so a
    one-company number, a many-company number and an unknown one look alike."""
    out = {"sent": True, "detail": SENT}
    if resp.get("dev_otp"):          # a test backend only (DEV_OTP_IN_RESPONSE)
        out["dev_mode"] = True
        out["dev_otp"] = resp["dev_otp"]
    return out


@router.post("/auth/otp/request")
async def request_otp(inp: OtpRequestInput):
    norm = _norm_phone(inp.phone)
    if len(norm) < 10:
        raise HTTPException(status_code=400, detail="Enter a valid mobile number")
    # FIX-003-A (S2-03): multi-tenant-safe resolution. Returns one
    # entry per DISTINCT tenant that has this phone on a non-obsolete
    # user. See services/phone.find_tenant_choices_for_phone for why
    # calling db.users.find_one({"phone_norm": ...}) directly is a bug.
    from services.auth.phone import find_tenant_choices_for_phone
    choices = await find_tenant_choices_for_phone(db, norm)
    if not choices:
        # Audit A-03: the same answer as a real number. Nothing is sent.
        return {"sent": True, "detail": SENT}
    # Invited but not yet in: only the invite link opens those (see INVITE_FIRST).
    # Removed or suspended: told so, and no code is sent (JOURNEY-1).
    live, pending, gone = await _split_three(choices)
    if inp.tenant_id:
        # Caller already knows which workspace to log into (either
        # single-tenant match on a prior attempt, or user picked from
        # the ambiguity picker). Only issue if the hint actually maps
        # to a real membership — never trust a client-supplied id.
        picked = next((c for c in live if c["tenant_id"] == inp.tenant_id), None)
        if not picked:
            if any(c["tenant_id"] == inp.tenant_id for c in pending):
                raise HTTPException(status_code=403, detail=INVITE_FIRST)
            left = [c for c in gone if c["tenant_id"] == inp.tenant_id]
            if left:
                raise HTTPException(status_code=403, detail=_no_longer(left))
            raise HTTPException(status_code=404, detail="This number is not registered in the selected workspace")
        return await _issue_otp(norm, inp.phone, tenant_id=picked["tenant_id"])
    if not live:
        raise HTTPException(status_code=403, detail=INVITE_FIRST if pending or not gone else _no_longer(gone))
    choices = live
    if len(choices) == 1:
        return _sent(await _issue_otp(norm, inp.phone, tenant_id=choices[0]["tenant_id"]))
    # Several companies: ONE code, and the list comes after it is read back
    # (verify answers {"choose": [...], "pick_token"}). Listing them here,
    # before any code, handed the company names and the person's name to
    # anyone who typed the number (audit A-03).
    return _sent(await _issue_otp(norm, inp.phone, tenant_id=ANY_COMPANY))


def _mask_phone(phone: str) -> str:
    d = re.sub(r"\D", "", phone or "")
    return ("•••• " + d[-4:]) if len(d) >= 4 else "••••"


@router.get("/auth/invite/{token}")
async def invite_info(token: str):
    """Public — resolve an invite link to a friendly welcome (no OTP sent yet)."""
    user = await db.users.find_one({"invite_token": token}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="This invite link is invalid or has already been used")
    exp = user.get("invite_expires_at")
    if exp and datetime.now(timezone.utc) > datetime.fromisoformat(exp):
        raise HTTPException(status_code=410, detail="This invite link has expired — ask your admin to resend")
    tenant = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0, "name": 1})
    return {"name": user.get("name"), "phone_masked": _mask_phone(user.get("phone", "")),
            "company": (tenant or {}).get("name", "your workspace")}


@router.post("/auth/invite/{token}/start")
async def invite_start(token: str):
    """Public — send the login OTP to the invited member's phone."""
    user = await db.users.find_one({"invite_token": token}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="This invite link is invalid or has already been used")
    exp = user.get("invite_expires_at")
    if exp and datetime.now(timezone.utc) > datetime.fromisoformat(exp):
        raise HTTPException(status_code=410, detail="This invite link has expired — ask your admin to resend")
    phone = user.get("phone", "")
    norm = _norm_phone(phone)
    if len(norm) < 10:
        raise HTTPException(status_code=400, detail="No mobile number on file for this invite")
    # FIX-003-A: invite already carries the exact tenant we're joining;
    # no ambiguity to resolve, but the OTP row still needs the tenant
    # scope so /auth/otp/verify can find it.
    # 2026-09-16: an invite link gets forwarded and re-tapped (WhatsApp), and
    # anyone holding the URL can call this without signing in. It keeps the same
    # 30s cooldown as an ordinary login so a stray link can't text someone on a
    # loop — but a tap inside that window still returns everything the device
    # needs to enter the code that was already sent, rather than an error.
    try:
        resp = await _issue_otp(norm, phone, tenant_id=user["tenant_id"])
    except HTTPException as e:
        if e.status_code != 429:
            raise
        resp = {"sent": True, "dev_mode": False, "tenant_id": user["tenant_id"],
                "detail": "We've already texted you a code — check your messages."}
    # Audit D-03 (2026-10-08): the MASKED number only. This returned the full
    # number to anyone holding the link — and the link is made to be forwarded
    # on WhatsApp. Verify reads the number from the invite itself now.
    resp.pop("phone", None)
    resp["phone_masked"] = _mask_phone(phone)
    resp["name"] = user.get("name")
    return resp


@router.post("/auth/otp/verify")
async def verify_otp(inp: OtpVerifyInput, response: Response):
    # Audit D-03: an invite names its own member, so the number comes from it
    # (the invite page is never given the full number to send back).
    invite_user = None
    if inp.invite_token:
        invite_user = await db.users.find_one(
            {"invite_token": inp.invite_token, "wa_phone_obsolete": {"$ne": True}}, {"_id": 0})
        if not invite_user:
            raise HTTPException(status_code=400, detail="This invite link is invalid or has already been used")
        norm = invite_user.get("phone_norm") or _norm_phone(invite_user.get("phone", ""))
    else:
        norm = _norm_phone(inp.phone)
    if len(norm) < 10:
        raise HTTPException(status_code=400, detail="Enter a valid mobile number")
    # FIX-003-A (S2-03): resolve which tenant the OTP was issued for
    # BEFORE looking up the code — the same phone can hold live OTPs in
    # multiple tenants simultaneously and each is a distinct row keyed
    # by (phone, tenant_id).
    from services.auth.phone import find_tenant_choices_for_phone
    choices = await find_tenant_choices_for_phone(db, norm)
    if not choices:
        # Audit A-03: a number with no account hears what a wrong code hears.
        raise HTTPException(status_code=401, detail="Incorrect OTP")
    if invite_user:
        # The invite link names its own workspace and member.
        _exp = invite_user.get("invite_expires_at")
        if _exp and datetime.now(timezone.utc) > datetime.fromisoformat(_exp):
            raise HTTPException(status_code=410, detail="This invite link has expired — ask your admin to resend")
        choices = [c for c in choices if c["tenant_id"] == invite_user["tenant_id"]]
        if not choices:
            raise HTTPException(status_code=404, detail="Account not found")
    else:
        live, pending, gone = await _split_three(choices)
        if not live:
            raise HTTPException(status_code=403, detail=INVITE_FIRST if pending or not gone else _no_longer(gone))
        if inp.tenant_id and any(c["tenant_id"] == inp.tenant_id for c in gone):
            raise HTTPException(status_code=403, detail=_no_longer([c for c in gone if c["tenant_id"] == inp.tenant_id]))
        if inp.tenant_id and any(c["tenant_id"] == inp.tenant_id for c in pending):
            raise HTTPException(status_code=403, detail=INVITE_FIRST)
        choices = live
    picked_by_proof = False
    if invite_user:
        target = choices[0]
    elif inp.pick_token and inp.tenant_id:
        # The second half of a many-company sign-in: the code was read back a
        # moment ago (pick token); now open the company they chose.
        if _read_pick_token(inp.pick_token) != norm:
            raise HTTPException(status_code=401, detail="That took too long — send yourself a new code.")
        target = next((c for c in choices if c["tenant_id"] == inp.tenant_id), None)
        if not target:
            raise HTTPException(status_code=404, detail="Account not found in the selected workspace")
        picked_by_proof = True
    elif inp.tenant_id:
        target = next((c for c in choices if c["tenant_id"] == inp.tenant_id), None)
        if not target:
            raise HTTPException(status_code=404, detail="Account not found in the selected workspace")
    elif len(choices) == 1:
        target = choices[0]
    else:
        # Several companies and none named: the one code sent for them all is
        # checked, and only THEN are the companies shown (audit A-03).
        await consume_otp(norm, ANY_COMPANY, inp.code)
        return {
            "choose": [{"tenant_id": c["tenant_id"], "tenant_name": c["tenant_name"],
                        "user_name": c["user_name"]} for c in choices],
            "pick_token": _issue_pick_token(norm),
        }
    tenant_id = target["tenant_id"]
    # The code check lives in services.otp so the one other place that has to
    # prove "this really is you" — changing your own sign-in email with no
    # password to confirm it — asks in exactly the same way (2026-09-16).
    if not picked_by_proof:
        await consume_otp(norm, tenant_id, inp.code)
    # FIX-003-A: fetch the exact user in the chosen tenant. Even if
    # target["user_id"] is populated from the choices list, re-fetch
    # so we get the full user record (roles, name, avatar, etc.) and
    # avoid a stale copy from the choices projection.
    user = await db.users.find_one(
        {"tenant_id": tenant_id, "phone_norm": norm,
         "wa_phone_obsolete": {"$ne": True}},
        {"_id": 0},
    )
    if not user:
        # Should be unreachable given `choices` was just resolved, but
        # a concurrent user deletion between /request and /verify can
        # get here. Refuse rather than issue a token for a ghost.
        raise HTTPException(status_code=404, detail="Account not found")
    # FIX-006-A (S0-10): the OTP verify IS the "invite accepted" moment
    # for invited users. Once we're about to issue a session token,
    # invalidate the invite_token so:
    #   * the invite link stops resolving on /auth/invite/{token}
    #     (no more leaked name / masked phone to anyone with the URL)
    #   * a second /auth/invite/{token}/start no longer bombs the
    #     invitee's phone with SMS OTPs via a link that should be dead
    # Idempotent — no-op when the user was never invited.
    if user.get("invite_token"):
        await db.users.update_one(
            {"id": user["id"]},
            {"$set": {"invite_token": None,
                      "invite_expires_at": None,
                      "invite_consumed_at": now_iso(),
                      # 2026-09-19 — a one-time "welcome, check your details"
                      # card on their first screen (WelcomeMemberCard.js).
                      "welcome_pending": True,
                      "updated_at": now_iso()}},
        )
        user.pop("invite_token", None)
        user.pop("invite_expires_at", None)
        user["welcome_pending"] = True
    # 2026-09-19 — a code texted to this number was just read back: the number
    # is theirs. Recorded once; the signup and Settings paths record it too.
    if not user.get("phone_verified_at"):
        _pv = now_iso()
        await db.users.update_one({"id": user["id"]}, {"$set": {"phone_verified_at": _pv}})
        user["phone_verified_at"] = _pv
    # 2026-09-16: the same moment accepts the MEMBERSHIP. A pending row is not a
    # live one, so without this an invited member got a session token here and a
    # 403 on their next request.
    from services.auth.membership import accept_pending_membership as _accept
    _accepted = await _accept(db, user["id"], tenant_id)
    if _accepted:
        user["role"] = _accepted.get("role") or user.get("role")
    token = create_token(user["id"], user["tenant_id"], user["role"])
    tenant = await db.tenants.find_one({"id": user["tenant_id"]}, TENANT_PUBLIC)
    user.pop("_id", None)
    user.pop("password_hash", None)
    # 2026-09-20 — an owner signing in to their mobile-only second company is
    # not asked to invent an email and a password they already have elsewhere.
    from services.auth.phone import has_credentials_elsewhere
    user["credentials_elsewhere"] = await has_credentials_elsewhere(db, user)
    set_auth_cookie(response, token)
    # FIX-006-A (S0-08): cookie is source of truth; only surface the JWT
    # in the body when AUTH_RETURN_TOKEN is on (dev/test) so prod XSS
    # can't leak it.
    return login_response(token, user=user, tenant=tenant)
