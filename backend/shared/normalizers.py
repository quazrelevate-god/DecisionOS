"""Pure normalizers extracted from core.py (Epic 8 Sprint 2).

Blueprint / lexicon / operating-model coercion. No db, no auth, no I/O --
deterministic pure functions, safe to import from anywhere. core.py re-exports
the public names so existing "from core import normalize_lexicon" keeps working.
"""
from typing import Optional


def _slugify_key(label: str) -> str:
    return (label or "").strip().lower().replace(" ", "_").replace("/", "_").replace("-", "_")


def _bp_departments(data: dict) -> list:
    departments, seen = [], set()
    for d in (data.get("departments") or []):
        label = (d if isinstance(d, str) else (d.get("label") or d.get("name") or "")).strip()
        key = _slugify_key(label)
        if key and key != "owner" and key not in seen:
            seen.add(key)
            departments.append({"key": key, "label": label})
    return departments[:12]


# WE-02 (2026-08-16): _bp_workflows removed. tenant.workflow_templates
# was a dead brainstorm list -- written but never consumed to drive
# behaviour. operating_model.pipelines is the single source of truth
# for what pipelines exist; the free-text template list served no
# purpose but confused Settings (three cards, three shapes, one
# concept). See Epic 5 spec deck slides 4 + 9.


def _bp_op_tasks(data: dict) -> list:
    out = []
    for t in (data.get("operational_tasks") or data.get("operational_task_templates") or []):
        if isinstance(t, str):
            title, cat = t.strip(), "Other"
        else:
            title = (t.get("title") or t.get("name") or "").strip()
            cat = (t.get("category") or "Other").strip() or "Other"
        if title:
            out.append({"title": title, "category": cat})
    return out[:20]


def _bp_rules(data: dict) -> list:
    out = []
    for r in (data.get("approval_rules") or []):
        if isinstance(r, str):
            name, desc = r.strip(), ""
        else:
            name = (r.get("name") or r.get("title") or "").strip()
            desc = (r.get("description") or "").strip()
        if name:
            out.append({"name": name, "description": desc})
    return out[:10]


def normalize_os_blueprint(data: dict) -> dict:
    """Coerce a raw (AI or user) blueprint into clean, editable lists.

    WE-02 (2026-08-16): 'workflows' key removed -- the ghost
    tenant.workflow_templates collection is retired; operating_model
    is the single source of truth for pipelines now."""
    return {
        "departments": _bp_departments(data),
        "operational_tasks": _bp_op_tasks(data),
        "approval_rules": _bp_rules(data),
    }


# ---------------------------------------------------------------------------
# Business vocabulary (industry-tailored UI terminology)
# ---------------------------------------------------------------------------
DEFAULT_LEXICON = {
    # WE-02 (2026-08-16): 'workflows' key removed. The three hardcoded
    # label/sub pairs (production/distribution/purchase_payment) were
    # a dead output -- nothing in the app read them. Pipeline labels
    # come from tenant.operating_model.pipelines[].label instead.
    "customer_singular": "Customer",
    "customer_plural": "Customers",
    "vendor_singular": "Supplier",
    "vendor_plural": "Suppliers",
    "task_types": {
        "operational": "Operational",
        "sales": "Sales",
        "purchase": "Purchase",
        "production": "Production",
        "finance": "Finance",
        "hr": "HR",
    },
}


def normalize_lexicon(data: dict) -> dict:
    """Merge a raw (AI or user) vocabulary over defaults, keeping only known keys."""
    d = data or {}

    def _s(v, fb):
        v = (str(v).strip() if v is not None else "")
        return v or fb

    base = DEFAULT_LEXICON
    out = {
        "customer_singular": _s(d.get("customer_singular"), base["customer_singular"]),
        "customer_plural": _s(d.get("customer_plural"), base["customer_plural"]),
        "vendor_singular": _s(d.get("vendor_singular"), base["vendor_singular"]),
        "vendor_plural": _s(d.get("vendor_plural"), base["vendor_plural"]),
        "task_types": {},
    }
    # WE-02: workflows key dropped. Legacy tenants with stored
    # lexicon.workflows are $unset by the drop_ghost_collections
    # migration; the read side ignores whatever was there anyway.
    tt_in = d.get("task_types") or {}
    for k, dv in base["task_types"].items():
        out["task_types"][k] = _s(tt_in.get(k), dv)
    return out


