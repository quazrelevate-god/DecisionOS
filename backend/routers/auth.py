"""Auth router — extracted from `server.py` in Phase B step 1.

Owns the 6 clean auth endpoints that only need `core` helpers and the
`ai_generate_*` helpers still in `server.py`. The OTP + invite endpoints
(also under `/auth/*`) stay in `server.py` for now — they'll ship in a
separate PR once their inline helpers (`_norm_phone`, `_issue_otp`,
`_hash_otp`) are moved into `services/otp.py`.

Server-local helpers (`ai_generate_lexicon`, `normalize_os_blueprint`,
`DEFAULT_ROLES`, `backfill_operating_model`, etc.) are DEFERRED-imported
inside each handler to avoid the circular import between `server.py` and
its own routers.
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr, Field

from core import (
    db, get_current_user, hash_password, verify_password, create_token,
    set_auth_cookie, clear_auth_cookie, set_usage_tenant, new_id, now_iso,
    login_response,
)


router = APIRouter(prefix="/api/auth")


# FIX-006-D (S0-07): tenant-login lockout — parity with admin login.
# Admin login (routers/admin.py) has always locked out at 5 failures
# per (IP, email) for 15 minutes. Tenant user login had no such gate,
# so email/password brute-force was rate-unlimited from any origin.
# Same numbers as admin so the two auth surfaces behave the same.
LOGIN_MAX_ATTEMPTS = 5
LOGIN_LOCKOUT_MIN = 15


def _login_ident(request: Request, email: str) -> str:
    """(IP, email) compound key. Same shape as platform_login_attempts
    so both auth surfaces can share observability queries later."""
    ip = "?"
    try:
        ip = request.client.host if request.client else "?"
    except Exception:
        pass
    # Trust the standard proxy header when present so a single-attacker-
    # behind-many-emails from one NAT doesn't slip past the compound key.
    xff = request.headers.get("X-Forwarded-For") or ""
    if xff:
        ip = xff.split(",")[0].strip() or ip
    return f"{ip}:{email}"


async def _login_locked_out(ident: str) -> tuple[bool, int]:
    """Return (locked, retry_after_seconds).  False, 0 when the caller
    can proceed. Reads db.user_login_attempts."""
    att = await db.user_login_attempts.find_one({"identifier": ident})
    if not att or att.get("count", 0) < LOGIN_MAX_ATTEMPTS:
        return False, 0
    last = att.get("last")
    if not last:
        return False, 0
    from datetime import datetime, timezone
    try:
        dt = datetime.fromisoformat(last)
    except ValueError:
        return False, 0
    mins = (datetime.now(timezone.utc) - dt).total_seconds() / 60
    if mins >= LOGIN_LOCKOUT_MIN:
        # Cool-down elapsed — clear the counter so this attempt starts fresh.
        await db.user_login_attempts.delete_one({"identifier": ident})
        return False, 0
    return True, int((LOGIN_LOCKOUT_MIN - mins) * 60)


async def _login_record_failure(ident: str) -> None:
    await db.user_login_attempts.update_one(
        {"identifier": ident},
        {"$inc": {"count": 1}, "$set": {"last": now_iso()}},
        upsert=True,
    )


async def _login_clear_attempts(ident: str) -> None:
    await db.user_login_attempts.delete_one({"identifier": ident})


# ---------------------------------------------------------------------------
# Request models (duplicated from server.py for now; will move to
# `models/auth.py` in a later pass — kept local to keep this router
# self-contained and importable without touching server.py).
# ---------------------------------------------------------------------------
class RoleItem(BaseModel):
    key: str
    label: str


class ProductItem(BaseModel):
    name: str
    description: Optional[str] = ""


class RegisterInput(BaseModel):
    company_name: Optional[str] = None  # can be sourced from draft
    name: Optional[str] = None
    email: EmailStr
    password: str = Field(min_length=6)
    phone: Optional[str] = None
    industry: Optional[str] = None
    description: Optional[str] = None
    company_size: Optional[str] = None
    region: Optional[str] = None
    currency: Optional[str] = "INR"
    gst: Optional[str] = None
    branches: Optional[str] = None
    business_scale: Optional[dict] = None
    current_software: Optional[List[str]] = None
    roles: Optional[List[RoleItem]] = None
    products: Optional[List[ProductItem]] = None
    os_blueprint: Optional[dict] = None
    # FIX-001-D: optional draft_id to source wizard data from server-side
    # draft (prevents "user typed 7 steps then /register 500'd and lost
    # everything"). Client-provided values still win over draft values.
    draft_id: Optional[str] = None
    # FIX-004-A (RBAC-02): Turnstile / hCaptcha proof-of-humanity token.
    # Verified server-side against the vendor's siteverify endpoint.
    # Optional in dev (see services/captcha.py); made hard-required in
    # prod via CAPTCHA_REQUIRED=1 env.
    captcha_token: Optional[str] = None


class LoginInput(BaseModel):
    email: EmailStr
    password: str
    # FIX-004-B (RBAC-12): when a user has multiple memberships, the
    # frontend re-POSTs with tenant_id filled in from the choices
    # returned in the ambiguity response. Optional — omitted for the
    # single-workspace fast path.
    tenant_id: Optional[str] = None


class SwitchWorkspaceInput(BaseModel):
    tenant_id: str


# FIX-005-D (RBAC-23): 2FA input models
class TotpConfirmInput(BaseModel):
    code: str = Field(min_length=4, max_length=10)


class TotpVerifyLoginInput(BaseModel):
    # Short-lived 2fa-challenge token returned by /login when the
    # account has 2FA enabled.
    challenge_token: str
    code: str = Field(min_length=4, max_length=10)


class TotpDisableInput(BaseModel):
    # Owner-only self-recovery: prove you own the account by
    # supplying a current TOTP or a backup code before disabling.
    code: str = Field(min_length=4, max_length=15)


# FIX-005-D (RBAC-24): ownership transfer input
class TransferOwnershipInput(BaseModel):
    new_owner_user_id: str
    # 2FA-confirmation code from the CURRENT owner if their account
    # has 2FA enabled (else ignored). Prevents session-theft from
    # trivially taking over the workspace.
    totp_code: Optional[str] = None


class ProfileUpdateInput(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    language: Optional[str] = None


class ChangePasswordInput(BaseModel):
    current_password: str
    new_password: str = Field(min_length=6)


# FIX-003-D (S2-07): email verification + password reset input models.
class PasswordForgotInput(BaseModel):
    email: EmailStr


class PasswordResetInput(BaseModel):
    token: str
    new_password: str = Field(min_length=6)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@router.post("/register")
async def register(inp: RegisterInput, request: Request, response: Response):
    # FIX-004-A (RBAC-02): rate-limit registrations per IP + verify
    # CAPTCHA before any DB work. Prevents bot-driven tenant creation
    # + AI credit burn + storage cost.
    from services.rate_limit import check_rate_limit, client_ip
    from services.captcha import verify_captcha
    ip = client_ip(request)
    ok, retry_after = await check_rate_limit(ip, 3, 3600, bucket="register")
    if not ok:
        raise HTTPException(
            status_code=429,
            detail="Too many registrations from this network. Try again later.",
            headers={"Retry-After": str(retry_after)},
        )
    cap_ok, cap_reason = await verify_captcha(inp.captcha_token, remote_ip=ip)
    if not cap_ok:
        # Never surface the raw vendor reason to the client; a friendly
        # message is enough. Detail contains a code the frontend can
        # branch on if it wants to re-render the CAPTCHA widget.
        raise HTTPException(
            status_code=400,
            detail={"code": f"captcha_{cap_reason}",
                     "message": "We couldn't verify you as human. Refresh the page and try again."},
        )

    # Deferred to break the server.py ↔ routers/auth.py cycle.
    from server import normalize_os_blueprint
    from core import DEFAULT_ROLES
    # FIX-001-D imports — status-aware AI + draft merge/complete
    from services import ai_setup as ai_setup_svc
    from services import onboarding_drafts as drafts_svc

    # FIX-001-D: if a draft_id was passed, merge saved wizard state
    # underneath the request body. Client-provided values still win.
    draft = None
    if inp.draft_id:
        draft = await drafts_svc.get_draft(db, inp.draft_id)
    if draft:
        raw = drafts_svc.merge_draft_into_register_input(draft, inp.model_dump())
        # Re-validate through the model so downstream code sees typed fields
        # without touching the request path.
        inp = RegisterInput(**{k: v for k, v in raw.items() if v is not None})

    if not inp.company_name or not inp.name:
        raise HTTPException(status_code=400, detail="Company name and your name are required")

    # FIX-003-B (S2-10): concurrent-registration race.
    # The historical pattern was `find_one -> insert_one`, which is
    # not atomic — two requests with the same email that arrive in
    # the ~10ms window between check and insert would BOTH pass the
    # pre-check, then the second one's insert would fail with the
    # `users.email` unique-index DuplicateKeyError, surface as a
    # 500 to the client, and leave an orphaned tenant row (the tenant
    # was created between the check and the crashing user insert).
    #
    # Fix:
    #   * Normalize email at the same choke point every write uses
    #     (already lower()'d).
    #   * Keep the fast path (idempotent no-op 400 on the pre-check).
    #   * Catch DuplicateKeyError on the user insert itself and roll
    #     back the tenant we just created so the loser's failed race
    #     leaves NOTHING behind.
    email = inp.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email already registered")
    tenant_id = new_id()
    set_usage_tenant(tenant_id)
    bp = normalize_os_blueprint(inp.os_blueprint) if inp.os_blueprint else None
    # Departments from the generated OS become the tenant's roles (single source of truth for RBAC).
    provided_roles = [r.model_dump() for r in (inp.roles or [])]
    if not provided_roles and bp and bp["departments"]:
        provided_roles = bp["departments"]
    roles = provided_roles or DEFAULT_ROLES
    # De-dupe and drop any 'owner' role (owner is implicit for the workspace creator).
    seen, clean_roles = set(), []
    for r in roles:
        k = r.get("key")
        if k and k != "owner" and k not in seen:
            seen.add(k)
            clean_roles.append({"key": k, "label": r.get("label") or k.replace("_", " ").title()})

    # FIX-001-D: use status-aware AI wrappers so a silent LLM failure /
    # default-fallback is RECORDED on the tenant doc as `ai_setup_status`.
    # Frontend can then show "AI setup incomplete — click to regenerate."
    # The `/api/tenant/ai-setup/retry` endpoint uses the same wrappers.
    lexicon, lex_status = await ai_setup_svc.ai_generate_lexicon_with_status(
        inp.industry, inp.company_size, clean_roles, inp.description or "")
    om, om_status = await ai_setup_svc.ai_generate_operating_model_with_status(
        inp.industry, inp.company_size, clean_roles, inp.description or "")
    fc, fc_status = await ai_setup_svc.ai_generate_finance_categories_with_status(
        inp.industry, inp.company_size, clean_roles, inp.description or "")
    ai_setup_status = {
        "lexicon": lex_status,
        "operating_model": om_status,
        "finance_categories": fc_status,
    }

    # FIX-005-A (S3-02): initialize plan fields on fresh registration.
    # Trial for 14 days, no overrides. Grandfathered tenants get their
    # plan set by the backfill migration in server.py._bootstrap.
    from services.plans import new_tenant_plan_fields
    _plan_fields = new_tenant_plan_fields()
    tenant_doc = {
        "id": tenant_id, "name": inp.company_name,
        "industry": inp.industry or "General",
        "description": (inp.description or "").strip(),
        "company_size": inp.company_size or "",
        "region": inp.region or "",
        "currency": (inp.currency or "INR").upper(),
        "gst": inp.gst or "",
        "branches": inp.branches or "",
        "business_scale": inp.business_scale or {},
        "current_software": inp.current_software or [],
        "invited_employees": [],
        "roles": clean_roles or DEFAULT_ROLES,
        "products": [p.model_dump() for p in (inp.products or [])],
        "workflow_templates": bp["workflows"] if bp else [],
        "operational_task_templates": bp["operational_tasks"] if bp else [],
        "approval_rules": bp["approval_rules"] if bp else [],
        "lexicon": lexicon,
        "operating_model": om,
        "finance_categories": fc,
        "ai_setup_status": ai_setup_status,  # FIX-001-D
        "created_at": now_iso(),
        # FIX-005-A (S3-02): plan defaults (plan / trial_ends_at /
        # seat_limit_override / usage_quotas / feature_flags).
        **_plan_fields,
    }
    await db.tenants.insert_one(tenant_doc)
    user_id = new_id()
    # FIX-002-A: also write phone_norm so OTP login + WhatsApp routing
    # can query by exact-match on the indexed field.
    from services.phone import norm_phone
    _raw_phone = (inp.phone or "").strip()
    # FIX-003-B (S2-10): DuplicateKeyError-safe insert. If a concurrent
    # request slipped past the pre-check, this insert loses the race
    # at the unique-index level. Roll back the orphan tenant so the
    # DB stays clean, then return the same friendly 400.
    # FIX-004-B (RBAC-13): user doc keeps tenant_id/role for compat
    # with pre-membership call sites during the transition window.
    # The AUTHORITATIVE role source is the owner membership created
    # right after. Once every downstream reader has been migrated to
    # read from memberships, tenant_id/role can be dropped from the
    # user doc entirely.
    try:
        await db.users.insert_one({
            "id": user_id, "tenant_id": tenant_id, "name": inp.name, "email": email,
            "phone": _raw_phone, "phone_norm": norm_phone(_raw_phone),
            "password_hash": hash_password(inp.password), "role": "owner", "created_at": now_iso(),
        })
    except Exception as _register_err:
        # pymongo.errors.DuplicateKeyError only fires when the unique
        # index on users.email rejects the insert. Anything else is a
        # genuine problem — re-raise so it surfaces in logs. We import
        # lazily to avoid coupling this router to pymongo at module load.
        try:
            from pymongo.errors import DuplicateKeyError
            is_dupe = isinstance(_register_err, DuplicateKeyError)
        except Exception:
            # Motor forwards DuplicateKeyError under the same name; if
            # the import unexpectedly fails, fall back to message match.
            is_dupe = "duplicate key" in str(_register_err).lower()
        if is_dupe:
            # Roll back the tenant we created before the failed user
            # insert — leaving it would silently accumulate ghost
            # tenants with no owner.
            try:
                await db.tenants.delete_one({"id": tenant_id})
            except Exception:
                # Log but don't mask the 400; a stray tenant is
                # recoverable in admin, an unhandled 500 to the user
                # is not.
                pass
            raise HTTPException(status_code=400, detail="Email already registered")
        raise

    # FIX-004-B (RBAC-13): create the owner membership so the
    # authoritative role/permissions live in the memberships table.
    # Failure to create is a hard error — a workspace without an
    # owner-membership is un-loginable via the new flow.
    from services.auth.membership import create_membership as _create_membership
    from core import PERMISSION_KEYS as _PERMISSION_KEYS
    try:
        await _create_membership(
            db, user_id=user_id, tenant_id=tenant_id, role="owner",
            permissions=list(_PERMISSION_KEYS),
        )
    except Exception as _membership_err:
        # If membership creation fails, roll back tenant + user so we
        # don't leave a half-provisioned workspace behind.
        try:
            await db.users.delete_one({"id": user_id})
            await db.tenants.delete_one({"id": tenant_id})
        except Exception:
            pass
        raise HTTPException(
            status_code=500,
            detail="Registration failed — please try again.",
        ) from _membership_err

    # FIX-001-D: consume the draft (if any) so it can't be reused.
    if draft:
        try:
            await drafts_svc.mark_completed(db, draft["id"], tenant_id)
        except Exception:
            pass  # best-effort; tenant is real regardless

    # FIX-003-D (S2-07): send verification email on register.
    # Best-effort — if SMTP is down or misconfigured, registration
    # still succeeds. The user can re-request from Settings later
    # (POST /auth/email/send-verification).
    try:
        from services import auth_emails
        from server import send_email
        _row = await auth_emails.issue(
            db, kind=auth_emails.KIND_EMAIL_VERIFY,
            user_id=user_id, tenant_id=tenant_id, email=email,
        )
        # Prefer explicit APP_BASE_URL then fall back through common vars.
        import os as _os
        _base = (_os.environ.get("APP_BASE_URL")
                 or _os.environ.get("REACT_APP_BACKEND_URL")
                 or _os.environ.get("FRONTEND_ORIGIN")
                 or "http://localhost:3000").rstrip("/")
        _verify_url = f"{_base}/verify-email?token={_row['token']}"
        _html = auth_emails.render_verify_email(inp.name or "", _verify_url)
        await send_email(email, "Verify your DecisionOS email", _html)
    except Exception:
        # Never fail registration on an email hiccup — the user is
        # already logged in with a valid JWT below.
        pass

    token = create_token(user_id, tenant_id, "owner")
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    tenant = await db.tenants.find_one({"id": tenant_id}, {"_id": 0})
    set_auth_cookie(response, token)
    # FIX-004-G (RBAC-21): record the new session on registration.
    import jwt as _jwt
    from core import JWT_SECRET as _JS, JWT_ALGORITHM as _JA
    from services.auth.session_tracking import record_session as _rec_sess
    try:
        _payload = _jwt.decode(token, _JS, algorithms=[_JA])
        _reg_ctx = __import__("services", fromlist=["audit_log"]).audit_log.context_from(request, user)
        await _rec_sess(
            db, jti=_payload.get("jti"),
            user_id=user_id, tenant_id=tenant_id,
            exp=_payload.get("exp"),
            ua=_reg_ctx.get("actor_ua"), ip=_reg_ctx.get("actor_ip"),
        )
    except Exception:
        pass
    # FIX-004-F (RBAC-20): audit tenant + user creation. Two events
    # so a reader querying by action can find each independently.
    from services import audit_log as _audit
    _ctx = _audit.context_from(request, {**user, "tenant_id": tenant_id})
    await _audit.record(
        db, action="tenant_created",
        entity_type="tenant", entity_id=tenant_id,
        meta={"industry": tenant_doc.get("industry"),
               "company_size": tenant_doc.get("company_size")},
        **_ctx,
    )
    await _audit.record(
        db, action="user_created",
        entity_type="user", entity_id=user_id,
        after={"email": email, "role": "owner"},
        **_ctx,
    )
    os_summary = {
        "departments": len(clean_roles),
        "workflows": len(tenant_doc["workflow_templates"]),
        "operational_tasks": len(tenant_doc["operational_task_templates"]),
        "approval_rules": len(tenant_doc["approval_rules"]),
    }
    # FIX-006-A (S0-08): cookie is source of truth; body carries user/tenant.
    # Raw JWT surfaces in the body only when AUTH_RETURN_TOKEN is on.
    return login_response(
        token,
        user=user, tenant=tenant, os_summary=os_summary,
        # FIX-001-D: surface AI setup status so the frontend can prompt
        # regeneration when needed instead of silently using defaults.
        ai_setup_status=ai_setup_svc.summarize_ai_setup_status(ai_setup_status),
    )


@router.post("/login")
async def login(inp: LoginInput, request: Request, response: Response):
    from services import audit_log as _audit
    email = inp.email.lower()
    # FIX-006-D (S0-07): brute-force lockout — parity with admin login.
    # Check BEFORE the DB lookup so an attacker can't measure timing
    # differences to enumerate valid emails, and so a hammered lock
    # short-circuits the more expensive path.
    ident = _login_ident(request, email)
    locked, retry_after = await _login_locked_out(ident)
    if locked:
        _ctx = _audit.context_from(request, None)
        _ctx["actor_email"] = email
        await _audit.record(
            db, action="login_locked_out",
            meta={"reason": "too_many_attempts", "retry_after_s": retry_after},
            **_ctx,
        )
        raise HTTPException(
            status_code=429,
            detail=f"Too many failed attempts. Try again in {retry_after // 60 + 1} min.",
            headers={"Retry-After": str(retry_after)},
        )
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(inp.password, user["password_hash"]):
        # FIX-006-D (S0-07): increment the counter, then audit.
        await _login_record_failure(ident)
        # FIX-004-F (RBAC-20): audit-log login failure so brute-force
        # + credential-stuffing attempts show up in ops review even
        # when they never succeed. Tenant unknown for failures against
        # non-existent emails; capture the email attempted regardless.
        _ctx = _audit.context_from(request, user)
        _ctx["actor_email"] = email  # attempted email even if user missing
        _ctx["tenant_id"] = (user or {}).get("tenant_id") if user else None
        await _audit.record(
            db, action="login_failure",
            meta={"reason": "invalid_credentials"},
            **_ctx,
        )
        raise HTTPException(status_code=401, detail="Invalid email or password")
    # FIX-006-D (S0-07): password verified — wipe the counter so a slow
    # attacker who eventually got the password can't share the lockout
    # cooldown with the legitimate user's next attempt.
    await _login_clear_attempts(ident)
    # FIX-004-B (RBAC-12): resolve the target workspace via memberships.
    # A person may hold memberships in multiple tenants — the caller
    # must pick which one to log into. Single-membership users hit the
    # fast path unchanged.
    from services.auth.membership import (
        resolve_login_choices as _choices,
        find_membership as _find_m,
        LIVE_STATUSES as _LIVE,
    )
    choices = await _choices(db, user["id"])
    # Fallback: pre-migration users may not have a memberships row yet
    # (backfill runs at bootstrap but a race is possible). Fall through
    # to the legacy user.tenant_id/role so nobody is locked out.
    if not choices:
        if user.get("tenant_id") and user.get("role"):
            tenant_id = user["tenant_id"]
            role = user["role"]
        else:
            raise HTTPException(
                status_code=403,
                detail="Your account isn't linked to any workspace. Contact your administrator.",
            )
    elif inp.tenant_id:
        picked = next((c for c in choices if c["tenant_id"] == inp.tenant_id), None)
        if not picked:
            raise HTTPException(
                status_code=404,
                detail="You don't have access to the selected workspace.",
            )
        tenant_id = picked["tenant_id"]
        role = picked["role"]
    elif len(choices) == 1:
        tenant_id = choices[0]["tenant_id"]
        role = choices[0]["role"]
    else:
        # Multiple memberships, no hint — surface the picker. HTTP 200
        # because the request was well-formed; the caller just needs to
        # re-POST with tenant_id chosen.
        return {
            "ambiguous": True,
            "detail": "This email belongs to multiple workspaces. Choose one to continue.",
            "choices": choices,
        }
    # FIX-005-D (RBAC-23): 2FA gate. If the user has confirmed 2FA
    # enrollment, we DON'T issue the session token yet — we issue a
    # short-lived (5min) challenge token and expect the client to
    # call /auth/2fa/verify-login with it + a TOTP or backup code.
    from services.auth.totp import is_enabled as _totp_enabled
    if _totp_enabled(user):
        # Audit the halfway-login so ops can see 2FA-protected logins
        # as a distinct signal from vanilla successful logins.
        _ctx_pre = _audit.context_from(request, {**user, "tenant_id": tenant_id})
        await _audit.record(
            db, action="two_factor_challenge_issued",
            entity_type="user", entity_id=user["id"],
            meta={"tenant_id": tenant_id, "role": role},
            **_ctx_pre,
        )
        challenge = _mint_challenge(user["id"], tenant_id, role)
        return {
            "two_factor_required": True,
            "challenge_token": challenge,
            "detail": "Enter your 2FA code to complete sign in.",
        }
    token = create_token(user["id"], tenant_id, role)
    tenant = await db.tenants.find_one({"id": tenant_id}, {"_id": 0})
    user.pop("_id", None)
    user.pop("password_hash", None)
    # Project the membership onto the returned user dict so the
    # /login response shape matches get_current_user's output.
    membership = await _find_m(db, user["id"], tenant_id, statuses=_LIVE)
    if membership:
        user["tenant_id"] = tenant_id
        user["role"] = role
        user["permissions"] = list(membership.get("permissions") or [])
        user["membership_id"] = membership.get("id")
    set_auth_cookie(response, token)
    # FIX-004-F (RBAC-20): audit-log successful login. Captures the
    # tenant chosen (for multi-membership users), the IP + UA, and
    # the actor. Pairs with login_failure so ops can see the full
    # auth pattern for a user.
    _ctx = _audit.context_from(request, {**user, "tenant_id": tenant_id})
    await _audit.record(
        db, action="login_success",
        entity_type="user", entity_id=user["id"],
        meta={"tenant_id": tenant_id, "role": role},
        **_ctx,
    )
    # FIX-004-G (RBAC-21): record the new session so /me/sessions can
    # list it. Decode the jti out of the freshly-issued token so we
    # track the exact one that will authenticate future requests.
    import jwt as _jwt
    from core import JWT_SECRET, JWT_ALGORITHM
    from services.auth.session_tracking import record_session as _rec_sess
    try:
        _payload = _jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        await _rec_sess(
            db, jti=_payload.get("jti"),
            user_id=user["id"], tenant_id=tenant_id,
            exp=_payload.get("exp"),
            ua=_ctx.get("actor_ua"), ip=_ctx.get("actor_ip"),
        )
    except Exception:
        pass  # best-effort — the JWT is still valid; session-mgmt is bonus
    # FIX-006-A (S0-08): cookie-only in prod (see login_response).
    return login_response(token, user=user, tenant=tenant)


@router.get("/me/workspaces")
async def list_my_workspaces(user: dict = Depends(get_current_user)):
    """FIX-004-B (RBAC-13): every workspace the current user is a
    member of. Powers the workspace-switcher UI.

    Marks the currently-active workspace with `is_current: true` so
    the UI can render it distinctly."""
    from services.auth.membership import resolve_login_choices
    choices = await resolve_login_choices(db, user["id"])
    current_tid = user.get("tenant_id")
    for c in choices:
        c["is_current"] = (c["tenant_id"] == current_tid)
    return {"workspaces": choices}


@router.post("/me/switch-workspace")
async def switch_workspace(inp: SwitchWorkspaceInput, request: Request,
                            response: Response,
                            user: dict = Depends(get_current_user)):
    """FIX-004-B (RBAC-13): re-issue the auth cookie/JWT with a
    different tenant_id claim. Refuses if the caller has no live
    membership in the target tenant."""
    from services.auth.membership import find_membership, LIVE_STATUSES
    target = await find_membership(
        db, user["id"], inp.tenant_id, statuses=LIVE_STATUSES,
    )
    if not target:
        raise HTTPException(
            status_code=403,
            detail="You don't have access to this workspace.",
        )
    token = create_token(user["id"], inp.tenant_id, target.get("role") or "sales")
    tenant = await db.tenants.find_one({"id": inp.tenant_id}, {"_id": 0})
    set_auth_cookie(response, token)
    # FIX-004-G (RBAC-21): the switch mints a NEW jti — record it.
    # The old jti stays valid (a user with 2 tabs open in 2
    # workspaces is a legitimate scenario).
    import jwt as _jwt
    from core import JWT_SECRET as _JS, JWT_ALGORITHM as _JA
    from services.auth.session_tracking import record_session as _rec_sess
    try:
        _payload = _jwt.decode(token, _JS, algorithms=[_JA])
        await _rec_sess(
            db, jti=_payload.get("jti"),
            user_id=user["id"], tenant_id=inp.tenant_id,
            exp=_payload.get("exp"),
            ua=request.headers.get("User-Agent") if hasattr(request, "headers") else None,
            ip=(request.headers.get("X-Forwarded-For") or "").split(",")[0].strip()
                or (getattr(request.client, "host", None) if request.client else None),
        )
    except Exception:
        pass
    # FIX-006-A (S0-08): cookie-only in prod.
    return login_response(
        token,
        tenant=tenant,
        role=target.get("role"),
        permissions=list(target.get("permissions") or []),
    )


# ---------------------------------------------------------------------------
# FIX-004-G (RBAC-21): session-management UI endpoints
# ---------------------------------------------------------------------------
@router.get("/me/sessions")
async def list_my_sessions(request: Request,
                             user: dict = Depends(get_current_user)):
    """Every non-revoked, non-expired session for the current user.

    Marks the current session with `is_current: true` so the UI can
    render it distinctly (grey out the revoke button, etc.).
    """
    from services.auth.session_tracking import list_sessions
    # Decode our own token to figure out which session is "current".
    import jwt as _jwt
    from core import JWT_SECRET, JWT_ALGORITHM, AUTH_COOKIE_NAME
    current_jti = None
    token = request.cookies.get(AUTH_COOKIE_NAME) or ""
    if not token:
        auth_hdr = request.headers.get("Authorization") or ""
        if auth_hdr.lower().startswith("bearer "):
            token = auth_hdr[7:].strip() or ""
    if token:
        try:
            _p = _jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM],
                              options={"verify_exp": False})
            current_jti = _p.get("jti")
        except Exception:
            pass
    sessions = await list_sessions(db, user["id"])
    for s in sessions:
        s["is_current"] = (s.get("jti") == current_jti)
    return {"sessions": sessions, "count": len(sessions)}


@router.delete("/me/sessions/{jti}")
async def revoke_my_session(jti: str,
                              user: dict = Depends(get_current_user)):
    """Revoke a specific session by jti. Ownership-guarded: refuses
    if the jti belongs to another user (prevents a caller from
    revoking someone else's session by guessing the jti)."""
    from services.auth.session_tracking import revoke_one_session
    ok = await revoke_one_session(db, jti=jti, user_id=user["id"])
    if not ok:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"ok": True, "revoked": True}


