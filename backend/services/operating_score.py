"""Operating-score + personal work-coach engine (Epic 8 Sprint 4 -- from server.py).

Company operating view (owner), self view (contributor), per-employee scoring,
employee stats, and the AI work-coach review. Pure compute over db reads +
one LLM call; depends on core + stdlib + fastapi only, nothing from server.
"""
import json
from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException
from emergentintegrations.llm.chat import UserMessage

from core import db, logger, user_perms, claude_chat, _extract_json
from core import model_for
from prompts import render
from services.ai.pii import redact_pii


# S9 (U8-09.5): shared short-TTL cache for the company operating view. The view
# runs several full-tenant collection scans (tasks/decisions/invoices/payments)
# on every dashboard load; a derived score tolerates a few seconds of staleness.
# Cache lives in Mongo (not process memory) so it stays consistent across
# replicas and survives restarts -- the same pattern as the Desk narrative cache.
# TTL-only invalidation (bump-on-write is a future option if fresher is needed).
_OPS_CACHE_TTL_SECONDS = 90


def _cache_fresh(computed_at: Optional[str], now: str, ttl: int) -> bool:
    """True if a cache entry stamped ``computed_at`` is younger than ``ttl`` at ``now``."""
    if not computed_at:
        return False
    try:
        c = datetime.fromisoformat(computed_at)
        n = datetime.fromisoformat(now)
        return (n - c).total_seconds() < ttl
    except (ValueError, TypeError):
        return False


def _clamp100(v):
    return max(0, min(100, int(round(v))))


def _is_open_task(t):
    return t.get("status") in ("todo", "in_progress", "blocked")


def _score_execution(tasks, now):
    """Task-execution score; returns (execution, done, open_tasks, overdue, actionable)."""
    done = sum(1 for t in tasks if t.get("status") == "done")
    open_tasks = [t for t in tasks if _is_open_task(t)]
    overdue = sum(1 for t in open_tasks if t.get("due_date") and t["due_date"] < now)
    actionable = done + len(open_tasks)
    completion = (done / actionable) if actionable else 0.7
    overdue_ratio = (overdue / len(open_tasks)) if open_tasks else 0
    return _clamp100(completion * 100 - overdue_ratio * 40), done, open_tasks, overdue, actionable


def _score_sales(decisions):
    """Decision-approval score; returns (sales, total_dec, approved)."""
    total_dec = len(decisions)
    approved = sum(1 for d in decisions if d.get("status") == "approved")
    approved_rate = (approved / total_dec) if total_dec else 0.7
    return _clamp100(approved_rate * 100), total_dec, approved


def _score_employees(tasks, members, now):
    """Per-employee execution scores, sorted high to low."""
    employees = []
    for mbr in members:
        mine = [t for t in tasks if t.get("assignee_id") == mbr["id"] or (not t.get("assignee_id") and t.get("assignee_role") == mbr["role"])]
        m_done = sum(1 for t in mine if t.get("status") == "done")
        m_open = [t for t in mine if _is_open_task(t)]
        m_overdue = sum(1 for t in m_open if t.get("due_date") and t["due_date"] < now)
        m_action = m_done + len(m_open)
        m_comp = (m_done / m_action) if m_action else 0
        m_score = _clamp100(m_comp * 100 - (m_overdue / len(m_open) if m_open else 0) * 40) if m_action else None
        employees.append({"id": mbr["id"], "name": mbr["name"], "role": mbr["role"],
                          "score": m_score, "done": m_done, "open": len(m_open), "overdue": m_overdue})
    employees.sort(key=lambda e: (e["score"] if e["score"] is not None else -1), reverse=True)
    return employees


