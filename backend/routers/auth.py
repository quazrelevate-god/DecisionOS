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

import asyncio
from typing import Optional

from services.tenant_ai_keys import TENANT_PUBLIC

from fastapi import APIRouter, Depends, HTTPException, Request, Response, BackgroundTasks

from core import (
    db, get_current_user, get_current_user_optional, hash_password, verify_password, create_token,
    set_auth_cookie, clear_auth_cookie, set_usage_tenant, new_id, now_iso,
    login_response, logger, _BASE_PERMS,
)
# J1-05 — what a team the AI just named starts out able to see.
from shared.roles import starting_perms


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


# Request models consolidated into models/auth.py (Epic 8 Sprint 5).
from models.auth import (  # noqa: F401
    RoleItem, ProductItem, RegisterInput, LoginInput, SwitchWorkspaceInput,
    TotpConfirmInput, TotpVerifyLoginInput, TotpDisableInput, TransferOwnershipInput,
    ProfileUpdateInput, ChangePasswordInput, PasswordForgotInput, PasswordResetInput,
    PhoneChangeCodeInput,
    OwnerCredentialsInput,
)


def _norm_company(name) -> str:
    """A company name as it compares: trimmed, case- and spacing-blind.

    Used to tell a lost "Create workspace" press (same company, retried) from a
    founder starting their SECOND company with the address they already use.
    """
    return " ".join(str(name or "").split()).strip().lower()


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@router.post("/register")
async def register(inp: RegisterInput, request: Request, response: Response,
                    background: BackgroundTasks = None,
                    caller: Optional[dict] = Depends(get_current_user_optional)):
    # FIX-004-A (RBAC-02): rate-limit registrations per IP + verify
    # CAPTCHA before any DB work. Prevents bot-driven tenant creation
    # + AI credit burn + storage cost.
    from services.rate_limit import check_rate_limit, client_ip
    from services.captcha import verify_captcha
    ip = client_ip(request)
    ok, retry_after = await check_rate_limit(ip, 3, 3600, bucket="register")
    if not ok:
        # 2026-09-17 — say how long, and name the other door. Three workspaces
        # an hour is per NETWORK, so an office behind one address reaches it
        # quickly, and "try again later" left a founder with nothing to do and
        # no idea when. Anyone who already has a workspace wants sign-in, not
        # this endpoint.
        _mins = max(1, round(retry_after / 60))
        raise HTTPException(
            status_code=429,
            detail=(f"Three workspaces have already been created from this network in the last hour. "
                    f"Try again in about {_mins} minute{'s' if _mins != 1 else ''} — "
                    f"or sign in if you already have a workspace."),
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
    from core import normalize_os_blueprint
    from core import DEFAULT_ROLES
    # FIX-001-D imports — status-aware AI + draft merge/complete
    from services.ai import ai_setup as ai_setup_svc
    from services.auth import onboarding_drafts as drafts_svc

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
    # 2026-09-20 — ONE FOUNDER, SEVERAL COMPANIES, AND NOBODY SETS A PASSWORD.
    #
    # The confirmed mobile is the sign-in — for the founder exactly as for every
    # member — and the email is how support and receipts reach them. So signup
    # sends no password at all; an owner who wants one adds it later in Settings
    # (POST /auth/owner-credentials), and a password sent here by an older
    # client still works.
    #
    # The email is one per company (globally unique, users.email_1) and the
    # number is not, so a SECOND company sends no address either: the proof
    # names a number somebody has already confirmed, and that row says who they
    # are. Either way the mobile has to be confirmed — an unknown number is not
    # an identity, and without one there would be no way back in.
    from services.auth.phone import identity_for_phone as _identity_for_phone
    from services.auth.phone_proof import read_phone_proof as _read_proof
    _proof_norm = _read_proof(inp.phone_token) if inp.phone_token else ""
    # 2026-09-20 (Yokesh) — "when I create a new company it has the catch about
    # being signed in, so why do we put the number and get the OTP again?" We
    # don't: a session whose own mobile is confirmed identifies this founder at
    # least as well as a 24-hour proof token does, so it stands in for one.
    # A session whose number was never confirmed does not — there would be
    # nothing to sign the new workspace in with.
    _session_norm = ""
    # Called as a function rather than through FastAPI (every test here does
    # that), `caller` is the Depends marker itself — there is no session then.
    if not isinstance(caller, dict):
        caller = None
    # This endpoint is on CSRF_EXEMPT_PATHS, because a founder signing up has
    # no CSRF cookie yet — and that exemption was harmless while register
    # ignored sessions entirely. It no longer does, so the half that ACTS on a
    # cookie session is checked here: without the double-submit header, another
    # site could make a signed-in founder's browser create a workspace. A
    # Bearer caller and a direct call are not forgeable and pass untouched.
    if caller:
        from services.csrf import cookie_session_needs_csrf, csrf_pair_matches
        if cookie_session_needs_csrf(request) and not csrf_pair_matches(request):
            logger.warning("register: ignoring a cookie session with no CSRF header")
            caller = None
    if caller and caller.get("phone_verified_at"):
        _session_norm = caller.get("phone_norm") or ""
    _known_norm = _proof_norm or _session_norm
    _identity = await _identity_for_phone(db, _known_norm) if _known_norm else None
    second_company = not inp.email
    if not _known_norm and not inp.password:
        raise HTTPException(status_code=400, detail={
            "code": "phone_unverified",
            "message": "Confirm your mobile number with the code we text you, then create your workspace.",
        })
    if second_company and not _identity:
        raise HTTPException(status_code=400, detail={
            "code": "identity_unknown",
            "message": ("This number has no workspace yet, so this is your first one — "
                        "an email for support and receipts is needed with it."),
        })

    email = (inp.email or "").lower()
    _existing = await db.users.find_one({"email": email}) if email else None
    if _existing:
        # 2026-09-17 — the founder pressing "Create workspace" a second time is
        # almost never someone else's account: it is the same person, because
        # their first attempt's answer never arrived (KM-61 measured a 499 at
        # the proxy's 60s ceiling followed by a 400 on the retry). Registration
        # had already created them, so the screen said "Couldn't create your
        # workspace" and every press after that said "Email already registered"
        # — about an account they could have signed straight into.
        #
        # So: if the password they just typed opens that account, this IS them.
        # Finish the job the first attempt started and hand them their
        # workspace. If it does not, the email genuinely belongs to someone
        # else — say so with the words the signup form uses at the email step,
        # and a code the screen can turn into a "Sign in instead" button.
        #
        # 2026-09-20 — but only when it is the SAME company. A founder starting
        # their second company reuses the address they already have, and this
        # recovery signed them into the FIRST workspace and answered like a
        # normal sign-in, so the reveal screen appeared and the new company had
        # never been created. The lost press is recognised by the company name
        # on the request matching the workspace that account already owns;
        # anything else is a person who wants a second company, and they are
        # sent to the door that opens: their mobile.
        _tid = _existing.get("tenant_id")
        _t = await db.tenants.find_one({"id": _tid}, TENANT_PUBLIC) if _tid else None
        _same_company = _norm_company(inp.company_name) == _norm_company((_t or {}).get("name"))
        # Is this the same person coming back? Their confirmed mobile answers
        # that now (nobody types a password in signup any more); a password sent
        # by an older client still counts.
        _same_person = bool(_known_norm) and _known_norm == (_existing.get("phone_norm") or "")
        if inp.password:
            _same_person = _same_person or verify_password(inp.password, _existing.get("password_hash", ""))
        if _same_company and _same_person:
            _tok = create_token(_existing["id"], _tid, _existing.get("role") or "owner")
            set_auth_cookie(response, _tok)
            _u = await db.users.find_one({"id": _existing["id"]}, {"_id": 0, "password_hash": 0})
            logger.info(f"register: same credentials for an existing account ({email}) — signing them in")
            return login_response(_tok, user=_u, tenant=_t)
        _owns = (_t or {}).get("name")
        raise HTTPException(status_code=400, detail={
            "code": "email_registered",
            "message": (
                f"This email already runs {_owns}. Create {inp.company_name.strip()} with your mobile "
                "instead — same number, new company — or use a different email."
                if _owns and not _same_company else
                "This email already has a workspace. Sign in instead, or use a different email."
            ),
        })

    # 2026-09-19 — the founder's mobile is a sign-in (Mobile OTP, the mobile
    # app) and a route (WhatsApp from it lands here as the owner). It used to
    # be stored exactly as typed, with nothing stricter than "8 digits" on the
    # form: a slip locked the founder out of Mobile OTP, and handed whoever
    # owns the mistyped number an owner's sign-in to this workspace. So it is
    # confirmed by a texted code at the step where it is typed, and trusted
    # here only with the proof /signup/phone/verify issued for THAT number.
    #
    # 2026-09-19 — a new password is 8+ characters with a letter and a number.
    # After the recovery above on purpose: an existing password is still valid.
    # A second company sets no password at all — the founder signs in to it by
    # mobile, and their first workspace still holds the password they have.
    if inp.password:
        from services.auth.passwords import password_problem
        _pw_problem = password_problem(inp.password)
        if _pw_problem:
            raise HTTPException(status_code=400, detail={"code": "password_weak", "message": _pw_problem})

    # Checked after the same-credentials recovery above on purpose: that path
    # signs an existing account in and writes no phone.
    from services.auth.phone import valid_indian_mobile, display_indian_mobile
    from services.auth.phone_proof import read_phone_proof
    _phone_norm = ""
    if (inp.phone or "").strip():
        # A number was typed: it must be a real mobile AND the proof must be for
        # THAT number. Confirming your own and then typing a colleague's is the
        # case this refuses — the proof does not transfer.
        _phone_norm = valid_indian_mobile(inp.phone)
        if not _phone_norm:
            raise HTTPException(status_code=400, detail={
                "code": "phone_invalid",
                "message": "Enter a 10-digit Indian mobile number.",
            })
        if read_phone_proof(inp.phone_token) != _phone_norm:
            raise HTTPException(status_code=400, detail={
                "code": "phone_unverified",
                "message": "Confirm your mobile number with the code we text you, then create your workspace.",
            })
    elif _known_norm:
        # No number typed — a second company sends the proof alone (or nothing
        # at all, when the session already says who this is), and that number is
        # what the new workspace signs in with.
        _phone_norm = _known_norm
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
            label = r.get("label") or k.replace("_", " ").title()
            # J1-05 (JOURNEY-1) — a team the AI names for the company's own work
            # is a CUSTOM role key, and a custom key falls through to
            # _BASE_PERMS. So the "Accounts & GST" team a founder was given at
            # sign-up had no access to Money, and the accountant he added to it
            # on day one could not open the accounts. A team whose name is about
            # money starts with Finance (shared/roles.starting_perms); the rest
            # start on the base, unchanged. Settings -> Team roles -> Access is
            # still where an owner decides differently.
            extra = starting_perms(k, label)
            role_doc = {"key": k, "label": label}
            if extra:
                role_doc["permissions"] = sorted(set(_BASE_PERMS) | set(extra))
            clean_roles.append(role_doc)

    # WE-EPIC5-BUG-2 (2026-08-16): before we can call the AI helpers,
    # the RBAC-25 DPDP consent gate needs a tenant doc with granted
    # consent -- otherwise every LLM call raises 451. On signup the
    # tenant doesn't exist yet, so the AI silently defaulted to the
    # textile-era pipeline for every new tenant (surfaced by the live
    # tech-manufacturer signup E2E). Fix: insert a stub tenant with
    # ai_consent pre-populated BEFORE the AI calls fire. The signup
    # click IS the consent event -- the founder cannot proceed
    # without it. We fill in the real fields (lexicon, operating_model,
    # etc.) via update_one below once AI returns.
    from services.ai_consent import build_grant_payload as _consent_grant
    _stub_consent = _consent_grant(
        actor_user_id="signup-provisional",  # user_id not yet minted
        actor_email=email,
        ip=(request.client.host if request.client else None),
        ua=(request.headers.get("user-agent") or "")[:500],
    )

    # 2026-09-17 — THE ACCOUNT IS MADE BEFORE THE AI RUNS, not after.
    #
    # The three setup generators (lexicon, operating model, finance categories)
    # used to run here, inside the request, BEFORE the user row existed: 14s on
    # a warm developer machine, and KM-61 caught a real signup where the
    # frontend's proxy gave up at its 60s ceiling —
    #
    #   POST /api/auth/register  499  totalDuration 60000
    #   POST /api/auth/register  400  totalDuration 26     <- the retry
    #
    # The backend never knew the client had gone; it finished and committed the
    # workspace. So the founder read "Couldn't create your workspace", pressed
    # again, and got "Email already registered" for an account that existed and
    # whose password worked. Making the calls concurrent (KM-61) narrowed that
    # window; it could not close it, because the window IS the AI latency.
    #
    # Now registration writes the tenant, the owner and the membership — all
    # deterministic, all fast — hands back the session, and generates the AI
    # setup behind it (services.ai.ai_setup.generate_tenant_setup, scheduled at
    # the end of this function). Every reader already tolerates the gap:
    # tenant_operating_model() falls back to DEFAULT_OPERATING_MODEL, and a
    # None lexicon was already a supported state because a failed generator
    # stored exactly that. `ai_setup_status` says "pending" until it lands.
    from services.ai.ai_setup import STATUS_PENDING as _AI_PENDING
    ai_setup_status = {
        "lexicon": _AI_PENDING,
        "operating_model": _AI_PENDING,
        "finance_categories": _AI_PENDING,
    }
    lexicon = om = fc = None

    # FIX-005-A (S3-02): initialize plan fields on fresh registration.
    # Trial for 14 days, no overrides. Grandfathered tenants get their
    # plan set by the backfill migration in server.py._bootstrap.
    from services.plans import new_tenant_plan_fields
    _plan_fields = new_tenant_plan_fields()
    # Stub tenant was inserted above (with ai_consent) so the AI calls
    # could run. Now UPDATE it with everything the signup collected +
    # the AI-generated fields. Preserves ai_consent + id + created_at
    # (already set). Keep the local tenant_doc var built for the
    # login-response payload downstream.
    tenant_doc = {
        "id": tenant_id, "name": inp.company_name,
        "industry": inp.industry or "General",
        "description": (inp.description or "").strip(),
        "company_size": inp.company_size or "",
        "region": inp.region or "",
        "currency": (inp.currency or "INR").upper(),
        "gst": inp.gst or "",
        # Where support and receipts for THIS company go. A founder's second
        # company has no sign-in address of its own, so this is how they are
        # reachable about it — and it may be the same address as their first
        # company, because it is company contact detail, not an account.
        "support_email": (inp.support_email or "").strip().lower(),
        "branches": inp.branches or "",
        "business_scale": inp.business_scale or {},
        "current_software": inp.current_software or [],
        "invited_employees": [],
        "roles": clean_roles or DEFAULT_ROLES,
        "products": [p.model_dump() for p in (inp.products or [])],
        # WE-02: workflow_templates removed (dead brainstorm list).
        "operational_task_templates": bp["operational_tasks"] if bp else [],
        "approval_rules": bp["approval_rules"] if bp else [],
        "lexicon": lexicon,
        "operating_model": om,
        "finance_categories": fc,
        "ai_setup_status": ai_setup_status,  # FIX-001-D
        "ai_consent": _stub_consent,  # the signup click IS the consent event
        "created_at": now_iso(),
        # FIX-005-A (S3-02): plan defaults (plan / trial_ends_at /
        # seat_limit_override / usage_quotas / feature_flags).
        **_plan_fields,
    }
    # One write, complete: nothing slow happened before it, so there is no
    # stub to patch up.
    await db.tenants.insert_one(dict(tenant_doc))
    user_id = new_id()
    # FIX-002-A: also write phone_norm so OTP login + WhatsApp routing
    # can query by exact-match on the indexed field.
    # Stored the way people write it back ("+91 98765 43210"), whatever
    # arrangement of spaces and prefixes was typed; the lookup key is the
    # confirmed 10 digits.
    _raw_phone = display_indian_mobile(_phone_norm) if _phone_norm else ""
    _owner_name = ((_identity or {}).get("name") or inp.name) if second_company else inp.name
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
            "id": user_id, "tenant_id": tenant_id,
            # A second company keeps the founder's name from the account their
            # number already belongs to, and has no email of its own (support
            # and receipts go to the workspace's own address instead).
            "name": _owner_name,
            "email": email,
            "phone": _raw_phone, "phone_norm": _phone_norm,
            "phone_verified_at": now_iso() if _phone_norm else None,
            # 2026-09-20 — nobody sets a password at signup: the confirmed
            # mobile is the sign-in. An owner who wants one adds it in Settings,
            # and a password from an older client is still honoured here.
            **({"password_hash": hash_password(inp.password)} if inp.password
               else {"passwordless": True}),
            "role": "owner", "created_at": now_iso(),
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

    # 2026-09-20 — KEEP WHATSAPP WORKING WHEN A NUMBER GAINS A SECOND COMPANY.
    # Inbound WhatsApp from a number that matches users in two workspaces is
    # dropped on purpose: picking a winner would silently sever the other
    # workspace (services/whatsapp.py, step 2). So the moment a second company
    # appears, name the FIRST one as where messages from this number land —
    # today's behaviour, made explicit — and leave changing it to Settings.
    if second_company and _phone_norm:
        try:
            _already = await db.users.find_one(
                {"phone_norm": _phone_norm, "wa_primary": True}, {"_id": 0, "id": 1})
            if not _already and _identity and _identity.get("id"):
                await db.users.update_one({"id": _identity["id"]}, {"$set": {"wa_primary": True}})
        except Exception:
            # Routing preference is a convenience; never fail a registration on it.
            logger.warning("register: could not mark the WhatsApp home workspace", exc_info=True)

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
    # A second company has no address yet — nothing to verify. They add a
    # business email for it in Settings, which sends its own link.
    try:
        if not email:
            raise RuntimeError("no address on this workspace yet")
        from services.auth import auth_emails
        from services.email import send_email
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

    # The workspace exists and the founder is about to be handed their session;
    # the AI setup fills in behind them (see the note above the tenant write).
    from services.ai.ai_setup import generate_tenant_setup as _gen_setup
    if background is not None:
        background.add_task(
            _gen_setup, tenant_id, industry=inp.industry or "General",
            company_size=inp.company_size or "", roles=clean_roles or DEFAULT_ROLES,
            description=inp.description or "")
    else:
        # No request context (a test or a script calling register directly):
        # run it inline so behaviour is identical, just slower.
        try:
            await _gen_setup(tenant_id, industry=inp.industry or "General",
                             company_size=inp.company_size or "", roles=clean_roles or DEFAULT_ROLES,
                             description=inp.description or "")
        except Exception as _setup_err:
            logger.error(f"register: inline AI setup failed: {_setup_err}")

    token = create_token(user_id, tenant_id, "owner")
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    tenant = await db.tenants.find_one({"id": tenant_id}, TENANT_PUBLIC)
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
        # WE-02: 'workflows' count removed (was reading the ghost
        # workflow_templates field that no longer exists on tenant).
        "departments": len(clean_roles),
        "operational_tasks": len(tenant_doc["operational_task_templates"]),
        "approval_rules": len(tenant_doc["approval_rules"]),
    }
    # FIX-006-A (S0-08): cookie is source of truth; body carries user/tenant.
    # Raw JWT surfaces in the body only when AUTH_RETURN_TOKEN is on.
    # 2026-09-20 — a second company is mobile-only by design, and the screen it
    # opens on decides whether to ask for an email and a password from THIS
    # answer (it does not re-read /auth/me first).
    from services.auth.phone import has_credentials_elsewhere
    user = {**user, "credentials_elsewhere": await has_credentials_elsewhere(db, user)}
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
        legacy_access_allowed as _legacy_ok,
        accept_pending_membership as _accept_pending,
    )
    choices = await _choices(db, user["id"])
    # 2026-09-16: a password sign-in accepts a pending invite too — the picker
    # only lists live memberships, so an invited member would otherwise be told
    # their account isn't linked to any workspace.
    if not choices or (inp.tenant_id and not any(c["tenant_id"] == inp.tenant_id for c in choices)):
        if await _accept_pending(db, user["id"], inp.tenant_id):
            choices = await _choices(db, user["id"])
    # Fallback: pre-migration users may not have a memberships row yet
    # (backfill runs at bootstrap but a race is possible). Fall through
    # to the legacy user.tenant_id/role so nobody is locked out — except
    # someone removed from that workspace (2026-09-15).
    if not choices:
        if user.get("tenant_id") and await _legacy_ok(db, user, user["tenant_id"]):
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
    tenant = await db.tenants.find_one({"id": tenant_id}, TENANT_PUBLIC)
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