@router.delete("/me/sessions")
async def revoke_my_other_sessions(request: Request,
                                     user: dict = Depends(get_current_user)):
    """Revoke ALL of the user's sessions EXCEPT the current one.
    Useful when the user says "log me out everywhere else" from a
    trusted device."""
    from services.auth.session_tracking import revoke_all_sessions_for_user
    # Determine current jti so we preserve it.
    import jwt as _jwt
    from core import JWT_SECRET, JWT_ALGORITHM, AUTH_COOKIE_NAME
    current_jti = None
    token = request.cookies.get(AUTH_COOKIE_NAME) or ""
    if not token:
        auth_hdr = request.headers.get("Authorization") or ""
        if auth_hdr.lower().startswith("bearer "):
            token = auth_hdr[7:].strip() or ""
    if token:
        try:
            _p = _jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM],
                              options={"verify_exp": False})
            current_jti = _p.get("jti")
        except Exception:
            pass
    n = await revoke_all_sessions_for_user(
        db, user_id=user["id"], keep_jti=current_jti,
    )
    return {"ok": True, "revoked_count": n}


@router.post("/logout")
async def logout(request: Request, response: Response):
    # FIX-003-C (S2-06): revoke the current session's jti BEFORE
    # clearing the cookie. Prior behavior only cleared the cookie —
    # an attacker who copied the token before logout kept full access
    # for up to 7 days (the JWT exp). Now we insert the jti into
    # db.revoked_tokens and get_current_user rejects any subsequent
    # request that presents it.
    #
    # No Depends(get_current_user) here — we want /logout to succeed
    # even if the token is malformed or already-revoked. Best-effort
    # decode: if we can pull a jti, revoke it. If not (legacy pre-jti
    # token or corrupted JWT), the cookie clear alone is the visible
    # signal — same behavior as before the fix.
    import jwt
    from core import JWT_SECRET, JWT_ALGORITHM, AUTH_COOKIE_NAME
    from services.session_revocation import revoke as _revoke
    token = request.cookies.get(AUTH_COOKIE_NAME)
    if not token:
        # No cookie -> maybe Bearer. Read from Authorization header
        # directly (we don't have HTTPBearer dep here — that would
        # 401 on missing creds).
        auth_hdr = request.headers.get("Authorization") or ""
        if auth_hdr.lower().startswith("bearer "):
            token = auth_hdr[7:].strip() or None
    logout_actor_id = None
    logout_tenant_id = None
    if token:
        try:
            # Accept even expired tokens for the revocation step —
            # revoking an expired jti is a harmless no-op (TTL will
            # remove it fast) but a benign no-op logout is better UX
            # than a 401 on a stale tab.
            payload = jwt.decode(
                token, JWT_SECRET, algorithms=[JWT_ALGORITHM],
                options={"verify_exp": False},
            )
            jti = payload.get("jti")
            exp = payload.get("exp")
            logout_actor_id = payload.get("sub")
            logout_tenant_id = payload.get("tenant_id")
            if jti:
                await _revoke(db, jti, exp=exp, reason="logout")
        except Exception:
            # Corrupted / unreadable token: nothing to revoke.
            # Cookie clear below is still the visible logout signal.
            pass
    clear_auth_cookie(response)
    # FIX-004-F (RBAC-20): audit the logout even if the token was
    # already invalid — captures the "user actively signed out" event
    # for the compliance timeline. actor_id/tenant_id come from the
    # decoded token when possible.
    from services import audit_log as _audit
    _ctx = _audit.context_from(request, None)
    _ctx["actor_id"] = logout_actor_id
    _ctx["tenant_id"] = logout_tenant_id
    await _audit.record(db, action="logout", **_ctx)
    return {"ok": True}


