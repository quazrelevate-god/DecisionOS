"""WhatsApp Smart-Capture: AI triage + review-draft engine (Epic 8 Sprint 4 --
from server.py).

Classifies an inbound message/document, routes it to the right department's
review queue (owner only when genuinely owner-level), decides the processing
level (auto/confirm/attention), and on approval files the records or runs the
voice pipeline. Depends on core + ingestion + voice; add_inbox_item (server)
is imported deferred.
"""
import os
from datetime import datetime, timezone, timedelta
from typing import Optional

from emergentintegrations.llm.chat import UserMessage

from core import db, logger, new_id, now_iso, claude_chat, LLM_MODEL, _extract_json
from core import model_for
from prompts import render
from services.ingestion import commit_ingestion_records, _classify_ingestion
from services.voice import process_voice_note


CAPTURE_CLASSES = ["operational_task", "invoice", "payment", "purchase", "sales", "hr", "meeting", "decision", "approval", "workflow", "other"]


INTENT_BY_CLASS = {
    "sales": "sales", "purchase": "purchase", "hr": "hr",
}


DEPT_HINTS = {
    "finance": ("financ", "account", "accts", "treasur", "billing", "audit", "insurance"),
    "sales": ("sales", "estimat", "quotation", "quote", "business_development", "customer_relation", "boutique", "retail", "consultant", "customer"),
    "purchase": ("purchas", "procure", "buying", "supply_chain", "vendor", "inventory", "merchandis", "acquisition"),
    "hr": ("human_resource", "talent", "recruit", "payroll", "administrator"),
    "operations": ("operation", "logistics", "warehouse", "workshop", "fulfillment", "supply", "office_manager", "admin"),
    "marketing": ("marketing", "content", "communication", "events", "listings"),
    "production": ("production", "kitchen", "manufactur", "quality", "detailing", "technician", "back_of_house", "assembly"),
}


FINANCE_ROLE_HINTS = ("financ", "account", "accts", "treasur", "billing", "audit")


async def _finance_role_key(tenant_id: str, troles: set) -> Optional[str]:
    """Find the tenant's finance/accounts role key (role names vary by industry)."""
    if "finance" in troles:
        return "finance"
    t = await db.tenants.find_one({"id": tenant_id}, {"_id": 0, "roles": 1})
    for r in ((t.get("roles") if t else None) or []):
        blob = f"{r.get('key', '')} {r.get('label', '')}".lower()
        if any(h in blob for h in FINANCE_ROLE_HINTS):
            return r.get("key")
    return None


async def _resolve_reviewer_role(tenant_id: str, troles: set, intent: Optional[str]) -> Optional[str]:
    """Map a department 'intent' (finance/sales/purchase/hr/operations/marketing/production, or a
    literal role name) to the tenant's ACTUAL role key. Returns None when nothing matches (so the
    caller can decide the fallback). This is what keeps departmental captures OUT of the owner queue."""
    intent = (intent or "").strip().lower()
    if not intent or intent == "owner":
        return None
    if intent in troles:
        return intent
    t = await db.tenants.find_one({"id": tenant_id}, {"_id": 0, "roles": 1})
    roles = (t.get("roles") if t else None) or []
    for r in roles:  # exact key match first
        if r.get("key") == intent:
            return r.get("key")
    hints = DEPT_HINTS.get(intent, (intent,))
    for r in roles:  # then fuzzy hint match against key + label
        blob = f"{r.get('key', '')} {r.get('label', '')}".lower()
        if any(h in blob for h in hints):
            return r.get("key")
    return None


DOC_CLASS = {"sales_invoice": "invoice", "purchase_bill": "purchase", "payment": "payment",
             "purchase_order": "purchase", "quotation": "sales", "receipt": "payment"}


CAPTURE_THRESHOLD = float(os.environ.get("CAPTURE_OWNER_THRESHOLD", "50000"))


AUTO_CONFIDENCE = float(os.environ.get("CAPTURE_AUTO_CONFIDENCE", "0.90"))


ATTENTION_CONFIDENCE = float(os.environ.get("CAPTURE_ATTENTION_CONFIDENCE", "0.60"))


def _needs_owner_review(cls: str, amount, policy: bool, threshold: float = CAPTURE_THRESHOLD) -> bool:
    return bool(policy) or cls in ("approval", "decision") or (amount is not None and amount >= threshold)