# ---------------------------------------------------------------------------
# Operating Model: industry-specific pipelines + task categories.
# The board & My Work are driven by this per-tenant structure (not hardcoded).
# Defaults mirror the original manufacturing model so existing tenants backfill
# to exactly what they had before.
# ---------------------------------------------------------------------------
def _st(key, label):
    return {"key": key, "label": label}


DEFAULT_OPERATING_MODEL = {
    "pipelines": [
        {
            "key": "production", "label": "Production", "sub": "Order → Ready", "approval_stage": None,
            "stages": [_st("order_received", "Order Received"), _st("confirmed", "Confirmed"),
                       _st("in_production", "In Production"), _st("ready", "Ready")],
        },
        {
            "key": "distribution", "label": "Distribution", "sub": "Dispatch → Deliver", "approval_stage": None,
            "stages": [_st("ready_to_dispatch", "Ready To Dispatch"), _st("dispatched", "Dispatched"),
                       _st("in_transit", "In Transit"), _st("delivered", "Delivered")],
        },
        {
            "key": "purchase_payment", "label": "Procurement", "sub": "Purchase → Payment", "approval_stage": "approved",
            "stages": [_st("requested", "Requested"), _st("approved", "Approved"), _st("ordered", "Ordered"),
                       _st("received", "Received"), _st("payment_pending", "Payment Pending"), _st("paid", "Paid")],
        },
    ],
    "task_categories": [
        _st("operational", "Operational"), _st("sales", "Sales"), _st("purchase", "Purchase"),
        _st("production", "Production"), _st("finance", "Finance"), _st("hr", "HR"),
    ],
}


def _norm_stage_task(t: dict) -> Optional[dict]:
    """WE-03 (2026-08-16): normalize one stage-template task.

    Shape: {title, role, evidence_required}. Missing role stays empty
    (engine treats as unassigned); missing evidence_required defaults
    False. Title over 120 chars is truncated -- title is UI-facing
    and long ones break the stage card layout."""
    if not isinstance(t, dict):
        return None
    title = str(t.get("title") or "").strip()[:120]
    if not title:
        return None
    role = _slugify_key(str(t.get("role") or ""))[:40]
    ev = bool(t.get("evidence_required"))
    return {"title": title, "role": role, "evidence_required": ev}


def _norm_stage_approval(a) -> Optional[dict]:
    """WE-03: normalize a stage's approval gate.

    Shape: {role, required} or None. `required=False` means the gate
    exists in the template but can be skipped -- WE-06 engine will
    still record if satisfied. Empty role -> None."""
    if not isinstance(a, dict):
        return None
    role = _slugify_key(str(a.get("role") or ""))[:40]
    if not role:
        return None
    return {"role": role, "required": bool(a.get("required", True))}


def _norm_stage_side_effect(se: dict) -> Optional[dict]:
    """WE-03: normalize a side-effect hook. `kind` is a slug registry
    lookup (create_expense, notify_role, post_to_slack, ...); `params`
    is an arbitrary dict the engine passes through to the hook."""
    if not isinstance(se, dict):
        return None
    kind = _slugify_key(str(se.get("kind") or ""))[:40]
    if not kind:
        return None
    params = se.get("params") if isinstance(se.get("params"), dict) else {}
    return {"kind": kind, "params": params}