@router.get("/me")
async def me(user: dict = Depends(get_current_user)):
    # Deferred so this router doesn't import server.py at module load.
    from server import (
        ai_generate_lexicon, ai_generate_finance_categories, backfill_operating_model,
    )

    tenant = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})
    if tenant and not tenant.get("lexicon"):
        # Backfill industry vocabulary once for pre-existing workspaces.
        lex = await ai_generate_lexicon(tenant.get("industry"), tenant.get("company_size"), tenant.get("roles"), tenant.get("description") or "")
        await db.tenants.update_one({"id": tenant["id"]}, {"$set": {"lexicon": lex}})
        tenant["lexicon"] = lex
    if tenant and not (tenant.get("operating_model") or {}).get("pipelines"):
        # Backfill the industry operating model (pipelines + task categories) once,
        # preserving any pipeline/category that already has data (non-destructive).
        om = await backfill_operating_model(tenant)
        await db.tenants.update_one({"id": tenant["id"]}, {"$set": {"operating_model": om}})
        tenant["operating_model"] = om
    if tenant and not (tenant.get("finance_categories") or {}).get("expense"):
        # Backfill AI-generated, per-company finance categories once for existing workspaces.
        fc = await ai_generate_finance_categories(tenant.get("industry"), tenant.get("company_size"), tenant.get("roles"), tenant.get("description") or "")
        await db.tenants.update_one({"id": tenant["id"]}, {"$set": {"finance_categories": fc}})
        tenant["finance_categories"] = fc
    return {"user": user, "tenant": tenant}