async def _confirmed_mobile_of(user: dict) -> str:
    """This session's own confirmed number, or "" if it was never confirmed.

    Read from the stored row rather than the token: the number is only an
    identity once a texted code proved it (`phone_verified_at`).
    """
    row = await db.users.find_one(
        {"id": user["id"]}, {"_id": 0, "phone_norm": 1, "phone_verified_at": 1}) or {}
    return row.get("phone_norm") or "" if row.get("phone_verified_at") else ""


async def _workspaces_by_confirmed_mobile(user: dict, exclude: set) -> list:
    """The other companies this person's confirmed mobile signs in to."""
    norm = await _confirmed_mobile_of(user)
    if not norm:
        return []
    from services.auth.phone import find_tenant_choices_for_phone
    from services.auth.membership import find_membership, LIVE_STATUSES
    out = []
    for c in await find_tenant_choices_for_phone(db, norm):
        if c["tenant_id"] in exclude:
            continue
        # A live membership, not merely a row with this number on it: an invite
        # not yet accepted opens with its link, and a membership that was
        # suspended or removed is not a way back in.
        m = await find_membership(db, c["user_id"], c["tenant_id"], statuses=LIVE_STATUSES)
        if m:
            out.append({"tenant_id": c["tenant_id"], "tenant_name": c["tenant_name"],
                        "role": m.get("role") or c.get("role"), "user_id": c.get("user_id")})
    return out


