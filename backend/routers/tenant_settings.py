"""Tenant settings endpoints (Epic 8 Sprint 3 -- extracted from server.py).

The Settings surface: business vocabulary (lexicon), operating model, finance
categories, tenant profile, roles + permissions, AI consent, usage/plan,
per-tenant AI keys, owner exclusions, audit log, and invites. AI-generation
helpers (ai_generate_*, backfill_operating_model, normalize_finance_categories)
and a few shared models stay in server; services are deferred-imported.
"""
import re
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from core import (
    db, get_current_user, require_perm, require_role, user_perms, clean_perms,
    tenant_role_keys, PERMISSION_KEYS, DEFAULT_ROLES, now_iso, log_activity, logger,
    normalize_lexicon, normalize_operating_model,
)
from models.tenant import TenantUpdateInput, InviteInput
from services.ai.generators import (
    ai_generate_lexicon, ai_generate_operating_model, ai_generate_finance_categories,
    backfill_operating_model, normalize_finance_categories,
)

router = APIRouter(prefix="/api")




# Request models consolidated into models/ (Epic 8 Sprint 5).
from models.tenant import (
    LexiconInput,
    OperatingModelInput,
    FinanceCategoriesInput,
    TenantSettingsInput,
    RoleLabelInput,
    RolePermissionsInput,
    AiConsentGrantInput,
    TenantAIKeysInput,
    OwnerExclusionsInput,
)
from models.auth import ProfileUpdateInput, ChangePasswordInput  # deduped (S5)


@router.patch("/tenant/lexicon")
async def update_lexicon(inp: LexiconInput, user: dict = Depends(require_perm("team_manage"))):
    """Owner-edit the industry vocabulary (customer/vendor words, workflow & task-type labels)."""
    lex = normalize_lexicon(inp.lexicon or {})
    await db.tenants.update_one({"id": user["tenant_id"]}, {"$set": {"lexicon": lex}})
    await log_activity(user["tenant_id"], user["id"], "lexicon_updated", f"{user['name']} updated the business vocabulary")
    return await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})


@router.post("/tenant/lexicon/regenerate")
async def regenerate_lexicon(user: dict = Depends(require_perm("team_manage"))):
    """Re-run AI to regenerate the industry vocabulary from the workspace's industry."""
    tenant = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})
    if not tenant:
        raise HTTPException(status_code=404, detail="Workspace not found")
    lex = await ai_generate_lexicon(tenant.get("industry"), tenant.get("company_size"), tenant.get("roles"), tenant.get("description") or "")
    await db.tenants.update_one({"id": user["tenant_id"]}, {"$set": {"lexicon": lex}})
    await log_activity(user["tenant_id"], user["id"], "lexicon_regenerated", f"{user['name']} regenerated the business vocabulary")
    return await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})




@router.patch("/tenant/operating-model")
async def update_operating_model(inp: OperatingModelInput, user: dict = Depends(require_perm("team_manage"))):
    """Owner-edit the operating model (workflow pipelines + stages + task categories)."""
    om = normalize_operating_model(inp.operating_model or {})
    await db.tenants.update_one({"id": user["tenant_id"]}, {"$set": {"operating_model": om}})
    await log_activity(user["tenant_id"], user["id"], "operating_model_updated", f"{user['name']} updated the operating model")
    return await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})


@router.post("/tenant/operating-model/regenerate")
async def regenerate_operating_model(user: dict = Depends(require_perm("team_manage"))):
    """Re-run AI to regenerate the operating model, preserving any pipeline/category with data."""
    tenant = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})
    if not tenant:
        raise HTTPException(status_code=404, detail="Workspace not found")
    # FIX-003-C (S2-11): track success/failure. Prior code called
    # backfill_operating_model directly, so a silent AI degradation
    # (timeout, malformed JSON, empty pipelines) left the tenant with
    # a defaulted operating model and no visible signal that anything
    # went wrong — the founder just saw "Regenerate" click, spinner,
    # and the same-looking board. Now we route through the status-
    # aware wrapper and update ai_setup_status.operating_model so the
    # frontend can surface "AI setup incomplete — click to retry."
    from services.ai import ai_setup as ai_setup_svc
    om, om_status = await ai_setup_svc.ai_generate_operating_model_with_status(
        tenant.get("industry") or "General",
        tenant.get("company_size") or "",
        tenant.get("roles") or DEFAULT_ROLES,
        tenant.get("description") or "",
    )
    # Preserve any pipeline/category the tenant has already customized:
    # if the AI succeeded, prefer its output; otherwise keep the existing
    # operating_model rather than clobbering it with a default. That's
    # the exact behavior founders expect from a "Regenerate" button.
    updates: dict = {}
    if om_status == ai_setup_svc.STATUS_GENERATED:
        # Merge over the existing so pipelines the AI didn't touch survive.
        merged = await backfill_operating_model({**tenant, "operating_model": om})
        updates["operating_model"] = merged
    status_map = dict(tenant.get("ai_setup_status") or {})
    status_map["operating_model"] = om_status
    updates["ai_setup_status"] = status_map
    await db.tenants.update_one({"id": user["tenant_id"]}, {"$set": updates})
    await log_activity(user["tenant_id"], user["id"], "operating_model_regenerated",
                       f"{user['name']} regenerated the operating model ({om_status})")
    out = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})
    # Surface the status so the frontend can prompt retry if needed
    # WITHOUT needing a second /me round-trip.
    out["ai_setup_status_summary"] = ai_setup_svc.summarize_ai_setup_status(status_map)
    return out