@router.patch("/profile")
async def update_profile(inp: ProfileUpdateInput, user: dict = Depends(get_current_user)):
    updates = {}
    if inp.name is not None and inp.name.strip():
        updates["name"] = inp.name.strip()
    if inp.phone is not None:
        # Changing your number should re-enable WhatsApp matching for it.
        from services.phone import norm_phone  # FIX-002-A
        _new_phone = inp.phone.strip()
        updates["phone"] = _new_phone
        updates["phone_norm"] = norm_phone(_new_phone)  # keep index-searchable form in sync
        updates["wa_phone_obsolete"] = False
    if inp.language is not None and inp.language in ("en", "hi", "ta"):
        updates["language"] = inp.language
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")
    updates["updated_at"] = now_iso()
    await db.users.update_one({"id": user["id"]}, {"$set": updates})
    fresh = await db.users.find_one({"id": user["id"]}, {"_id": 0, "password_hash": 0, "password": 0})
    tenant = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})
    return {"user": fresh, "tenant": tenant}


@router.post("/change-password")
async def change_password(inp: ChangePasswordInput, user: dict = Depends(get_current_user)):
    if user.get("passwordless"):
        raise HTTPException(status_code=400, detail="Your account signs in with mobile OTP and has no password to change.")
    full = await db.users.find_one({"id": user["id"]})
    if not full or not verify_password(inp.current_password, full.get("password_hash", "")):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    if inp.new_password == inp.current_password:
        raise HTTPException(status_code=400, detail="New password must be different from your current password")
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"password_hash": hash_password(inp.new_password), "updated_at": now_iso()}},
    )
    return {"ok": True}


