"""Server-side onboarding-draft store.

Solves the "user typed 7 steps of onboarding, then /register 500'd and
they lost everything" problem. Each wizard step PATCHes the draft as
it completes so a page refresh, network drop, or backend hiccup never
wipes user input.

Drafts are PRE-tenant — they exist before a tenant is created. They live
in their own `onboarding_drafts` collection (not `signup_sessions`,
which is only for the AI voice interview). Drafts auto-expire after 30
days via TTL index (Mongo does the cleanup, no cron needed).

Draft schema:
  {
    id: str,                      # draft_id — client keeps this to resume
    email: str | None,            # for retrieval and email-collision checks
    step_data: {                  # each wizard step's user input
      about: {...},               # step 1: company_name, name, industry, gst...
      scale: {...},               # step 2: team_size, currency, monthly_sales...
      software: [...],            # step 3: current software
      team: {roles, products},    # step 4: after AI suggest
      os_blueprint: {...},        # step 5: after AI blueprint
      data_uploads: [...],        # step 6: which CSVs uploaded
    },
    created_at: iso,
    updated_at: iso,
    completed_at: iso | None,     # set when register() consumes the draft
    ai_calls: {                   # audit of what AI failed and where
      onboarding_suggest: "generated"|"defaulted"|"failed" | None,
      os_blueprint:       "generated"|"defaulted"|"failed" | None,
    },
  }

Never contains a password or JWT — those are ONLY sent in the final
/register call and never persisted in the draft.
"""
from datetime import datetime, timezone
from typing import Optional


VALID_STEP_KEYS = {"about", "scale", "software", "team", "os_blueprint", "data_uploads"}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def create_draft(db, email: Optional[str] = None) -> dict:
    """Create a fresh onboarding draft. Returns the full draft doc."""
    from core import new_id
    doc = {
        "id": new_id(),
        "email": (email or "").strip().lower() or None,
        "step_data": {},
        "ai_calls": {},
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
        "completed_at": None,
    }
    await db.onboarding_drafts.insert_one(dict(doc))
    doc.pop("_id", None)
    return doc


async def get_draft(db, draft_id: str) -> Optional[dict]:
    """Fetch a draft by id. Returns None if not found or already completed."""
    doc = await db.onboarding_drafts.find_one({"id": draft_id}, {"_id": 0})
    return doc


async def patch_draft(db, draft_id: str, step: str, data: dict) -> Optional[dict]:
    """Update ONE step's data on a draft. Returns updated draft or None
    if draft doesn't exist. Ignores unknown step keys (fail-safe: don't
    let a client stash arbitrary data in the draft blob)."""
    if step not in VALID_STEP_KEYS:
        return None
    result = await db.onboarding_drafts.update_one(
        {"id": draft_id, "completed_at": None},
        {"$set": {
            f"step_data.{step}": data,
            "updated_at": _now_iso(),
        }},
    )
    if result.matched_count == 0:
        return None
    return await get_draft(db, draft_id)


async def record_ai_call(db, draft_id: str, call_name: str, status: str) -> None:
    """Record an AI call outcome on the draft (for the audit trail).
    Best-effort — never raises. Values are the STATUS_* constants from
    services.ai_setup."""
    try:
        await db.onboarding_drafts.update_one(
            {"id": draft_id, "completed_at": None},
            {"$set": {f"ai_calls.{call_name}": status, "updated_at": _now_iso()}},
        )
    except Exception:
        pass  # audit-only, don't break the flow


async def mark_completed(db, draft_id: str, tenant_id: str) -> None:
    """Mark a draft as consumed by a completed registration. We keep the
    row (for post-hoc debugging of onboarding funnel issues) but block
    further edits and let the TTL sweep clean it up eventually."""
    await db.onboarding_drafts.update_one(
        {"id": draft_id},
        {"$set": {
            "completed_at": _now_iso(),
            "tenant_id": tenant_id,  # crumb linking draft to created tenant
        }},
    )


def merge_draft_into_register_input(draft: dict, provided: dict) -> dict:
    """When /register is called with a draft_id, merge the draft's saved
    step data underneath the provided input. Client-provided values win
    (the user may have edited the final screen). Missing values fall
    back to the draft."""
    if not draft:
        return provided
    step = (draft.get("step_data") or {})
    about = step.get("about") or {}
    scale = step.get("scale") or {}
    team = step.get("team") or {}
    bp = step.get("os_blueprint")
    software = step.get("software") or []

    merged = dict(provided or {})
    for key, val in (
        ("company_name", about.get("company_name")),
        ("name", about.get("name")),
        ("email", about.get("email")),
        ("phone", about.get("phone")),
        ("industry", about.get("industry")),
        ("description", about.get("description")),
        ("region", about.get("region")),
        ("gst", about.get("gst")),
        ("branches", about.get("branches")),
        ("company_size", scale.get("team_size") or scale.get("company_size")),
        ("currency", scale.get("currency")),
        ("business_scale", scale),
        ("current_software", software),
        ("roles", team.get("roles")),
        ("products", team.get("products")),
        ("os_blueprint", bp),
    ):
        # Fill only if the client didn't provide it (None or empty)
        if val is not None and merged.get(key) in (None, "", [], {}):
            merged[key] = val
    return merged
