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
    """Operating model is meaningful only if pipelines is a non-empty list."""
    if not isinstance(data, dict):
        return False
    p = data.get("pipelines")
    return isinstance(p, list) and len(p) > 0


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
    from server import ai_generate_lexicon  # deferred: no import-time cycle
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
    from server import ai_generate_operating_model
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
    from server import ai_generate_finance_categories
    try:
        result = await ai_generate_finance_categories(industry, company_size, roles, description)
    except Exception:
        from server import normalize_finance_categories
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