# ---------------------------------------------------------------------------
# FIX-003-D (S2-07): email verification + password reset.
# ---------------------------------------------------------------------------
def _app_base_url() -> str:
    """Where the verification / reset links point. Falls back to
    the frontend origin env var. Trailing slashes stripped."""
    import os as _os
    url = (_os.environ.get("APP_BASE_URL")
           or _os.environ.get("REACT_APP_BACKEND_URL")
           or _os.environ.get("FRONTEND_ORIGIN")
           or "http://localhost:3000").rstrip("/")
    return url


@router.post("/email/send-verification")
async def send_verification_email(user: dict = Depends(get_current_user)):
    """Issue (or reuse) an email-verification token and email it to
    the current user. Idempotent — hitting this twice in the cooldown
    window returns the same token and does NOT re-send."""
    from services import auth_emails
    from server import send_email  # deferred: server.py owns the SMTP helper
    email = (user.get("email") or "").strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail="No email on file for this account")
    if user.get("email_verified_at"):
        return {"ok": True, "already_verified": True, "sent": False}
    row = await auth_emails.issue(
        db, kind=auth_emails.KIND_EMAIL_VERIFY,
        user_id=user["id"], tenant_id=user["tenant_id"], email=email,
    )
    verify_url = f"{_app_base_url()}/verify-email?token={row['token']}"
    html = auth_emails.render_verify_email(user.get("name") or "", verify_url)
    delivery = await send_email(email, "Verify your DecisionOS email", html)
    # Response does NOT leak the token (it's in the email link only).
    return {"ok": True, "sent": bool(delivery.get("sent")),
            "provider": delivery.get("provider") or "mock"}


