"""AI operating-model / lexicon / finance-category generators (Epic 8 Sprint 4
-- from server.py).

Industry-tailored AI generators (lexicon, operating model, finance categories),
the tenant operating-model reader, and the non-destructive backfill migration,
plus the answer-language directive. Depend on core + normalizers; routers.ledger
category defaults and server's WORKFLOW_STAGES are imported deferred.
"""
from core import (
    db, logger, claude_chat, _extract_json, new_id,
    normalize_lexicon, normalize_operating_model, DEFAULT_OPERATING_MODEL,
)
from emergentintegrations.llm.chat import UserMessage
from core import model_for
from prompts import render


LANG_NAMES = {"en": "English", "hi": "Hindi", "ta": "Tamil"}


def lang_directive(lang: str) -> str:
    """Instruct an AI to write its human-readable answer in the user's language."""
    name = LANG_NAMES.get((lang or "en"))
    if not name or name == "English":
        return ""
    return (f"IMPORTANT: Write the human-readable text (the 'answer'/'summary'/message body) in {name}. "
            "Keep proper nouns, names, company/product names, numbers and JSON keys exactly as-is; only translate the prose.")


async def ai_generate_lexicon(industry: str, company_size: str = "", roles=None, description: str = "") -> dict:
    """AI-localize the app's fixed vocabulary to the tenant's industry."""
    role_labels = ", ".join([r.get("label") for r in (roles or []) if r.get("label")]) or "not specified"
    system = render("generators.lexicon")
    prompt = (
        f"Industry: {industry or 'general business'}\n"
        f"Company size: {company_size or 'unspecified'}\n"
        f"What the business actually does: {description.strip() or 'not specified'}\n"
        f"Departments: {role_labels}\n"
        "Localize the vocabulary now."
    )
    chat = claude_chat(task="generators.lexicon", session_id=f"lexicon-{new_id()}", system_message=system).with_model(*model_for("generators.lexicon"))
    try:
        resp = await chat.send_message(UserMessage(text=prompt))
        data = _extract_json(resp)
    except Exception as e:
        logger.error(f"ai_generate_lexicon failed: {e}")
        data = {}
    return normalize_lexicon(data or {})


async def ai_generate_operating_model(industry: str, company_size: str = "", roles=None, description: str = "") -> dict:
    """AI-design the industry's operating model: workflow pipelines (with stages) + task categories."""
    role_labels = ", ".join([r.get("label") for r in (roles or []) if r.get("label")]) or "not specified"
    system = render("generators.operating_model")
    prompt = (
        f"Industry: {industry or 'general business'}\n"
        f"Company size: {company_size or 'unspecified'}\n"
        f"What the business actually does (use this to tailor precisely): {description.strip() or 'not specified'}\n"
        f"Departments: {role_labels}\n"
        "Design the operating model now."
    )
    chat = claude_chat(task="generators.operating_model", session_id=f"opmodel-{new_id()}", system_message=system).with_model(*model_for("generators.operating_model"))
    try:
        resp = await chat.send_message(UserMessage(text=prompt))
        data = _extract_json(resp)
    except Exception as e:
        logger.error(f"ai_generate_operating_model failed: {e}")
        data = {}
    return normalize_operating_model(data or {})


async def tenant_operating_model(tenant_id: str) -> dict:
    t = await db.tenants.find_one({"id": tenant_id}, {"_id": 0, "operating_model": 1})
    om = (t or {}).get("operating_model")
    return om if om and om.get("pipelines") else DEFAULT_OPERATING_MODEL


