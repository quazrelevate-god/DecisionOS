"""Leave & absence engine (Epic 8 Sprint 4 -- from server.py).

Approver resolution (reporting manager -> role mapping -> owner), leave-request
creation + approver notification, and the AI leave-impact analyzer used when a
leave is approved. Depends on core + services.notifications.
"""
import json

from emergentintegrations.llm.chat import UserMessage

from core import db, logger, new_id, now_iso, log_activity, claude_chat, LLM_MODEL, _extract_json
from services.notifications import push_notification


async def _resolve_leave_approver(tenant_id: str, requester: dict):
    """Approver priority: reporting manager → department/role mapping → owner."""
    rm = requester.get("reporting_manager_id")
    if rm:
        m = await db.users.find_one({"id": rm, "tenant_id": tenant_id}, {"_id": 0, "id": 1, "name": 1})
        if m:
            return m["id"], m.get("name")
    t = await db.tenants.find_one({"id": tenant_id}, {"_id": 0, "leave_approvers": 1})
    mapping = (t or {}).get("leave_approvers") or {}
    aid = mapping.get(requester.get("role"))
    if aid:
        m = await db.users.find_one({"id": aid, "tenant_id": tenant_id}, {"_id": 0, "id": 1, "name": 1})
        if m:
            return m["id"], m.get("name")
    owner = await db.users.find_one({"tenant_id": tenant_id, "role": "owner"}, {"_id": 0, "id": 1, "name": 1})
    if owner:
        return owner["id"], owner.get("name")
    return None, None


async def _create_leave(tenant_id, requester, leave_type, from_date, to_date, day_portion, reason, is_emergency):
    approver_id, approver_name = await _resolve_leave_approver(tenant_id, requester)
    lid = new_id()
    doc = {
        "id": lid, "tenant_id": tenant_id, "user_id": requester["id"],
        "user_name": requester.get("name"), "user_role": requester.get("role"),
        "leave_type": leave_type, "from_date": from_date[:10], "to_date": to_date[:10],
        "day_portion": day_portion if day_portion in ("full", "half") else "full",
        "reason": reason or "", "is_emergency": bool(is_emergency),
        "status": "pending", "approver_id": approver_id, "approver_name": approver_name,
        "info_note": None, "created_at": now_iso(), "decided_at": None, "decided_by": None,
        "history": [{"action": "submitted", "by": requester["id"], "by_name": requester.get("name"), "note": reason or "", "at": now_iso()}],
    }
    await db.leaves.insert_one(doc)
    label = "Emergency absence" if is_emergency else f"{leave_type.title()} leave"
    msg = f"{requester.get('name')} — {label} ({doc['from_date']}" + (f" → {doc['to_date']}" if doc['to_date'] != doc['from_date'] else "") + ")"
    await push_notification(tenant_id, [approver_id], 3 if is_emergency else 2, msg,
                            entity_type="leave", entity_id=lid, ntype="approval",
                            title=label, sender=requester.get("name"))
    await log_activity(tenant_id, requester["id"], "leave_requested", msg, "leave", lid)
    doc.pop("_id", None)
    return doc


async def ai_leave_impact(person_name: str, from_date: str, to_date: str, tasks: list, members: list) -> dict:
    if not tasks:
        return {"summary": "No active tasks are affected by this leave.", "suggestions": []}
    system = (
        "You are an operations manager for an Indian SME. A team member is going on leave and their active tasks are "
        "at risk. For EACH task, recommend exactly ONE action to keep work on track:\n"
        "- 'reassign': hand it to an available teammate — prefer someone with the same or adjacent role and the LOWEST "
        "current workload (active_task_count). Only choose an assignee_id from the available_members list.\n"
        "- 'extend': push the due date to shortly AFTER the person returns (a day or two after leave_to), only when the "
        "task can safely wait and shouldn't move to someone else.\n"
        "- 'monitor': leave as-is (low priority, almost done, or nothing to do now).\n"
        "Return STRICT JSON: {\"summary\": string (one plain-English sentence), \"suggestions\": [{\"task_id\": string, "
        "\"action\": \"reassign\"|\"extend\"|\"monitor\", \"assignee_id\": string (required only if reassign, must be from "
        "available_members), \"assignee_name\": string, \"due_date\": \"YYYY-MM-DD\" (required only if extend), "
        "\"reason\": string (short)}]}. Every input task_id MUST appear exactly once. If there are no available_members, "
        "do not use 'reassign'."
    )
    payload = {
        "person_on_leave": person_name, "leave_from": from_date, "leave_to": to_date,
        "at_risk_tasks": [{"task_id": t["id"], "title": t.get("title"), "priority": t.get("priority"),
                           "status": t.get("status"), "due_date": (t.get("due_date") or "")[:10]} for t in tasks],
        "available_members": [{"id": m["id"], "name": m["name"], "role": m["role"],
                               "active_task_count": m["load"]} for m in members],
    }
    chat = claude_chat(session_id=f"leave-impact-{new_id()}", system_message=system).with_model(*LLM_MODEL)
    resp = await chat.send_message(UserMessage(text=json.dumps(payload)))
    data = _extract_json(resp)
    return data if isinstance(data, dict) else {"summary": "", "suggestions": []}