@router.get("/email/verify/{token}")
async def verify_email(token: str):
    """Consume an email-verification token and mark the user's email
    verified. Single-use, TTL-bounded (3 days)."""
    from services import auth_emails
    row = await auth_emails.consume(
        db, token=token, kind=auth_emails.KIND_EMAIL_VERIFY,
    )
    if not row:
        raise HTTPException(status_code=400, detail="This verification link is invalid or has expired")
    await db.users.update_one(
        {"id": row["user_id"], "tenant_id": row["tenant_id"]},
        {"$set": {"email_verified_at": now_iso(), "updated_at": now_iso()}},
    )
    return {"ok": True, "verified": True, "email": row["email"]}


@router.post("/password/forgot")
async def password_forgot(inp: PasswordForgotInput):
    """Send a password-reset email if the address exists. Response
    shape is identical whether the address is registered or not —
    prevents email enumeration ("does this email have an account?")
    via response-diff or timing.

    Callers should always show the same "if that email exists, we
    sent a reset link" message.
    """
    from services import auth_emails
    from server import send_email
    email = inp.email.lower().strip()
    # Same response shape regardless of what we find below.
    canonical_response = {"ok": True,
                           "detail": "If an account exists for that email, a reset link has been sent."}
    if not email:
        return canonical_response
    user = await db.users.find_one({"email": email}, {"_id": 0, "id": 1,
                                                       "tenant_id": 1, "name": 1,
                                                       "passwordless": 1})
    if not user or user.get("passwordless"):
        # Password reset only makes sense for password-having accounts.
        # OTP-only members can't have their password reset because they
        # have none. Return canonical response anyway (no enumeration).
        return canonical_response
    row = await auth_emails.issue(
        db, kind=auth_emails.KIND_PASSWORD_RESET,
        user_id=user["id"], tenant_id=user["tenant_id"], email=email,
    )
    reset_url = f"{_app_base_url()}/reset-password?token={row['token']}"
    html = auth_emails.render_reset_email(user.get("name") or "", reset_url)
    # Best-effort email; if SMTP is down the user can retry.
    await send_email(email, "Reset your DecisionOS password", html)
    return canonical_response


