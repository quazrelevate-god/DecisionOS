"""Company Brain — permission-aware conversational BI over the workspace.

Phase-1 pipeline (all on the existing Python/FastAPI/MongoDB stack):
  question -> intent+query plan (LLM) -> permission validation -> scoped retrieval
  -> DETERMINISTIC metrics/table (numbers computed in code, never by the LLM)
  -> answer prose + follow-ups (LLM) -> source citations w/ deep-links
  -> audit log + follow-up context. Plus CSV/Excel/PDF export of the last result.

Self-contained: imports foundation from `core` only (no `server` import → no cycle).
Reuses the existing permission model (owner / finance / privileged / department scope).
"""
import io
import json
import re
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from emergentintegrations.llm.chat import UserMessage

from core import (
    db, claude_chat, LLM_MODEL, _extract_json, new_id, now_iso, logger,
    require_perm, user_perms,
)

router = APIRouter(prefix="/api")

# ---------------------------------------------------------------------------
# Permission scope (reuse existing flags)
# ---------------------------------------------------------------------------
def _can_finance(user: dict) -> bool:
    return bool({"finance", "ledger"} & user_perms(user))


def _privileged(user: dict) -> bool:
    return user.get("role") == "owner" or "team_manage" in user_perms(user)


def _lang_directive(lang: Optional[str]) -> str:
    names = {"hi": "Hindi", "ta": "Tamil"}
    if lang in names:
        return f" Reply in {names[lang]}. Keep proper nouns, numbers and data labels as-is."
    return ""


# ---------------------------------------------------------------------------
# Entity catalogue — collection, sensitivity, display + deep-link
# ---------------------------------------------------------------------------
FINANCE_ENTITIES = {"invoices", "payments", "expenses"}
KNOWN_ENTITIES = {"tasks", "decisions", "workflows", "contacts", "invoices",
                  "payments", "expenses", "leaves", "employees", "memory"}


def _deep_link(entity: str, r: dict) -> str:
    rid = r.get("id", "")
    if entity == "tasks":
        return f"/my-work?task={rid}"
    if entity == "decisions":
        return f"/?focus=approval:{rid}"
    if entity == "workflows":
        return f"/my-work?view=workflows&wf={rid}&wf_type={r.get('type', '')}"
    if entity == "contacts":
        return f"/contacts/{rid}"
    if entity == "invoices":
        return "/ledger?tab=revenue" if r.get("type") == "sales_invoice" else "/ledger?tab=expenses"
    if entity == "payments":
        return "/ledger?tab=revenue" if r.get("direction") == "in" else "/ledger?tab=expenses"
    if entity == "expenses":
        return "/ledger?tab=expenses"
    if entity == "leaves":
        return "/my-work?view=leave"
    if entity == "employees":
        return f"/coach?user={rid}"
    return "/brain"


# ---------------------------------------------------------------------------
# Date presets
# ---------------------------------------------------------------------------
def _date_range(preset: Optional[str]):
    now = datetime.now(timezone.utc)
    midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
    if preset == "today":
        return midnight, now
    if preset == "yesterday":
        return midnight - timedelta(days=1), midnight
    if preset in ("this_week", "last_7_days"):
        return now - timedelta(days=7), now
    if preset == "this_month":
        return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0), now
    if preset == "last_month":
        first_this = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        last_month_end = first_this - timedelta(seconds=1)
        return last_month_end.replace(day=1, hour=0, minute=0, second=0, microsecond=0), first_this
    if preset in ("last_30_days", "monthly"):
        return now - timedelta(days=30), now
    return None, None


def _in_range(iso_str, start, end) -> bool:
    if not start:
        return True
    try:
        d = datetime.fromisoformat(str(iso_str).replace("Z", "+00:00"))
        if d.tzinfo is None:
            d = d.replace(tzinfo=timezone.utc)
    except Exception:
        return False
    return (start <= d) and (not end or d < end)


# ---------------------------------------------------------------------------
# 1) Query planner (LLM → controlled plan)
# ---------------------------------------------------------------------------
_PLANNER_SYSTEM = (
    "You are the query planner of DecisionOS Company Brain. Convert the user's question into a "
    "STRICT JSON plan. Never write SQL or code. Return ONLY this JSON:\n"
    "{\n"
    '  "intent": one of ["FACT_QUESTION","LIST_REQUEST","AGGREGATION","COMPARISON","TREND_ANALYSIS","ROOT_CAUSE_ANALYSIS","REPORT_GENERATION","MEMORY_RETRIEVAL","RECORD_SEARCH"],\n'
    '  "primary_entity": one of ["tasks","decisions","workflows","contacts","invoices","payments","expenses","leaves","employees","memory"],\n'
    '  "needs_finance": boolean,  // true if it needs money, cost, price, margin, profit, invoice, payment, expense, outstanding, or revenue data\n'
    '  "keywords": [string],      // salient nouns to match (names, products, suppliers). [] if none\n'
    '  "status": string|null,     // completed | todo | in_progress | overdue | pending | paid | unpaid | approved\n'
    '  "date_field": string|null, // created_at | due_date | completed | date\n'
    '  "date_preset": one of ["today","yesterday","this_week","this_month","last_month","last_7_days","last_30_days","all"]|null,\n'
    '  "group_by": one of ["assignee","role","status","type","category","contact","priority"]|null,\n'
    '  "on_time_analysis": boolean, // true when asking about on-time / late / overdue task completion\n'
    '  "output": one of ["TEXT","TABLE","KPI_TABLE","BAR_CHART","TIMELINE"]\n'
    "}\n"
    "Rules: pick the single most relevant primary_entity. Set needs_finance=true for ANY money question. "
    "If the user says 'them'/'these'/'those' or refers to a previous result, keep the SAME primary_entity and "
    "carry forward the previous filters, only adding the new refinement."
)