def _norm_stage(s, used):
    """WE-03 extended (2026-08-16): stages carry tasks[], approval,
    side_effects[] in addition to {key,label}. Old string / two-field
    dict inputs still normalize -- new fields default to empty so
    behaviour matches today until an owner edits them in."""
    if isinstance(s, str):
        label = s.strip()
        obj = {}
    elif isinstance(s, dict):
        label = str(s.get("label") or s.get("name") or "").strip()
        obj = s
    else:
        return None
    key = _slugify_key(obj.get("key") or "") or _slugify_key(label)
    if not key or not label or key in used:
        return None
    used.add(key)

    # WE-03: preserve/default the three new fields. Caps kept tight so
    # bad AI output can't blow up the operating-model document size.
    raw_tasks = obj.get("tasks") if isinstance(obj.get("tasks"), list) else []
    tasks = []
    for t in raw_tasks:
        nt = _norm_stage_task(t)
        if nt:
            tasks.append(nt)
        if len(tasks) >= 6:
            break

    approval = _norm_stage_approval(obj.get("approval"))

    raw_ses = obj.get("side_effects") if isinstance(obj.get("side_effects"), list) else []
    side_effects = []
    for se in raw_ses:
        nse = _norm_stage_side_effect(se)
        if nse:
            side_effects.append(nse)
        if len(side_effects) >= 6:
            break

    # WE-01.5 (2026-08-16): stage.role -- the department that "owns"
    # this stage. Set by the AI on generation, or backfilled from
    # tasks[0].role, or from the legacy WORKFLOW_OWNER_ROLE map. Used
    # by voice-capture to route each spawned task to the stage its
    # role naturally owns, so the engine can auto-advance the full
    # chain (not just one step). Empty string when no owner is set --
    # engine falls back to workflow's current stage in that case.
    role = _slugify_key(obj.get("role") or "")[:40] if isinstance(obj.get("role"), str) else ""
    # Fallback: if no explicit role, derive from the first template
    # task's role. Keeps the AI prompt simpler (role is optional).
    if not role and tasks:
        role = (tasks[0].get("role") or "").strip()

    return {
        "key": key, "label": label,
        "tasks": tasks, "approval": approval, "side_effects": side_effects,
        "role": role,
    }


def normalize_operating_model(data: dict) -> dict:
    """Coerce a raw (AI or user) operating model into a clean, editable structure."""
    d = data or {}
    pipelines, seen_p = [], set()
    for p in (d.get("pipelines") or []):
        if not isinstance(p, dict):
            continue
        label = (p.get("label") or p.get("name") or "").strip()
        key = _slugify_key(p.get("key") or label)
        if not key or not label or key in seen_p:
            continue
        used_st = set()
        stages = []
        for s in (p.get("stages") or []):
            ns = _norm_stage(s, used_st)
            if ns:
                stages.append(ns)
            if len(stages) >= 8:
                break
        if not stages:
            continue
        stage_keys = {s["key"] for s in stages}
        appr = p.get("approval_stage")
        appr = appr if appr in stage_keys else None
        seen_p.add(key)
        pipelines.append({
            "key": key, "label": label,
            "sub": (p.get("sub") or "").strip() or f"{stages[0]['label']} → {stages[-1]['label']}",
            "stages": stages, "approval_stage": appr,
        })
        if len(pipelines) >= 6:
            break
    cats, seen_c = [], set()
    for c in (d.get("task_categories") or []):
        label = (c if isinstance(c, str) else (c.get("label") or c.get("name") or "")).strip()
        key = _slugify_key(c.get("key") if isinstance(c, dict) else label) or _slugify_key(label)
        if key and label and key not in seen_c:
            seen_c.add(key)
            cats.append({"key": key, "label": label})
        if len(cats) >= 10:
            break
    if not pipelines:
        pipelines = DEFAULT_OPERATING_MODEL["pipelines"]
    if not cats:
        cats = DEFAULT_OPERATING_MODEL["task_categories"]
    return {"pipelines": pipelines, "task_categories": cats}