def normalize_finance_categories(d: dict) -> dict:
    """Clean AI-generated finance categories: dedupe, cap, always end with 'Other'."""
    def clean(lst, cap):
        out = []
        for x in (lst or []):
            s = str(x).strip()
            if s and s.lower() != "other" and s.lower() not in [o.lower() for o in out]:
                out.append(s)
        return out[:cap] + ["Other"]
    from routers.ledger import EXPENSE_CATEGORIES, ASSET_CATEGORIES
    exp = clean((d or {}).get("expense"), 14)
    ast = clean((d or {}).get("asset"), 10)
    if len(exp) <= 1:
        exp = list(EXPENSE_CATEGORIES)
    if len(ast) <= 1:
        ast = list(ASSET_CATEGORIES)
    return {"expense": exp, "asset": ast}


async def ai_generate_finance_categories(industry: str, company_size: str = "", roles=None, description: str = "") -> dict:
    """AI-generate the finance bookkeeping categories (expense + fixed-asset) tailored to this business."""
    role_labels = ", ".join([r.get("label") for r in (roles or []) if r.get("label")]) or "not specified"
    system = render("generators.finance_categories")
    prompt = (
        f"Industry: {industry or 'general business'}\n"
        f"Company size: {company_size or 'unspecified'}\n"
        f"What the business actually does: {(description or '').strip() or 'not specified'}\n"
        f"Departments: {role_labels}\n"
        "Generate the finance categories now."
    )
    data = {}
    try:
        chat = claude_chat(task="generators.finance_categories", session_id=f"fincats-{new_id()}", system_message=system).with_model(*model_for("generators.finance_categories"))
        resp = await chat.send_message(UserMessage(text=prompt))
        data = _extract_json(resp) or {}
    except Exception as e:  # noqa: BLE001
        logger.error(f"ai_generate_finance_categories failed: {e}")
    return normalize_finance_categories(data)


LEGACY_WF_LABELS = {"production": "Production", "distribution": "Distribution", "purchase_payment": "Procurement", "sales_dispatch": "Sales & Dispatch"}


async def backfill_operating_model(tenant: dict) -> dict:
    """Generate the industry operating model for an existing tenant AND preserve any
    pipeline/category that already has data (non-destructive migration)."""
    from server import WORKFLOW_STAGES  # shared constant (also used by bootstrap); stays in server
    tenant_id = tenant["id"]
    om = await ai_generate_operating_model(tenant.get("industry"), tenant.get("company_size"), tenant.get("roles"), tenant.get("description") or "")

    # Keep legacy pipelines that already have workflow cards, so nothing is orphaned.
    ai_keys = {p["key"] for p in om["pipelines"]}
    legacy_pipelines = []
    for wt in await db.workflows.distinct("type", {"tenant_id": tenant_id}):
        if not wt or wt in ai_keys:
            continue
        stages = WORKFLOW_STAGES.get(wt)
        if not stages:
            sample = await db.workflows.find_one({"tenant_id": tenant_id, "type": wt}, {"_id": 0, "stages": 1})
            stages = (sample or {}).get("stages") or []
        if not stages:
            continue
        appr = "approved" if (wt == "purchase_payment" and "approved" in stages) else None
        legacy_pipelines.append({
            "key": wt, "label": LEGACY_WF_LABELS.get(wt, wt.replace("_", " ").title()),
            "sub": f"{stages[0].replace('_', ' ').title()} → {stages[-1].replace('_', ' ').title()}",
            "approval_stage": appr,
            "stages": [{"key": s, "label": s.replace("_", " ").title()} for s in stages],
        })

    # Keep any task category already used by existing tasks.
    ai_cat_keys = {c["key"] for c in om["task_categories"]}
    legacy_cats = []
    for tt in await db.tasks.distinct("task_type", {"tenant_id": tenant_id}):
        if tt and tt != "other" and tt not in ai_cat_keys:
            legacy_cats.append({"key": tt, "label": tt.replace("_", " ").title()})

    # Legacy (data-bearing) items first so existing cards/tasks stay visible.
    return normalize_operating_model({
        "pipelines": legacy_pipelines + om["pipelines"],
        "task_categories": om["task_categories"] + legacy_cats,
    })