async def _plan(question: str, prev: Optional[dict], lang) -> dict:
    ctx = ""
    if prev:
        ctx = f"\nPrevious query plan (the user may be refining it):\n{json.dumps(prev)}\n"
    chat = claude_chat(session_id=f"brain-plan-{new_id()}", system_message=_PLANNER_SYSTEM).with_model(*LLM_MODEL)
    raw = await chat.send_message(UserMessage(text=f"{ctx}\nQuestion: {question}"))
    plan = _extract_json(raw) or {}
    plan.setdefault("intent", "LIST_REQUEST")
    pe = plan.get("primary_entity")
    if pe not in KNOWN_ENTITIES:
        plan["primary_entity"] = "tasks"
    plan.setdefault("keywords", [])
    plan.setdefault("output", "TABLE")
    plan.setdefault("needs_finance", plan["primary_entity"] in FINANCE_ENTITIES)
    return _refine_plan(plan, question)


def _refine_plan(plan: dict, question: str) -> dict:
    """Deterministic guardrails over the LLM plan for the most common misreadings."""
    ql = (question or "").lower()
    on_time_words = ("on time" in ql or "on-time" in ql or "ontime" in ql)
    completion_words = ("complet" in ql or "finished" in ql or "done on" in ql)
    # "overdue" without completion context is an OPEN-tasks query, not an on-time report.
    if "overdue" in ql and not on_time_words and not completion_words:
        plan["on_time_analysis"] = False
        plan["status"] = "overdue"
    if on_time_words or completion_words:
        plan["on_time_analysis"] = True
    # Questions ranking PEOPLE go to the employees aggregation.
    people_trigger = any(p in ql for p in (
        "which employee", "which employees", "who has", "employees have", "employee has",
        "team member", "per employee", "by employee", "most tasks", "rank employee",
        "employees by", "highest workload", "who is overloaded", "workload"))
    people_generic = ("employee" in ql or "staff" in ql or "team member" in ql) and any(
        w in ql for w in ("rank", "most", "highest", "top", "overdue", "pending", "workload", "overloaded"))
    if (people_trigger or people_generic) and ("task" in ql or "overdue" in ql or "pending" in ql or "workload" in ql or "work" in ql):
        plan["primary_entity"] = "employees"
        plan["on_time_analysis"] = False
        plan["keywords"] = []
    return plan


# ---------------------------------------------------------------------------
# 2) Retrieval — permission-scoped, tenant-locked, keyword + date filtered
# ---------------------------------------------------------------------------
_KW_STOP = {
    "customer", "customers", "client", "clients", "invoice", "invoices", "bill", "bills",
    "payment", "payments", "outstanding", "pending", "overdue", "task", "tasks", "supplier",
    "suppliers", "vendor", "vendors", "expense", "expenses", "sale", "sales", "purchase",
    "purchases", "employee", "employees", "staff", "team", "this", "that", "these", "those",
    "month", "week", "today", "yesterday", "show", "all", "list", "give", "which", "what",
    "who", "the", "and", "for", "with", "our", "have", "not", "paid", "unpaid", "completed",
    "done", "open", "status", "report", "decision", "decisions", "workflow", "workflows",
    "leave", "leaves", "record", "records", "company", "business",
}


def _rx(keywords):
    toks = [re.escape(k) for k in (keywords or [])
            if len(str(k)) >= 3 and str(k).lower() not in _KW_STOP]
    return {"$regex": "|".join(toks), "$options": "i"} if toks else None


async def _users_map(tid):
    return {u["id"]: u for u in await db.users.find({"tenant_id": tid}, {"_id": 0, "id": 1, "name": 1, "role": 1}).to_list(500)}


async def _retrieve(plan: dict, scope: dict):
    tid = scope["tenant_id"]
    entity = plan["primary_entity"]
    kw = plan.get("keywords")
    rx = _rx(kw)
    start, end = _date_range(plan.get("date_preset"))

    if entity == "tasks" or entity == "employees":
        q = {"tenant_id": tid}
        if rx and entity == "tasks":
            q["$or"] = [{"title": rx}, {"description": rx}]
        if not scope["privileged"]:
            dept = [{"assignee_id": scope["uid"]}, {"assignee_role": scope["role"]}, {"created_by": scope["uid"]}]
            q = {"$and": [q, {"$or": dept}]}
        rows = await db.tasks.find(q, {"_id": 0}).sort("created_at", -1).to_list(1000)
        return {"records": rows, "entity": entity}

    if entity == "decisions":
        q = {"tenant_id": tid}
        if rx:
            q["$or"] = [{"title": rx}, {"summary": rx}]
        rows = await db.decisions.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
        return {"records": rows, "entity": entity}

    if entity == "workflows":
        q = {"tenant_id": tid}
        if rx:
            q["$or"] = [{"title": rx}, {"detail": rx}, {"counterparty": rx}]
        rows = await db.workflows.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
        if not scope["can_finance"]:
            for w in rows:
                w.pop("amount", None)
        return {"records": rows, "entity": entity}

    if entity == "contacts":
        q = {"tenant_id": tid}
        if rx:
            q["$or"] = [{"name": rx}, {"company": rx}, {"email": rx}, {"phone": rx}, {"notes": rx}]
        rows = await db.contacts.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
        return {"records": rows, "entity": entity}

    if entity == "leaves":
        rows = await db.leaves.find({"tenant_id": tid}, {"_id": 0}).sort("created_at", -1).to_list(500)
        return {"records": rows, "entity": entity}

    if entity == "memory":
        q = {"tenant_id": tid}
        if rx:
            q["text"] = rx
        rows = await db.memory.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
        return {"records": rows, "entity": entity}

    # Finance entities (already gated upstream)
    if entity == "invoices":
        q = {"tenant_id": tid}
        if rx:
            q["$or"] = [{"number": rx}, {"contact_name": rx}]
        rows = await db.invoices.find(q, {"_id": 0}).sort("created_at", -1).to_list(1000)
        return {"records": rows, "entity": entity}
    if entity == "payments":
        rows = await db.payments.find({"tenant_id": tid}, {"_id": 0}).sort("created_at", -1).to_list(1000)
        return {"records": rows, "entity": entity}
    if entity == "expenses":
        q = {"tenant_id": tid}
        if rx:
            q["$or"] = [{"title": rx}, {"vendor_name": rx}, {"category": rx}]
        rows = await db.expenses.find(q, {"_id": 0}).sort("created_at", -1).to_list(1000)
        return {"records": rows, "entity": entity}
    return {"records": [], "entity": entity}