@router.patch("/tenant/finance-categories")
async def update_finance_categories(inp: FinanceCategoriesInput, user: dict = Depends(require_perm("team_manage"))):
    """Owner-edit the per-company finance categories (expense + fixed-asset buckets)."""
    fc = normalize_finance_categories(inp.finance_categories or {})
    await db.tenants.update_one({"id": user["tenant_id"]}, {"$set": {"finance_categories": fc}})
    await log_activity(user["tenant_id"], user["id"], "finance_categories_updated", f"{user['name']} updated the finance categories")
    return await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})


@router.post("/tenant/finance-categories/regenerate")
async def regenerate_finance_categories(user: dict = Depends(require_perm("team_manage"))):
    """Re-run AI to regenerate the finance categories from the workspace's industry."""
    tenant = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})
    if not tenant:
        raise HTTPException(status_code=404, detail="Workspace not found")
    # FIX-003-C (S2-11): use the status-tracking wrapper so a defaulted
    # AI result updates ai_setup_status.finance_categories instead of
    # silently clobbering the existing categories with a default map.
    from services.ai import ai_setup as ai_setup_svc
    fc, fc_status = await ai_setup_svc.ai_generate_finance_categories_with_status(
        tenant.get("industry") or "General",
        tenant.get("company_size") or "",
        tenant.get("roles") or DEFAULT_ROLES,
        tenant.get("description") or "",
    )
    updates: dict = {}
    if fc_status == ai_setup_svc.STATUS_GENERATED:
        updates["finance_categories"] = fc
    status_map = dict(tenant.get("ai_setup_status") or {})
    status_map["finance_categories"] = fc_status
    updates["ai_setup_status"] = status_map
    await db.tenants.update_one({"id": user["tenant_id"]}, {"$set": updates})
    await log_activity(user["tenant_id"], user["id"], "finance_categories_regenerated",
                       f"{user['name']} regenerated the finance categories ({fc_status})")
    out = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})
    out["ai_setup_status_summary"] = ai_setup_svc.summarize_ai_setup_status(status_map)
    return out









@router.patch("/tenant")
async def update_tenant(inp: TenantUpdateInput, user: dict = Depends(require_perm("team_manage"))):
    updates = {}
    for f in ["name", "industry", "company_size", "region", "gst", "phone", "branches"]:
        v = getattr(inp, f)
        if v is not None:
            updates[f] = v.strip() if isinstance(v, str) else v
    if inp.currency is not None:
        updates["currency"] = inp.currency.strip().upper()
    if inp.products is not None:
        updates["products"] = [p.model_dump() for p in inp.products if (p.name or "").strip()]
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")
    await db.tenants.update_one({"id": user["tenant_id"]}, {"$set": updates})
    await log_activity(user["tenant_id"], user["id"], "company_updated", f"{user['name']} updated company details")
    return await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})




@router.patch("/tenant/settings")
async def update_tenant_settings(inp: TenantSettingsInput, user: dict = Depends(require_role("owner"))):
    updates = {}
    if inp.high_value_threshold is not None:
        if inp.high_value_threshold < 0:
            raise HTTPException(status_code=400, detail="Threshold must be a positive amount")
        updates["high_value_threshold"] = float(inp.high_value_threshold)
    if inp.require_owner_signoff is not None:
        updates["require_owner_signoff"] = bool(inp.require_owner_signoff)
    if inp.currency is not None:
        updates["currency"] = inp.currency.strip().upper()
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")
    await db.tenants.update_one({"id": user["tenant_id"]}, {"$set": updates})
    await log_activity(user["tenant_id"], user["id"], "settings_updated", f"{user['name']} updated workspace settings")
    return await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})



