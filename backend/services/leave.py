"""Leave & absence engine (Epic 8 Sprint 4 -- from server.py).

Approver resolution (reporting manager -> role mapping -> owner), leave-request
creation + approver notification, and the AI leave-impact analyzer used when a
leave is approved. Depends on core + services.notifications.
"""
import json

from emergentintegrations.llm.chat import UserMessage

from core import db, new_id, now_iso, log_activity, claude_chat, _extract_json
from services.notifications import push_notification
from core import model_for
from prompts import render


async def _resolve_leave_approver(tenant_id: str, requester: dict):
    """Who signs off this person's leave — reporting manager → department/role
    mapping → an owner — and NEVER the requester themselves.

    An owner sits at the top of the company: nobody approves their leave, so they
    RECORD it rather than request it. And any chain that would point a request
    back at the person who raised it (a manager who is themselves, a role mapping
    to self) falls through to the next rung, so no one ever approves their own
    leave. Returns (approver_id, approver_name); (None, None) means no one signs
    it off — the caller records the leave as already approved."""
    rid = requester["id"]
    # An owner has nobody above them — their own leave is recorded, not requested.
    if requester.get("role") == "owner":
        return None, None
    rm = requester.get("reporting_manager_id")
    if rm and rm != rid:
        m = await db.users.find_one({"id": rm, "tenant_id": tenant_id}, {"_id": 0, "id": 1, "name": 1})
        if m:
            return m["id"], m.get("name")
    t = await db.tenants.find_one({"id": tenant_id}, {"_id": 0, "leave_approvers": 1})
    mapping = (t or {}).get("leave_approvers") or {}
    aid = mapping.get(requester.get("role"))
    if aid and aid != rid:
        m = await db.users.find_one({"id": aid, "tenant_id": tenant_id}, {"_id": 0, "id": 1, "name": 1})
        if m:
            return m["id"], m.get("name")
    # The owner fallback — but never the requester (a co-owner in a multi-owner
    # company must not have their own request routed back to them).
    owner = await db.users.find_one(
        {"tenant_id": tenant_id, "role": "owner", "id": {"$ne": rid}}, {"_id": 0, "id": 1, "name": 1})
    if owner:
        return owner["id"], owner.get("name")
    return None, None


async def _create_leave(tenant_id, requester, leave_type, from_date, to_date, day_portion, reason, is_emergency):
    approver_id, approver_name = await _resolve_leave_approver(tenant_id, requester)
    # No one above the requester to sign it off (an owner, or a company with no
    # other approver): the leave is RECORDED, not requested — created already
    # approved so nobody has to approve their own time off.
    auto_approved = approver_id is None
    lid = new_id()
    now = now_iso()
    history = [{"action": "submitted", "by": requester["id"], "by_name": requester.get("name"),
                "note": reason or "", "at": now}]
    if auto_approved:
        history.append({"action": "approved", "by": requester["id"], "by_name": requester.get("name"),
                        "note": "Auto-approved — no approver above the requester", "at": now})
    doc = {
        "id": lid, "tenant_id": tenant_id, "user_id": requester["id"],
        "user_name": requester.get("name"), "user_role": requester.get("role"),
        "leave_type": leave_type, "from_date": from_date[:10], "to_date": to_date[:10],
        "day_portion": day_portion if day_portion in ("full", "half") else "full",
        "reason": reason or "", "is_emergency": bool(is_emergency),
        "status": "approved" if auto_approved else "pending",
        "approver_id": approver_id, "approver_name": approver_name,
        "info_note": None, "created_at": now,
        "decided_at": now if auto_approved else None,
        "decided_by": requester["id"] if auto_approved else None,
        "history": history,
    }
    await db.leaves.insert_one(doc)
    label = "Emergency absence" if is_emergency else f"{leave_type.title()} leave"
    span = doc["from_date"] + (f" → {doc['to_date']}" if doc["to_date"] != doc["from_date"] else "")
    if auto_approved:
        # Nobody to ask; just record it — it lands on the calendar / "on leave
        # today" like any approved leave, without a self-approval step.
        await log_activity(tenant_id, requester["id"], "leave_recorded",
                           f"{requester.get('name')} recorded {label.lower()} ({span})", "leave", lid)
    else:
        msg = f"{requester.get('name')} — {label} ({span})"
        await push_notification(tenant_id, [approver_id], 3 if is_emergency else 2, msg,
                                entity_type="leave", entity_id=lid, ntype="approval",
                                title=label, sender=requester.get("name"))
        await log_activity(tenant_id, requester["id"], "leave_requested", msg, "leave", lid)
    doc.pop("_id", None)
    return doc


async def ai_leave_impact(person_name: str, from_date: str, to_date: str, tasks: list, members: list) -> dict:
    if not tasks:
        return {"summary": "No active tasks are affected by this leave.", "suggestions": []}
    system = render("coaching.leave_impact")
    payload = {
        "person_on_leave": person_name, "leave_from": from_date, "leave_to": to_date,
        "at_risk_tasks": [{"task_id": t["id"], "title": t.get("title"), "priority": t.get("priority"),
                           "status": t.get("status"), "due_date": (t.get("due_date") or "")[:10]} for t in tasks],
        "available_members": [{"id": m["id"], "name": m["name"], "role": m["role"],
                               "active_task_count": m["load"]} for m in members],
    }
    chat = claude_chat(task="coaching.leave_impact", session_id=f"leave-impact-{new_id()}", system_message=system).with_model(*model_for("coaching.leave_impact"))
    resp = await chat.send_message(UserMessage(text=json.dumps(payload)))
    data = _extract_json(resp)
    return data if isinstance(data, dict) else {"summary": "", "suggestions": []}
