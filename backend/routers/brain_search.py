"""Company Brain search endpoint (Epic 8 Sprint 3 -- extracted from server.py).

Cross-collection keyword search (decisions/tasks/workflows/contacts/memory +
finance when permitted), RBAC-gated by the brain permission and the finance
visibility helpers. enrich_* stay in server / services for now.
"""
import re

from fastapi import APIRouter, Depends

from core import db, require_perm, user_perms
from services.tasks import enrich_tasks
from server import enrich_decisions, enrich_contacts  # shared; server-side for now

router = APIRouter(prefix="/api")


def _brain_can_finance(user: dict) -> bool:
    """Whether a user may see financial records in Company Brain (Search + Ask)."""
    return bool({"finance", "ledger"} & user_perms(user))


def _brain_privileged(user: dict) -> bool:
    """Owners / team managers see all departments' operational records."""
    return user.get("role") == "owner" or "team_manage" in user_perms(user)


@router.get("/brain/search")
async def brain_search(q: str = "", user: dict = Depends(require_perm("brain"))):
    tid = user["tenant_id"]
    uid = user.get("id")
    urole = user.get("role")
    can_finance = _brain_can_finance(user)
    privileged = _brain_privileged(user)
    tokens = [re.escape(t) for t in q.split() if len(t) >= 2]
    rx = {"$regex": "|".join(tokens), "$options": "i"} if tokens else {"$exists": True}

    # Tasks: non-privileged users only see tasks in their own department (own / their role / created by them).
    task_q = {"tenant_id": tid, "$and": [{"$or": [{"title": rx}, {"description": rx}]}]}
    if not privileged:
        task_q["$and"].append({"$or": [{"assignee_id": uid}, {"assignee_role": urole}, {"created_by": uid}]})

    decisions = await db.decisions.find({"tenant_id": tid, "$or": [{"title": rx}, {"summary": rx}]}, {"_id": 0}).sort("created_at", -1).to_list(50)
    tasks = await db.tasks.find(task_q, {"_id": 0}).sort("created_at", -1).to_list(50)
    workflows = await db.workflows.find({"tenant_id": tid, "$or": [{"title": rx}, {"detail": rx}, {"counterparty": rx}]}, {"_id": 0}).sort("created_at", -1).to_list(50)
    contacts = await db.contacts.find({"tenant_id": tid, "$or": [{"name": rx}, {"company": rx}, {"email": rx}, {"phone": rx}, {"notes": rx}]}, {"_id": 0}).sort("created_at", -1).to_list(50)
    memory = await db.memory.find({"tenant_id": tid, "text": rx}, {"_id": 0}).sort("created_at", -1).to_list(50)

    # Financial records: department-restricted to Owner / Finance / Ledger roles only.
    if can_finance:
        invoices = await db.invoices.find({"tenant_id": tid, "$or": [{"number": rx}, {"contact_name": rx}]}, {"_id": 0}).sort("created_at", -1).to_list(50)
        expenses = await db.expenses.find({"tenant_id": tid, "$or": [{"title": rx}, {"vendor_name": rx}, {"category": rx}]}, {"_id": 0}).sort("created_at", -1).to_list(50)
        assets = await db.assets.find({"tenant_id": tid, "$or": [{"name": rx}, {"vendor_name": rx}, {"category": rx}]}, {"_id": 0}).sort("created_at", -1).to_list(50)
        inventory = await db.inventory.find({"tenant_id": tid, "$or": [{"item": rx}, {"sku": rx}, {"vendor_name": rx}, {"category": rx}]}, {"_id": 0}).sort("created_at", -1).to_list(50)
    else:
        invoices = expenses = assets = inventory = []
        # Hide the money figure on operational workflow cards from non-finance roles.
        for w in workflows:
            if "amount" in w:
                w["amount"] = None
    return {
        # FIX-003-B (S2-05): explicit tenant_id makes the tenant filter
        # unconditional (auto-inference in enrich_decisions works, but
        # explicit reads better and survives future refactors that may
        # widen the query).
        "decisions": await enrich_decisions(decisions, tenant_id=tid),
        "tasks": await enrich_tasks(tasks),
        "workflows": workflows,
        "contacts": await enrich_contacts(contacts),
        "memory": memory,
        "invoices": invoices,
        "expenses": expenses,
        "assets": assets,
        "inventory": inventory,
        "scope": {"finance_visible": can_finance, "all_departments": privileged},
    }
