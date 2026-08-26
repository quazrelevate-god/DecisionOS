"""Epic 8 Sprint 2 — unit tests for core/security.py (auth primitives).

Password hashing, JWT tokens, and auth/CSRF/admin cookies. In-process, no db
(get_platform_admin, the one db-bound function here, is covered by the live
login smoke, not this file).
"""
import jwt
from starlette.responses import Response

from config import (
    JWT_SECRET, JWT_ALGORITHM, PLATFORM_ADMIN_JWT_SECRET,
    AUTH_RETURN_TOKEN, AUTH_COOKIE_NAME, CSRF_COOKIE_NAME, ADMIN_COOKIE_NAME,
)
from core.security import (
    hash_password, verify_password, create_token, create_admin_token,
    set_auth_cookie, clear_auth_cookie, set_admin_cookie, login_response,
)


def _set_cookie_headers(resp):
    return [v.decode() for k, v in resp.raw_headers if k == b"set-cookie"]


# --- password hashing ------------------------------------------------------
def test_hash_verify_roundtrip():
    h = hash_password("s3cret!")
    assert h != "s3cret!"                      # not plaintext
    assert verify_password("s3cret!", h) is True
    assert verify_password("wrong", h) is False


def test_verify_password_bad_hash_is_false_not_raise():
    assert verify_password("x", "not-a-bcrypt-hash") is False


# --- JWT tokens ------------------------------------------------------------
def test_create_token_roundtrip_and_claims():
    tok = create_token("u1", "t1", "owner")
    payload = jwt.decode(tok, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    assert payload["sub"] == "u1"
    assert payload["tenant_id"] == "t1"
    assert payload["role"] == "owner"
    assert payload["type"] == "access"
    assert payload["jti"]                       # revocation key present (FIX-003-C)


def test_create_token_unique_jti():
    a = jwt.decode(create_token("u", "t", "r"), JWT_SECRET, algorithms=[JWT_ALGORITHM])
    b = jwt.decode(create_token("u", "t", "r"), JWT_SECRET, algorithms=[JWT_ALGORITHM])
    assert a["jti"] != b["jti"]


def test_admin_token_uses_admin_secret_and_type():
    tok = create_admin_token("admin1")
    payload = jwt.decode(tok, PLATFORM_ADMIN_JWT_SECRET, algorithms=[JWT_ALGORITHM])
    assert payload["sub"] == "admin1"
    assert payload["type"] == "platform_admin"


# --- cookies ---------------------------------------------------------------
def test_set_auth_cookie_also_mints_csrf():
    resp = Response()
    set_auth_cookie(resp, "jwt-token")
    cookies = _set_cookie_headers(resp)
    assert any(c.startswith(AUTH_COOKIE_NAME + "=") for c in cookies)
    assert any(c.startswith(CSRF_COOKIE_NAME + "=") for c in cookies)
    # auth cookie is HttpOnly; csrf cookie is not (frontend must read it)
    auth = next(c for c in cookies if c.startswith(AUTH_COOKIE_NAME + "="))
    assert "httponly" in auth.lower()


def test_set_admin_cookie_sets_admin_and_csrf():
    resp = Response()
    set_admin_cookie(resp, "admin-jwt")
    cookies = _set_cookie_headers(resp)
    assert any(c.startswith(ADMIN_COOKIE_NAME + "=") for c in cookies)
    assert any(c.startswith(CSRF_COOKIE_NAME + "=") for c in cookies)


def test_clear_auth_cookie_deletes_auth_and_csrf():
    resp = Response()
    clear_auth_cookie(resp)
    cookies = _set_cookie_headers(resp)
    # delete_cookie emits a set-cookie with an expiry in the past
    assert any(c.startswith(AUTH_COOKIE_NAME + "=") for c in cookies)
    assert any(c.startswith(CSRF_COOKIE_NAME + "=") for c in cookies)


# --- login response body ---------------------------------------------------
def test_login_response_matches_flag():
    out = login_response("tok", user={"id": "u1"})
    assert out["user"] == {"id": "u1"}
    if AUTH_RETURN_TOKEN:
        assert out.get("token") == "tok"
    else:
        assert "token" not in out


# --- core re-export contract ----------------------------------------------
def test_core_reexports_security():
    import core
    import core.security as cs
    for n in ("hash_password", "verify_password", "create_token",
              "create_admin_token", "set_auth_cookie", "login_response",
              "get_platform_admin"):
        assert getattr(core, n) is getattr(cs, n)
