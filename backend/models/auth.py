"""Authentication request schemas (Epic 8 Sprint 5 -- consolidated from
server.py + routers/auth.py).

Registration, password login, workspace switch, 2FA (TOTP), ownership transfer,
profile/password updates, email-verify + password-reset, and phone-OTP shapes.
RoleItem / ProductItem are reused from models.tenant (deduped in S5).
"""
from typing import List, Optional

from pydantic import BaseModel, EmailStr, Field

from models.tenant import RoleItem, ProductItem  # noqa: F401  (re-exported for callers)


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


# Phone-OTP login shapes (moved out of server.py in U8-05.1).
class OtpRequestInput(BaseModel):
    phone: str
    # FIX-003-A (S2-03): tenant hint. Optional so the single-tenant fast
    # path stays backward-compatible; required when the phone is
    # registered in more than one workspace (the request returns
    # {"ambiguous": true, "choices": [...]} in that case and the
    # frontend re-sends with tenant_id filled in).
    tenant_id: Optional[str] = None


class OtpVerifyInput(BaseModel):
    phone: str
    code: str
    # FIX-003-A (S2-03): tenant hint. Same rules as OtpRequestInput —
    # the OTP code is keyed by (phone, tenant_id) so verifying without
    # a tenant on a multi-tenant phone is a 409.
    tenant_id: Optional[str] = None
