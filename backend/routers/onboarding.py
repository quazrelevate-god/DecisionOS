"""Onboarding & Operating-System endpoints.

Foundation (db, LLM config, auth deps, helpers) comes from `core` — this module
does NOT import from `server`, so there is no circular dependency.
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from emergentintegrations.llm.chat import LlmChat, UserMessage

from core import (
    db, EMERGENT_LLM_KEY, CLAUDE_KEY, claude_key, claude_chat, LLM_MODEL,
    _extract_json, new_id, now_iso, logger, DEFAULT_ROLES,
    normalize_os_blueprint, require_perm, require_role, log_activity,
    get_current_user,
)
from services.auth import onboarding_drafts as drafts_svc  # FIX-001-D
from services.ai import ai_setup as ai_setup_svc          # FIX-001-D
# FIX-004-A (RBAC Wave 1)
from services.auth.draft_tokens import sign_draft_id, verify_draft_token
from services.rate_limit import (
    check_rate_limit, client_ip,
    guard_unauth_ai_endpoint,  # FIX-006-D (S0-06)
)

router = APIRouter(prefix="/api")


# FIX-004-A (RBAC-01): rate-limit draft creation per IP so an attacker
# can't spin up unlimited draft rows to fill the DB. Sliding window.
_DRAFT_CREATE_LIMIT = (10, 3600)   # 10 create/hour/IP
_DRAFT_ACCESS_LIMIT = (60, 60)     # 60 read-or-patch/min/draft_id — legit
                                     # frontend saves after every keystroke so
                                     # we allow a healthy per-draft ceiling.


async def _require_draft_token(request: Request, draft_id: str) -> None:
    """FIX-004-A (RBAC-01): draft URLs are HMAC-signed. Every GET/PATCH
    must present the token that create_onboarding_draft returned.

    Accepts either:
      * `X-Draft-Token: <token>` header (preferred)
      * `?token=<token>` query param (convenience for browser reloads)

    Missing or mismatched token -> 401. The draft ID alone is NOT
    sufficient authorization anymore.
    """
    token = (request.headers.get("X-Draft-Token")
             or request.query_params.get("token")
             or "")
    if not verify_draft_token(draft_id, token):
        raise HTTPException(
            status_code=401,
            detail=("This draft link is missing or invalid. Ask the browser "
                    "that created the draft to resume it, or start a fresh one."),
        )
    # Per-draft rate limit: a legitimate wizard save cadence is well
    # under 60/min. Anything hotter is scripted.
    ok, retry_after = await check_rate_limit(
        draft_id, _DRAFT_ACCESS_LIMIT[0], _DRAFT_ACCESS_LIMIT[1],
        bucket="draft_access",
    )
    if not ok:
        raise HTTPException(
            status_code=429,
            detail="Too many draft requests. Slow down and retry.",
            headers={"Retry-After": str(retry_after)},
        )








# Request models consolidated into models/ (Epic 8 Sprint 5).
from models.onboarding import (
    OnboardingSuggestInput,
    OSBlueprintGenInput,
    OSBlueprintInput,
    DraftCreateInput,
    DraftPatchInput,
)


@router.post("/onboarding/suggest")
async def onboarding_suggest(inp: OnboardingSuggestInput, request: Request):
    # FIX-006-D (S0-06): unauth endpoint that calls Claude — every hit
    # burns LLM credit. Rate-limit + captcha stop drive-by cost drain.
    await guard_unauth_ai_endpoint(request, service="onboarding", kind="suggest")
    system = (
        "You are an onboarding assistant for DecisionOS, a business operations app. "
        "Given an industry, propose the team roles/departments and example products or services a small business in that "
        "industry would have. Return ONLY valid JSON, no prose: "
        "{\"roles\": [{\"key\": lowercase_snake_case_slug, \"label\": Human Readable}], "
        "\"products\": [{\"name\": string, \"description\": short string}]}. "
        "Provide 3-6 roles (do NOT include 'owner' — it is implicit) and 3-5 example products/services. Keep it specific to the industry."
    )
    prompt = f"Industry: {inp.industry}\nCompany size: {inp.company_size or 'unspecified'}\nExtra notes: {inp.description or 'none'}\nSuggest roles and example products/services now."
    chat = claude_chat(session_id=f"onboard-{new_id()}", system_message=system).with_model(*LLM_MODEL)
    try:
        resp = await chat.send_message(UserMessage(text=prompt))
        data = _extract_json(resp)
    except Exception as e:
        logger.error(f"onboarding_suggest failed: {e}")
        data = {}
    roles = []
    for r in (data.get("roles") or []):
        label = (r.get("label") or r.get("key") or "").strip()
        key = (r.get("key") or label).strip().lower().replace(" ", "_").replace("/", "_").replace("-", "_")
        if key and key != "owner":
            roles.append({"key": key, "label": label or key.replace("_", " ").title()})
    products = []
    for p in (data.get("products") or []):
        name = (p.get("name") or "").strip()
        if name:
            products.append({"name": name, "description": (p.get("description") or "").strip()})
    if not roles:
        roles = DEFAULT_ROLES
    return {"roles": roles[:6], "products": products[:5]}


@router.post("/onboarding/os-blueprint")
async def onboarding_os_blueprint(inp: OSBlueprintGenInput, request: Request):
    # FIX-006-D (S0-06): full-blueprint generation is the most expensive
    # unauth AI call in the codebase (large system + long response).
    # Same 3-check guard as the rest of the pre-auth AI surface.
    await guard_unauth_ai_endpoint(request, service="onboarding", kind="os_blueprint")
    system = (
        "You are the onboarding architect for DecisionOS, an operating system for founder-led SMEs. "
        "Given an industry, design a ready-to-use Business Operating System for a small/mid business. "
        "Return ONLY valid JSON, no prose, with exactly these keys: "
        "{\"departments\": [string department name], "
        "\"workflows\": [{\"name\": string}], "
        "\"operational_tasks\": [{\"title\": string, \"category\": one of "
        "[Presentation,Meeting,Documentation,Proposal,Planning,Review,Administration,Compliance,Marketing,HR Activity,Travel,Event,IT Support,Other]}], "
        "\"approval_rules\": [{\"name\": string, \"description\": short string}]}. "
        "Provide 6-9 departments, 6-12 workflows, 10-15 recurring operational tasks, and 4-8 approval rules. "
        "Make everything concrete and specific to the industry (use its real terminology). Do NOT include an 'Owner' department."
    )
    prompt = f"Industry: {inp.industry}\nCompany size: {inp.company_size or 'unspecified'}\nWhat the business actually does: {inp.description or 'not specified'}\nDesign the operating system now."
    chat = claude_chat(session_id=f"osbp-{new_id()}", system_message=system).with_model(*LLM_MODEL)
    try:
        resp = await chat.send_message(UserMessage(text=prompt))
        data = _extract_json(resp)
    except Exception as e:
        logger.error(f"os_blueprint generation failed: {e}")
        raise HTTPException(status_code=503, detail="Couldn't generate your operating system. Please try again.")
    return normalize_os_blueprint(data or {})


@router.patch("/tenant/os-blueprint")
async def update_os_blueprint(inp: OSBlueprintInput, user: dict = Depends(require_perm("team_manage"))):
    """Edit the generated Operating System templates (workflows, operational tasks, approval rules)."""
    updates = {}
    # WE-02: workflow_templates branch removed (field dropped from input).
    if inp.operational_task_templates is not None:
        updates["operational_task_templates"] = [
            {"title": (t.get("title") or "").strip(), "category": (t.get("category") or "Other").strip() or "Other"}
            for t in inp.operational_task_templates if (t.get("title") or "").strip()
        ]
    if inp.approval_rules is not None:
        updates["approval_rules"] = [
            {"name": (r.get("name") or "").strip(), "description": (r.get("description") or "").strip()}
            for r in inp.approval_rules if (r.get("name") or "").strip()
        ]
    if updates:
        await db.tenants.update_one({"id": user["tenant_id"]}, {"$set": updates})
        await log_activity(user["tenant_id"], user["id"], "os_blueprint_updated", f"{user['name']} updated the operating system templates")
    return await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})


# ============================================================================
# FIX-001-D: Onboarding drafts (pre-registration) + AI setup retry (post)
# ============================================================================






@router.post("/onboarding/draft")
async def create_onboarding_draft(inp: DraftCreateInput, request: Request):
    """Create a server-side onboarding draft. Client keeps the returned
    draft_id + draft_token; every subsequent GET/PATCH must present the
    token in the `X-Draft-Token` header.

    FIX-004-A (RBAC-01): draft URLs used to be world-accessible by ID.
    Now they're HMAC-signed and per-IP rate-limited on creation."""
    ip = client_ip(request)
    ok, retry_after = await check_rate_limit(
        ip, _DRAFT_CREATE_LIMIT[0], _DRAFT_CREATE_LIMIT[1],
        bucket="draft_create",
    )
    if not ok:
        raise HTTPException(
            status_code=429,
            detail="Too many draft creations from this IP. Try again later.",
            headers={"Retry-After": str(retry_after)},
        )
    doc = await drafts_svc.create_draft(db, email=inp.email)
    return {
        "draft_id": doc["id"],
        "draft_token": sign_draft_id(doc["id"]),  # FIX-004-A (RBAC-01)
        "created_at": doc["created_at"],
    }