@router.post("/password/reset")
async def password_reset(inp: PasswordResetInput):
    """Consume a password-reset token and set a new password.

    Also revokes every other outstanding reset link for this email
    (single-outstanding-link invariant) so a stale email in a
    compromised inbox becomes useless after the first successful
    reset.
    """
    from services import auth_emails
    row = await auth_emails.consume(
        db, token=inp.token, kind=auth_emails.KIND_PASSWORD_RESET,
    )
    if not row:
        raise HTTPException(status_code=400, detail="This reset link is invalid or has expired")
    email = (row.get("email") or "").strip().lower()
    user = await db.users.find_one({"id": row["user_id"], "tenant_id": row["tenant_id"]})
    if not user:
        # User was deleted between /forgot and /reset. Same "invalid"
        # error rather than a distinctive 404 (no enumeration).
        raise HTTPException(status_code=400, detail="This reset link is invalid or has expired")
    if user.get("passwordless"):
        raise HTTPException(status_code=400,
                             detail="This account signs in with mobile OTP; no password to reset.")
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"password_hash": hash_password(inp.new_password),
                  "updated_at": now_iso()}},
    )
    # Kill any other still-outstanding reset tokens for this email.
    await auth_emails.invalidate_active_tokens(
        db, kind=auth_emails.KIND_PASSWORD_RESET, email=email,
    )
    return {"ok": True}


# ---------------------------------------------------------------------------
# FIX-005-D (RBAC-23): TOTP two-factor auth
# ---------------------------------------------------------------------------
# JWT type "2fa_challenge" — short-lived (5min) token issued by /login
# when the user has 2FA enabled. Cannot be used for anything except
# calling /auth/2fa/verify-login. The full session JWT is only issued
# after the challenge is answered with a valid TOTP or backup code.
_TWO_FA_CHALLENGE_TTL_SECONDS = 300


def _mint_challenge(user_id: str, tenant_id: str, role: str) -> str:
    """Encode a short-lived 2fa-challenge token so we can round-trip
    the user's chosen tenant_id + role after the second factor
    succeeds without re-resolving them."""
    import jwt as _jwt
    from datetime import datetime as _dt, timezone as _tz, timedelta as _td
    from core import JWT_SECRET, JWT_ALGORITHM
    payload = {
        "sub": user_id,
        "tenant_id": tenant_id,
        "role": role,
        "type": "2fa_challenge",
        "jti": new_id(),
        "exp": _dt.now(_tz.utc) + _td(seconds=_TWO_FA_CHALLENGE_TTL_SECONDS),
    }
    return _jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def _decode_challenge(token: str) -> dict:
    """Reverse of _mint_challenge. Raises HTTPException(401) on any
    problem (expired, tampered, wrong type)."""
    import jwt as _jwt
    from core import JWT_SECRET, JWT_ALGORITHM
    try:
        payload = _jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except _jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="2FA challenge expired — please log in again")
    except _jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid 2FA challenge")
    if payload.get("type") != "2fa_challenge":
        raise HTTPException(status_code=401, detail="Invalid 2FA challenge")
    return payload


@router.post("/2fa/enroll")
async def begin_2fa_enrollment(user: dict = Depends(get_current_user)):
    """Start 2FA enrollment. Generates a fresh base32 secret and
    persists it as `pending_secret` on the user doc. Returns the
    provisioning URI so the client can render a QR code + the raw
    secret for manual entry when a QR reader isn't available.

    User must call /2fa/confirm with a valid TOTP from the same
    secret to actually enable 2FA. Re-running enroll overwrites the
    previous pending secret (user restarted the flow)."""
    from services.auth.totp import begin_enrollment, persist_pending_secret
    payload = begin_enrollment(user, issuer_name="DecisionOS")
    await persist_pending_secret(db, user["id"], payload["secret"])
    return {
        "secret": payload["secret"],
        "provisioning_uri": payload["provisioning_uri"],
        "note": ("Scan the QR (or type the secret) into your authenticator app, "
                  "then POST /auth/2fa/confirm with a 6-digit code to enable 2FA."),
    }


@router.post("/2fa/confirm")
async def confirm_2fa_enrollment(inp: TotpConfirmInput, request: Request,
                                    user: dict = Depends(get_current_user)):
    """Complete 2FA enrollment by proving the user actually scanned
    the QR. On success we generate 10 backup codes and return the
    plaintext ONCE — after this response the user cannot retrieve
    them again (only regenerate)."""
    from services.auth.totp import confirm_enrollment
    from services import audit_log as _audit
    ok, backup_codes = await confirm_enrollment(db, user["id"], inp.code)
    if not ok:
        raise HTTPException(status_code=400, detail="Invalid TOTP code")
    _ctx = _audit.context_from(request, user)
    await _audit.record(
        db, action="two_factor_enabled",
        entity_type="user", entity_id=user["id"],
        **_ctx,
    )
    return {
        "ok": True,
        "backup_codes": backup_codes,
        "warning": ("Save these 10 backup codes somewhere safe. "
                     "They're single-use and shown only once — "
                     "if you lose your authenticator you'll need them."),
    }


@router.post("/2fa/verify-login")
async def verify_2fa_on_login(inp: TotpVerifyLoginInput, request: Request,
                                response: Response):
    """Second step of the login flow when the user has 2FA enabled.
    Consumes the short-lived challenge_token from /login and issues
    the full session JWT if the TOTP (or a backup code) verifies."""
    payload = _decode_challenge(inp.challenge_token)
    user_id = payload["sub"]
    tenant_id = payload["tenant_id"]
    role = payload["role"]
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "two_factor": 1,
                                                       "email": 1, "name": 1})
    if not user:
        raise HTTPException(status_code=404, detail="Account not found")
    # Try TOTP first, then backup code.
    from services.auth.totp import verify_totp, consume_backup_code
    from services import audit_log as _audit
    used_backup = False
    if not verify_totp(user, inp.code):
        used_backup = await consume_backup_code(db, user_id, inp.code)
        if not used_backup:
            _ctx = _audit.context_from(request, user)
            _ctx["tenant_id"] = tenant_id
            await _audit.record(
                db, action="two_factor_failure",
                entity_type="user", entity_id=user_id,
                meta={"reason": "invalid_totp"},
                **_ctx,
            )
            raise HTTPException(status_code=401, detail="Invalid 2FA code")
    # Success — issue the real session token, matching /login's tail.
    token = create_token(user_id, tenant_id, role)
    tenant = await db.tenants.find_one({"id": tenant_id}, {"_id": 0})
    user.pop("_id", None)
    user.pop("password_hash", None)
    set_auth_cookie(response, token)
    # Track the new session + audit.
    import jwt as _jwt
    from core import JWT_SECRET as _JS, JWT_ALGORITHM as _JA
    from services.auth.session_tracking import record_session as _rec_sess
    _p = _jwt.decode(token, _JS, algorithms=[_JA])
    _ctx = _audit.context_from(request, {**user, "tenant_id": tenant_id})
    await _rec_sess(
        db, jti=_p.get("jti"), user_id=user_id, tenant_id=tenant_id,
        exp=_p.get("exp"),
        ua=_ctx.get("actor_ua"), ip=_ctx.get("actor_ip"),
    )
    await _audit.record(
        db, action="two_factor_success",
        entity_type="user", entity_id=user_id,
        meta={"used_backup_code": used_backup},
        **_ctx,
    )
    # FIX-006-A (S0-08): cookie-only in prod.
    return login_response(token, user=user, tenant=tenant, used_backup_code=used_backup)