def _slug_role(label: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", (label or "").strip().lower()).strip("_")




@router.post("/tenant/roles")
async def add_role(inp: RoleLabelInput, user: dict = Depends(require_perm("team_manage"))):
    label = (inp.label or "").strip()
    key = _slug_role(label)
    if not label or not key or key == "owner":
        raise HTTPException(status_code=400, detail="Enter a valid role name")
    t = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0, "roles": 1})
    roles = (t or {}).get("roles") or []
    if any(r.get("key") == key for r in roles):
        raise HTTPException(status_code=400, detail="A role with this name already exists")
    roles.append({"key": key, "label": label})
    await db.tenants.update_one({"id": user["tenant_id"]}, {"$set": {"roles": roles}})
    await log_activity(user["tenant_id"], user["id"], "role_added", f"{user['name']} added the role '{label}'")
    return await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})


@router.patch("/tenant/roles/{key}")
async def rename_role(key: str, inp: RoleLabelInput, user: dict = Depends(require_perm("team_manage"))):
    label = (inp.label or "").strip()
    if not label:
        raise HTTPException(status_code=400, detail="Enter a valid role name")
    if key == "owner":
        raise HTTPException(status_code=400, detail="The Owner role can't be renamed")
    t = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0, "roles": 1})
    roles = (t or {}).get("roles") or []
    if not any(r.get("key") == key for r in roles):
        raise HTTPException(status_code=404, detail="Role not found")
    for r in roles:
        if r.get("key") == key:
            r["label"] = label
    await db.tenants.update_one({"id": user["tenant_id"]}, {"$set": {"roles": roles}})
    await log_activity(user["tenant_id"], user["id"], "role_renamed", f"{user['name']} renamed a role to '{label}'")
    return await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})


@router.delete("/tenant/roles/{key}")
async def delete_role(key: str, user: dict = Depends(require_perm("team_manage"))):
    if key == "owner":
        raise HTTPException(status_code=400, detail="The Owner role can't be deleted")
    t = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0, "roles": 1})
    roles = (t or {}).get("roles") or []
    if not any(r.get("key") == key for r in roles):
        raise HTTPException(status_code=404, detail="Role not found")
    in_use = await db.users.count_documents({"tenant_id": user["tenant_id"], "role": key})
    if in_use:
        raise HTTPException(status_code=400, detail=f"This role has {in_use} member(s) assigned. Reassign them to another role before deleting.")
    new_roles = [r for r in roles if r.get("key") != key]
    await db.tenants.update_one({"id": user["tenant_id"]}, {"$set": {"roles": new_roles}})
    await log_activity(user["tenant_id"], user["id"], "role_deleted", f"{user['name']} deleted a role")
    return await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})


# FIX-004-D (RBAC-14): per-role permission editor. Tenant-level roles
# can now carry a permissions[] list — every member holding that role
# picks up those perms via user_perms(). Was previously impossible:
# creating a 'warehouse_manager' role gave every member _BASE_PERMS
# only, and the only way to add e.g. 'finance' was editing each user
# individually.


@router.patch("/tenant/roles/{key}/permissions")
async def update_role_permissions(key: str, inp: RolePermissionsInput,
                                    user: dict = Depends(require_perm("team_manage"))):
    """Set the permission list for a tenant-defined role. Unknown
    permission keys are silently dropped (clean_perms filters to
    PERMISSION_KEYS). Owner role is reserved — its perms come from the
    all-perms shortcut minus owner_exclusions."""
    if key == "owner":
        raise HTTPException(
            status_code=400,
            detail="The Owner role's permissions are managed via owner-exclusions, not per-role.",
        )
    t = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0, "roles": 1})
    roles = (t or {}).get("roles") or []
    if not any(r.get("key") == key for r in roles):
        raise HTTPException(status_code=404, detail="Role not found")
    perms = clean_perms(inp.permissions)
    for r in roles:
        if r.get("key") == key:
            r["permissions"] = perms
    await db.tenants.update_one({"id": user["tenant_id"]}, {"$set": {"roles": roles}})
    await log_activity(
        user["tenant_id"], user["id"], "role_permissions_updated",
        f"{user['name']} updated permissions on role '{key}' to {len(perms)} perm(s)",
    )
    return await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})


