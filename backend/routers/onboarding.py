"""Onboarding & Operating-System endpoints.

Foundation (db, LLM config, auth deps, helpers) comes from `core` — this module
does NOT import from `server`, so there is no circular dependency.
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from emergentintegrations.llm.chat import LlmChat, UserMessage

from core import (
    db, EMERGENT_LLM_KEY, CLAUDE_KEY, claude_key, LLM_MODEL,
    _extract_json, new_id, logger, DEFAULT_ROLES,
    normalize_os_blueprint, require_perm, log_activity,
)

router = APIRouter(prefix="/api")


class OnboardingSuggestInput(BaseModel):
    industry: str
    company_size: Optional[str] = None
    description: Optional[str] = None


class OSBlueprintGenInput(BaseModel):
    industry: str
    company_size: Optional[str] = None
    description: Optional[str] = None


class OSBlueprintInput(BaseModel):
    workflow_templates: Optional[List[dict]] = None
    operational_task_templates: Optional[List[dict]] = None
    approval_rules: Optional[List[dict]] = None


@router.post("/onboarding/suggest")
async def onboarding_suggest(inp: OnboardingSuggestInput):
    system = (
        "You are an onboarding assistant for DecisionOS, a business operations app. "
        "Given an industry, propose the team roles/departments and example products or services a small business in that "
        "industry would have. Return ONLY valid JSON, no prose: "
        "{\"roles\": [{\"key\": lowercase_snake_case_slug, \"label\": Human Readable}], "
        "\"products\": [{\"name\": string, \"description\": short string}]}. "
        "Provide 3-6 roles (do NOT include 'owner' — it is implicit) and 3-5 example products/services. Keep it specific to the industry."
    )
    prompt = f"Industry: {inp.industry}\nCompany size: {inp.company_size or 'unspecified'}\nExtra notes: {inp.description or 'none'}\nSuggest roles and example products/services now."
    chat = LlmChat(api_key=claude_key(), session_id=f"onboard-{new_id()}", system_message=system).with_model(*LLM_MODEL)
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
async def onboarding_os_blueprint(inp: OSBlueprintGenInput):
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
    chat = LlmChat(api_key=claude_key(), session_id=f"osbp-{new_id()}", system_message=system).with_model(*LLM_MODEL)
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
    if inp.workflow_templates is not None:
        updates["workflow_templates"] = [{"name": (w.get("name") or "").strip()} for w in inp.workflow_templates if (w.get("name") or "").strip()]
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