@router.get("/me/workspaces")
async def list_my_workspaces(user: dict = Depends(get_current_user)):
    """FIX-004-B (RBAC-13): every workspace the current user is a
    member of. Powers the workspace-switcher UI.

    Marks the currently-active workspace with `is_current: true` so
    the UI can render it distinctly."""
    from services.auth.membership import resolve_login_choices
    choices = await resolve_login_choices(db, user["id"])
    # 2026-09-20 — ALSO the companies this person's confirmed mobile reaches.
    # A workspace creates its own user row per person (register and Team invite
    # both do), so one founder running two companies has two ids and each id
    # has exactly one membership — the list above would always be a single row.
    # The confirmed number is what says they are the same person, so it is what
    # the switcher lists. Live memberships only: an invite not yet accepted
    # opens with its link, and a removed one is not a way back in.
    choices += await _workspaces_by_confirmed_mobile(user, exclude={c["tenant_id"] for c in choices})
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
    # 2026-09-20 — the same person holds a DIFFERENT user row in each of their
    # companies (register and Team invite both create one), so the membership
    # above only ever exists for the workspace they are already in. Their
    # confirmed mobile is what links the rows: find the row this number holds
    # in the target workspace, require BOTH sides to have been confirmed by a
    # texted code, and mint the token for THAT row — its id and its role.
    _switch_user_id = user["id"]
    if not target:
        _norm = await _confirmed_mobile_of(user)
        _row = await db.users.find_one(
            {"tenant_id": inp.tenant_id, "phone_norm": _norm,
             "phone_verified_at": {"$ne": None}, "wa_phone_obsolete": {"$ne": True}},
            {"_id": 0, "id": 1},
        ) if _norm else None
        if _row:
            target = await find_membership(db, _row["id"], inp.tenant_id, statuses=LIVE_STATUSES)
            if target:
                _switch_user_id = _row["id"]
    if not target:
        raise HTTPException(
            status_code=403,
            detail="You don't have access to this workspace.",
        )
    user = {**user, "id": _switch_user_id}
    token = create_token(_switch_user_id, inp.tenant_id, target.get("role") or "sales")
    tenant = await db.tenants.find_one({"id": inp.tenant_id}, TENANT_PUBLIC)
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
    from services.auth.session_revocation import revoke as _revoke
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
    from services.ai.generators import ai_generate_finance_categories, ai_generate_lexicon, backfill_operating_model

    tenant = await db.tenants.find_one({"id": user["tenant_id"]}, TENANT_PUBLIC)
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
    # ASK-28 TK-08 (plan 6.5): the permissions the server actually applies (own
    # list, else the company's role settings, else role defaults, plus live temp
    # grants), so the screens decide with the same answer as the routes.
    from core import user_perms
    # 2026-09-20 — an owner who came in by mobile is asked for an email and a
    # password by a full-screen gate (OwnerCredentialsGate). A founder's SECOND
    # company is mobile-only by design, and they already have both on their
    # first one — so say when that is the case and let the gate stand down.
    # Looked up only for the accounts it can apply to, on an indexed field.
    from services.auth.phone import has_credentials_elsewhere
    _full = await db.users.find_one(
        {"id": user["id"]}, {"_id": 0, "phone_norm": 1, "phone_verified_at": 1,
                             "passwordless": 1, "email": 1, "role": 1, "id": 1}) or {}
    _elsewhere = await has_credentials_elsewhere(db, {**_full, "role": user.get("role")})
    return {"user": {**user, "effective_permissions": sorted(user_perms(user)),
                     "credentials_elsewhere": _elsewhere},
            "tenant": tenant}