@router.get("/onboarding/draft/{draft_id}")
async def get_onboarding_draft(draft_id: str, request: Request):
    """Resume from a saved draft. Returns the full draft doc so the client
    can restore every step's inputs.

    FIX-004-A (RBAC-01): requires the draft_token issued at create time."""
    await _require_draft_token(request, draft_id)
    doc = await drafts_svc.get_draft(db, draft_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Draft not found or already completed")
    return doc


@router.patch("/onboarding/draft/{draft_id}")
async def patch_onboarding_draft(draft_id: str, inp: DraftPatchInput, request: Request):
    """Save one wizard step's data onto the draft. Unknown step keys are
    rejected (fail-safe: don't let a client stash arbitrary data).

    FIX-004-A (RBAC-01): requires the draft_token issued at create time."""
    await _require_draft_token(request, draft_id)
    if inp.step not in drafts_svc.VALID_STEP_KEYS:
        raise HTTPException(status_code=400, detail=f"Invalid step '{inp.step}'")
    doc = await drafts_svc.patch_draft(db, draft_id, inp.step, inp.data)
    if not doc:
        raise HTTPException(status_code=404, detail="Draft not found or already completed")
    return doc


@router.post("/tenant/ai-setup/retry")
async def retry_ai_setup(user: dict = Depends(require_role("owner"))):
    """Re-run any AI generators marked `defaulted` or `failed` on this
    tenant. Owner-only. Idempotent: safe to call repeatedly. Uses the
    tenant's stored industry/roles/description as inputs.

    Introduced by FIX-001-D so a founder whose AI setup silently
    fell back to defaults during signup can retry without needing
    admin intervention or starting a new workspace."""
    tenant = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})
    if not tenant:
        raise HTTPException(status_code=404, detail="Workspace not found")

    industry = tenant.get("industry") or "General"
    company_size = tenant.get("company_size") or ""
    roles = tenant.get("roles") or DEFAULT_ROLES
    description = tenant.get("description") or ""

    status_map = dict(tenant.get("ai_setup_status") or {})
    updates = {}

    # Retry lexicon if not already generated
    if status_map.get("lexicon") != ai_setup_svc.STATUS_GENERATED:
        lex, lex_status = await ai_setup_svc.ai_generate_lexicon_with_status(
            industry, company_size, roles, description)
        if lex_status == ai_setup_svc.STATUS_GENERATED:
            updates["lexicon"] = lex
        status_map["lexicon"] = lex_status

    # Retry operating model
    if status_map.get("operating_model") != ai_setup_svc.STATUS_GENERATED:
        om, om_status = await ai_setup_svc.ai_generate_operating_model_with_status(
            industry, company_size, roles, description)
        if om_status == ai_setup_svc.STATUS_GENERATED:
            updates["operating_model"] = om
        status_map["operating_model"] = om_status

    # Retry finance categories
    if status_map.get("finance_categories") != ai_setup_svc.STATUS_GENERATED:
        fc, fc_status = await ai_setup_svc.ai_generate_finance_categories_with_status(
            industry, company_size, roles, description)
        if fc_status == ai_setup_svc.STATUS_GENERATED:
            updates["finance_categories"] = fc
        status_map["finance_categories"] = fc_status

    updates["ai_setup_status"] = status_map
    updates["ai_setup_retried_at"] = now_iso()
    await db.tenants.update_one({"id": user["tenant_id"]}, {"$set": updates})
    await log_activity(user["tenant_id"], user["id"], "ai_setup_retried",
                       f"{user['name']} retried AI setup",
                       "tenant", user["tenant_id"])
    return {
        "status": "ok",
        "ai_setup_status": ai_setup_svc.summarize_ai_setup_status(status_map),
    }


@router.get("/tenant/ai-setup/status")
async def get_ai_setup_status(user: dict = Depends(get_current_user)):
    """Read the AI setup status for the current tenant. Frontend uses
    this to decide whether to show the 'AI setup incomplete, click to
    regenerate' banner."""
    tenant = await db.tenants.find_one({"id": user["tenant_id"]},
                                       {"_id": 0, "ai_setup_status": 1})
    return ai_setup_svc.summarize_ai_setup_status((tenant or {}).get("ai_setup_status") or {})
