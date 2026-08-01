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

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, EmailStr, Field

from core import (
    db, get_current_user, hash_password, verify_password, create_token,
    set_auth_cookie, clear_auth_cookie, set_usage_tenant, new_id, now_iso,
)


router = APIRouter(prefix="/api/auth")


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
    company_name: str
    name: str
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


class LoginInput(BaseModel):
    email: EmailStr
    password: str


class ProfileUpdateInput(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    language: Optional[str] = None


class ChangePasswordInput(BaseModel):
    current_password: str
    new_password: str = Field(min_length=6)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@router.post("/register")
async def register(inp: RegisterInput, response: Response):
    # Deferred to break the server.py ↔ routers/auth.py cycle.
    from server import (
        normalize_os_blueprint, ai_generate_lexicon, ai_generate_operating_model,
        ai_generate_finance_categories,
    )
    from core import DEFAULT_ROLES

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
        "lexicon": await ai_generate_lexicon(inp.industry, inp.company_size, clean_roles, inp.description or ""),
        "operating_model": await ai_generate_operating_model(inp.industry, inp.company_size, clean_roles, inp.description or ""),
        "finance_categories": await ai_generate_finance_categories(inp.industry, inp.company_size, clean_roles, inp.description or ""),
        "created_at": now_iso(),
    }
    await db.tenants.insert_one(tenant_doc)
    user_id = new_id()
    await db.users.insert_one({
        "id": user_id, "tenant_id": tenant_id, "name": inp.name, "email": email,
        "phone": (inp.phone or "").strip(),
        "password_hash": hash_password(inp.password), "role": "owner", "created_at": now_iso(),
    })
    token = create_token(user_id, tenant_id, "owner")
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    tenant = await db.tenants.find_one({"id": tenant_id}, {"_id": 0})
    set_auth_cookie(response, token)
    os_summary = {
        "departments": len(clean_roles),
        "workflows": len(tenant_doc["workflow_templates"]),
        "operational_tasks": len(tenant_doc["operational_task_templates"]),
        "approval_rules": len(tenant_doc["approval_rules"]),
    }
    return {"token": token, "user": user, "tenant": tenant, "os_summary": os_summary}


@router.post("/login")
async def login(inp: LoginInput, response: Response):
    email = inp.email.lower()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(inp.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_token(user["id"], user["tenant_id"], user["role"])
    tenant = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})
    user.pop("_id", None)
    user.pop("password_hash", None)
    set_auth_cookie(response, token)
    return {"token": token, "user": user, "tenant": tenant}


@router.post("/logout")
async def logout(response: Response):
    clear_auth_cookie(response)
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
        updates["phone"] = inp.phone.strip()
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