@router.patch("/profile")
async def update_profile(inp: ProfileUpdateInput, user: dict = Depends(get_current_user)):
    """Your own details: name, job title, what you handle, mobile, email, language.

    2026-09-16 — a person keeps their own details current without going through
    a manager. What is NOT here, and never will be: role, permissions, reporting
    line. Those are someone else's call about you and live on PATCH /users, so
    nobody can edit their own way into more of the app.
    """
    updates = {}
    if inp.name is not None and inp.name.strip():
        updates["name"] = inp.name.strip()[:80]
    if inp.title is not None:
        # The line under your name on the Team page. Yours to keep current; a
        # team manager can still set it for you.
        updates["title"] = inp.title.strip()[:80] or None
    if inp.about is not None:
        # One line on what you look after, in your own words.
        updates["about"] = inp.about.strip()[:280] or None
    # 2026-09-19 (U7-24.14) — a new mobile is saved only with the code texted
    # to it. It used to be saved on trust after one check (nobody else in the
    # workspace has it), so a slip locked you out of Mobile OTP and gave the
    # stranger who owns the mistyped number a sign-in as you, with their
    # WhatsApp filed as yours; a 5-digit "number" saved too. Signup closed the
    # same hole the same way (U7-24.11). The code is checked last, just before
    # the write, so a refusal elsewhere in this form doesn't spend it.
    _phone_to_confirm = None
    if inp.phone is not None:
        from services.auth.phone import norm_phone, valid_indian_mobile, display_indian_mobile
        _stored = await db.users.find_one({"id": user["id"]}, {"_id": 0, "phone": 1, "phone_norm": 1,
                                                               "passwordless": 1}) or {}
        _old_norm = _stored.get("phone_norm") or norm_phone(_stored.get("phone") or "")
        _typed = inp.phone.strip()
        if not _typed:
            if _old_norm:
                # Taking a number away only narrows what it can do — except for
                # someone who signs in with nothing else.
                if _stored.get("passwordless"):
                    raise HTTPException(status_code=400, detail=(
                        "You sign in with this number, so it can be changed but not removed."))
                updates.update({"phone": "", "phone_norm": "", "phone_verified_at": None})
        elif norm_phone(_typed) == _old_norm:
            # The whole form comes back on every save, number included. The same
            # number, however it is written, is not a change — and an old
            # malformed one is left alone rather than blocking a name edit.
            pass
        else:
            _new_norm = valid_indian_mobile(_typed)
            if not _new_norm:
                raise HTTPException(status_code=400, detail={
                    "code": "phone_invalid", "message": "Enter a 10-digit Indian mobile number."})
            # One mobile, one member, inside this workspace: the number is a
            # sign-in and a WhatsApp route, so taking a colleague's number would
            # send their codes and captures to your account.
            clash = await db.users.find_one(
                {"tenant_id": user["tenant_id"], "phone_norm": _new_norm, "id": {"$ne": user["id"]}},
                {"_id": 0, "name": 1},
            )
            if clash:
                raise HTTPException(
                    status_code=400,
                    detail=f"That mobile number is already {clash.get('name')}'s in this workspace.",
                )
            if not (inp.phone_code or "").strip():
                raise HTTPException(status_code=400, detail={
                    "code": "phone_unconfirmed",
                    "message": "Confirm the new number with the code we text to it."})
            _phone_to_confirm = (_new_norm, inp.phone_code)
            updates["phone"] = display_indian_mobile(_new_norm)
            updates["phone_norm"] = _new_norm  # keep index-searchable form in sync
            updates["phone_verified_at"] = now_iso()
            # Changing your number should re-enable WhatsApp matching for it.
            updates["wa_phone_obsolete"] = False
    if inp.language is not None and inp.language in ("en", "hi", "ta"):
        updates["language"] = inp.language
    if inp.email is not None and inp.email.strip().lower() != (user.get("email") or "").lower():
        email = inp.email.strip().lower()
        # The email is how you sign in, so prove it is you at the keyboard: your
        # password, or — for a member who signs in by mobile and has none — a
        # code to your own number, asked the same way the sign-in door asks.
        full = await db.users.find_one({"id": user["id"]})
        if (full or {}).get("passwordless"):
            # 2026-09-19 — for someone who signs in by mobile the email is
            # contact detail, not a key: they have no password to sign in or
            # reset with it. So it needs no proof. (An owner who came in by
            # mobile adds email + password together, through
            # /auth/owner-credentials.)
            pass
        else:
            if not inp.current_password or not verify_password(inp.current_password, (full or {}).get("password_hash", "")):
                raise HTTPException(status_code=400, detail="Enter your current password to change your email")
        if await db.users.find_one({"email": email, "id": {"$ne": user["id"]}}, {"_id": 0, "id": 1}):
            raise HTTPException(status_code=400, detail="That email is already used by another account")
        updates["email"] = email
        # A new address is unproven until they click the link we send.
        updates["email_verified_at"] = None
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")
    if _phone_to_confirm:
        from services.otp import consume_otp
        await consume_otp(_phone_to_confirm[0], _profile_phone_scope(user["id"]), _phone_to_confirm[1])
    updates["updated_at"] = now_iso()
    # Saving your details at all is what the one-time welcome card asks for, so
    # it clears the card in the same write — one request, nothing to leave half
    # done if they move on before a second call lands (2026-09-19).
    await db.users.update_one({"id": user["id"]}, {"$set": updates, "$unset": {"welcome_pending": ""}})
    fresh = await db.users.find_one({"id": user["id"]}, {"_id": 0, "password_hash": 0, "password": 0})
    tenant = await db.tenants.find_one({"id": user["tenant_id"]}, TENANT_PUBLIC)
    return {"user": fresh, "tenant": tenant}