# ---------------------------------------------------------------------------
# 3) Deterministic compute — numbers come from CODE, never the LLM
# ---------------------------------------------------------------------------
def _num(x):
    try:
        return float(x or 0)
    except (TypeError, ValueError):
        return 0.0


async def _compute(plan, retrieved, scope):
    """Thin dispatcher — hands off to a per-entity handler.

    Historically this was one 300-line function with 10+ nested `if entity ==`
    branches; every new intent (finance / production / etc.) risked ballooning
    it further. Split in Phase B step 6 into small handlers via
    `_COMPUTE_HANDLERS`. Each handler receives the same `(ctx, plan, recs)`
    contract and returns `(kpis, table, cites)`.
    """
    entity = retrieved["entity"]
    recs = retrieved["records"]
    tid = scope["tenant_id"]
    umap = await _users_map(tid)
    start, end = _date_range(plan.get("date_preset"))

    def uname(uid):
        return (umap.get(uid) or {}).get("name") or "Unassigned"

    ctx = {
        "tid": tid, "umap": umap, "uname": uname,
        "start": start, "end": end, "scope": scope,
    }

    # Tasks + on-time completion analysis takes a specialised path (joins to activity).
    if entity == "tasks" and (plan.get("on_time_analysis") or plan.get("status") == "completed"):
        return await _compute_tasks_completion(ctx, plan, recs)

    handler = _COMPUTE_HANDLERS.get(entity)
    if handler:
        return await handler(ctx, plan, recs)
    return [], {"columns": [], "rows": [], "total_rows": 0}, []


async def _compute_tasks_completion(ctx, plan, _recs):
    """Task completion + on-time analysis: joined with activity[kind=task_done]."""
    tid, uname, start, end, scope = ctx["tid"], ctx["uname"], ctx["start"], ctx["end"], ctx["scope"]
    umap = ctx["umap"]
    kpis, rows, cites = [], [], []
    acts = await db.activity.find(
        {"tenant_id": tid, "kind": "task_done"}, {"_id": 0}).sort("created_at", -1).to_list(3000)
    acts = [a for a in acts if _in_range(a.get("created_at"), start, end)]
    task_ids = [a.get("entity_id") for a in acts if a.get("entity_id")]
    tmap = {}
    if task_ids:
        for t in await db.tasks.find({"tenant_id": tid, "id": {"$in": task_ids}}, {"_id": 0}).to_list(3000):
            tmap[t["id"]] = t
    if not scope["privileged"]:
        acts = [a for a in acts
                if (tmap.get(a.get("entity_id")) or {}).get("assignee_id") == scope["uid"]
                or (tmap.get(a.get("entity_id")) or {}).get("assignee_role") == scope["role"]]
    total = on_time = late = 0
    by_role = {}
    for a in acts:
        t = tmap.get(a.get("entity_id"))
        if not t:
            continue
        total += 1
        due = t.get("due_date")
        ontime = True
        if due:
            try:
                dd = datetime.fromisoformat(str(due).replace("Z", "+00:00"))
                cc = datetime.fromisoformat(str(a["created_at"]).replace("Z", "+00:00"))
                if dd.tzinfo is None:
                    dd = dd.replace(tzinfo=timezone.utc)
                if cc.tzinfo is None:
                    cc = cc.replace(tzinfo=timezone.utc)
                ontime = cc <= dd
            except Exception:
                ontime = True
        on_time += 1 if ontime else 0
        late += 0 if ontime else 1
        r = t.get("assignee_role") or "unassigned"
        by_role.setdefault(r, {"t": 0, "o": 0})
        by_role[r]["t"] += 1
        by_role[r]["o"] += 1 if ontime else 0
        rows.append({"task": t.get("title"), "assignee": uname(t.get("assignee_id")),
                     "role": t.get("assignee_role") or "-", "due": (t.get("due_date") or "")[:10],
                     "completed": str(a["created_at"])[:10], "on_time": "Yes" if ontime else "No"})
        cites.append({"type": "task", "title": t.get("title"), "id": t["id"],
                      "deep_link": _deep_link("tasks", t), "date": str(a["created_at"])[:10],
                      "confidence": "VERIFIED"})
    rate = round(100 * on_time / total, 1) if total else 0
    best = max(by_role.items(), key=lambda kv: (kv[1]["o"] / kv[1]["t"] if kv[1]["t"] else 0), default=None)
    kpis = [
        {"label": "Completed", "value": total},
        {"label": "On time", "value": on_time},
        {"label": "Late", "value": late},
        {"label": "On-time rate", "value": f"{rate}%"},
    ]
    if best and best[1]["t"]:
        kpis.append({"label": "Best department", "value": f"{best[0]} — {round(100 * best[1]['o'] / best[1]['t'])}%"})
    columns = [{"key": "task", "label": "Task", "type": "text"},
               {"key": "assignee", "label": "Assignee", "type": "text"},
               {"key": "role", "label": "Department", "type": "text"},
               {"key": "due", "label": "Due", "type": "date"},
               {"key": "completed", "label": "Completed", "type": "date"},
               {"key": "on_time", "label": "On time", "type": "text"}]
    _ = umap  # silence unused warning; kept for signature symmetry with siblings
    return kpis, {"columns": columns, "rows": rows, "total_rows": len(rows)}, cites[:12]