async def _company_operating_view(tid: str, viewer: dict, now: str) -> dict:
    """Compute the owner-facing company payload. Extracted so /operating-score
    can dispatch by role (Epic 7 Sprint 1 Phase A -- role split)."""
    can_finance = viewer.get("role") == "owner" or "finance" in user_perms(viewer)

    # S9 (U8-09.5): the view is identical for every viewer sharing the same
    # can_finance flag, so cache on (tenant, can_finance). Best-effort: any cache
    # error falls straight through to a live recompute.
    cache_key = f"{tid}:{int(can_finance)}"
    try:
        cached = await db.operating_score_cache.find_one({"_id": cache_key}, {"_id": 0})
        if cached and _cache_fresh(cached.get("computed_at"), now, _OPS_CACHE_TTL_SECONDS):
            return cached["payload"]
    except Exception as e:
        logger.warning(f"operating_score cache read failed: {e}")

    tasks = await db.tasks.find({"tenant_id": tid}, {"_id": 0}).to_list(2000)
    decisions = await db.decisions.find({"tenant_id": tid}, {"_id": 0, "status": 1}).to_list(2000)
    complaints = await db.complaints.find({"tenant_id": tid}, {"_id": 0, "status": 1}).to_list(500)

    execution, done, open_tasks, overdue, actionable = _score_execution(tasks, now)

    total_billed = total_paid = 0.0
    overdue_inv = 0
    inv_count = 0
    if can_finance:
        invs = await db.invoices.find({"tenant_id": tid}, {"_id": 0, "amount": 1, "type": 1, "status": 1, "due_date": 1}).to_list(2000)
        pays = await db.payments.find({"tenant_id": tid}, {"_id": 0, "amount": 1}).to_list(2000)
        inv_count = len(invs)
        total_billed = sum(float(i.get("amount") or 0) for i in invs if i.get("type") == "sales_invoice")
        total_paid = sum(float(p.get("amount") or 0) for p in pays)
        overdue_inv = sum(1 for i in invs if i.get("type") == "sales_invoice" and i.get("status") != "paid" and i.get("due_date") and i["due_date"] < now)
    collected = (min(total_paid, total_billed) / total_billed) if total_billed else 0.7
    finance = _clamp100(collected * 100 - overdue_inv * 5) if can_finance else None

    sales, total_dec, approved = _score_sales(decisions)

    open_complaints = sum(1 for c in complaints if c.get("status") != "resolved")
    responsiveness = _clamp100(100 - open_complaints * 12 - overdue * 3)

    categories = {"execution": execution, "finance": finance, "sales": sales, "responsiveness": responsiveness}
    weights = {"execution": 0.35, "finance": 0.25, "sales": 0.2, "responsiveness": 0.2}
    avail = {k: v for k, v in categories.items() if v is not None}
    wsum = sum(weights[k] for k in avail) or 1
    overall = _clamp100(sum(avail[k] * weights[k] for k in avail) / wsum)

    enough_data = actionable >= 3 or inv_count > 0

    members = await db.users.find({"tenant_id": tid}, {"_id": 0, "id": 1, "name": 1, "role": 1}).to_list(200)
    employees = _score_employees(tasks, members, now)

    payload = {
        "company": {"overall": overall if enough_data else None, "categories": categories, "enough_data": enough_data},
        "stats": {"done": done, "open": len(open_tasks), "overdue": overdue,
                  "total_decisions": total_dec, "approved": approved, "open_complaints": open_complaints,
                  "outstanding": round(total_billed - total_paid, 2) if can_finance else None},
        "employees": employees,
        "can_finance": can_finance,
    }
    try:
        await db.operating_score_cache.update_one(
            {"_id": cache_key},
            {"$set": {"tenant_id": tid, "can_finance": can_finance, "payload": payload, "computed_at": now}},
            upsert=True,
        )
    except Exception as e:
        logger.warning(f"operating_score cache write failed: {e}")
    return payload


async def _self_operating_view(tid: str, viewer: dict, now: str) -> dict:
    """Compute a personal, contributor-facing operating view for any
    non-owner team member (Epic 7 Sprint 1 Phase A -- founder ask 2026-08-17:
    'if the team person login and go the ops it have to show the individuals
    person metrics').

    Reuses compute_employee_stats for the richer signals (proof upload rate,
    plan adoption, streak-friendly counts) that the company view discards.
    Adds two purely-viewer surfaces the owner leaderboard never carried:
    my open work (top 5 by due date) and my active workflows (current-stage
    owner). Peer context is computed but the frontend keeps it behind an
    opt-in per privacy default (open decision #1 in the analysis doc).
    """
    uid = viewer["id"]
    urole = viewer.get("role") or ""
    stats = await compute_employee_stats(tid, viewer)

    # Top 5 open tasks by due date -- the surface a contributor actually acts on.
    my_open = await db.tasks.find(
        {"tenant_id": tid,
         "$or": [{"assignee_id": uid},
                 {"assignee_id": None, "assignee_role": urole}],
         "status": {"$in": ["todo", "in_progress", "blocked"]}},
        {"_id": 0, "id": 1, "title": 1, "due_date": 1, "priority": 1,
         "status": 1, "workflow_id": 1, "stage_key": 1, "category": 1}
    ).sort([("due_date", 1)]).to_list(5)
    for t in my_open:
        due = t.get("due_date")
        t["is_overdue"] = bool(due and due < now)

    # Active workflows where the viewer owns the CURRENT stage -- pull via
    # tasks (workflow_id + stage_key == wf.current_stage). Cheap dedupe.
    wf_ids_seen = set()
    for t in my_open:
        wid = t.get("workflow_id")
        if wid:
            wf_ids_seen.add(wid)
    my_workflows = []
    if wf_ids_seen:
        wfs = await db.workflows.find(
            {"id": {"$in": list(wf_ids_seen)}, "tenant_id": tid},
            {"_id": 0, "id": 1, "title": 1, "type": 1, "stage": 1,
             "counterparty": 1, "amount": 1}
        ).to_list(len(wf_ids_seen))
        my_workflows = wfs

    # Peer context: rank in role. Frontend hides behind an opt-in toggle
    # until we ship the per-user privacy preference (Phase B follow-up).
    peer_context = None
    if urole and urole != "owner":
        role_members = await db.users.find(
            {"tenant_id": tid, "role": urole},
            {"_id": 0, "id": 1, "name": 1, "role": 1}
        ).to_list(200)
        if len(role_members) > 1:
            all_tasks = await db.tasks.find(
                {"tenant_id": tid}, {"_id": 0}).to_list(2000)
            ranked = _score_employees(all_tasks, role_members, now)
            ranked = [r for r in ranked if r["score"] is not None]
            if ranked:
                # rank of viewer within their role
                try:
                    my_rank = next(i for i, r in enumerate(ranked) if r["id"] == uid) + 1
                except StopIteration:
                    my_rank = None
                peer_context = {
                    "role": urole,
                    "role_peer_count": len(role_members),
                    "my_rank_in_role": my_rank,
                    "role_ranked_size": len(ranked),
                }

    return {
        "self": {"id": uid, "name": viewer.get("name"), "role": urole},
        "stats": stats,
        "my_open_work": my_open,
        "my_active_workflows": my_workflows,
        "peer_context": peer_context,
    }