def _profile_phone_scope(user_id: str) -> str:
    """Where a change-your-mobile code lives in otp_codes. Its own scope, not
    the workspace's: a sign-in code for the new number (if it already signs in
    elsewhere) must not confirm this change, and this code must never sign
    anyone in."""
    return f"profile:{user_id}"


# One person, and one number, can be texted this many change codes an hour.
_PHONE_CHANGE_CODES_PER_USER = (10, 3600)
_PHONE_CHANGE_CODES_PER_NUMBER = (5, 3600)


@router.post("/phone/send-code")
async def send_phone_change_code(inp: PhoneChangeCodeInput, user: dict = Depends(get_current_user)):
    """Text a code to the mobile you want to switch to (2026-09-19, U7-24.14).

    Signed-in only, and it answers the questions Save would, before anything is
    texted: is it a mobile, is it actually different, is it a colleague's.
    """
    from services.auth.phone import norm_phone, valid_indian_mobile, display_indian_mobile
    from services.rate_limit import check_rate_limit
    from services.otp import _issue_otp
    norm = valid_indian_mobile(inp.phone)
    if not norm:
        raise HTTPException(status_code=400, detail="Enter a 10-digit Indian mobile number")
    stored = await db.users.find_one({"id": user["id"]}, {"_id": 0, "phone": 1, "phone_norm": 1}) or {}
    if norm == (stored.get("phone_norm") or norm_phone(stored.get("phone") or "")):
        raise HTTPException(status_code=400, detail="That's already your number.")
    clash = await db.users.find_one(
        {"tenant_id": user["tenant_id"], "phone_norm": norm, "id": {"$ne": user["id"]}},
        {"_id": 0, "name": 1},
    )
    if clash:
        raise HTTPException(status_code=400,
                            detail=f"That mobile number is already {clash.get('name')}'s in this workspace.")
    for key, (limit, window), bucket in (
        (user["id"], _PHONE_CHANGE_CODES_PER_USER, "profile_phone_code_user"),
        (norm, _PHONE_CHANGE_CODES_PER_NUMBER, "profile_phone_code_number"),
    ):
        ok, retry_after = await check_rate_limit(key, limit, window, bucket=bucket)
        if not ok:
            mins = max(1, round(retry_after / 60))
            raise HTTPException(
                status_code=429,
                detail=f"That's a lot of codes in an hour. Try again in about {mins} minute{'s' if mins != 1 else ''}.",
                headers={"Retry-After": str(retry_after)},
            )
    resp = await _issue_otp(norm, norm, tenant_id=_profile_phone_scope(user["id"]))
    resp.pop("tenant_id", None)
    resp["phone"] = display_indian_mobile(norm)
    return resp