@router.post("/2fa/disable")
async def disable_2fa(inp: TotpDisableInput, request: Request,
                        user: dict = Depends(get_current_user)):
    """Turn 2FA off — user must prove account ownership by supplying
    a valid TOTP or a backup code. Wipes secret + all backup codes."""
    from services.auth.totp import (
        is_enabled, verify_totp, consume_backup_code, disable_totp,
    )
    from services import audit_log as _audit
    full = await db.users.find_one({"id": user["id"]}, {"_id": 0})
    if not is_enabled(full):
        raise HTTPException(status_code=400, detail="2FA is not enabled on this account")
    ok = verify_totp(full, inp.code)
    if not ok:
        ok = await consume_backup_code(db, user["id"], inp.code)
    if not ok:
        raise HTTPException(status_code=401, detail="Invalid 2FA code")
    await disable_totp(db, user["id"])
    _ctx = _audit.context_from(request, user)
    await _audit.record(
        db, action="two_factor_disabled",
        entity_type="user", entity_id=user["id"],
        **_ctx,
    )
    return {"ok": True}


@router.post("/2fa/regenerate-backup-codes")
async def regenerate_2fa_backup(inp: TotpConfirmInput, request: Request,
                                   user: dict = Depends(get_current_user)):
    """Fresh set of 10 backup codes; invalidates the old set. Requires
    a valid current TOTP (not a backup code) to prove the user still
    has the authenticator."""
    from services.auth.totp import (
        is_enabled, verify_totp, regenerate_backup_codes,
    )
    from services import audit_log as _audit
    full = await db.users.find_one({"id": user["id"]}, {"_id": 0})
    if not is_enabled(full):
        raise HTTPException(status_code=400, detail="2FA is not enabled")
    if not verify_totp(full, inp.code):
        raise HTTPException(status_code=401, detail="Invalid TOTP")
    codes = await regenerate_backup_codes(db, user["id"])
    _ctx = _audit.context_from(request, user)
    await _audit.record(
        db, action="two_factor_backup_regenerated",
        entity_type="user", entity_id=user["id"],
        **_ctx,
    )
    return {"backup_codes": codes,
             "warning": "Old backup codes are now invalid. Save these."}


# ---------------------------------------------------------------------------
# FIX-005-D (RBAC-24): tenant ownership transfer
# ---------------------------------------------------------------------------
@router.post("/tenant/transfer-ownership")
async def transfer_ownership(inp: TransferOwnershipInput, request: Request,
                                user: dict = Depends(get_current_user)):
    """Transfer workspace ownership from the current owner to another
    active member. The caller MUST be a current owner AND must supply
    a valid TOTP code if they have 2FA enabled (prevents session-theft
    from trivially seizing the workspace).

    Steps:
      1. Guard: caller is an owner in this tenant.
      2. Guard: target is a live member in this tenant.
      3. Guard: caller passes 2FA check (only enforced if their
         account has 2FA — non-2FA callers pass through, but the
         audit-log entry marks whether 2FA was in play).
      4. Promote target: membership.role = "owner".
      5. Demote caller: membership.role -> "sales" (caller can pick
         a specific role later via team.update_user; sales is a safe
         default that keeps them in the workspace).
      6. Audit-log the full before/after.

    Returns {ok, previous_owner_id, new_owner_id, transferred_at}.
    """
    from services.auth.membership import (
        find_membership, update_membership, LIVE_STATUSES,
    )
    from services.auth.totp import is_enabled as totp_is_enabled, verify_totp
    from services import audit_log as _audit
    if user.get("role") != "owner":
        raise HTTPException(
            status_code=403,
            detail="Only a current owner can transfer ownership.",
        )
    if inp.new_owner_user_id == user["id"]:
        raise HTTPException(
            status_code=400,
            detail="Pick a different member to transfer ownership to.",
        )
    target_membership = await find_membership(
        db, inp.new_owner_user_id, user["tenant_id"],
        statuses=LIVE_STATUSES,
    )
    if not target_membership:
        raise HTTPException(
            status_code=400,
            detail="Target is not an active member of this workspace.",
        )
    # 2FA gate — only enforced when the caller has 2FA enabled.
    # (An owner who never turned on 2FA can still transfer, but the
    # audit trail marks 2fa_used=false so ops can see the risk.)
    caller_full = await db.users.find_one({"id": user["id"]}, {"_id": 0})
    two_fa_active = totp_is_enabled(caller_full)
    if two_fa_active:
        if not inp.totp_code:
            raise HTTPException(
                status_code=400,
                detail="Your account has 2FA enabled. Include a TOTP code with the transfer request.",
            )
        if not verify_totp(caller_full, inp.totp_code):
            raise HTTPException(status_code=401, detail="Invalid TOTP")
    # Promote + demote in memberships.
    await update_membership(
        db, user_id=inp.new_owner_user_id, tenant_id=user["tenant_id"],
        updates={"role": "owner"},
    )
    await update_membership(
        db, user_id=user["id"], tenant_id=user["tenant_id"],
        updates={"role": "sales"},   # safe default; caller can change later
    )
    # Update the legacy user.role field for compat (see FIX-004-B
    # compat layer notes) — the new owner may be reading user.role
    # somewhere that hasn't been migrated.
    await db.users.update_many(
        {"id": {"$in": [inp.new_owner_user_id, user["id"]]},
         "tenant_id": user["tenant_id"]},
        {"$set": {"updated_at": now_iso()}},
    )
    await db.users.update_one(
        {"id": inp.new_owner_user_id, "tenant_id": user["tenant_id"]},
        {"$set": {"role": "owner"}},
    )
    await db.users.update_one(
        {"id": user["id"], "tenant_id": user["tenant_id"]},
        {"$set": {"role": "sales"}},
    )
    _ctx = _audit.context_from(request, user)
    await _audit.record(
        db, action="tenant_ownership_transferred",
        entity_type="tenant", entity_id=user["tenant_id"],
        before={"owner_id": user["id"]},
        after={"owner_id": inp.new_owner_user_id, "previous_owner_role": "sales",
                "2fa_used": two_fa_active},
        **_ctx,
    )
    return {
        "ok": True,
        "previous_owner_id": user["id"],
        "new_owner_id": inp.new_owner_user_id,
        "transferred_at": now_iso(),
        "two_fa_used": two_fa_active,
    }