async def _compute_employees(ctx, _plan, recs):
    """People / teams ranked by overdue + open work."""
    uname, umap = ctx["uname"], ctx["umap"]
    now = datetime.now(timezone.utc).isoformat()
    rows, cites = [], []
    agg = {}
    for t in recs:
        uid = t.get("assignee_id")
        key = uid if uid else (f"role:{t.get('assignee_role')}" if t.get("assignee_role") else None)
        if not key:
            continue
        a = agg.setdefault(key, {"open": 0, "overdue": 0, "total": 0,
                                 "name": uname(uid) if uid else (t.get("assignee_role") or "Unassigned"),
                                 "role": (umap.get(uid) or {}).get("role") if uid else t.get("assignee_role"),
                                 "uid": uid})
        a["total"] += 1
        if t.get("status") in ("todo", "in_progress"):
            a["open"] += 1
            if t.get("due_date") and str(t["due_date"]) < now:
                a["overdue"] += 1
    ranked = sorted(agg.values(), key=lambda a: (a["overdue"], a["open"]), reverse=True)
    for a in ranked:
        if a["open"] == 0 and a["overdue"] == 0:
            continue
        rows.append({"employee": a["name"], "role": a["role"] or "-",
                     "overdue": a["overdue"], "open": a["open"]})
        if a["uid"]:
            cites.append({"type": "employee", "title": a["name"], "id": a["uid"],
                          "deep_link": _deep_link("employees", {"id": a["uid"]}), "confidence": "VERIFIED"})
    columns = [{"key": "employee", "label": "Employee / Team", "type": "text"},
               {"key": "role", "label": "Department", "type": "text"},
               {"key": "overdue", "label": "Overdue", "type": "number"},
               {"key": "open", "label": "Open", "type": "number"}]
    kpis = [{"label": "People/teams with work", "value": len(rows)},
            {"label": "Total overdue", "value": sum(r["overdue"] for r in rows)},
            {"label": "Total open", "value": sum(r["open"] for r in rows)}]
    return kpis, {"columns": columns, "rows": rows, "total_rows": len(rows)}, cites[:12]


async def _compute_tasks(ctx, plan, recs):
    """Generic task list (open / overdue / by status), inside optional date window."""
    uname, start, end = ctx["uname"], ctx["start"], ctx["end"]
    now = datetime.now(timezone.utc).isoformat()
    st = plan.get("status")
    rows, cites = [], []
    filtered = []
    for t in recs:
        if st == "overdue":
            if not (t.get("status") in ("todo", "in_progress") and t.get("due_date") and str(t["due_date"]) < now):
                continue
        elif st and t.get("status") != st:
            continue
        if start and not _in_range(t.get("created_at"), start, end) and not _in_range(t.get("due_date"), start, end):
            continue
        filtered.append(t)
    for t in filtered[:300]:
        rows.append({"task": t.get("title"), "assignee": uname(t.get("assignee_id")),
                     "role": t.get("assignee_role") or "-", "status": t.get("status"),
                     "priority": t.get("priority") or "-", "due": (t.get("due_date") or "")[:10]})
        cites.append({"type": "task", "title": t.get("title"), "id": t["id"],
                      "deep_link": _deep_link("tasks", t), "date": (t.get("created_at") or "")[:10],
                      "confidence": "SYSTEM_RECORDED"})
    overdue_n = sum(1 for t in filtered if t.get("status") in ("todo", "in_progress") and t.get("due_date") and str(t["due_date"]) < now)
    kpis = [{"label": "Matching tasks", "value": len(filtered)},
            {"label": "Overdue", "value": overdue_n},
            {"label": "Done", "value": sum(1 for t in filtered if t.get("status") == "done")}]
    columns = [{"key": "task", "label": "Task", "type": "text"},
               {"key": "assignee", "label": "Assignee", "type": "text"},
               {"key": "role", "label": "Department", "type": "text"},
               {"key": "status", "label": "Status", "type": "text"},
               {"key": "priority", "label": "Priority", "type": "text"},
               {"key": "due", "label": "Due", "type": "date"}]
    return kpis, {"columns": columns, "rows": rows, "total_rows": len(rows)}, cites[:12]


