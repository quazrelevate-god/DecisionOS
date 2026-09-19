"""Voice-note / directive processing pipeline (Epic 8 Sprint 4 -- from server.py).

Transcribe -> AI-extract -> a PENDING decision that carries a proposal (tasks,
workflows, meetings, reminders, memory notes). Nothing in the proposal exists
until the decision is approved: services.decision_flow calls
materialize_proposal() then (ASK-32 decision flow Phase 1, 2026-09-15).
Member-matching + smart-assignment helpers live here too (also used by
services.meetings). Cross-domain helpers still in server (tenant_operating_model,
_read_reference_text, add_inbox_item) are imported deferred to avoid a cycle.
"""
import re
from datetime import datetime, timezone, timedelta
from typing import Optional

from core import (
    db, logger, new_id, now_iso, set_usage_tenant, tenant_role_keys, log_activity,
)
from services.transcription import transcribe_audio_full
from services.ai.extraction import ai_extract
from services.tasks import _attach_reference_ids
# ASK-32 Phase 2 — who decides (capturer, else their manager, else the owner) and who is told.
from services.decision_flow import notify_decision_waiting, route_approver


def match_member_by_name(members: list, name: str):
    n = re.sub(r"[^a-z ]", "", (name or "").lower()).strip()
    if not n or not members:
        return None
    for m in members:  # exact (case-insensitive) full-name match
        if (m.get("name") or "").lower().strip() == n:
            return m
    tokens = set(n.split())
    best = None
    for m in members:  # first-name / token overlap
        mtoks = set((m.get("name") or "").lower().split())
        if tokens & mtoks:
            best = m
            break
    return best