async def compute_employee_stats(tenant_id: str, target: dict) -> dict:
    uid, role = target["id"], target.get("role")
    now = datetime.now(timezone.utc).isoformat()
    tasks = await db.tasks.find(
        {"tenant_id": tenant_id, "$or": [{"assignee_id": uid}, {"assignee_id": None, "assignee_role": role}]},
        {"_id": 0}).to_list(3000)
    done = [t for t in tasks if t.get("status") == "done"]
    open_tasks = [t for t in tasks if t.get("status") in ("todo", "in_progress", "blocked")]
    overdue = [t for t in open_tasks if t.get("due_date") and t["due_date"] < now]
    actionable = len(done) + len(open_tasks)

    def has_attach(t, kind=None):
        atts = t.get("attachments") or []
        return any((kind is None or a.get("kind") == kind) for a in atts) if atts else False

    done_with_proof = sum(1 for t in done if has_attach(t))
    with_plan = sum(1 for t in tasks if (t.get("execution_plan") or {}).get("status") == "accepted")
    plans_completed = sum(1 for t in tasks if (t.get("execution_plan") or {}).get("progress") == 100)
    photos = sum(len([a for a in (t.get("attachments") or []) if a.get("kind") == "photo"]) for t in tasks)
    voices = sum(len([a for a in (t.get("attachments") or []) if a.get("kind") == "voice"]) for t in tasks)
    return {
        "completed": len(done),
        "open": len(open_tasks),
        "overdue": len(overdue),
        "actionable": actionable,
        "completion_rate": round(len(done) / actionable * 100) if actionable else 0,
        "proof_upload_rate": round(done_with_proof / len(done) * 100) if done else 0,
        "plans_used": with_plan,
        "plans_completed": plans_completed,
        "photos_uploaded": photos,
        "voice_updates": voices,
    }


async def ai_work_coach(target: dict, stats: dict, session_id: str) -> dict:
    system = render("coaching.work_coach")
    prompt = (f"Employee: {target.get('name')} (role: {target.get('role')})\n"
              f"Stats: {json.dumps(stats)}\n"
              "Write the review now.")
    chat = claude_chat(task="coaching.work_coach", session_id=session_id, system_message=system).with_model(*model_for("coaching.work_coach"))
    resp = await chat.send_message(UserMessage(text=prompt))
    try:
        d = _extract_json(resp)
    except Exception as e:
        logger.error(f"AI work coach parse error: {e} :: {redact_pii(resp)[:300]}")
        d = {}
    return {
        "headline": str(d.get("headline") or "")[:200],
        "strengths": [str(s)[:120] for s in (d.get("strengths") or [])][:4],
        "improvements": [str(s)[:120] for s in (d.get("improvements") or [])][:3],
        "recommendation": str(d.get("recommendation") or "")[:240],
    }


async def _resolve_coach_target(user: dict, user_id: Optional[str]) -> dict:
    if user_id and user_id != user["id"]:
        if user.get("role") != "owner":
            raise HTTPException(status_code=403, detail="Only the owner can view others' coaching")
        target = await db.users.find_one({"id": user_id, "tenant_id": user["tenant_id"]}, {"_id": 0})
        if not target:
            raise HTTPException(status_code=404, detail="Employee not found")
        return target
    return user