async def _compute_invoices(ctx, plan, recs):
    """Sales + purchase invoices; billed / outstanding KPIs; date-window filtered."""
    start, end = ctx["start"], ctx["end"]
    rows, cites = [], []
    filtered = [i for i in recs if not start or _in_range(i.get("date"), start, end)]
    st = plan.get("status")
    if st in ("paid", "unpaid", "partial"):
        filtered = [i for i in filtered if i.get("status") == st]
    billed = sum(_num(i.get("amount")) for i in filtered)
    outstanding = sum(_num(i.get("amount")) - _num(i.get("amount_paid")) for i in filtered if i.get("status") != "paid")
    for i in filtered[:300]:
        rows.append({"number": i.get("number") or "-", "party": i.get("contact_name") or "-",
                     "type": "Sales" if i.get("type") == "sales_invoice" else "Purchase",
                     "amount": round(_num(i.get("amount")), 2), "paid": round(_num(i.get("amount_paid")), 2),
                     "outstanding": round(_num(i.get("amount")) - _num(i.get("amount_paid")), 2),
                     "status": i.get("status"), "due": (i.get("due_date") or "")[:10]})
        cites.append({"type": "invoice", "title": f"{i.get('number') or 'Invoice'} · {i.get('contact_name') or ''}".strip(),
                      "id": i["id"], "deep_link": _deep_link("invoices", i), "date": (i.get("date") or "")[:10],
                      "confidence": "VERIFIED"})
    kpis = [{"label": "Invoices", "value": len(filtered)},
            {"label": "Billed", "value": round(billed, 2)},
            {"label": "Outstanding", "value": round(outstanding, 2)}]
    columns = [{"key": "number", "label": "Number", "type": "text"},
               {"key": "party", "label": "Party", "type": "text"},
               {"key": "type", "label": "Type", "type": "text"},
               {"key": "amount", "label": "Amount", "type": "money"},
               {"key": "paid", "label": "Paid", "type": "money"},
               {"key": "outstanding", "label": "Outstanding", "type": "money"},
               {"key": "status", "label": "Status", "type": "text"},
               {"key": "due", "label": "Due", "type": "date"}]
    return kpis, {"columns": columns, "rows": rows, "total_rows": len(rows)}, cites[:12]


async def _compute_payments(ctx, _plan, recs):
    """Cash in / out with reconciliation status; date-window filtered."""
    start, end = ctx["start"], ctx["end"]
    rows, cites = [], []
    filtered = [p for p in recs if not start or _in_range(p.get("date"), start, end)]
    total_in = sum(_num(p.get("amount")) for p in filtered if p.get("direction") == "in")
    total_out = sum(_num(p.get("amount")) for p in filtered if p.get("direction") == "out")
    for p in filtered[:300]:
        rows.append({"date": (p.get("date") or "")[:10], "party": p.get("contact_name") or "-",
                     "direction": "In" if p.get("direction") == "in" else "Out",
                     "amount": round(_num(p.get("amount")), 2), "method": p.get("method") or "-",
                     "status": p.get("match_status") or "-"})
        cites.append({"type": "payment", "title": f"{p.get('contact_name') or 'Payment'} · {round(_num(p.get('amount')))}",
                      "id": p["id"], "deep_link": _deep_link("payments", p), "date": (p.get("date") or "")[:10],
                      "confidence": "VERIFIED"})
    kpis = [{"label": "Payments", "value": len(filtered)},
            {"label": "Received", "value": round(total_in, 2)},
            {"label": "Paid out", "value": round(total_out, 2)}]
    columns = [{"key": "date", "label": "Date", "type": "date"},
               {"key": "party", "label": "Party", "type": "text"},
               {"key": "direction", "label": "Direction", "type": "text"},
               {"key": "amount", "label": "Amount", "type": "money"},
               {"key": "method", "label": "Method", "type": "text"},
               {"key": "status", "label": "Match", "type": "text"}]
    return kpis, {"columns": columns, "rows": rows, "total_rows": len(rows)}, cites[:12]


async def _compute_expenses(ctx, _plan, recs):
    """Expenses grouped by category; top category KPI; date-window filtered."""
    start, end = ctx["start"], ctx["end"]
    rows, cites = [], []
    filtered = [e for e in recs if not start or _in_range(e.get("date"), start, end)]
    by_cat = {}
    for e in filtered:
        by_cat[e.get("category") or "Other"] = by_cat.get(e.get("category") or "Other", 0) + _num(e.get("amount"))
    total = sum(_num(e.get("amount")) for e in filtered)
    for e in filtered[:300]:
        rows.append({"title": e.get("title") or "-", "vendor": e.get("vendor_name") or "-",
                     "category": e.get("category") or "Other", "amount": round(_num(e.get("amount")), 2),
                     "date": (e.get("date") or "")[:10]})
        cites.append({"type": "expense", "title": e.get("title") or "Expense", "id": e["id"],
                      "deep_link": _deep_link("expenses", e), "date": (e.get("date") or "")[:10],
                      "confidence": "VERIFIED"})
    top_cat = max(by_cat.items(), key=lambda kv: kv[1], default=None)
    kpis = [{"label": "Expenses", "value": len(filtered)}, {"label": "Total spend", "value": round(total, 2)}]
    if top_cat:
        kpis.append({"label": "Top category", "value": f"{top_cat[0]} ({round(top_cat[1])})"})
    columns = [{"key": "title", "label": "Item", "type": "text"},
               {"key": "vendor", "label": "Vendor", "type": "text"},
               {"key": "category", "label": "Category", "type": "text"},
               {"key": "amount", "label": "Amount", "type": "money"},
               {"key": "date", "label": "Date", "type": "date"}]
    return kpis, {"columns": columns, "rows": rows, "total_rows": len(rows)}, cites[:12]