@router.post("/owner-credentials")
async def set_owner_credentials(inp: OwnerCredentialsInput, request: Request,
                                user: dict = Depends(get_current_user)):
    """An owner who came in by mobile adds an email and password (2026-09-19).

    Members sign in with their mobile only; owners have both, because the owner
    is who recovers everyone else. Someone added on Team as an owner, or
    promoted to one, arrives mobile-only — this is where they finish. Asked
    for by a full-screen step in the app until done (OwnerCredentialsGate.js).
    """
    if user.get("role") != "owner":
        raise HTTPException(status_code=403, detail="Only owners add an email and password here.")
    full = await db.users.find_one({"id": user["id"]}) or {}
    if not full.get("passwordless") and full.get("email"):
        raise HTTPException(status_code=400, detail="You already sign in with an email and password.")
    from services.auth.passwords import password_problem
    problem = password_problem(inp.password)
    if problem:
        raise HTTPException(status_code=400, detail=problem)
    email = inp.email.strip().lower()
    if await db.users.find_one({"email": email, "id": {"$ne": user["id"]}}, {"_id": 0, "id": 1}):
        raise HTTPException(status_code=400, detail="That email is already used by another account")
    # bcrypt takes ~0.3 s of CPU; off the event loop, so the Desk's requests
    # loading behind this screen aren't frozen while it runs (U7-24.18).
    password_hash = await asyncio.to_thread(hash_password, inp.password)
    await db.users.update_one({"id": user["id"]}, {"$set": {
        "email": email, "password_hash": password_hash, "passwordless": False,
        "email_verified_at": None if email != (full.get("email") or "") else full.get("email_verified_at"),
        "updated_at": now_iso()}})
    # Best-effort: the link that confirms the address, as registration sends.
    try:
        from services.auth import auth_emails
        from services.email import send_email
        row = await auth_emails.issue(db, kind=auth_emails.KIND_EMAIL_VERIFY,
                                      user_id=user["id"], tenant_id=user["tenant_id"], email=email)
        await send_email(email, "Verify your DecisionOS email",
                         auth_emails.render_verify_email(full.get("name") or "",
                                                         f"{_app_base_url()}/verify-email?token={row['token']}"))
    except Exception:
        pass
    fresh = await db.users.find_one({"id": user["id"]}, {"_id": 0, "password_hash": 0})
    return {"user": fresh}


