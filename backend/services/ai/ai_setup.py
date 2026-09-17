"""AI setup wrappers with explicit success/failure status.

Introduced by FIX-001-D to close the "silent AI degradation" gap: the
three per-tenant AI generators used during registration (lexicon,
operating model, finance categories) previously fell back to industry
defaults on any error without telling anyone. A bakery whose Anthropic
call timed out during signup silently received textile-shaped boards.

These wrappers preserve the existing generators' behavior (still return
a usable result on failure) but ADDITIONALLY report the outcome as
`generated` | `defaulted` | `failed` so:
  - The tenant doc records `ai_setup_status` per generator.
  - The frontend can show "AI setup incomplete — click to regenerate."
  - The `POST /api/tenant/ai-setup/retry` endpoint knows what to redo.

Outcomes:
  generated : AI returned a well-formed, non-empty result. Confidence high.
  defaulted : AI returned nothing useful (empty JSON, wrong shape,
              missing required keys). We fell back to a safe default.
              Tenant should be prompted to regenerate.
  failed    : AI raised an exception (timeout, rate limit, network,
              malformed JSON). Same fallback applied; same prompt to retry.
"""
from typing import Tuple

# The module's own db handle, the way every other service binds it — so a test
# can rebind THIS name and the background write lands in the test's database.
from core import db, logger, set_usage_tenant


# Status literals — kept here (not an Enum) for JSON-friendliness and easy
# equality checks across the codebase.
STATUS_GENERATED = "generated"
STATUS_DEFAULTED = "defaulted"
STATUS_FAILED = "failed"

VALID_STATUSES = {STATUS_GENERATED, STATUS_DEFAULTED, STATUS_FAILED}


def _is_meaningful_lexicon(data: dict) -> bool:
    """Lexicon is meaningful if it has at least one non-empty section."""
    if not isinstance(data, dict):
        return False
    return any(bool(v) for v in data.values() if v)


def _is_meaningful_operating_model(data: dict) -> bool:
    """Operating model is meaningful only if pipelines is a non-empty
    list AND NOT the textile-era DEFAULT_OPERATING_MODEL fallback.

    WE-EPIC5-BUG-2 (2026-08-16): the underlying ai_generate_operating_model
    catches its own exceptions and returns normalize_operating_model({})
    -- which is the DEFAULT model with production/distribution/
    purchase_payment pipelines. Previously this function saw "pipelines
    non-empty" and reported STATUS_GENERATED, hiding the AI failure.
    The tenant then thought their model was industry-tailored when it
    was the built-in fallback.

    Fix: compare against the DEFAULT model's pipeline signature.
    Signature = sorted (pipeline.key, first_stage.key) tuples across
    all pipelines. Cheap, robust to WE-01.5 role additions, no false
    positives on legitimately-different AI output.
    """
    if not isinstance(data, dict):
        return False
    p = data.get("pipelines")
    if not (isinstance(p, list) and len(p) > 0):
        return False
    # Cheap default-signature check.
    from core import DEFAULT_OPERATING_MODEL

    def _sig(model: dict) -> tuple:
        pipes = (model or {}).get("pipelines") or []
        out = []
        for pl in pipes:
            if not isinstance(pl, dict):
                continue
            k = pl.get("key") or ""
            stages = pl.get("stages") or []
            first_key = ""
            if stages:
                fs = stages[0]
                first_key = fs.get("key") if isinstance(fs, dict) else str(fs)
            out.append((k, first_key or ""))
        return tuple(sorted(out))

    if _sig(data) == _sig(DEFAULT_OPERATING_MODEL):
        return False  # this IS the fallback -- AI didn't contribute
    return True


def _is_meaningful_finance(data: dict) -> bool:
    """Finance categories are meaningful if expense list is non-trivial."""
    if not isinstance(data, dict):
        return False
    exp = data.get("expense") or []
    # normalize_finance_categories appends "Other" as a sentinel; a real
    # AI result has >1 element. If len==1 (just "Other") it was defaulted.
    return isinstance(exp, list) and len(exp) > 1


