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


# ASK-5 / J11-02 (JOURNEY-1, founder 24 Sep) — WHO HOLDS THE APPROVALS WHILE
# SOMEBODY IS AWAY. A manager going on leave left every decision and escalation
# waiting on them, waiting on them: leave changed who was in the building and
# nothing else. The founder's rule is that an approver is ASKED to name a cover
# when they raise the leave, and the cover is switched on by the APPROVAL of
# that leave, for exactly the days of it.
#
# The mechanism already existed and nothing read it from here: `acting_as` on
# the user (RBAC-26, services/delegation) is a dated window, so the hand-back
# is not a job anybody has to run — the window simply ends. Withdrawing or
# rejecting the leave takes it off again.
APPROVAL_PERMS = ("approvals", "decisions_approve", "leave_approve")


def approves_things(user: dict) -> bool:
    """Whether this person has anything waiting on them to sign off."""
    from core import user_perms
    return user.get("role") == "owner" or bool(set(user_perms(user)) & set(APPROVAL_PERMS))


async def _set_cover(tenant_id: str, lv: dict) -> None:
    """Switch the cover on for the days of an approved leave."""
    delegate = (lv or {}).get("delegate_user_id")
    if not delegate or delegate == lv.get("user_id"):
        return
    who = await db.users.find_one({"id": delegate, "tenant_id": tenant_id}, {"_id": 0, "id": 1, "name": 1})
    if not who:
        return
    await db.users.update_one(
        {"id": lv["user_id"], "tenant_id": tenant_id},
        {"$set": {"acting_as": {
            "delegate_user_id": delegate,
            "from": lv["from_date"], "to": lv["to_date"],
            "reason": f"On leave ({lv.get('leave_type') or 'leave'})",
            "leave_id": lv["id"],
        }}})
    await push_notification(
        tenant_id, [delegate], 2,
        f"{lv.get('user_name')} is on leave {lv['from_date']}"
        + (f" to {lv['to_date']}" if lv["to_date"] != lv["from_date"] else "")
        + ". Their approvals come to you until they are back.",
        entity_type="leave", entity_id=lv["id"], ntype="handoff",
        title="Covering approvals", sender=lv.get("user_name"))
    await log_activity(tenant_id, lv["user_id"], "leave_cover_set",
                       f"{lv.get('user_name')}'s approvals go to {who.get('name')} while they are away",
                       "leave", lv["id"])


async def _clear_cover(tenant_id: str, lv: dict) -> None:
    """Take the cover off again — the leave was withdrawn, rejected or cancelled.
    Only the window THIS leave set; a cover somebody arranged by hand stays."""
    await db.users.update_one(
        {"id": (lv or {}).get("user_id"), "tenant_id": tenant_id, "acting_as.leave_id": (lv or {}).get("id")},
        {"$set": {"acting_as": None}})


async def _create_leave(tenant_id, requester, leave_type, from_date, to_date, day_portion, reason, is_emergency,
                        delegate_user_id=None):
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
        # ASK-5 — who covers this person's approvals while they are away. Kept
        # on the request so the approver can see it before they say yes.
        "delegate_user_id": (delegate_user_id or None) if approves_things(requester) else None,
        "info_note": None, "created_at": now,
        "decided_at": now if auto_approved else None,
        "decided_by": requester["id"] if auto_approved else None,
        "history": history,
    }
    await db.leaves.insert_one(doc)
    if auto_approved:
        await _set_cover(tenant_id, doc)      # ASK-5: recorded leave is approved leave
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