async def _compute_contacts(_ctx, _plan, recs):
    rows, cites = [], []
    for c in recs[:300]:
        rows.append({"name": c.get("name") or "-", "company": c.get("company") or "-",
                     "type": c.get("type") or "-", "status": c.get("status") or "-",
                     "phone": c.get("phone") or "-"})
        cites.append({"type": "contact", "title": c.get("name") or "Contact", "id": c["id"],
                      "deep_link": _deep_link("contacts", c), "confidence": "VERIFIED"})
    kpis = [{"label": "Contacts", "value": len(recs)},
            {"label": "Customers", "value": sum(1 for c in recs if c.get("type") == "customer")},
            {"label": "Vendors", "value": sum(1 for c in recs if c.get("type") in ("vendor", "dealer"))}]
    columns = [{"key": "name", "label": "Name", "type": "text"},
               {"key": "company", "label": "Company", "type": "text"},
               {"key": "type", "label": "Type", "type": "text"},
               {"key": "status", "label": "Status", "type": "text"},
               {"key": "phone", "label": "Phone", "type": "text"}]
    return kpis, {"columns": columns, "rows": rows, "total_rows": len(rows)}, cites[:12]


async def _compute_decisions(_ctx, _plan, recs):
    rows, cites = [], []
    for d in recs[:200]:
        rows.append({"title": d.get("title"), "status": d.get("status") or "-",
                     "summary": (d.get("summary") or "")[:120]})
        cites.append({"type": "decision", "title": d.get("title"), "id": d["id"],
                      "deep_link": _deep_link("decisions", d), "date": (d.get("created_at") or "")[:10],
                      "confidence": "SYSTEM_RECORDED"})
    kpis = [{"label": "Decisions", "value": len(recs)},
            {"label": "Pending approval", "value": sum(1 for d in recs if d.get("status") == "pending_approval")}]
    columns = [{"key": "title", "label": "Decision", "type": "text"},
               {"key": "status", "label": "Status", "type": "text"},
               {"key": "summary", "label": "Summary", "type": "text"}]
    return kpis, {"columns": columns, "rows": rows, "total_rows": len(rows)}, cites[:12]


async def _compute_workflows(_ctx, _plan, recs):
    rows, cites = [], []
    for w in recs[:200]:
        rows.append({"title": w.get("title"), "type": w.get("type") or "-", "stage": w.get("stage") or "-",
                     "counterparty": w.get("counterparty") or "-"})
        cites.append({"type": "workflow", "title": w.get("title"), "id": w["id"],
                      "deep_link": _deep_link("workflows", w), "confidence": "SYSTEM_RECORDED"})
    kpis = [{"label": "Workflows", "value": len(recs)}]
    columns = [{"key": "title", "label": "Workflow", "type": "text"},
               {"key": "type", "label": "Type", "type": "text"},
               {"key": "stage", "label": "Stage", "type": "text"},
               {"key": "counterparty", "label": "Party", "type": "text"}]
    return kpis, {"columns": columns, "rows": rows, "total_rows": len(rows)}, cites[:12]


async def _compute_leaves(_ctx, _plan, recs):
    rows, cites = [], []
    for lv in recs[:200]:
        rows.append({"employee": lv.get("user_name") or "-", "type": lv.get("leave_type") or "-",
                     "status": lv.get("status") or "-", "from": lv.get("from_date") or "-",
                     "to": lv.get("to_date") or "-"})
        cites.append({"type": "leave", "title": f"{lv.get('user_name')} — {lv.get('leave_type')}", "id": lv["id"],
                      "deep_link": _deep_link("leaves", lv), "confidence": "SYSTEM_RECORDED"})
    kpis = [{"label": "Leave records", "value": len(recs)},
            {"label": "Pending", "value": sum(1 for lv in recs if lv.get("status") == "pending")}]
    columns = [{"key": "employee", "label": "Employee", "type": "text"},
               {"key": "type", "label": "Type", "type": "text"},
               {"key": "status", "label": "Status", "type": "text"},
               {"key": "from", "label": "From", "type": "date"},
               {"key": "to", "label": "To", "type": "date"}]
    return kpis, {"columns": columns, "rows": rows, "total_rows": len(rows)}, cites[:12]


async def _compute_memory(_ctx, _plan, recs):
    rows, cites = [], []
    for m in recs[:200]:
        rows.append({"note": m.get("text"), "tag": m.get("tag") or "note"})
        cites.append({"type": "memory", "title": (m.get("text") or "")[:60], "id": m["id"],
                      "deep_link": "/brain", "confidence": "EMPLOYEE_REPORTED"})
    kpis = [{"label": "Memory notes", "value": len(recs)}]
    columns = [{"key": "note", "label": "Note", "type": "text"}, {"key": "tag", "label": "Tag", "type": "text"}]
    return kpis, {"columns": columns, "rows": rows, "total_rows": len(rows)}, cites[:12]


# Dispatch registry — extend by adding an entry here + a `_compute_<entity>` function.
# Future intents (procurement, production, inventory) plug in without touching `_compute`.
_COMPUTE_HANDLERS = {
    "employees": _compute_employees,
    "tasks": _compute_tasks,
    "invoices": _compute_invoices,
    "payments": _compute_payments,
    "expenses": _compute_expenses,
    "contacts": _compute_contacts,
    "decisions": _compute_decisions,
    "workflows": _compute_workflows,
    "leaves": _compute_leaves,
    "memory": _compute_memory,
}