# FIX-005-C (RBAC-25): DPDP AI-consent tracking endpoints.


@router.get("/tenant/ai-consent")
async def get_ai_consent(user: dict = Depends(get_current_user)):
    """Consent status readable by any member — the frontend needs it
    to decide whether to show the consent modal (owner) or a
    'consent pending' banner (non-owner)."""
    from services.ai_consent import consent_status
    tenant = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0, "ai_consent": 1})
    return consent_status(tenant or {})


@router.post("/tenant/ai-consent")
async def grant_ai_consent(inp: AiConsentGrantInput, request: Request,
                             user: dict = Depends(require_role("owner"))):
    """Grant DPDP AI-processing consent. Owner-only — non-owners can't
    obligate the workspace to AI processing on their behalf.

    Captures actor + IP + UA so a regulator can verify who granted
    when. Emits an audit_log row so the compliance timeline has an
    immutable record.
    """
    from services import ai_consent as _consent
    from services import audit_log as _audit
    ip = (request.headers.get("X-Forwarded-For") or "").split(",")[0].strip() or (
        request.headers.get("X-Real-IP") or "").strip() or (
        request.client.host if request.client else None)
    ua = request.headers.get("User-Agent") or None
    payload = _consent.build_grant_payload(
        actor_user_id=user["id"],
        actor_email=user.get("email") or "",
        ip=ip, ua=ua,
        version=inp.version or _consent.CURRENT_CONSENT_VERSION,
    )
    await db.tenants.update_one(
        {"id": user["tenant_id"]},
        {"$set": {"ai_consent": payload, "updated_at": now_iso()}},
    )
    _ctx = _audit.context_from(request, user)
    await _audit.record(
        db, action="tenant_ai_consent_granted",
        entity_type="tenant", entity_id=user["tenant_id"],
        after={"version": payload["version"]},
        **_ctx,
    )
    await log_activity(
        user["tenant_id"], user["id"], "ai_consent_granted",
        f"{user['name']} granted AI-processing consent (v{payload['version']})",
    )
    return _consent.consent_status(
        await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0, "ai_consent": 1})
    )


@router.delete("/tenant/ai-consent")
async def revoke_ai_consent(request: Request,
                              user: dict = Depends(require_role("owner"))):
    """Revoke previously-granted consent. Preserves the grant record
    (granted_at + granting user's identity) — just flips revoked_at
    so the audit trail stays intact.

    All AI features become 451 immediately for this tenant.
    """
    from services import ai_consent as _consent
    from services import audit_log as _audit
    tenant = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0, "ai_consent": 1})
    if not tenant or not (tenant.get("ai_consent") or {}).get("granted_at"):
        raise HTTPException(status_code=400, detail="No active AI consent to revoke")
    await db.tenants.update_one(
        {"id": user["tenant_id"]},
        {"$set": _consent.build_revoke_patch(), "updated_at": now_iso()},
    )
    _ctx = _audit.context_from(request, user)
    await _audit.record(
        db, action="tenant_ai_consent_revoked",
        entity_type="tenant", entity_id=user["tenant_id"],
        before={"granted_at": (tenant.get("ai_consent") or {}).get("granted_at")},
        **_ctx,
    )
    await log_activity(
        user["tenant_id"], user["id"], "ai_consent_revoked",
        f"{user['name']} revoked AI-processing consent",
    )
    return _consent.consent_status(
        await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0, "ai_consent": 1})
    )


# FIX-005-B (S3-04): monthly usage dashboard read endpoint.
@router.get("/tenant/usage")
async def get_tenant_usage(user: dict = Depends(get_current_user)):
    """Return every quota resource with current usage + cap + percent.
    Powers the frontend usage panel — badges at 75%/90%/100%. Every
    logged-in member can read; hides no sensitive info.

    Aggregation window = current UTC calendar month. Resets on the 1st.
    """
    from services.quotas import quota_status_all
    tenant = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})
    return {"quotas": await quota_status_all(db, tenant or {"id": user["tenant_id"]})}