@router.post("/welcome/done")
async def welcome_done(user: dict = Depends(get_current_user)):
    """The member's one-time welcome card was saved or put off (2026-09-19)."""
    await db.users.update_one({"id": user["id"]}, {"$unset": {"welcome_pending": ""}})
    return {"ok": True}


@router.post("/change-password")
async def change_password(inp: ChangePasswordInput, user: dict = Depends(get_current_user)):
    if user.get("passwordless"):
        raise HTTPException(status_code=400, detail="Your account signs in with mobile OTP and has no password to change.")
    full = await db.users.find_one({"id": user["id"]})
    if not full or not verify_password(inp.current_password, full.get("password_hash", "")):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    from services.auth.passwords import password_problem
    _pw_problem = password_problem(inp.new_password)
    if _pw_problem:
        raise HTTPException(status_code=400, detail=_pw_problem)
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
    from services.auth import auth_emails
    from services.email import send_email
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
    from services.auth import auth_emails
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
    from services.auth import auth_emails
    from services.email import send_email
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
    from services.auth import auth_emails
    # The rule first, so a weak choice doesn't spend the link.
    from services.auth.passwords import password_problem
    _pw_problem = password_problem(inp.new_password)
    if _pw_problem:
        raise HTTPException(status_code=400, detail=_pw_problem)
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
    tenant = await db.tenants.find_one({"id": tenant_id}, TENANT_PUBLIC)
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