async def _capture_settings(tenant_id: str):
    """Owner-configurable capture settings: (high_value_threshold, require_owner_signoff)."""
    t = await db.tenants.find_one({"id": tenant_id}, {"_id": 0, "high_value_threshold": 1, "require_owner_signoff": 1})
    thr = (t or {}).get("high_value_threshold")
    thr = float(thr) if isinstance(thr, (int, float)) and thr > 0 else CAPTURE_THRESHOLD
    return thr, bool((t or {}).get("require_owner_signoff"))


def _decide_processing_level(cls, confidence, amount, needs_owner, is_duplicate, has_records, is_document, has_unknown_purchase=False):
    """Map an AI-triaged capture to one of: auto | confirm | attention.
    Returns (level, reason)."""
    if is_duplicate:
        return "attention", "Possible duplicate of an already-filed invoice — please verify before saving."
    if has_unknown_purchase:
        return "attention", "AI couldn't confidently tell if this purchase is an expense, an asset, or inventory — please classify and approve."
    if confidence is not None and confidence < ATTENTION_CONFIDENCE:
        return "attention", "Low confidence extraction — please double-check the details."
    if is_document and not has_records:
        return "attention", "Couldn't read clear structured data from this document — please review."
    if needs_owner:
        return "confirm", ""
    if (is_document and confidence is not None and confidence >= AUTO_CONFIDENCE
            and amount is not None and 0 < amount < CAPTURE_THRESHOLD
            and cls in ("purchase", "sales")):
        return "auto", ""
    return "confirm", ""


_CAPTURE_SYS = render("captures.triage")  # prompt in prompts/captures.py; {roles} filled by .replace()


async def ai_capture_triage(text: str, roles: list) -> dict:
    system = _CAPTURE_SYS.replace("{roles}", ", ".join(roles) or "owner")
    chat = claude_chat(session_id=f"capture-{new_id()}", system_message=system).with_model(*model_for("captures.triage"))
    resp = await chat.send_message(UserMessage(text=(text or "")[:4000]))
    try:
        d = _extract_json(resp)
    except Exception:
        d = {}
    if d.get("classification") not in CAPTURE_CLASSES:
        d["classification"] = "other"
    d.setdefault("intent", "")
    d.setdefault("summary", (text or "")[:160])
    if d.get("priority") not in ("low", "medium", "high"):
        d["priority"] = "medium"
    d.setdefault("department", "owner")
    try:
        d["confidence"] = max(0.0, min(1.0, float(d.get("confidence"))))
    except (TypeError, ValueError):
        d["confidence"] = 0.7
    d["unrelated"] = bool(d.get("unrelated"))
    return d


async def persist_capture_draft(tenant_id, wa_from, kind, payload, tri, troles, records=None,
                                status="pending_review", confidence=None, processing_level="confirm",
                                duplicate_of=None, attention_reason=""):
    cls = tri.get("classification", "other")
    amount = tri.get("amount") if isinstance(tri.get("amount"), (int, float)) else None
    dept = tri.get("department")
    money_item = cls in ("invoice", "payment")
    reviewer_perm = "finance" if money_item else None
    threshold, require_signoff = await _capture_settings(tenant_id)
    high_value = amount is not None and amount >= threshold
    escalate_reason = ""
    needs_owner = False
    # Department intent: money items → finance; sales/purchase/hr fixed; everything else uses
    # the AI-suggested department. Resolved against the tenant's REAL role keys below.
    intent = INTENT_BY_CLASS.get(cls) or dept

    if money_item:
        # Invoice/payment always flow to finance directly — routed to the tenant's actual
        # finance/accounts role. reviewer_perm ensures anyone with the finance permission sees it.
        reviewer = await _finance_role_key(tenant_id, troles) or "owner"
        if high_value:
            escalate_reason = f"High value ({amount:,.0f}) — verify before approving"
            if require_signoff:
                # Owner sign-off required above the configured threshold.
                needs_owner = True
                reviewer = "owner"
                escalate_reason = f"High value ({amount:,.0f}) — owner sign-off required"
    elif cls in ("approval", "decision") or bool(tri.get("policy_or_high_risk")) or high_value:
        # Genuinely owner-level: formal approvals/decisions, policy/high-risk, or high-value commitments.
        needs_owner = True
        reviewer = "owner"
        if high_value:
            escalate_reason = f"High-value item ({amount:,.0f})"
        elif cls in ("approval", "decision"):
            escalate_reason = f"{cls.title()}-level item"
        else:
            escalate_reason = "Policy / high-risk"
    else:
        # Routine departmental work (tasks, sales, purchase, hr, meetings, workflows) → the
        # relevant department's Review Queue, NOT the owner. Owner still sees all captures.
        reviewer = await _resolve_reviewer_role(tenant_id, troles, intent) or "owner"
    if not reviewer:
        reviewer = "owner"
    due = None
    if isinstance(tri.get("due_in_days"), int):
        due = (datetime.now(timezone.utc) + timedelta(days=tri["due_in_days"])).isoformat()
    did = new_id()
    await db.capture_drafts.insert_one({
        "id": did, "tenant_id": tenant_id, "source": "whatsapp", "wa_from": wa_from, "kind": kind,
        "text": payload.get("text", ""), "file_url": payload.get("file_url"), "filename": payload.get("filename"),
        "classification": cls, "intent": tri.get("intent", ""), "summary": tri.get("summary", ""),
        "department": dept, "reviewer_role": reviewer, "reviewer_perm": reviewer_perm, "assignee_id": None,
        "priority": tri.get("priority", "medium"), "due_date": due, "amount": amount, "records": records,
        "needs_owner": needs_owner, "escalate_reason": escalate_reason,
        "confidence": confidence, "processing_level": processing_level,
        "duplicate_of": duplicate_of, "attention_reason": attention_reason, "auto_processed": False,
        "status": status, "review_action": None, "clarification_note": None,
        "created_at": now_iso(), "reviewed_by": None, "reviewed_at": None, "result_ref": None,
    })
    return did