_WEEKDAYS = {"monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3, "friday": 4, "saturday": 5, "sunday": 6}


def _resolve_meeting_date(when: str, due_in_days) -> str:
    """Resolve a meeting's natural-language timing into an ISO date (YYYY-MM-DD).
    Explicit day references in `when` take priority over the LLM's due_in_days heuristic."""
    now = datetime.now(timezone.utc)
    w = (when or "").lower()
    if "today" in w:
        return now.date().isoformat()
    if "tomorrow" in w:
        return (now + timedelta(days=1)).date().isoformat()
    for name, idx in _WEEKDAYS.items():
        if name in w:
            ahead = (idx - now.weekday()) % 7 or 7  # next occurrence, not today
            if "next" in w:
                ahead += 7
            return (now + timedelta(days=ahead)).date().isoformat()
    if isinstance(due_in_days, int):
        return (now + timedelta(days=due_in_days)).date().isoformat()
    if "next week" in w:
        return (now + timedelta(days=7)).date().isoformat()
    return (now + timedelta(days=2)).date().isoformat()


async def pick_least_loaded_member(tenant_id: str, role: str) -> Optional[str]:
    """Auto-assignment (E3-13): the ACTIVE role member with the fewest open (not
    done/cancelled) tasks, with a DETERMINISTIC tiebreak (by id) when loads are equal.
    Returns None when the role has no assignable member. Never raises."""
    if not role:
        return None
    try:
        members = await db.users.find({"tenant_id": tenant_id, "role": role}, {"_id": 0, "id": 1}).to_list(200)
        if not members:
            return None
        # Only auto-assign to ACTIVE members -- never to a suspended/removed/pending person.
        # Honor membership data strictly when it exists; fail open for legacy tenants without it.
        active_ids = {r.get("user_id") for r in await db.memberships.find(
            {"tenant_id": tenant_id, "status": "active"}, {"_id": 0, "user_id": 1}).to_list(1000)}
        if active_ids:
            members = [m for m in members if m["id"] in active_ids]
            if not members:
                return None
        if len(members) == 1:
            return members[0]["id"]
        # S9 (U8-09.1): one aggregation instead of a count_documents per member
        # (this runs on every auto-assign -- voice + agent). Members with zero
        # open tasks don't appear in the group result and default to 0.
        member_ids = [m["id"] for m in members]
        cur = await db.tasks.aggregate([
            {"$match": {"tenant_id": tenant_id, "assignee_id": {"$in": member_ids},
                        "status": {"$nin": ["done", "cancelled"]}}},
            {"$group": {"_id": "$assignee_id", "n": {"$sum": 1}}},
        ])
        counts = {r["_id"]: r["n"] for r in await cur.to_list(len(member_ids))}
        loads = sorted((counts.get(m["id"], 0), m["id"]) for m in members)  # (load asc, id asc): deterministic
        return loads[0][1]
    except Exception as e:
        logger.warning(f"pick_least_loaded_member failed: {e}")
        return None


async def resolve_assignee(tenant_id: str, *, role: str = None, assignee_name: str = None,
                           members: list = None) -> dict:
    """The single entry point for auto-assigning an AI-generated task to a PERSON (E3-13).
    Priority: an explicitly-named person -> the sole active member of the role -> the
    least-loaded active member -> unassigned (role only). Returns
    {assignee_id, role, how} where how is 'named' | 'load' | 'unassigned'. Never raises."""
    role = (role or "").strip().lower() or None
    try:
        if assignee_name:
            if members is None:
                members = await db.users.find(
                    {"tenant_id": tenant_id}, {"_id": 0, "id": 1, "name": 1, "role": 1}).to_list(500)
            m = match_member_by_name(members, assignee_name)
            if m:
                return {"assignee_id": m["id"], "role": (m.get("role") or role), "how": "named"}
        if role:
            aid = await pick_least_loaded_member(tenant_id, role)
            if aid:
                return {"assignee_id": aid, "role": role, "how": "load"}
    except Exception as e:
        logger.warning(f"resolve_assignee failed: {e}")
    return {"assignee_id": None, "role": role, "how": "unassigned"}


# ---------------------------------------------------------------------------
# ASK-32 decision flow Phase 1 — the proposal.
# What the AI read is resolved into concrete items at capture (who each task
# goes to, which pipeline a workflow joins, the meeting date) so the approver
# sees exactly what approving will create. Nothing is written but the decision.
# ---------------------------------------------------------------------------
PROPOSAL_KINDS = ("tasks", "workflows", "meetings", "reminders", "memory_notes")


def proposal_is_empty(proposal: Optional[dict]) -> bool:
    """Nothing to act on: no task, workflow, meeting, reminder or note."""
    return not any((proposal or {}).get(k) for k in PROPOSAL_KINDS)


# What the proposal would actually CREATE, as opposed to remember.
ACTIONABLE_KINDS = ("tasks", "workflows", "meetings", "reminders")


def decision_worthy(extracted: Optional[dict], proposal: Optional[dict]) -> bool:
    """Is this capture a decision, or just news?

    2026-09-16 — the Desk was raising decisions for remarks. "The new office
    chairs arrived and everyone likes them" came back as a decision titled
    "Office chairs received and approved by team": nothing to do, nothing to
    choose, and an owner asked to approve it. The old gate only refused a
    capture that produced NOTHING at all, so a single memory note was enough to
    put a card on someone's desk.

    A decision is work being directed, or a rule being set:
      * anything the proposal would CREATE — a task, a workflow move, a meeting,
        a reminder — is work, so it is a decision;
      * with nothing to create, it is a decision only if the owner stated one:
        a directive, an approval, or a policy. The AI's own "observation" type
        (and a capture it read as no decision at all) is news, not a decision.

    News with a lasting fact in it is kept in the company brain instead — see
    the `noted` outcome in process_voice_note. Nothing is lost; nobody is asked
    to approve the weather.
    """
    if any((proposal or {}).get(k) for k in ACTIONABLE_KINDS):
        return True
    items = [i for i in ((extracted or {}).get("decisions") or []) if isinstance(i, dict)]
    return any((i.get("type") or "directive") != "observation" for i in items)


async def save_memory_notes(tenant_id: str, user_id: str, notes, decision_id=None) -> int:
    """Keep the lasting facts from a capture in the company brain. Returns how
    many were written. Used both when a decision is approved and when a capture
    turned out to be news worth remembering rather than a decision."""
    written = 0
    for m in (notes or []):
        if not (m or {}).get("text"):
            continue
        await db.memory.insert_one({
            "id": new_id(), "tenant_id": tenant_id, "text": m["text"],
            "tag": m.get("tag", "note"), "created_by": user_id, "created_at": now_iso(),
            "decision_id": decision_id,
        })
        written += 1
    return written


def _words(text: str) -> set:
    return set(re.findall(r"[a-z0-9]+", (text or "").lower()))


def looks_alike(a: str, b: str, threshold: float = 0.8) -> bool:
    """Two captures read the same: most of their words overlap (Jaccard)."""
    wa, wb = _words(a), _words(b)
    if not wa or not wb:
        return False
    return len(wa & wb) / len(wa | wb) >= threshold


# Words that do not identify a customer or supplier ("Kapoor Retail Pvt Ltd" = "Kapoor Retail").
_PARTY_NOISE = {"pvt", "ltd", "limited", "private", "co", "and", "the", "llp", "inc", "company", "corp"}


def party_words(name: str) -> set:
    return {w for w in _words(name) if w not in _PARTY_NOISE and len(w) > 2}


def same_party(a: str, b: str) -> bool:
    """One name contains the other's identifying words: "Gujarat Cotton Mills"
    and "Gujarat Cotton Mills Ltd"; "Toyota" and "Toyota Kirloskar"."""
    wa, wb = party_words(a), party_words(b)
    return bool(wa and wb and (wa <= wb or wb <= wa))


def mentioned_stage(stage_objs: list, text: str, after_index: int = -1):
    """The furthest stage (after `after_index`) whose name the text mentions —
    "move the Toyota order to dispatched" -> Dispatched. None when no stage is named."""
    hay = f" {' '.join(re.findall(r'[a-z0-9]+', (text or '').lower()))} "
    found = None
    for i, s in enumerate(stage_objs or []):
        if i <= after_index:
            continue
        name = " ".join(re.findall(r"[a-z0-9]+", (s.get("label") or s.get("key", "").replace("_", " ")).lower()))
        if name and f" {name} " in hay:
            found = i
    return found


REPEAT_WINDOW_HOURS = 24


async def find_repeat(tenant_id: str, title: str, summary: str) -> Optional[dict]:
    """A decision still waiting from the last day that says the same thing."""
    since = (datetime.now(timezone.utc) - timedelta(hours=REPEAT_WINDOW_HOURS)).isoformat()
    async for d in db.decisions.find(
            {"tenant_id": tenant_id, "status": {"$in": ["pending", "pending_approval"]}, "created_at": {"$gte": since}},
            {"_id": 0, "id": 1, "title": 1, "summary": 1}).sort("created_at", -1):
        if looks_alike(title, d.get("title")) or (summary and looks_alike(summary, d.get("summary"))):
            return {"id": d["id"], "title": d.get("title")}
    return None


async def build_proposal(tenant_id, extracted, troles, members, cat_keys, pipelines) -> dict:
    """Turn the AI extraction into the concrete items approving would create."""
    now = datetime.now(timezone.utc)
    cat_keys = cat_keys or set()
    tasks = []
    for t in extracted.get("tasks") or []:
        role = t.get("assignee_role") if t.get("assignee_role") in troles else None
        assignee_id, how = None, "unassigned"
        member = match_member_by_name(members, t.get("assignee_name", ""))
        if member:
            assignee_id, role, how = member["id"], member["role"], "named"
        elif role:
            # Smart assignment: distribute role-level tasks to the least-loaded member.
            assignee_id = await pick_least_loaded_member(tenant_id, role)
            how = "load" if assignee_id else "team"
        due = None
        if isinstance(t.get("due_in_days"), int):
            due = (now + timedelta(days=t["due_in_days"])).isoformat()
        tasks.append({
            "key": new_id(), "title": t.get("title") or "Untitled task",
            "description": t.get("description", ""), "assignee_id": assignee_id,
            "assignee_role": role, "assignee_how": how,
            "priority": t.get("priority") if t.get("priority") in ("low", "medium", "high") else "medium",
            "due_date": due,
            "task_type": t.get("task_category") if t.get("task_category") in cat_keys else None,
        })
    pmap = {p["key"]: p for p in (pipelines or [])}
    # ASK-32 Phase 4.1 — look at what is already on the board first, so a
    # message about an order that exists moves/links THAT card instead of
    # making a second one. Open = not yet at its last stage.
    open_wfs = [w for w in await db.workflows.find(
        {"tenant_id": tenant_id},
        {"_id": 0, "id": 1, "type": 1, "title": 1, "counterparty": 1, "contact_id": 1, "stage": 1, "stages": 1},
    ).sort("created_at", -1).to_list(500) if w.get("stages") and w.get("stage") != w["stages"][-1]]
    workflows, claimed = [], set()
    for ev in extracted.get("workflow_events") or []:
        pipeline = pmap.get(ev.get("type"))
        stages = [s["key"] for s in (pipeline or {}).get("stages") or []]
        if not pipeline or not stages:
            continue
        cp = (ev.get("counterparty") or "").strip()
        contact_id = None
        if cp:
            c = await db.contacts.find_one({"tenant_id": tenant_id, "$or": [
                {"name": {"$regex": f"^{re.escape(cp)}$", "$options": "i"}},
                {"company": {"$regex": f"^{re.escape(cp)}$", "$options": "i"}}]}, {"_id": 0, "id": 1})
            contact_id = (c or {}).get("id")
        title = (ev.get("title") or ev.get("action") or pipeline.get("label") or "").strip()
        amount = ev.get("amount") if isinstance(ev.get("amount"), (int, float)) else None
        match = next((w for w in open_wfs if w["id"] not in claimed and w.get("type") == ev["type"] and (
            (contact_id and w.get("contact_id") == contact_id)
            or (cp and same_party(cp, w.get("counterparty")))
            or (not cp and looks_alike(title, w.get("title"), 0.6)))), None)
        if match:
            claimed.add(match["id"])
            wstages = match["stages"]
            cur = wstages.index(match["stage"]) if match.get("stage") in wstages else 0
            to = mentioned_stage(pipeline["stages"], f"{title} {ev.get('detail') or ''}", after_index=cur)
            workflows.append({
                "key": new_id(), "mode": "existing", "workflow_id": match["id"], "type": ev["type"],
                "pipeline_label": pipeline.get("label"), "title": match.get("title") or title,
                "detail": ev.get("detail", ""), "amount": amount, "counterparty": match.get("counterparty") or cp,
                "said_counterparty": cp, "stages": wstages, "stage": match.get("stage"),
                "move_to": wstages[to] if to is not None and to < len(wstages) else None,
            })
            continue
        workflows.append({
            "key": new_id(), "mode": "new", "type": ev["type"], "pipeline_label": pipeline.get("label"),
            "title": title, "detail": ev.get("detail", ""), "amount": amount,
            "counterparty": cp, "contact_id": contact_id, "stages": stages, "stage": stages[0],
        })
    meetings = [{"key": new_id(), "title": (mt.get("title") or "Meeting").strip(),
                 "when": (mt.get("when") or "").strip(),
                 "date": _resolve_meeting_date((mt.get("when") or "").strip(), mt.get("due_in_days"))}
                for mt in extracted.get("meeting_events") or []]
    reminders = []
    for r in extracted.get("reminders") or []:
        due = (now + timedelta(days=r["due_in_days"])).isoformat() if isinstance(r.get("due_in_days"), int) else None
        reminders.append({"key": new_id(), "title": r.get("title") or "Reminder", "due_date": due})
    memory_notes = [{"key": new_id(), "text": m["text"], "tag": m.get("tag", "note")}
                    for m in extracted.get("memory_notes") or [] if m.get("text")]
    # ASK-32 Phase 4.2 — a task about a customer or supplier that has a workflow
    # joins it by itself: first a workflow this decision proposes, else an open
    # one on the board. A task about nobody in particular stays a plain task.
    def mentions(words, *names):
        return any(party_words(n) and party_words(n) <= words for n in names)

    for t in tasks:
        words = _words(f"{t['title']} {t.get('description') or ''}")
        # The board's name ("Toyota Kirloskar Pvt Ltd") or the name as it was said ("Toyota").
        item = next((w for w in workflows if mentions(words, w.get("counterparty"), w.get("said_counterparty"))), None)
        if item:
            t.update({"workflow_key": item["key"], "workflow_title": item.get("title")})
            continue
        wf = next((w for w in open_wfs if w["id"] not in claimed and party_words(w.get("counterparty"))
                   and party_words(w.get("counterparty")) <= words), None)
        if wf:
            t.update({"workflow_id": wf["id"], "workflow_title": wf.get("title"), "workflow_stage": wf.get("stage")})
    return {"tasks": tasks, "workflows": workflows, "meetings": meetings,
            "reminders": reminders, "memory_notes": memory_notes}


def summarize_proposal(proposal: dict) -> dict:
    """The execution summary shape the Desk and Dex already read, from a proposal."""
    p = proposal or {}
    people = {f"u:{t['assignee_id']}" if t.get("assignee_id") else f"r:{t.get('assignee_role')}"
              for t in p.get("tasks") or [] if t.get("assignee_id") or t.get("assignee_role")}
    return {
        "tasks": len(p.get("tasks") or []), "assignees": len(people),
        "approvals": 1 if p.get("tasks") else 0,
        "workflows": len(p.get("workflows") or []), "meetings": len(p.get("meetings") or []),
        "reminders": len(p.get("reminders") or []),
    }


async def _default_approver_for(tenant_id, decision, on_task):
    """ASK-50 — who approves a decision's task when the proposal named nobody:
    exactly who New Task would pick for the person who raised the decision
    (their reporting manager when the manager may approve and is not on the
    task, else the owner) — the tasks are created "asked by" them."""
    from routers.tasks import _default_task_approver
    creator = await db.users.find_one({"id": decision.get("created_by"), "tenant_id": tenant_id},
                                      {"_id": 0, "id": 1, "role": 1, "reporting_manager_id": 1}) or {}
    creator = {**creator, "id": creator.get("id") or decision.get("created_by"), "tenant_id": tenant_id}
    return await _default_task_approver(creator, frozenset(x for x in on_task if x))


async def _create_decision_tasks(tenant_id, decision, items):
    """Create the decision's tasks on approval; returns their ids.
    ASK-50 — with the proof and approval the proposal was given
    (services.proposal_task_settings.creation_fields): the same fields, and the
    same lock before work starts, that New Task writes."""
    from services.proposal_task_settings import creation_fields
    task_ids = []
    for t in items or []:
        tid = new_id()
        default_approver = None
        if t.get("approval_required") and not t.get("approver_id"):
            default_approver = await _default_approver_for(
                tenant_id, decision, {decision.get("created_by"), t.get("assignee_id")})
        settings = creation_fields(t, default_approver)
        await db.tasks.insert_one({
            "id": tid, "tenant_id": tenant_id, "title": t.get("title") or "Untitled task",
            "description": t.get("description", ""), "assignee_role": t.get("assignee_role"),
            "assignee_id": t.get("assignee_id"), "priority": t.get("priority") or "medium",
            "due_date": t.get("due_date"), "decision_id": decision["id"],
            **settings,
            "task_type": t.get("task_type"), "created_by": decision.get("created_by"),
            "source": decision.get("source") or "voice", "created_at": now_iso(),
            # WE-01 / ASK-32 4.2: the workflow the proposal tied it to, else filled
            # in by _link_tasks_to_workflows once the workflows exist.
            "workflow_id": t.get("workflow_id"), "stage_key": t.get("stage_key"),
            "updated_at": now_iso(), "last_action": "Created",
        })
        task_ids.append(tid)
    return task_ids


async def _create_reminders_and_memory(tenant_id, note, proposal):
    """Voice shortcuts: lightweight personal reminders + lasting company memory."""
    for r in (proposal.get("reminders") or []):
        await db.tasks.insert_one({
            "id": new_id(), "tenant_id": tenant_id, "title": r.get("title", "Reminder"),
            "description": "", "assignee_role": None, "assignee_id": note["created_by"],
            "priority": "medium", "status": "todo", "due_date": r.get("due_date"),
            "decision_id": note.get("decision_id"), "source": "reminder", "created_at": now_iso(),
        })
    await save_memory_notes(tenant_id, note["created_by"], proposal.get("memory_notes"),
                            decision_id=note.get("decision_id"))


async def _create_meetings(tenant_id, note, decision_id, meetings):
    """Schedule a real calendar event + a lightweight to-do per approved meeting; returns the list."""
    for mt in meetings or []:
        when = (mt.get("when") or "").strip()
        title = (mt.get("title") or "Meeting").strip()
        await db.calendar_events.insert_one({
            "id": new_id(), "tenant_id": tenant_id, "date": mt.get("date") or _resolve_meeting_date(when, None),
            "title": title, "when_text": when, "decision_id": decision_id, "source": "voice",
            "created_by": note["created_by"], "created_at": now_iso(),
        })
        await db.tasks.insert_one({
            "id": new_id(), "tenant_id": tenant_id,
            "title": title + (f" ({when})" if when else ""),
            "description": "", "assignee_role": None, "assignee_id": note["created_by"],
            "priority": "medium", "status": "todo", "due_date": None, "decision_id": decision_id,
            "source": "meeting", "created_at": now_iso(),
        })
    return meetings or []


async def _create_workflows(tenant_id, note, decision_id, items):
    """Materialize each approved workflow into a real board card; returns the created ids."""
    wf_ids = []
    for w in items or []:
        stages = w.get("stages") or []
        if not stages:
            continue
        wid = new_id()
        await db.workflows.insert_one({
            "id": wid, "tenant_id": tenant_id, "type": w["type"], "title": w.get("title") or w.get("pipeline_label") or "",
            "detail": w.get("detail", ""), "amount": w.get("amount"), "counterparty": w.get("counterparty") or "",
            "contact_id": w.get("contact_id"),
            "stage": stages[0], "stages": stages,
            "stage_version": 0,
            "history": [{"stage": stages[0], "note": "Created by an approved decision", "by": note["created_by"], "at": now_iso()}],
            "source": "voice", "decision_id": decision_id,
            "created_by": note["created_by"], "created_at": now_iso(),
        })
        wf_ids.append(wid)
    return wf_ids


async def _link_tasks_to_workflows(tenant_id, task_ids, wf_ids, fallback=True):
    """WE-01 / WE-01.5: each task is routed to the workflow whose pipeline has a
    stage its ROLE owns; tasks no pipeline claims fall back to the first
    workflow's current stage (never a workflow picked at random).
    fallback=False (ASK-32 4.2): a task no stage claims stays a plain task."""
    if not (wf_ids and task_ids):
        return
    from services.ai.generators import tenant_operating_model
    from services.workflows import stage_owned_by  # WE-01.5
    tk_rows = await db.tasks.find({"id": {"$in": task_ids}, "tenant_id": tenant_id},
                                  {"_id": 0, "id": 1, "assignee_role": 1}).to_list(len(task_ids))
    wfs = await db.workflows.find({"id": {"$in": wf_ids}, "tenant_id": tenant_id},
                                  {"_id": 0, "id": 1, "type": 1, "stage": 1}).to_list(len(wf_ids))
    om = await tenant_operating_model(tenant_id)
    pipelines = {p.get("key"): p for p in (om or {}).get("pipelines") or [] if p.get("key")}
    wf_map = [{"wf": wf, "pipeline": pipelines.get(wf.get("type") or "")} for wf in wfs]
    first = wf_map[0] if wf_map else None
    for tk in tk_rows:
        role = (tk.get("assignee_role") or "").strip()
        chosen_wf, chosen_stage = None, None
        for entry in wf_map:
            sk = stage_owned_by(entry["pipeline"], role) if entry["pipeline"] else None
            if sk:
                chosen_wf, chosen_stage = entry["wf"]["id"], sk
                break
        if not chosen_wf and first and fallback:
            chosen_wf, chosen_stage = first["wf"]["id"], first["wf"].get("stage")
        if chosen_wf:
            await db.tasks.update_one({"id": tk["id"], "tenant_id": tenant_id},
                                      {"$set": {"workflow_id": chosen_wf, "stage_key": chosen_stage}})


async def materialize_proposal(tenant_id: str, decision: dict) -> dict:
    """Create everything an approved decision proposed. Returns what was made."""
    p = decision.get("proposal") or {}
    note = {"created_by": decision.get("created_by"), "decision_id": decision["id"]}
    # ASK-32 Phase 4: new workflows are created; existing ones are only linked
    # (and moved later by services.decision_flow when the proposal says so).
    items = [w for w in p.get("workflows") or [] if w.get("stages")]
    new_items = [w for w in items if w.get("mode") != "existing"]
    new_ids = await _create_workflows(tenant_id, note, decision["id"], new_items)
    key_to_id = {w["key"]: wid for w, wid in zip(new_items, new_ids)}
    existing_ids = []
    for w in items:
        if w.get("mode") == "existing" and w.get("workflow_id"):
            key_to_id[w["key"]] = w["workflow_id"]
            existing_ids.append(w["workflow_id"])
    task_items = []
    for t in p.get("tasks") or []:
        t = dict(t)
        t["workflow_id"] = key_to_id.get(t.get("workflow_key")) or t.get("workflow_id")
        task_items.append(t)
    linked = {t["workflow_id"] for t in task_items if t.get("workflow_id")}
    stage_of_wf = {w["id"]: w.get("stage") async for w in db.workflows.find(
        {"tenant_id": tenant_id, "id": {"$in": list(linked)}}, {"_id": 0, "id": 1, "stage": 1})} if linked else {}
    for t in task_items:
        t["stage_key"] = stage_of_wf.get(t.get("workflow_id")) if t.get("workflow_id") else None
    task_ids = await _create_decision_tasks(tenant_id, decision, task_items)
    ref_ids = decision.get("reference_file_ids") or []
    if ref_ids and task_ids:
        # Attach the uploaded reference file(s) to every task this decision produced.
        for tid in task_ids:
            await _attach_reference_ids(tenant_id, decision.get("created_by"), tid, ref_ids)
    await _create_reminders_and_memory(tenant_id, note, p)
    meetings = await _create_meetings(tenant_id, note, decision["id"], p.get("meetings"))
    # A task not tied to a customer/supplier joins one of this decision's
    # workflows only when a stage there belongs to its team; otherwise it
    # stays a plain task (no blind "first workflow" fallback).
    unlinked = [tid for tid, t in zip(task_ids, task_items) if not t.get("workflow_id")]
    await _link_tasks_to_workflows(tenant_id, unlinked, list(key_to_id.values()), fallback=False)
    return {"task_ids": task_ids, "workflow_ids": new_ids, "linked_workflow_ids": existing_ids,
            "meetings": len(meetings), "reminders": len(p.get("reminders") or []),
            "memory_notes": len(p.get("memory_notes") or [])}


async def process_voice_note(note_id: str, hold: bool = False):
    """hold=True (ASK-32 1.6): transcribe only and stop at status "transcribed"
    so the person can review the words; POST /voice-notes/{id}/submit sends the
    same note on to be structured — one recording, one decision."""
    note = await db.voice_notes.find_one({"id": note_id})
    if not note:
        return
    tenant_id = note["tenant_id"]
    set_usage_tenant(tenant_id)
    from services.ai.generators import tenant_operating_model
    from services.files import _read_reference_text
    from services.inbox import add_inbox_item
    try:
        # 2026-09-16 — say it up front. Every AI call behind this point raises
        # 451 ai_consent_required when the workspace has not agreed to AI
        # processing, and the pipeline used to swallow that and record the
        # capture as "nothing to decide" — so a workspace with AI switched off
        # was told its decisions were empty. Checked here, before speech-to-text
        # and before the model, so nothing is spent on a call that cannot work
        # and the Desk can say what is actually wrong.
        from services.ai_consent import has_active_consent, consent_error_detail
        _tenant = await db.tenants.find_one({"id": tenant_id}, {"_id": 0, "ai_consent": 1})
        if not has_active_consent(_tenant):
            await db.voice_notes.update_one({"id": note_id}, {"$set": {
                "status": "failed", "error": consent_error_detail(_tenant), "processed_at": now_iso()}})
            await log_activity(tenant_id, note["created_by"], "capture_ai_off",
                               "A capture could not be read: AI processing is off for this workspace",
                               "voice_note", note_id)
            return
        await db.voice_notes.update_one({"id": note_id}, {"$set": {"status": "transcribing"}})
        transcript = note.get("transcript")
        detected_code = note.get("detected_language")
        detected_name = note.get("detected_language_name")
        if not transcript and note.get("audio_path"):
            stt = await transcribe_audio_full(note["audio_path"], note.get("language", "auto"))
            transcript = stt.get("transcript")
            detected_code = stt.get("language_code") or ""
            detected_name = stt.get("language_name") or ""
            await db.voice_notes.update_one({"id": note_id}, {"$set": {
                "transcript": transcript, "detected_language": detected_code,
                "detected_language_name": detected_name,
                "language_probability": stt.get("language_probability"), "stt_engine": stt.get("engine")}})
        if hold:
            await db.voice_notes.update_one({"id": note_id}, {"$set": {"status": "transcribed", "transcribed_at": now_iso()}})
            return

        await db.voice_notes.update_one({"id": note_id}, {"$set": {"status": "structuring"}})
        troles = await tenant_role_keys(tenant_id)
        members = await db.users.find({"tenant_id": tenant_id}, {"_id": 0, "id": 1, "name": 1, "role": 1}).to_list(200)
        om = await tenant_operating_model(tenant_id)
        cat_keys = {c["key"] for c in om["task_categories"]}
        # Read any attached reference files so the AI factors them into the decision.
        ref_ids = note.get("reference_file_ids") or []
        extra_context = ""
        if ref_ids:
            chunks = []
            for fid in ref_ids:
                frec = await db.files.find_one({"id": fid, "tenant_id": tenant_id, "is_deleted": False}, {"_id": 0})
                if frec:
                    txt = await _read_reference_text(frec, tenant_id)
                    if txt:
                        chunks.append(txt)
            extra_context = "\n\n".join(chunks)
        extracted = await ai_extract(transcript or "", session_id=f"extract-{note_id}", allowed_roles=sorted(troles),
                                     members=members, pipelines=om["pipelines"], task_categories=om["task_categories"],
                                     extra_context=extra_context)
        # The AI never answered (provider down, rate limit, bad key, consent
        # revoked mid-flight): that is a failure with a reason, not a capture
        # with nothing in it. The Desk shows the reason and offers Retry.
        if extracted.get("ai_error"):
            await db.voice_notes.update_one({"id": note_id}, {"$set": {
                "status": "failed", "error": str(extracted["ai_error"])[:500], "processed_at": now_iso()}})
            await log_activity(tenant_id, note["created_by"], "capture_ai_failed",
                               f"A capture could not be read: {str(extracted['ai_error'])[:120]}",
                               "voice_note", note_id)
            return
        proposal = await build_proposal(tenant_id, extracted, troles, members, cat_keys, om["pipelines"])

        # ASK-32 1.4 — a question, a greeting or "no directive" is not a decision.
        # 2026-09-16 — nor is a remark about how things are going. News that
        # carries a lasting fact is kept in the company brain and said so;
        # nobody is asked to approve it.
        if not decision_worthy(extracted, proposal):
            notes = [m for m in (proposal or {}).get("memory_notes") or [] if m.get("text")]
            kept = await save_memory_notes(tenant_id, note["created_by"], notes)
            if kept:
                first = notes[0]["text"].strip()
                said = (f"Kept in the Company Brain: {first}" if kept == 1
                        else f"Kept {kept} notes in the Company Brain. {first}")
                outcome, event = "noted", "capture_noted"
                logline = f"Kept {kept} note(s) from a capture: {first[:80]}"
            else:
                said = extracted.get("summary", "")
                outcome, event = "nothing_to_decide", "capture_nothing_to_decide"
                logline = f"Nothing to decide in a capture: {(extracted.get('summary') or '')[:80]}"
            await db.voice_notes.update_one({"id": note_id}, {"$set": {
                "status": "done", "outcome": outcome, "decision_id": None,
                "summary": said, "processed_at": now_iso()}})
            await log_activity(tenant_id, note["created_by"], event, logline, "voice_note", note_id)
            return

        decision_id = new_id()
        dlist = extracted.get("decisions", [])
        first = dlist[0] if dlist else {}
        dtype = first.get("type") if first.get("type") in ("directive", "approval", "policy", "observation") else "directive"
        conf = extracted.get("confidence", 0.8)
        conf = float(conf) if isinstance(conf, (int, float)) else 0.8
        # ASK-32 2.1 (DD2) — always name who decides: the capturer when they can
        # approve decisions, else their reporting manager when the manager can,
        # else the owner (every owner only in a company with several).
        _approver_id, _route = await route_approver(tenant_id, note["created_by"])
        title = (dlist[0] if dlist else {}).get("title") or (extracted.get("summary") or "New decision")[:80]
        review_reasons = list(extracted.get("review_reasons") or [])
        # ASK-32 1.5 — the same thing captured again within a day is flagged, not hidden.
        repeat = await find_repeat(tenant_id, title, extracted.get("summary", ""))
        if repeat:
            review_reasons.append(f"Looks like a repeat of “{repeat['title']}”")
        summary = summarize_proposal(proposal)
        decision = {
            "id": decision_id, "tenant_id": tenant_id, "voice_note_id": note_id,
            "title": title,
            "summary": extracted.get("summary", ""),
            "items": extracted.get("decisions", []),
            "workflow_events": extracted.get("workflow_events", []),
            "dtype": dtype, "confidence": round(max(0.0, min(1.0, conf)), 2),
            # E3-02.2: calibrated confidence + review flag.
            "confidence_raw": extracted.get("confidence_raw"),
            "needs_review": bool(extracted.get("needs_review")) or bool(repeat),
            "review_reasons": review_reasons,
            "repeat_of": repeat,
            "status": "pending_approval",
            "approver_id": _approver_id, "approver_route": _route,
            "created_by": note["created_by"], "created_at": now_iso(),
            "source": note.get("source") or ("voice" if note.get("kind") == "audio" else "text"),
            "wa_from": note.get("wa_from"), "raised_by_name": note.get("raised_by_name"),
            "detected_language": detected_code or None,
            "detected_language_name": detected_name or None,
            # Nothing exists yet: approving creates the proposal (services.decision_flow).
            "proposal": proposal, "reference_file_ids": ref_ids,
            "task_ids": [], "workflow_ids": [],
            "execution_summary": summary,
        }
        decision["timeline"] = [{"ts": now_iso(), "label": f"Decision captured via {note.get('source') or note.get('kind') or 'voice'}", "actor": note.get("raised_by_name") or "Owner", "kind": "created"}]
        await db.decisions.insert_one(decision)
        _icls = "approval" if dtype == "approval" else ("task" if proposal["tasks"] else "reminder")
        await add_inbox_item(tenant_id, note["created_by"],
                             "voice" if note.get("kind") == "audio" else "text",
                             _icls, decision["title"], (decision.get("summary") or "")[:180],
                             "decision", decision_id, status="open")
        # ASK-32 2.3 — tell whoever decides. A WhatsApp capture the reviewer is
        # approving right now is decided already, so nobody is told it waits.
        if not note.get("review_approved"):
            sender = next((m.get("name") for m in members if m.get("id") == note["created_by"]), None)
            await notify_decision_waiting(tenant_id, decision, sender_name=sender)
        await db.voice_notes.update_one({"id": note_id}, {"$set": {"status": "done", "outcome": "decision", "decision_id": decision_id, "execution_summary": summary, "processed_at": now_iso()}})
        await log_activity(tenant_id, note["created_by"], "decision_extracted",
                           f"Extracted decision '{decision['title']}' proposing {summary['tasks']} task(s)", "decision", decision_id)
    except Exception as e:
        logger.exception("process_voice_note failed")
        await db.voice_notes.update_one({"id": note_id}, {"$set": {"status": "failed", "error": str(e)}})
