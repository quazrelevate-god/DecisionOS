"""Agent tool registry (Epic 3 Sprint 4 -- E3-11.1/.3/.4).

The Company Brain agent acts only through tools declared here. Each tool is a named,
schema'd, RBAC-gated function -- mirroring the prompt registry. Read tools return
data (metrics, RAG passages, ops state); propose tools NEVER execute -- they file a
pending_approval decision into the existing approval flow, so the human approves.

``tools_for(user)`` returns only the tools that user may call (permission-gated);
``to_schema`` renders them into the emergentintegrations tool-definition format.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Optional

from core import db, logger, new_id, now_iso, user_perms


@dataclass(frozen=True)
class Tool:
    name: str
    description: str
    parameters: dict            # JSON schema for the tool's arguments
    fn: Callable                # async (user, **args) -> JSON-serializable dict
    access: str = "read"        # "read" | "propose"
    permission: Optional[str] = None  # required permission key, or None for all users


_REGISTRY: dict[str, Tool] = {}


def register(t: Tool) -> Tool:
    if t.name in _REGISTRY:
        raise ValueError(f"duplicate agent tool: {t.name}")
    _REGISTRY[t.name] = t
    return t


def get(name: str) -> Optional[Tool]:
    return _REGISTRY.get(name)


def all_tools() -> list[Tool]:
    return list(_REGISTRY.values())


def tools_for(user: dict) -> list[Tool]:
    """The tools this user's agent may call -- filtered by permission (owner sees all)."""
    perms = user_perms(user)
    is_owner = user.get("role") == "owner"
    return [t for t in _REGISTRY.values()
            if t.permission is None or is_owner or t.permission in perms]


def to_schema(tools: list[Tool]) -> list[dict]:
    """Render tools into emergentintegrations' function-tool format."""
    return [{"type": "function",
             "function": {"name": t.name, "description": t.description, "parameters": t.parameters}}
            for t in tools]


# ---------------------------------------------------------------------------
# READ tools (E3-11.3)
# ---------------------------------------------------------------------------
async def _t_search_brain(user: dict, query: str = "") -> dict:
    """Semantic search over the Company Brain (documents/policies/context)."""
    from services.ai.brain_retrieval import search_chunks
    hits = await search_chunks(user=user, query=query, limit=5)
    return {"passages": [{"title": h.get("title"), "text": (h.get("text") or "")[:500]} for h in hits],
            "count": len(hits)}


async def _t_list_open_tasks(user: dict, assignee_role: str = "") -> dict:
    """List open (not-done) tasks for the tenant, optionally filtered by assignee role."""
    q = {"tenant_id": user["tenant_id"], "status": {"$in": ["todo", "blocked", "in_progress"]}}
    if assignee_role:
        q["assignee_role"] = assignee_role.strip().lower()
    rows = await db.tasks.find(q, {"_id": 0, "title": 1, "assignee_role": 1, "priority": 1,
                                    "due_date": 1, "status": 1}).sort("created_at", -1).to_list(25)
    return {"count": len(rows), "tasks": rows}


async def _t_finance_summary(user: dict) -> dict:
    """Deterministic finance snapshot: total receivables (owed to us) + payables (we owe).
    Numbers come from the ledger, never invented."""
    tid = user["tenant_id"]
    async def _sum(match):
        cur = await db.invoices.aggregate([{"$match": match},
                {"$group": {"_id": None, "total": {"$sum": "$amount"}, "n": {"$sum": 1}}}])
        rows = await cur.to_list(1)
        return (round(rows[0]["total"], 2), rows[0]["n"]) if rows else (0.0, 0)
    recv, recv_n = await _sum({"tenant_id": tid, "type": "sales_invoice", "status": {"$ne": "paid"}})
    pay, pay_n = await _sum({"tenant_id": tid, "type": "purchase_bill", "status": {"$ne": "paid"}})
    return {"receivables": recv, "receivable_invoices": recv_n,
            "payables": pay, "payable_bills": pay_n}


async def _t_get_contact(user: dict, name: str = "") -> dict:
    """Look up a customer/supplier by name + their outstanding balance."""
    if not name.strip():
        return {"error": "name is required"}
    tid = user["tenant_id"]
    c = await db.contacts.find_one(
        {"tenant_id": tid, "name": {"$regex": name.strip(), "$options": "i"}},
        {"_id": 0, "id": 1, "name": 1, "type": 1, "status": 1})
    if not c:
        return {"found": False}
    cur = await db.invoices.aggregate([
        {"$match": {"tenant_id": tid, "contact_name": {"$regex": f"^{c['name']}$", "$options": "i"},
                    "status": {"$ne": "paid"}}},
        {"$group": {"_id": None, "outstanding": {"$sum": "$amount"}}}])
    rows = await cur.to_list(1)
    c["outstanding"] = round(rows[0]["outstanding"], 2) if rows else 0.0
    c["found"] = True
    return c