async def execute_capture(d: dict, user: dict):
    from server import add_inbox_item  # inbox helper still in server; deferred
    tenant_id = d["tenant_id"]
    # Document-based drafts → file the extracted financial records.
    if d.get("records") and d.get("kind") in ("pdf", "image", "document"):
        ing_id = new_id()
        created = await commit_ingestion_records(tenant_id, user["id"], d["records"], ing_id, "whatsapp")
        doc = {
            "id": ing_id, "tenant_id": tenant_id, "created_by": user["id"], "source": "whatsapp",
            "kind": d.get("kind"), "filename": d.get("filename") or f"{ing_id}", "file_url": d.get("file_url"),
            "status": "filed", "created_at": now_iso(), "summary": d.get("summary", ""),
            "doc_type": d.get("classification"), "records": d["records"], "created_counts": created,
            "filed_at": now_iso(), "wa_from": d.get("wa_from"),
        }
        await db.ingestions.insert_one(dict(doc))
        inbox_id = await add_inbox_item(tenant_id, user["id"], "whatsapp", _classify_ingestion(doc),
                                        doc["summary"] or doc["filename"], doc["filename"], "ingestion", ing_id, status="done")
        await db.ingestions.update_one({"id": ing_id, "tenant_id": tenant_id}, {"$set": {"inbox_id": inbox_id}})  # FIX-001-C
        return {"type": "ingestion", "id": ing_id, "created": created}
    # Text / instruction drafts → run the structuring pipeline, then apply reviewer overrides + release.
    note_id = new_id()
    await db.voice_notes.insert_one({
        "id": note_id, "tenant_id": tenant_id, "created_by": user["id"], "kind": "text",
        "audio_path": None, "transcript": d.get("text") or d.get("summary") or "", "language": "auto",
        "status": "queued", "source": "whatsapp", "wa_from": d.get("wa_from"),
        "raised_by_name": d.get("wa_from"), "created_at": now_iso(),
    })
    await process_voice_note(note_id)
    vn = await db.voice_notes.find_one({"id": note_id}, {"_id": 0, "decision_id": 1})
    decision_id = (vn or {}).get("decision_id")
    if decision_id:
        overrides = {}
        if d.get("assignee_id"):
            overrides["assignee_id"] = d["assignee_id"]
        if d.get("priority"):
            overrides["priority"] = d["priority"]
        if d.get("due_date"):
            overrides["due_date"] = d["due_date"]
        if overrides:
            overrides["updated_at"] = now_iso()
            overrides["last_action"] = "Set by reviewer"
            # FIX-001-C: all writes below scope by tenant_id so a leaked/guessed
            # decision_id can never touch another tenant's tasks or decision.
            await db.tasks.update_many({"tenant_id": tenant_id, "decision_id": decision_id}, {"$set": overrides})
        # Reviewer approved the capture → release the decision's blocked tasks.
        await db.decisions.update_one({"id": decision_id, "tenant_id": tenant_id}, {"$set": {"status": "approved"}})
        await db.tasks.update_many({"tenant_id": tenant_id, "decision_id": decision_id, "status": "blocked"},
                                   {"$set": {"status": "todo", "updated_at": now_iso(), "last_action": "Approved via capture"}})
    return {"type": "decision", "id": decision_id}