# FIX-005-A (S3-02): plan / entitlement read endpoint.
@router.get("/tenant/plan")
async def get_tenant_plan(user: dict = Depends(get_current_user)):
    """Return the tenant's current effective plan (base plan defaults
    merged with tenant-level overrides). Every logged-in member can
    read this — frontend uses it to decide whether to show upgrade
    prompts, disabled features, seat-count badges."""
    from services.plans import effective_plan
    tenant = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})
    if not tenant:
        raise HTTPException(status_code=404, detail="Workspace not found")
    ep = effective_plan(tenant)
    # Include seats_used so the UI can render "X of Y seats used"
    # without a second round trip.
    from services.auth.membership import list_memberships_for_tenant, LIVE_STATUSES
    active = await list_memberships_for_tenant(
        db, user["tenant_id"], statuses=LIVE_STATUSES,
    )
    ep["seats_used"] = len(active)
    return ep


# FIX-005-A (S3-03): per-tenant AI key endpoints.


@router.get("/tenant/ai-keys")
async def get_tenant_ai_keys(user: dict = Depends(require_role("owner"))):
    """Owner-only: list all providers with tenant-key presence + a
    masked preview of the actual key. Never returns the full secret.
    Fallback to platform pool is indicated by source='platform'."""
    from services.tenant_ai_keys import summarize_tenant_ai_keys
    tenant = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})
    return {"providers": summarize_tenant_ai_keys(tenant)}


@router.put("/tenant/ai-keys")
async def put_tenant_ai_keys(inp: TenantAIKeysInput, request: Request,
                               user: dict = Depends(require_role("owner"))):
    """Owner-only: replace the tenant.ai_keys map wholesale. Unknown
    providers dropped by normalize_ai_key_map. Emits audit log for
    each provider whose key was added / rotated / removed."""
    from services.tenant_ai_keys import (
        normalize_ai_key_map, CUSTOMIZABLE_PROVIDERS,
    )
    from services import audit_log as _audit
    tenant = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})
    if not tenant:
        raise HTTPException(status_code=404, detail="Workspace not found")
    old_keys = tenant.get("ai_keys") or {}
    new_keys = normalize_ai_key_map(inp.keys)
    await db.tenants.update_one(
        {"id": user["tenant_id"]}, {"$set": {"ai_keys": new_keys,
                                              "updated_at": now_iso()}},
    )
    # Audit each provider whose presence changed. Never log the value.
    _ctx = _audit.context_from(request, user)
    for p in CUSTOMIZABLE_PROVIDERS:
        had_old = bool((old_keys.get(p) or "").strip()) if isinstance(old_keys.get(p), str) else False
        has_new = bool((new_keys.get(p) or "").strip())
        if had_old != has_new or (had_old and has_new and old_keys.get(p) != new_keys.get(p)):
            await _audit.record(
                db, action="ai_key_updated",
                entity_type="tenant", entity_id=user["tenant_id"],
                meta={"provider": p, "had_old": had_old, "has_new": has_new,
                       "was_rotated": had_old and has_new and old_keys.get(p) != new_keys.get(p)},
                **_ctx,
            )
    await log_activity(
        user["tenant_id"], user["id"], "ai_keys_updated",
        f"{user['name']} updated AI keys ({len(new_keys)} provider(s) set)",
    )
    from services.tenant_ai_keys import summarize_tenant_ai_keys
    tenant = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})
    return {"providers": summarize_tenant_ai_keys(tenant)}


@router.delete("/tenant/ai-keys/{provider}")
async def delete_tenant_ai_key(provider: str, request: Request,
                                 user: dict = Depends(require_role("owner"))):
    """Owner-only: revert one provider back to the platform shared
    pool by removing the tenant's own key for it."""
    from services.tenant_ai_keys import CUSTOMIZABLE_PROVIDERS
    from services import audit_log as _audit
    if provider not in CUSTOMIZABLE_PROVIDERS:
        raise HTTPException(status_code=400, detail=f"Unknown provider {provider!r}")
    tenant = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})
    keys = dict((tenant or {}).get("ai_keys") or {})
    had_it = bool((keys.get(provider) or "").strip()) if isinstance(keys.get(provider), str) else False
    keys.pop(provider, None)
    await db.tenants.update_one(
        {"id": user["tenant_id"]}, {"$set": {"ai_keys": keys, "updated_at": now_iso()}},
    )
    if had_it:
        _ctx = _audit.context_from(request, user)
        await _audit.record(
            db, action="ai_key_updated",
            entity_type="tenant", entity_id=user["tenant_id"],
            meta={"provider": provider, "removed": True},
            **_ctx,
        )
        await log_activity(
            user["tenant_id"], user["id"], "ai_keys_updated",
            f"{user['name']} removed the tenant-level {provider} key",
        )
    from services.tenant_ai_keys import summarize_tenant_ai_keys
    tenant = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})
    return {"providers": summarize_tenant_ai_keys(tenant)}


