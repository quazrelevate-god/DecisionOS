"""Filling in the work for stages that have none (2026-09-21).

Why this exists: until generators.operating_model v1.1 the prompt that designs a
company's pipelines never asked for the work each stage needs, so every company
set up before then has stages with `tasks: []`. The engine spawns a stage's
tasks the moment a card reaches it — and for those companies it had nothing to
spawn, so a card arrived at "In production" and nobody was told to do anything.

THREE RULES, each one a thing this module refuses to do otherwise:

1. ONLY THE GAPS. A stage that already has work — because the AI gave it some,
   or because an owner typed it in Settings — is never touched. Neither is
   anything else about a stage: its key, label, order, department, approval
   gate or side effects. "Regenerate" is the wrong tool for this: it redesigns
   the whole model, stage keys come back different, and running cards keep
   their old stage list frozen on them.

2. THE OWNER SEES IT FIRST. `suggest` writes nothing. `apply` takes what the
   owner kept and edited. From that moment their staff start being assigned
   work automatically, which is theirs to decide, not a migration's.

3. NOTHING LANDS ON CARDS ALREADY MOVING. Templates act the next time a card
   ENTERS a stage. A card sitting on a stage today does not suddenly sprout
   tasks — that would put unannounced work on people mid-job.

`apply` re-checks emptiness at write time, so two owners (or two tabs) applying
suggestions cannot double a stage's work, and running it twice changes nothing.
"""
from __future__ import annotations

import copy
import logging
from typing import Optional

from core import _extract_json, claude_chat, model_for, new_id
from shared.normalizers import _norm_stage_task, _slugify_key
from shared.roles import resolve_role

logger = logging.getLogger("decisionos.stage_work")

MAX_PER_STAGE = 3      # what the AI may suggest for a stage
MAX_OWNER_KEEPS = 6    # what an owner may keep — the normalizer's own ceiling


def empty_stages(om: Optional[dict]) -> list:
    """Every stage in the model that carries no work, in board order."""
    out = []
    for p in (om or {}).get("pipelines") or []:
        for s in p.get("stages") or []:
            if not isinstance(s, dict) or not s.get("key"):
                continue
            if s.get("tasks"):
                continue
            out.append({
                "pipeline_key": p.get("key"), "pipeline_label": p.get("label") or p.get("key"),
                "stage_key": s["key"], "stage_label": s.get("label") or s["key"],
                "role": s.get("role") or "",
            })
    return out


def _clean_tasks(raw, role_keys: set, fallback_role: str, cap: int = MAX_PER_STAGE) -> list:
    """Normalise one stage's tasks: shape, length, a department that exists."""
    out, seen = [], set()
    for t in raw if isinstance(raw, list) else []:
        nt = _norm_stage_task(t)
        if not nt or nt["title"].lower() in seen:
            continue
        # A department the company does not have would route the task nowhere.
        # Resolve the AI's word onto a real department (shared/roles.py); then
        # the stage's own department; '' beats a wrong one.
        if nt["role"] and nt["role"] not in role_keys:
            nt["role"] = (resolve_role(nt["role"], role_keys)
                          or resolve_role(fallback_role, role_keys) or "")
        seen.add(nt["title"].lower())
        out.append(nt)
        if len(out) >= cap:
            break
    return out


async def suggest(tenant: dict) -> dict:
    """Ask the AI for work for every EMPTY stage. Writes nothing.

    Returns {"suggestions": [...], "empty": n, "filled_already": n}. A stage the
    AI said nothing useful about is still listed, with no tasks, so the owner
    can see it was considered and type their own.
    """
    from emergentintegrations.llm.chat import UserMessage
    from prompts import render

    om = tenant.get("operating_model") or {}
    targets = empty_stages(om)
    total = sum(len(p.get("stages") or []) for p in om.get("pipelines") or [])
    base = {"empty": len(targets), "filled_already": total - len(targets)}
    if not targets:
        return {**base, "suggestions": []}

    roles = tenant.get("roles") or []
    role_keys = {r.get("key") for r in roles if r.get("key")} | {"owner"}
    lines = "\n".join(
        f"- pipeline_key={t['pipeline_key']} ({t['pipeline_label']}) · stage_key={t['stage_key']} "
        f"({t['stage_label']}) · department={t['role'] or 'none set'}"
        for t in targets
    )
    prompt = (
        f"Industry: {tenant.get('industry') or 'general business'}\n"
        f"What the business does: {(tenant.get('description') or '').strip() or 'not specified'}\n"
        f"Departments (slugs): {', '.join(sorted(k for k in role_keys if k))}\n"
        f"Stages to fill:\n{lines}\n"
        "Suggest the work for these stages now."
    )
    got: dict = {}
    try:
        chat = claude_chat(task="generators.stage_work", session_id=f"stagework-{new_id()}",
                           system_message=render("generators.stage_work")
                           ).with_model(*model_for("generators.stage_work"))
        data = _extract_json(await chat.send_message(UserMessage(text=prompt))) or {}
        for row in data.get("stages") or []:
            if isinstance(row, dict):
                got[(_slugify_key(row.get("pipeline_key") or ""), _slugify_key(row.get("stage_key") or ""))] = row.get("tasks")
    except Exception as e:  # noqa: BLE001 — the caller reports a failed suggest
        logger.error(f"stage_work.suggest failed for tenant {str(tenant.get('id'))[:8]}: {e}")
        raise

    suggestions = [
        {**t, "tasks": _clean_tasks(got.get((t["pipeline_key"], t["stage_key"])), role_keys, t["role"])}
        for t in targets
    ]
    return {**base, "suggestions": suggestions}


def apply(om: dict, fills: list, role_keys: set) -> tuple:
    """Write the owner's kept suggestions into the stages that are STILL empty.

    Returns (new_model, filled, skipped) where skipped explains each stage that
    was not written — so the screen can say why rather than pretend.
    """
    model = copy.deepcopy(om or {})
    index = {}
    for p in model.get("pipelines") or []:
        for s in p.get("stages") or []:
            if isinstance(s, dict) and s.get("key"):
                index[(p.get("key"), s["key"])] = s
    filled, skipped = [], []
    for f in fills or []:
        key = (f.get("pipeline_key"), f.get("stage_key"))
        stage = index.get(key)
        if stage is None:
            skipped.append({"pipeline_key": key[0], "stage_key": key[1], "reason": "stage no longer exists"})
            continue
        if stage.get("tasks"):
            skipped.append({"pipeline_key": key[0], "stage_key": key[1], "reason": "stage already has work"})
            continue
        tasks = _clean_tasks(f.get("tasks"), role_keys, stage.get("role") or "", cap=MAX_OWNER_KEEPS)
        if not tasks:
            continue  # the owner removed them all; nothing to write
        stage["tasks"] = tasks
        filled.append({"pipeline_key": key[0], "stage_key": key[1], "tasks": len(tasks)})
    return model, filled, skipped
