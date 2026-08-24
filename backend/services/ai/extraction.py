"""AI text-extraction + scoring engines (Epic 8 Sprint 4 -- from server.py).

Founder-directive extraction, task/contact scoring, meeting minutes, and
task execution planning/assist. Pure LLM helpers: depend on core (claude_chat,
LLM_MODEL, _extract_json, DEFAULT_OPERATING_MODEL, logger) + stdlib only;
import nothing from server.
"""
import os
import json
from datetime import datetime, timezone
from typing import Optional

from emergentintegrations.llm.chat import UserMessage

from core import claude_chat, LLM_MODEL, _extract_json, logger, DEFAULT_OPERATING_MODEL
from core import model_for
from prompts import render


async def ai_extract(transcript: str, session_id: str, allowed_roles: Optional[list] = None, members: Optional[list] = None,
                     pipelines: Optional[list] = None, task_categories: Optional[list] = None, extra_context: str = "") -> dict:
    roles = allowed_roles or ["owner", "sales", "operations", "finance"]
    roles_str = ",".join(roles)
    pipelines = pipelines or DEFAULT_OPERATING_MODEL["pipelines"]
    task_categories = task_categories or DEFAULT_OPERATING_MODEL["task_categories"]
    pipe_keys = [p["key"] for p in pipelines]
    pipe_keys_str = ",".join(pipe_keys)
    cat_keys_str = ",".join([c["key"] for c in task_categories])
    pipe_desc = " ".join(
        f"'{p['key']}' = the '{p['label']}' pipeline ({' → '.join(s['label'] for s in p['stages'])});"
        for p in pipelines
    )
    cat_desc = ", ".join(f"'{c['key']}' ({c['label']})" for c in task_categories)
    names = [m.get("name") for m in (members or []) if m.get("name")]
    members_line = (
        "Team members you can assign to by name: " + ", ".join(names) + ". "
        "If the directive explicitly names a person (e.g. 'tell Priya to...', 'ask Rajesh...'), set that task's "
        "\"assignee_name\" to the closest matching team member name above. Otherwise leave \"assignee_name\" empty "
        "and just pick a sensible \"assignee_role\". "
    ) if names else ""
    system = render(
        "extraction.extract",
        roles_str=roles_str, cat_keys_str=cat_keys_str, pipe_keys_str=pipe_keys_str,
        members_line=members_line, pipe_desc=pipe_desc, cat_desc=cat_desc,
    )
    prompt = f"Founder directive transcript:\n\"\"\"\n{transcript}\n\"\"\"\n"
    if extra_context:
        prompt += (
            "\nThe founder also attached reference material (a photo/PDF/Word/Excel — e.g. a business card, "
            "a list, an order, a screenshot). Its full contents have already been read for you below. Use it "
            "TOGETHER with the directive: pull the concrete facts out of it (names, phone numbers, emails, "
            "company, addresses, dates, amounts, items) and put the relevant ones INTO the task description(s) so "
            "the assignee has everything they need. If the directive names a person (e.g. 'fix the appointment, "
            "Priya'), delegate the task to that person and include the attachment's details (e.g. the contact's "
            "name, phone and email from a business card) in that task's description. If the directive is empty, "
            "treat the attached document as the PRIMARY input and derive the decision and tasks from it.\n"
            f"ATTACHED REFERENCE CONTENT:\n\"\"\"\n{extra_context[:6000]}\n\"\"\"\n"
        )
    prompt += "Extract the structured JSON now."
    chat = claude_chat(task="extraction.extract", session_id=session_id, system_message=system).with_model(*model_for("extraction.extract"))
    resp = await chat.send_message(UserMessage(text=prompt))
    try:
        data = _extract_json(resp)
    except Exception as e:
        logger.error(f"AI extract parse error: {e} :: {resp[:400]}")
        data = {"summary": transcript[:200], "decisions": [], "tasks": [], "workflow_events": []}
    data.setdefault("summary", "")
    for k in ("decisions", "tasks", "workflow_events", "reminders", "meeting_events", "memory_notes"):
        if not isinstance(data.get(k), list):
            data[k] = []
    return data


async def ai_score_tasks(tasks: list, currency: str, session_id: str) -> dict:
    """Score open tasks on 4 axes (0-100) + a blended priority score. Returns {task_id: scores}."""
    if not tasks:
        return {}
    today = datetime.now(timezone.utc).date().isoformat()
    lines = []
    for t in tasks:
        lines.append({
            "id": t["id"], "title": t.get("title", ""), "description": (t.get("description") or "")[:200],
            "priority": t.get("priority", "medium"), "due_date": (t.get("due_date") or "")[:10],
            "assignee_role": t.get("assignee_role") or "unassigned", "status": t.get("status"),
        })
    system = render("extraction.score_tasks", today=today, currency=currency)
    prompt = "Tasks:\n" + json.dumps(lines, ensure_ascii=False) + "\nScore them now."
    chat = claude_chat(task="extraction.score_tasks", session_id=session_id, system_message=system).with_model(*model_for("extraction.score_tasks"))
    resp = await chat.send_message(UserMessage(text=prompt))
    out = {}
    try:
        data = _extract_json(resp)
        for s in data.get("scores", []):
            tid = s.get("id")
            if not tid:
                continue
            def clamp(v):
                try:
                    return max(0, min(100, int(round(float(v)))))
                except Exception:
                    return 0
            out[tid] = {
                "business_impact": clamp(s.get("business_impact")),
                "revenue": clamp(s.get("revenue")),
                "risk": clamp(s.get("risk")),
                "urgency": clamp(s.get("urgency")),
                "priority_score": clamp(s.get("priority_score")),
                "reason": str(s.get("reason") or "")[:200],
            }
    except Exception as e:
        logger.error(f"AI score parse error: {e} :: {resp[:300]}")
    return out


