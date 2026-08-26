"""Runtime platform configuration (Epic 10 Sprint 6).

A small global key->value store in db.platform_config that lets the super-admin
change runtime behaviour with NO redeploy: AI model routes per task, the Sarvam
voice stack (model/mode/voice), global feature flags, plan capabilities, and misc
runtime thresholds. Two hot paths read in-process caches (config._MODEL_OVERRIDES,
integrations.stt._SARVAM_RUNTIME) that this module keeps in sync -- populated at boot
and refreshed by the scheduler each tick so all replicas converge.
"""
from __future__ import annotations

from typing import Any, Optional

from core import db, now_iso

# Known config keys (documented surface).
K_MODELS = "ai_model_overrides"      # {task: model_name}
K_SARVAM = "sarvam_config"           # {model, mode, voice}
K_FLAGS = "global_flags"             # {flag: bool}
K_PLAN_CAPS = "plan_capabilities"    # {plan: {cap: bool}}
K_RUNTIME = "runtime"                # {key: value}


async def get(key: str, default: Any = None) -> Any:
    doc = await db.platform_config.find_one({"key": key}, {"_id": 0, "value": 1})
    return doc["value"] if doc and "value" in doc else default


async def set(key: str, value: Any, admin_email: Optional[str] = None) -> None:
    await db.platform_config.update_one(
        {"key": key},
        {"$set": {"value": value, "updated_at": now_iso(), "updated_by": admin_email}},
        upsert=True)
    await apply_hot_paths()


async def all_config() -> dict:
    """Every config key -> value (for the admin console)."""
    rows = await db.platform_config.find({}, {"_id": 0}).to_list(100)
    return {r["key"]: r.get("value") for r in rows}


async def apply_hot_paths() -> None:
    """Push the DB config into the in-process caches the sync hot paths read.
    Best-effort: a bad/missing key just leaves the env/default behaviour."""
    try:
        import config as _cfg
        from integrations import stt as _stt
        _cfg.set_model_overrides(await get(K_MODELS, {}) or {})
        _stt.set_sarvam_runtime(await get(K_SARVAM, {}) or {})
    except Exception:
        pass


# Alias used by bootstrap + the scheduler.
load_all = apply_hot_paths
refresh = apply_hot_paths
