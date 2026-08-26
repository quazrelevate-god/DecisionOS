"""Auth primitives: password hashing, JWT tokens, auth/CSRF/admin cookies.

Extracted from core.py (Epic 8 Sprint 2). core re-exports every name here.
The only db-touching function is get_platform_admin (platform-admin auth
dependency); the tenant-user dependency get_current_user stays in core.
"""
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional

import bcrypt
import jwt
from fastapi import Request, Response, Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from database import db
from config import (
    CSRF_COOKIE_NAME, AUTH_COOKIE_NAME, AUTH_COOKIE_MAX_AGE, ADMIN_COOKIE_NAME,
    AUTH_RETURN_TOKEN, JWT_SECRET, JWT_ALGORITHM, PLATFORM_ADMIN_JWT_SECRET,
)


# Bearer scheme shared by the auth dependencies (get_current_user in core,
# get_platform_admin below). Named bearer_scheme (not `security`) so it doesn't
# shadow the core.security module in the package namespace.
bearer_scheme = HTTPBearer(auto_error=False)


def _mint_csrf_token() -> str:
    """Random URL-safe token. Uses secrets.token_urlsafe for cryptographic
    strength — CSRF tokens must be unpredictable per session."""
    import secrets
    return secrets.token_urlsafe(32)


def set_csrf_cookie(response: Response, token: str = None) -> str:
    """FIX-006-B (S0-02): set the double-submit CSRF cookie.

    Called by set_auth_cookie / set_admin_cookie so every login,
    register, switch-workspace, 2fa-verify, and OTP-verify path mints
    a fresh token. NOT HttpOnly — the frontend needs JS access to
    read it and echo it back as X-CSRF-Token.

    Returns the token so callers can also embed it in the response
    body when they need to (e.g. for tests, or future native clients
    that never see cookies)."""
    tok = token or _mint_csrf_token()
    response.set_cookie(
        key=CSRF_COOKIE_NAME, value=tok, max_age=AUTH_COOKIE_MAX_AGE,
        httponly=False, secure=True, samesite="none", path="/",
    )
    return tok


def clear_csrf_cookie(response: Response) -> None:
    response.delete_cookie(key=CSRF_COOKIE_NAME, path="/",
                             samesite="none", secure=True, httponly=False)


def set_auth_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=AUTH_COOKIE_NAME, value=token, max_age=AUTH_COOKIE_MAX_AGE,
        httponly=True, secure=True, samesite="none", path="/",
    )
    # FIX-006-B (S0-02): mint CSRF token alongside the auth token so
    # every cookie-authed browser session has a matching double-submit
    # token available. No extra call site to update — every set_auth_cookie
    # caller inherits this for free.
    set_csrf_cookie(response)


def clear_auth_cookie(response: Response) -> None:
    response.delete_cookie(key=AUTH_COOKIE_NAME, path="/", samesite="none", secure=True, httponly=True)
    # FIX-006-B (S0-02): drop the CSRF cookie too so a stale one from a
    # previous session can't cross-contaminate the next login.
    clear_csrf_cookie(response)


def login_response(token: str, /, **body) -> dict:
    """FIX-006-A (S0-08): build a login/register/switch-workspace response
    body. The HttpOnly cookie is already the source of truth for auth;
    embedding the raw JWT in the JSON body means any XSS bypasses
    HttpOnly. In prod (`AUTH_RETURN_TOKEN=False`) we omit it entirely.
    Left on in dev/test so the ~50 legacy bearer-header integration
    tests keep working locally; explicit `AUTH_RETURN_TOKEN=1` in env
    also opts back in.

    Callers still call `set_auth_cookie(response, token)` themselves —
    this helper only shapes the JSON body.
    """
    if AUTH_RETURN_TOKEN:
        return {"token": token, **body}
    return dict(body)


def create_admin_token(admin_id: str) -> str:
    # FIX-006-A (S0-09): sign platform-admin tokens with a dedicated
    # secret so a leak of JWT_SECRET (tenant secret) can't forge admin
    # sessions. Falls back to JWT_SECRET when PLATFORM_ADMIN_JWT_SECRET
    # is unset — dev-friendly; prod must set both to distinct values.
    payload = {
        "sub": admin_id, "type": "platform_admin",
        "exp": datetime.now(timezone.utc) + timedelta(days=7),
    }
    return jwt.encode(payload, PLATFORM_ADMIN_JWT_SECRET, algorithm=JWT_ALGORITHM)


def set_admin_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=ADMIN_COOKIE_NAME, value=token, max_age=AUTH_COOKIE_MAX_AGE,
        httponly=True, secure=True, samesite="none", path="/",
    )
    # FIX-006-B (S0-02): admin console needs CSRF too — mint the same
    # cookie so the admin frontend's mutating calls carry the header.
    set_csrf_cookie(response)


def clear_admin_cookie(response: Response) -> None:
    response.delete_cookie(key=ADMIN_COOKIE_NAME, path="/", samesite="none", secure=True, httponly=True)
    clear_csrf_cookie(response)


async def get_platform_admin(
    request: Request,
    creds: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
) -> dict:
    token = request.cookies.get(ADMIN_COOKIE_NAME) or (creds.credentials if creds else None)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    # FIX-006-A (S0-09): verify with the admin-scoped secret. Falls back
    # to JWT_SECRET when unset so dev/test flows keep working; the
    # `type == platform_admin` claim remains as a second gate either way.
    try:
        payload = jwt.decode(token, PLATFORM_ADMIN_JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session expired, please log in again")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    if payload.get("type") != "platform_admin":
        raise HTTPException(status_code=403, detail="Not a platform admin")
    admin = await db.platform_admins.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
    if not admin:
        raise HTTPException(status_code=401, detail="Admin not found")
    return admin


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def create_token(user_id: str, tenant_id: str, role: str) -> str:
    # FIX-003-C (S2-06): every token gets a random jti. On logout the
    # server records this jti in db.revoked_tokens; get_current_user
    # checks membership before honoring the token. Without a jti the
    # session-revocation table has no key to work on, so this is a
    # HARD requirement for the fix — do not remove the field.
    payload = {
        "sub": user_id, "tenant_id": tenant_id, "role": role,
        "jti": str(uuid.uuid4()),
        "exp": datetime.now(timezone.utc) + timedelta(days=7), "type": "access",
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
