"""Who may read which record — one home for the rules the AI must follow too.

2026-10-05 (AI audit, founder: "fix the 1"). Dex answered from data the asker
could not open on its own screen: Anand (Accounts) was told the history of a
Sales order because the Brain's memory row about it was written "public", and
/ask listed every decision, contact and leave in the company to any member.
The screens already had the right rules; they lived in routers, where the AI
services could not import them (import-linter: services may not import
routers). They live here now, and the routers re-export them under their old
names.
"""
from core import db
from core.permissions import crm_types, user_perms


async def visible_decisions_clause(user: dict) -> dict:
    """RBAC P1 (2026-09-15): only decisions this person can open — the same
    people get_decision lets in. Every title in the company was listed.
    2026-10-03: one function, because Company Brain search listed every
    decision matching a word to any member while this list did not."""
    if user.get("role") == "owner":
        return {}
    mine = [t["decision_id"] async for t in db.tasks.find(
        {"tenant_id": user["tenant_id"], "decision_id": {"$nin": [None, ""]},
         "$or": [{"assignee_id": user["id"]}, {"co_assignee_ids": user["id"]}]},
        {"_id": 0, "decision_id": 1})]
    return {"$or": [{"created_by": user["id"]}, {"approver_id": user["id"]}, {"id": {"$in": mine}}]}


async def complaint_scope(user: dict) -> dict:
    """2026-10-03 RBAC audit — who reads which complaint. Raising or closing
    one already followed the contact it is about (J14-05); the list did not,
    so every complaint about every customer reached every member. Now: the
    owner sees all; anyone else the complaints on contacts they may open, plus
    the ones they raised themselves. Also used by the calendar."""
    if user.get("role") == "owner":
        return {}
    types = list(crm_types(user))
    ids = [c["id"] for c in await db.contacts.find(
        {"tenant_id": user["tenant_id"], "type": {"$in": types}}, {"_id": 0, "id": 1}).to_list(5000)] if types else []
    return {"$or": [{"customer_id": {"$in": ids}}, {"created_by": user["id"]}]}


def leave_scope(user: dict) -> dict:
    """The leaves this person may read — /leaves?scope=all's rule: everyone's
    with "Approve leave", otherwise their own and the ones they approve."""
    if user.get("role") == "owner" or "leave_approve" in user_perms(user):
        return {}
    return {"$or": [{"user_id": user["id"]}, {"approver_id": user["id"]}]}


async def readable_context_rows(user: dict, rows: list) -> list:
    """Drop Brain memory rows whose underlying record this person may not open.

    A row's own `visibility` was set by whoever wrote it, and approvals,
    workflow moves, meetings and resolved complaints were all written
    "public" — so the memory told anyone what the record's screen would not.
    Rows already in the database keep that label, so the rule is applied when
    they are READ, against the record they describe:
      decision  -> visible_decisions_clause
      workflow  -> the pipelines this person's team works in (workflow_scope)
      complaint -> complaint_scope
      meeting   -> owner only (as /meetings)
    Anything else (task rows, notes, finance rows) keeps its own visibility.
    The owner reads everything."""
    if user.get("role") == "owner" or not rows:
        return rows
    tid = user["tenant_id"]

    def ids_of(kind: str) -> list:
        return list({r.get("source_id") for r in rows if r.get("source_type") == kind and r.get("source_id")})

    allowed: dict = {}
    dec_ids = ids_of("decision")
    if dec_ids:
        q = {"tenant_id": tid, "id": {"$in": dec_ids}, **(await visible_decisions_clause(user))}
        allowed["decision"] = {d["id"] async for d in db.decisions.find(q, {"_id": 0, "id": 1})}
    wf_ids = ids_of("workflow")
    if wf_ids:
        from services.workflows import workflow_scope, scope_query
        q = {"tenant_id": tid, "id": {"$in": wf_ids}, **scope_query(await workflow_scope(user))}
        allowed["workflow"] = {w["id"] async for w in db.workflows.find(q, {"_id": 0, "id": 1})}
    cp_ids = ids_of("complaint")
    if cp_ids:
        q = {"tenant_id": tid, "id": {"$in": cp_ids}, **(await complaint_scope(user))}
        allowed["complaint"] = {c["id"] async for c in db.complaints.find(q, {"_id": 0, "id": 1})}
    allowed["meeting"] = set()

    out = []
    for r in rows:
        kind = r.get("source_type")
        if kind in allowed and r.get("source_id") not in allowed[kind]:
            continue
        out.append(r)
    return out