async def ai_generate_lexicon_with_status(
    industry: str, company_size: str, roles: list, description: str,
) -> Tuple[dict, str]:
    """Wrap ai_generate_lexicon so callers see whether AI actually
    contributed. Returns (result, status). Result is always usable."""
    from services.ai.generators import ai_generate_lexicon
    try:
        result = await ai_generate_lexicon(industry, company_size, roles, description)
    except Exception:
        # ai_generate_lexicon already try/excepts internally, but belt-and-
        # braces: never let a wrapper raise where the original wouldn't.
        from core import normalize_lexicon
        return normalize_lexicon({}), STATUS_FAILED
    status = STATUS_GENERATED if _is_meaningful_lexicon(result) else STATUS_DEFAULTED
    return result, status


async def ai_generate_operating_model_with_status(
    industry: str, company_size: str, roles: list, description: str,
) -> Tuple[dict, str]:
    """Wrap ai_generate_operating_model with success/failure status."""
    from services.ai.generators import ai_generate_operating_model
    try:
        result = await ai_generate_operating_model(industry, company_size, roles, description)
    except Exception:
        from core import normalize_operating_model
        return normalize_operating_model({}), STATUS_FAILED
    status = STATUS_GENERATED if _is_meaningful_operating_model(result) else STATUS_DEFAULTED
    return result, status


async def ai_generate_finance_categories_with_status(
    industry: str, company_size: str, roles: list, description: str,
) -> Tuple[dict, str]:
    """Wrap ai_generate_finance_categories with success/failure status."""
    from services.ai.generators import ai_generate_finance_categories
    try:
        result = await ai_generate_finance_categories(industry, company_size, roles, description)
    except Exception:
        from services.ai.generators import normalize_finance_categories
        return normalize_finance_categories({}), STATUS_FAILED
    status = STATUS_GENERATED if _is_meaningful_finance(result) else STATUS_DEFAULTED
    return result, status


def summarize_ai_setup_status(status_map: dict) -> dict:
    """Given the per-generator status dict, return a summary safe for API
    responses: {healthy: bool, needs_retry: [list of generator keys]}."""
    needs_retry = [k for k, v in (status_map or {}).items()
                   if v in (STATUS_DEFAULTED, STATUS_FAILED)]
    return {
        "healthy": len(needs_retry) == 0,
        "needs_retry": needs_retry,
        "detail": dict(status_map or {}),
    }

# ---------------------------------------------------------------------------
# The three generators, run OFF the signup request (2026-09-17).
# ---------------------------------------------------------------------------
STATUS_PENDING = "pending"


async def generate_tenant_setup(tenant_id: str, *, industry: str, company_size: str,
                                 roles: list, description: str) -> dict:
    """Generate a new workspace's lexicon, operating model and finance
    categories, and write them onto the tenant.

    Runs as a background task after registration has already returned. It used
    to run INSIDE the signup request, which is how a founder could lose a
    workspace they had just created: the three calls took 14s on a warm
    developer machine and up to the proxy's 60s ceiling on a phone, and if the
    client gave up first the request carried on and created the account anyway —
    so the screen said "Couldn't create your workspace" and the next press said
    "Email already registered" (KM-61 recorded exactly that pair in the Railway
    log). The account is now made first and this fills in behind it.

    Every generator already reports its own status and degrades to a documented
    default, so a failure here leaves a usable workspace with `ai_setup_status`
    marking what to retry (POST /api/tenant/ai-setup/retry).
    """
    import asyncio

    set_usage_tenant(tenant_id)
    lex_r, om_r, fc_r = await asyncio.gather(
        ai_generate_lexicon_with_status(industry, company_size, roles, description),
        ai_generate_operating_model_with_status(industry, company_size, roles, description),
        ai_generate_finance_categories_with_status(industry, company_size, roles, description),
        return_exceptions=True,
    )

    def _unpack(res, what):
        if isinstance(res, Exception):
            logger.error(f"tenant setup: {what} generation failed: {res}")
            return None, STATUS_FAILED
        return res

    lexicon, lex_status = _unpack(lex_r, "lexicon")
    om, om_status = _unpack(om_r, "operating_model")
    fc, fc_status = _unpack(fc_r, "finance_categories")
    status = {"lexicon": lex_status, "operating_model": om_status,
              "finance_categories": fc_status}
    await db.tenants.update_one({"id": tenant_id}, {"$set": {
        "lexicon": lexicon, "operating_model": om, "finance_categories": fc,
        "ai_setup_status": status,
    }})
    logger.info(f"tenant setup generated for {tenant_id}: {status}")
    return status
