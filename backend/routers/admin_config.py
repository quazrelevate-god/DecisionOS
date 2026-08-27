"""Admin console -- feature flags & runtime config (Epic 10 Sprint 6).

No-redeploy runtime config for the super-admin: switch the AI model per task, tune the
Sarvam voice stack, toggle global + per-tenant feature flags, and set plan capabilities /
runtime thresholds. Reads/writes db.platform_config via services.platform_config, which
keeps the sync hot paths (model_for, Sarvam STT) in sync. All writes audited.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core import db, get_platform_admin
from config import MODELS, MODEL_ROUTES, model_for
from services import platform_config as pc
from services.plans import PLAN_KEYS
from routers.admin import log_admin_action

router = APIRouter(prefix="/api/admin")

# Sarvam option surface (see reference_sarvam_stt): saaras models, STT modes, TTS voice.
SARVAM_MODELS = ["saaras:v3", "saaras:v4", "saaras:v2.5"]
SARVAM_MODES = ["transcribe", "translate", "verbatim", "translit", "codemix"]
SARVAM_VOICES = ["anushka", "meera", "pavithra", "maitreyi", "arvind", "amol", "amartya"]  # Bulbul TTS


class ModelOverridesInput(BaseModel):
    overrides: dict  # {task: model_name}


class SarvamConfigInput(BaseModel):
    model: Optional[str] = None
    mode: Optional[str] = None
    voice: Optional[str] = None


class FlagsInput(BaseModel):
    flags: dict  # {flag_key: bool}


@router.get("/config")
async def admin_config(admin: dict = Depends(get_platform_admin)):
    """Full runtime config + the option surface the UI needs."""
    cfg = await pc.all_config()
    overrides = cfg.get(pc.K_MODELS, {}) or {}
    # Effective model per known task (env/override/route/default resolved by model_for).
    tasks = sorted(set(MODEL_ROUTES) | set(overrides))
    effective = {t: {"effective": model_for(t)[1], "override": overrides.get(t),
                     "default": MODEL_ROUTES.get(t)} for t in tasks}
    return {
        "models": {"available": sorted(MODELS.keys()), "routes": effective, "overrides": overrides},
        "sarvam": {"config": cfg.get(pc.K_SARVAM, {}) or {},
                   "options": {"models": SARVAM_MODELS, "modes": SARVAM_MODES, "voices": SARVAM_VOICES}},
        "global_flags": cfg.get(pc.K_FLAGS, {}) or {},
        "plan_capabilities": cfg.get(pc.K_PLAN_CAPS, {}) or {},
        "runtime": cfg.get(pc.K_RUNTIME, {}) or {},
    }


@router.patch("/config/models")
async def admin_set_models(payload: ModelOverridesInput, admin: dict = Depends(get_platform_admin)):
    bad = [f"{t}={m}" for t, m in payload.overrides.items() if m and m not in MODELS]
    if bad:
        raise HTTPException(status_code=422, detail=f"Unknown model(s): {', '.join(bad)}")
    clean = {t: m for t, m in payload.overrides.items() if m}  # empty value clears the override
    await pc.set(pc.K_MODELS, clean, admin.get("email"))
    await log_admin_action(admin, "config_models",
                           f"Set model overrides: {clean or '(cleared)'}", "config", "ai_model_overrides")
    return {"status": "ok", "overrides": clean}


@router.patch("/config/sarvam")
async def admin_set_sarvam(payload: SarvamConfigInput, admin: dict = Depends(get_platform_admin)):
    if payload.model and payload.model not in SARVAM_MODELS:
        raise HTTPException(status_code=422, detail=f"model must be one of {SARVAM_MODELS}")
    if payload.mode and payload.mode not in SARVAM_MODES:
        raise HTTPException(status_code=422, detail=f"mode must be one of {SARVAM_MODES}")
    if payload.voice and payload.voice not in SARVAM_VOICES:
        raise HTTPException(status_code=422, detail=f"voice must be one of {SARVAM_VOICES}")
    cfg = {k: v for k, v in {"model": payload.model, "mode": payload.mode, "voice": payload.voice}.items() if v}
    await pc.set(pc.K_SARVAM, cfg, admin.get("email"))
    await log_admin_action(admin, "config_sarvam", f"Set Sarvam config: {cfg}", "config", "sarvam_config")
    return {"status": "ok", "config": cfg}


@router.patch("/config/flags")
async def admin_set_flags(payload: FlagsInput, admin: dict = Depends(get_platform_admin)):
    flags = {k: bool(v) for k, v in payload.flags.items()}
    await pc.set(pc.K_FLAGS, flags, admin.get("email"))
    await log_admin_action(admin, "config_flags", f"Set global flags: {flags}", "config", "global_flags")
    return {"status": "ok", "flags": flags}


@router.patch("/config/runtime")
async def admin_set_runtime(payload: dict, admin: dict = Depends(get_platform_admin)):
    """Free-form runtime thresholds (e.g. capture confidence, budgets). Merges into K_RUNTIME."""
    cur = await pc.get(pc.K_RUNTIME, {}) or {}
    cur.update(payload or {})
    await pc.set(pc.K_RUNTIME, cur, admin.get("email"))
    await log_admin_action(admin, "config_runtime", f"Updated runtime config keys: {list((payload or {}).keys())}",
                           "config", "runtime")
    return {"status": "ok", "runtime": cur}


@router.patch("/config/plan-capabilities")
async def admin_set_plan_caps(payload: dict, admin: dict = Depends(get_platform_admin)):
    """Plan -> {capability: bool}. Merges per plan."""
    cur = await pc.get(pc.K_PLAN_CAPS, {}) or {}
    for plan, caps in (payload or {}).items():
        if plan not in PLAN_KEYS:
            raise HTTPException(status_code=422, detail=f"Unknown plan '{plan}'")
        cur.setdefault(plan, {}).update({k: bool(v) for k, v in (caps or {}).items()})
    await pc.set(pc.K_PLAN_CAPS, cur, admin.get("email"))
    await log_admin_action(admin, "config_plan_caps", "Updated plan capabilities", "config", "plan_capabilities")
    return {"status": "ok", "plan_capabilities": cur}


@router.get("/tenants/{tenant_id}/flags")
async def admin_get_tenant_flags(tenant_id: str, admin: dict = Depends(get_platform_admin)):
    t = await db.tenants.find_one({"id": tenant_id}, {"_id": 0, "feature_flags": 1})
    if t is None:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return {"feature_flags": t.get("feature_flags", {})}


@router.patch("/tenants/{tenant_id}/flags")
async def admin_set_tenant_flags(tenant_id: str, payload: FlagsInput, admin: dict = Depends(get_platform_admin)):
    t = await db.tenants.find_one({"id": tenant_id}, {"_id": 0, "id": 1, "feature_flags": 1})
    if not t:
        raise HTTPException(status_code=404, detail="Workspace not found")
    flags = dict(t.get("feature_flags") or {})
    flags.update({k: bool(v) for k, v in payload.flags.items()})
    await db.tenants.update_one({"id": tenant_id}, {"$set": {"feature_flags": flags}})
    await log_admin_action(admin, "tenant_flags", f"Set feature flags for {tenant_id}: {payload.flags}",
                           "tenant", tenant_id)
    return {"status": "ok", "feature_flags": flags}