# ---------------------------------------------------------------------------
# 4) Answer prose (LLM writes words, NOT numbers)
# ---------------------------------------------------------------------------
_ANSWER_SYSTEM = (
    "You are DecisionOS Company Brain. You are given a user question plus PRE-COMPUTED, VERIFIED metrics "
    "(KPIs) and a sample of the result table for the user's own company workspace. Write a concise, "
    "professional answer in markdown (2-5 sentences). Use ONLY the numbers provided — never invent or "
    "recompute figures. If the data looks empty, say so plainly. Then propose 3 natural follow-up questions. "
    "Return ONLY JSON: {\"answer\": string, \"suggested_questions\": [string, string, string]}."
)


async def _answer(question, kpis, table, lang):
    sample = {"kpis": kpis, "columns": [c["label"] for c in table["columns"]],
              "rows": table["rows"][:20], "total_rows": table["total_rows"]}
    chat = claude_chat(session_id=f"brain-ans-{new_id()}",
                       system_message=_ANSWER_SYSTEM + _lang_directive(lang)).with_model(*LLM_MODEL)
    try:
        raw = await chat.send_message(UserMessage(text=f"Question: {question}\n\nComputed data:\n{json.dumps(sample, default=str)}"))
        data = _extract_json(raw) or {}
        ans = data.get("answer") or raw
        sugg = data.get("suggested_questions") if isinstance(data.get("suggested_questions"), list) else []
    except Exception:
        logger.exception("brain answer failed")
        ans = "Here is what I found in your workspace." if table["total_rows"] else "I couldn't find matching records."
        sugg = []
    return ans, [s for s in sugg if isinstance(s, str)][:3]


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------
class AskRequest(BaseModel):
    question: str
    context_id: Optional[str] = None


class ExportRequest(BaseModel):
    context_id: str
    format: str = "csv"


_PERM_DENIED_MSG = "You do not have permission to access financial or profitability information. Ask your workspace owner for Finance access."


@router.post("/ask")
async def ask(inp: AskRequest, user: dict = Depends(require_perm("ask"))):
    tid = user["tenant_id"]
    scope = {"tenant_id": tid, "uid": user.get("id"), "role": user.get("role"),
             "can_finance": _can_finance(user), "privileged": _privileged(user)}
    q = (inp.question or "").strip()
    if not q:
        raise HTTPException(status_code=400, detail="Ask a question")

    # RBAC gate — fail closed on intent BEFORE we plan/retrieve/compute so a
    # random employee cannot ask "what are our sales?" and get a real answer.
    from services import brain_rbac
    intent = brain_rbac.classify_intent(q)
    allowed = brain_rbac.allowed_intents(user)
    if intent not in allowed:
        await _audit(tid, scope["uid"], q, {"intent": intent}, [], "PERMISSION_DENIED")
        return {"type": "PERMISSION_DENIED",
                "message": brain_rbac.refusal_message(user, intent),
                "intent": intent,
                "allowed_intents": sorted(allowed)}

    prev = None
    if inp.context_id:
        prev = await db.brain_contexts.find_one(
            {"id": inp.context_id, "tenant_id": tid}, {"_id": 0, "plan": 1})
        prev = (prev or {}).get("plan")

    try:
        plan = await _plan(q, prev, user.get("language"))
    except Exception:
        logger.exception("brain planning failed")
        raise HTTPException(status_code=502, detail="AI planning error")

    # Permission validation BEFORE retrieval (disclosure by omission, not filtering)
    if (plan.get("needs_finance") or plan.get("primary_entity") in FINANCE_ENTITIES) and not scope["can_finance"]:
        await _audit(tid, scope["uid"], q, plan, [], "PERMISSION_DENIED")
        return {"type": "PERMISSION_DENIED", "message": _PERM_DENIED_MSG}

    retrieved = await _retrieve(plan, scope)
    kpis, table, cites = await _compute(plan, retrieved, scope)

    # Disclosure guard (belt & suspenders): strip money columns for non-finance users
    if not scope["can_finance"]:
        money_keys = {c["key"] for c in table["columns"] if c["type"] == "money"}
        if money_keys:
            table["columns"] = [c for c in table["columns"] if c["type"] != "money"]
            table["rows"] = [{k: v for k, v in r.items() if k not in money_keys} for r in table["rows"]]
            kpis = [k for k in kpis if not isinstance(k.get("value"), (int, float))]

    if table["total_rows"] == 0:
        await _audit(tid, scope["uid"], q, plan, [], "INSUFFICIENT_DATA")
        return {
            "type": "INSUFFICIENT_DATA",
            "answer": "I couldn't find enough information in your workspace to answer that yet.",
            "missing_information": ["No matching records were found for this question."],
            "suggested_questions": ["What needs my attention today?", "Show my overdue tasks", "Show tasks completed this month"],
        }

    answer, suggested = await _answer(q, kpis, table, user.get("language"))
    ctx_id = new_id()
    plan["_currency"] = await _currency(tid)
    await db.brain_contexts.insert_one({
        "id": ctx_id, "tenant_id": tid, "user_id": scope["uid"], "question": q,
        "plan": plan, "created_at": now_iso(),
    })
    await _audit(tid, scope["uid"], q, plan, [c["id"] for c in cites], "ANSWER")

    return {
        "type": "ANSWER",
        "answer": answer,
        "query_context_id": ctx_id,
        "kpis": kpis,
        "table": table if table["total_rows"] else None,
        "sources": cites,
        "applied_filters": {k: plan.get(k) for k in ("primary_entity", "status", "date_preset", "group_by") if plan.get(k)},
        "suggested_questions": suggested,
        "export_options": ["csv", "excel", "pdf"] if table["total_rows"] else [],
        "currency": await _currency(tid),
    }