async def ai_score_contact(contact: dict, metrics: dict, currency: str, session_id: str) -> dict:
    """Score a customer/supplier relationship. Returns {relationship_score, risk_score, reason, signals}."""
    ctype = contact.get("type") or "customer"
    payload = {
        "name": contact.get("name"), "type": ctype,
        "status": contact.get("status"), "tags": contact.get("tags"),
        "outstanding": metrics.get("outstanding"), "total_billed": metrics.get("total_billed"),
        "total_paid": metrics.get("total_paid"), "last_payment": metrics.get("last_payment"),
        "open_complaints": metrics.get("open_complaints"),
        "pending_deliveries": metrics.get("pending_deliveries"),
        "invoice_count": metrics.get("invoice_count"), "payment_count": metrics.get("payment_count"),
    }
    system = render("extraction.score_contact", currency=currency, ctype=ctype)
    prompt = json.dumps(payload, ensure_ascii=False, default=str) + "\nScore this relationship now."
    chat = claude_chat(task="extraction.score_contact", session_id=session_id, system_message=system).with_model(*model_for("extraction.score_contact"))
    resp = await chat.send_message(UserMessage(text=prompt))
    def clamp(v):
        try:
            return max(0, min(100, int(round(float(v)))))
        except Exception:
            return 0
    try:
        d = _extract_json(resp)
        return {
            "relationship_score": clamp(d.get("relationship_score")),
            "risk_score": clamp(d.get("risk_score")),
            "reason": str(d.get("reason") or "")[:200],
            "signals": [str(s)[:60] for s in (d.get("signals") or [])][:3],
        }
    except Exception as e:
        logger.error(f"AI contact score parse error: {e} :: {resp[:300]}")
        return {}


async def ai_meeting_notes(transcript: str, members: list, session_id: str) -> dict:
    """Turn a raw meeting transcript into structured minutes + action items."""
    names = [m.get("name") for m in (members or []) if m.get("name")]
    members_line = ("Team members you may assign action items to by name: " + ", ".join(names) + ". "
                    "Set action_items[].assignee_name to the closest matching name when a person is named, else empty. ") if names else ""
    system = render("extraction.meeting_notes", members_line=members_line)
    prompt = f"Meeting transcript:\n\"\"\"\n{(transcript or '')[:40000]}\n\"\"\"\nExtract the structured minutes now."
    chat = claude_chat(task="extraction.meeting_notes", session_id=session_id, system_message=system).with_model(*model_for("extraction.meeting_notes"))
    resp = await chat.send_message(UserMessage(text=prompt))
    try:
        d = _extract_json(resp)
    except Exception as e:
        logger.error(f"AI meeting parse error: {e} :: {resp[:300]}")
        d = {}
    d.setdefault("title", "Meeting")
    d.setdefault("summary", (transcript or "")[:200])
    for k in ("key_points", "decisions", "action_items"):
        if not isinstance(d.get(k), list):
            d[k] = []
    return d


async def ai_execution_plan(task: dict, industry: str, currency: str, session_id: str) -> dict:
    """Generate a context-aware execution checklist for a task. Returns {task_type, steps:[str]}."""
    system = render("extraction.execution_plan", industry=industry or "general", currency=currency)
    prompt = (f"Task title: {task.get('title','')}\n"
              f"Description: {task.get('description','') or '(none)'}\n"
              f"Assigned role: {task.get('assignee_role') or 'team'}\n"
              f"Priority: {task.get('priority','medium')}\n"
              "Generate the execution checklist now.")
    chat = claude_chat(task="extraction.execution_plan", session_id=session_id, system_message=system).with_model(*model_for("extraction.execution_plan"))
    resp = await chat.send_message(UserMessage(text=prompt))
    try:
        d = _extract_json(resp)
    except Exception as e:
        logger.error(f"AI execution plan parse error: {e} :: {resp[:300]}")
        d = {}
    steps = [str(s).strip() for s in (d.get("steps") or []) if str(s).strip()][:12]
    if not steps:
        steps = ["Review the task details", "Do the work", "Upload proof / notes", "Close the task"]
    return {"task_type": d.get("task_type") or "generic", "steps": steps}


async def ai_step_assist(task: dict, step_text: str, industry: str, session_id: str) -> dict:
    """Suggest a script/guidance for a single execution step + likely objections and responses."""
    system = render("extraction.step_assist", industry=industry or "general")
    prompt = (f"Task: {task.get('title','')}\n"
              f"Context: {task.get('description','') or '(none)'}\n"
              f"Current step: {step_text}\n"
              "Give the suggestion and objection handling now.")
    chat = claude_chat(task="extraction.step_assist", session_id=session_id, system_message=system).with_model(*model_for("extraction.step_assist"))
    resp = await chat.send_message(UserMessage(text=prompt))
    try:
        d = _extract_json(resp)
    except Exception as e:
        logger.error(f"AI step assist parse error: {e} :: {resp[:300]}")
        d = {}
    objs = []
    for o in (d.get("objections") or [])[:4]:
        if isinstance(o, dict) and o.get("objection"):
            objs.append({"objection": str(o["objection"])[:160], "response": str(o.get("response") or "")[:280]})
    return {"suggestion": str(d.get("suggestion") or "")[:600], "objections": objs}