async def _t_list_workflows(user: dict) -> dict:
    """List active workflows (pipelines) and their current stage."""
    rows = await db.workflows.find(
        {"tenant_id": user["tenant_id"]},
        {"_id": 0, "id": 1, "type": 1, "title": 1, "stage": 1, "counterparty": 1}
    ).sort("created_at", -1).to_list(25)
    return {"count": len(rows), "workflows": rows}


# ---------------------------------------------------------------------------
# PROPOSE tools (E3-11.4) -- file a pending_approval decision; never auto-execute
# ---------------------------------------------------------------------------
async def _t_propose_task(user: dict, title: str = "", description: str = "",
                          assignee_role: str = "", assignee_name: str = "",
                          priority: str = "medium") -> dict:
    """Propose a task for the human to approve. Creates a pending_approval decision with a
    blocked task -- released only when the owner approves (reuses the existing approval flow).
    Auto-assigns to a PERSON via E3-13 (named person, else least-loaded role member)."""
    if not title.strip():
        return {"error": "title is required"}
    tid = user["tenant_id"]
    did, task_id = new_id(), new_id()
    prio = priority if priority in ("low", "medium", "high") else "medium"
    # E3-13: resolve the assignee to an actual person (named -> least-loaded active role member).
    from services.voice import resolve_assignee
    assigned = await resolve_assignee(tid, role=(assignee_role or "operations"),
                                      assignee_name=(assignee_name or ""))
    await db.decisions.insert_one({
        "id": did, "tenant_id": tid, "title": f"[AI proposed] {title.strip()[:80]}",
        "summary": description.strip()[:300], "items": [], "workflow_events": [],
        "dtype": "directive", "status": "pending_approval", "source": "agent",
        "created_by": user["id"], "created_at": now_iso(), "task_ids": [task_id],
        "proposed_by_agent": True,
    })
    await db.tasks.insert_one({
        "id": task_id, "tenant_id": tid, "decision_id": did, "title": title.strip()[:120],
        "description": description.strip()[:500],
        "assignee_role": assigned["role"] or "operations", "assignee_id": assigned["assignee_id"],
        "priority": prio, "status": "blocked", "created_at": now_iso(), "source": "agent",
    })
    logger.info(f"agent proposed task '{title[:40]}' -> decision {did} (pending; assignee {assigned['how']})")
    return {"proposed": True, "decision_id": did, "status": "pending_approval",
            "assigned_to": assigned["assignee_id"], "assignment": assigned["how"],
            "message": "Task proposed. It will run once an owner approves the decision."}


def register_default_tools() -> None:
    """Register the v1 tool surface. Idempotent."""
    if _REGISTRY:
        return
    register(Tool("search_brain", "Semantic search over the company's uploaded documents, "
                  "policies, and past-decision context. Use for 'what does our policy say' / "
                  "'why did we...' questions.",
                  {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]},
                  _t_search_brain, "read", "brain"))
    register(Tool("list_open_tasks", "List open (not-done) tasks, optionally by assignee role "
                  "(sales/finance/operations/...).",
                  {"type": "object", "properties": {"assignee_role": {"type": "string"}}},
                  _t_list_open_tasks, "read", None))
    register(Tool("finance_summary", "Exact total receivables (money owed to us) and payables "
                  "(money we owe) from the ledger. Use for cash-position questions.",
                  {"type": "object", "properties": {}},
                  _t_finance_summary, "read", "finance"))
    register(Tool("get_contact", "Look up a customer or supplier by name and their outstanding balance.",
                  {"type": "object", "properties": {"name": {"type": "string"}}, "required": ["name"]},
                  _t_get_contact, "read", None))
    register(Tool("list_workflows", "List active workflows/pipelines and their current stage.",
                  {"type": "object", "properties": {}},
                  _t_list_workflows, "read", "workflows"))
    register(Tool("propose_task", "Propose a task for the owner to APPROVE (does not execute). "
                  "Use when the user asks you to create/assign work.",
                  {"type": "object", "properties": {
                      "title": {"type": "string"}, "description": {"type": "string"},
                      "assignee_role": {"type": "string"},
                      "assignee_name": {"type": "string", "description": "a specific person's name if the owner named one"},
                      "priority": {"type": "string"}},
                   "required": ["title"]},
                  _t_propose_task, "propose", "voice_capture"))


register_default_tools()