async def _currency(tid):
    t = await db.tenants.find_one({"id": tid}, {"_id": 0, "currency": 1})
    return (t or {}).get("currency") or "INR"


async def _audit(tid, uid, question, plan, source_ids, result_type):
    try:
        await db.brain_audit.insert_one({
            "id": new_id(), "tenant_id": tid, "user_id": uid, "question": question,
            "intent": plan.get("intent"), "primary_entity": plan.get("primary_entity"),
            "needs_finance": bool(plan.get("needs_finance")), "source_record_ids": source_ids[:50],
            "result_type": result_type, "created_at": now_iso(),
        })
    except Exception:
        logger.warning("brain audit write failed")


@router.post("/brain/export")
async def export(inp: ExportRequest, user: dict = Depends(require_perm("brain_export"))):
    # FIX-004-C (RBAC-10): export = bulk data extraction (search
    # results + full context payload downloaded). Previously gated on
    # `ask` (the query permission most employees have). Split into a
    # distinct `brain_export` permission that is NOT in _BASE_PERMS —
    # only owner (magic all-perms) or an explicit grant on
    # user.permissions[]/membership.permissions[] can hit it.
    tid = user["tenant_id"]
    scope = {"tenant_id": tid, "uid": user.get("id"), "role": user.get("role"),
             "can_finance": _can_finance(user), "privileged": _privileged(user)}
    ctx = await db.brain_contexts.find_one({"id": inp.context_id, "tenant_id": tid}, {"_id": 0})
    if not ctx:
        raise HTTPException(status_code=404, detail="This result has expired. Re-run the question, then export.")
    plan = ctx["plan"]
    if (plan.get("needs_finance") or plan.get("primary_entity") in FINANCE_ENTITIES) and not scope["can_finance"]:
        raise HTTPException(status_code=403, detail=_PERM_DENIED_MSG)
    retrieved = await _retrieve(plan, scope)
    _, table, _ = await _compute(plan, retrieved, scope)
    if not scope["can_finance"]:
        money_keys = {c["key"] for c in table["columns"] if c["type"] == "money"}
        if money_keys:
            table["columns"] = [c for c in table["columns"] if c["type"] != "money"]
            table["rows"] = [{k: v for k, v in r.items() if k not in money_keys} for r in table["rows"]]
    if not table["rows"]:
        raise HTTPException(status_code=400, detail="Nothing to export.")

    cols = table["columns"]
    headers = [c["label"] for c in cols]
    keys = [c["key"] for c in cols]
    tname = await db.tenants.find_one({"id": tid}, {"_id": 0, "name": 1})
    workspace = (tname or {}).get("name") or "Workspace"
    title = ctx.get("question") or "Company Brain report"
    fmt = (inp.format or "csv").lower()

    if fmt == "csv":
        import csv
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow([f"Workspace: {workspace}"])
        w.writerow([f"Report: {title}"])
        w.writerow([f"Generated: {now_iso()} by {user.get('name')}"])
        w.writerow([])
        w.writerow(headers)
        for r in table["rows"]:
            w.writerow([r.get(k, "") for k in keys])
        data = buf.getvalue().encode("utf-8")
        return StreamingResponse(io.BytesIO(data), media_type="text/csv",
                                 headers={"Content-Disposition": "attachment; filename=company-brain.csv"})

    if fmt in ("excel", "xlsx"):
        import pandas as pd
        df = pd.DataFrame([[r.get(k, "") for k in keys] for r in table["rows"]], columns=headers)
        bio = io.BytesIO()
        with pd.ExcelWriter(bio, engine="openpyxl") as xw:
            df.to_excel(xw, index=False, sheet_name="Report", startrow=4)
            ws = xw.sheets["Report"]
            ws["A1"] = f"Workspace: {workspace}"
            ws["A2"] = f"Report: {title}"
            ws["A3"] = f"Generated: {now_iso()} by {user.get('name')}"
        bio.seek(0)
        return StreamingResponse(bio,
                                 media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                                 headers={"Content-Disposition": "attachment; filename=company-brain.xlsx"})

    if fmt == "pdf":
        from reportlab.lib.pagesizes import A4, landscape
        from reportlab.lib import colors
        from reportlab.lib.units import mm
        from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
        from reportlab.lib.styles import getSampleStyleSheet
        bio = io.BytesIO()
        doc = SimpleDocTemplate(bio, pagesize=landscape(A4), topMargin=15 * mm, bottomMargin=12 * mm)
        styles = getSampleStyleSheet()
        elems = [Paragraph(f"<b>{workspace}</b>", styles["Title"]),
                 Paragraph(title, styles["Heading3"]),
                 Paragraph(f"Generated {now_iso()} by {user.get('name')}", styles["Normal"]),
                 Spacer(1, 8)]
        data = [headers] + [[str(r.get(k, "")) for k in keys] for r in table["rows"][:500]]
        tbl = Table(data, repeatRows=1)
        tbl.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1a1a1a")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTSIZE", (0, 0), (-1, -1), 7),
            ("GRID", (0, 0), (-1, -1), 0.4, colors.grey),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f4f4f4")]),
        ]))
        elems.append(tbl)
        doc.build(elems)
        bio.seek(0)
        return StreamingResponse(bio, media_type="application/pdf",
                                 headers={"Content-Disposition": "attachment; filename=company-brain.pdf"})

    raise HTTPException(status_code=400, detail="Unsupported format")
