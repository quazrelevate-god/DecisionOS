"""Auth OTP + invite endpoints (Epic 8 Sprint 3 -- extracted from server.py).

Phone-OTP login (multi-tenant-aware request + verify -> session cookie) and the
public invite-link resolve/start flow. OTP infra (_issue_otp, _hash_otp,
_apm_send_and_fetch_otp, OTP_MAX_ATTEMPTS) + _norm_phone stay in server.
"""
import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response

from core import db, now_iso, create_token, set_auth_cookie, login_response
from server import _issue_otp, _hash_otp, OTP_MAX_ATTEMPTS  # OTP infra still in server (S7)
from models.auth import OtpRequestInput, OtpVerifyInput
from services.whatsapp import _norm_phone

router = APIRouter(prefix="/api")


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
        raise HTTPException(status_code=404, detail="No account is registered with this mobile number")
    if inp.tenant_id:
        # Caller already knows which workspace to log into (either
        # single-tenant match on a prior attempt, or user picked from
        # the ambiguity picker). Only issue if the hint actually maps
        # to a real membership — never trust a client-supplied id.
        picked = next((c for c in choices if c["tenant_id"] == inp.tenant_id), None)
        if not picked:
            raise HTTPException(status_code=404, detail="This number is not registered in the selected workspace")
        return await _issue_otp(norm, inp.phone, tenant_id=picked["tenant_id"])
    if len(choices) == 1:
        # Single-tenant fast path: keeps backward compat with every
        # existing OTP client that doesn't know about tenant_id yet.
        return await _issue_otp(norm, inp.phone, tenant_id=choices[0]["tenant_id"])
    # Multi-tenant collision: the caller must disambiguate. We do NOT
    # send an OTP — sending one and picking a tenant at verify would
    # leak "you're registered in workspace X" (workspace_name is a
    # low-sensitivity leak but still avoidable) and would let the
    # attacker learn the workspace list of an arbitrary phone.
    # HTTP 200 with an ambiguity payload keeps the flow simple; the
    # frontend just re-POSTs with tenant_id filled in.
    return {
        "ambiguous": True,
        "detail": "This number is registered in multiple workspaces. Choose one to continue.",
        "choices": [
            {"tenant_id": c["tenant_id"], "tenant_name": c["tenant_name"],
             "user_name": c["user_name"]}
            for c in choices
        ],
    }


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
    resp = await _issue_otp(norm, phone, tenant_id=user["tenant_id"],
                             enforce_cooldown=False)
    resp["phone"] = phone  # returned so the invitee's device can verify
    resp["name"] = user.get("name")
    return resp


@router.post("/auth/otp/verify")
async def verify_otp(inp: OtpVerifyInput, response: Response):
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
        raise HTTPException(status_code=404, detail="Account not found")
    if inp.tenant_id:
        target = next((c for c in choices if c["tenant_id"] == inp.tenant_id), None)
        if not target:
            raise HTTPException(status_code=404, detail="Account not found in the selected workspace")
    elif len(choices) == 1:
        target = choices[0]
    else:
        # Multi-tenant match with no tenant hint — same ambiguity as
        # /request, surface it the same way so the frontend can pick.
        # 409 (not 400) because the request was well-formed; the state
        # of the world is what forces disambiguation.
        raise HTTPException(
            status_code=409,
            detail={
                "code": "ambiguous_tenant",
                "message": "This number is registered in multiple workspaces. Include tenant_id in the request.",
                "choices": [
                    {"tenant_id": c["tenant_id"], "tenant_name": c["tenant_name"],
                     "user_name": c["user_name"]}
                    for c in choices
                ],
            },
        )
    tenant_id = target["tenant_id"]
    key = {"phone": norm, "tenant_id": tenant_id}
    rec = await db.otp_codes.find_one(key, {"_id": 0})
    if not rec:
        raise HTTPException(status_code=400, detail="Request an OTP first")
    if datetime.now(timezone.utc) > datetime.fromisoformat(rec["expires_at"]):
        await db.otp_codes.delete_one(key)
        raise HTTPException(status_code=400, detail="OTP expired. Request a new one")
    if rec.get("attempts", 0) >= OTP_MAX_ATTEMPTS:
        await db.otp_codes.delete_one(key)
        raise HTTPException(status_code=429, detail="Too many attempts. Request a new OTP")
    if _hash_otp((inp.code or "").strip(), norm) != rec["code_hash"]:
        await db.otp_codes.update_one(key, {"$inc": {"attempts": 1}})
        raise HTTPException(status_code=401, detail="Incorrect OTP")

    await db.otp_codes.delete_one(key)
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
                      "updated_at": now_iso()}},
        )
        user.pop("invite_token", None)
        user.pop("invite_expires_at", None)
    token = create_token(user["id"], user["tenant_id"], user["role"])
    tenant = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})
    user.pop("_id", None)
    user.pop("password_hash", None)
    set_auth_cookie(response, token)
    # FIX-006-A (S0-08): cookie is source of truth; only surface the JWT
    # in the body when AUTH_RETURN_TOKEN is on (dev/test) so prod XSS
    # can't leak it.
    return login_response(token, user=user, tenant=tenant)