# FIX-004-D (RBAC-15): owner exclusion list. Lets a tenant opt an
# owner OUT of specific permissions. Solves the "co-founder with
# everything EXCEPT finance visibility" ask that early-stage founders
# make. Empty list = classic all-perms owner (backward compat).


@router.put("/tenant/owner-exclusions")
async def update_owner_exclusions(inp: OwnerExclusionsInput, request: Request,
                                    user: dict = Depends(require_role("owner"))):
    """Set the list of permission keys owner(s) do NOT get. Owner-only:
    a non-owner cannot restrict what owners can see. `owner` role
    itself cannot be excluded — the exclusion applies to specific
    permissions, not the role."""
    from services import audit_log as _audit
    tenant_before = await db.tenants.find_one(
        {"id": user["tenant_id"]}, {"_id": 0, "owner_exclusions": 1},
    )
    excl = clean_perms(inp.exclusions)
    await db.tenants.update_one(
        {"id": user["tenant_id"]}, {"$set": {"owner_exclusions": excl}},
    )
    await log_activity(
        user["tenant_id"], user["id"], "owner_exclusions_updated",
        f"{user['name']} set owner exclusions to {excl}",
    )
    # FIX-004-F (RBAC-20): audit-log the change — owner-exclusion
    # edits are exactly the compliance events the audit table exists
    # for. before/after captures the exact permission-scope shift.
    _ctx = _audit.context_from(request, user)
    await _audit.record(
        db, action="owner_exclusions_updated",
        entity_type="tenant", entity_id=user["tenant_id"],
        before={"owner_exclusions": (tenant_before or {}).get("owner_exclusions") or []},
        after={"owner_exclusions": excl},
        **_ctx,
    )
    return await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})


# FIX-004-F (RBAC-20): owner-facing audit-log read endpoint.
# Read-only — this API deliberately does NOT expose update/delete
# on audit rows. Tampering the log requires DB-level access.
@router.get("/admin/audit-log")
async def read_audit_log(
    request: Request,
    action: Optional[str] = None,
    actor_id: Optional[str] = None,
    entity_type: Optional[str] = None,
    entity_id: Optional[str] = None,
    since_ts: Optional[str] = None,
    before_ts: Optional[str] = None,
    limit: int = 100,
    user: dict = Depends(require_role("owner")),
):
    """Read the tenant's audit log. Owner-only.

    Query params act as filters — omit for the full recent-first list.
    `before_ts` pages older entries (pass the timestamp of the last row
    returned). `limit` capped at 500 by the service to keep responses
    bounded.
    """
    from services import audit_log as _audit
    filters = {}
    if action:
        filters["action"] = action
    if actor_id:
        filters["actor_id"] = actor_id
    if entity_type:
        filters["entity_type"] = entity_type
    if entity_id:
        filters["entity_id"] = entity_id
    if since_ts:
        filters["since_ts"] = since_ts
    rows = await _audit.query(
        db, tenant_id=user["tenant_id"],
        filters=filters, limit=limit, before_ts=before_ts,
    )
    return {"rows": rows, "count": len(rows)}


@router.get("/invites")
async def list_invites(user: dict = Depends(get_current_user)):
    t = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0, "invited_employees": 1})
    return (t or {}).get("invited_employees", [])


@router.post("/invites")
async def add_invites(inp: InviteInput, user: dict = Depends(require_perm("team_manage"))):
    clean = []
    seen = set()
    for p in inp.phones:
        p = (p or "").strip()
        if p and p not in seen:
            seen.add(p)
            clean.append({"phone": p, "status": "pending", "invited_at": now_iso(), "invited_by": user["id"]})
    if clean:
        await db.tenants.update_one({"id": user["tenant_id"]}, {"$push": {"invited_employees": {"$each": clean}}})
        await log_activity(user["tenant_id"], user["id"], "employees_invited",
                           f"Invited {len(clean)} employee(s) — SMS pending", "tenant", user["tenant_id"])
    t = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0, "invited_employees": 1})
    # NOTE: real SMS delivery pending Twilio credentials; invites stored as 'pending'.
    return {"added": len(clean), "invited_employees": (t or {}).get("invited_employees", [])}


# ---------------------------------------------------------------------------
# Team / users
