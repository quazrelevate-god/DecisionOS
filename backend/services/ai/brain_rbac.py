"""Company Brain — Role-Based Access Control (Phase-2).

Shared RBAC utilities used by BOTH `/api/ask` (routers/brain.py) and
`/api/brain/agent` (routers/brain_router.py) so a random employee cannot ask
Dex "what are our sales?" and get a real answer regardless of which entry
point they use.

Design:
  • FAIL CLOSED — any intent outside the caller's grant list is refused
    with a warm message that names what they CAN ask.
  • DETERMINISTIC — the allow-list is a static role→intents map (no LLM
    judgement in the security decision).
  • BELT & SUSPENDERS — tool-level guards (e.g. mongo_query hiding money
    columns for non-finance users) still apply on top.
"""
import re
from typing import Optional


INTENTS = (
    "finance", "sales", "hr", "procurement", "operations",
    "org_analytics", "policy", "personal", "general",
)

# Baseline every authenticated user always has access to.
_BASELINE = {"policy", "personal", "general"}

# Role / permission → additional intent grants (union'd with baseline).
_ROLE_GRANTS = {
    "owner":        set(INTENTS),                             # sees everything
    "finance":      {"finance", "procurement", "operations", "org_analytics"},
    "ledger":       {"finance", "procurement", "org_analytics"},
    "sales":        {"sales"},
    "hr":           {"hr", "org_analytics"},
    "team_manage":  {"hr", "org_analytics"},
    "operations":   {"operations", "procurement"},
    "ops":          {"operations", "procurement"},
    "production":   {"operations", "procurement"},
    "procurement":  {"procurement"},
}


def allowed_intents(user: dict) -> set:
    """Compute the intent categories this specific user may ask about."""
    from core import user_perms  # local import to avoid cycles
    allowed = set(_BASELINE)
    role = (user.get("role") or "").lower()
    if role in _ROLE_GRANTS:
        allowed |= _ROLE_GRANTS[role]
    # user_perms() lets a "manager" role with `team_manage` still get HR access.
    for p in user_perms(user):
        if p in _ROLE_GRANTS:
            allowed |= _ROLE_GRANTS[p]
    return allowed


def refusal_message(user: dict, intent: str) -> str:
    """Warm, actionable refusal that names what this user CAN ask about."""
    name = (user.get("name") or "").split()[0] if user.get("name") else "there"
    allowed = allowed_intents(user)
    labels = {
        "finance":       "invoices, payments and cash",
        "sales":         "your sales pipeline and customer deals",
        "hr":            "team, hiring, and leaves",
        "procurement":   "vendors and purchase orders",
        "operations":    "production, inventory and delivery",
        "org_analytics": "company-wide metrics",
        "policy":        "company policies",
        "personal":      "your own tasks and activity",
        "general":       "how to use DecisionOS",
    }
    can_ask_order = ("finance", "sales", "hr", "procurement", "operations",
                     "org_analytics", "policy", "personal")
    can_ask = [labels[i] for i in can_ask_order if i in allowed]
    if len(can_ask) > 1:
        fallback = ", ".join(can_ask[:-1]) + f", or {can_ask[-1]}"
    else:
        fallback = can_ask[0] if can_ask else "your own tasks and public policies"
    intent_label = labels.get(intent, "that")
    return (
        f"Sorry {name} — questions about {intent_label} aren't part of your access. "
        f"Ask your workspace owner to grant that role if you need it. "
        f"For now you can ask me about {fallback}."
    )


# ---------------------------------------------------------------------------
# Heuristic intent classifier — used by /api/ask which doesn't want a full
# extra Claude call just for RBAC. Order matters: more specific patterns
# checked before broader ones. `policy` runs BEFORE hr/finance/etc so that
# "leave policy" and "expense policy" get classified as policy (a public
# baseline intent) rather than the private domain the noun belongs to.
# ---------------------------------------------------------------------------
_INTENT_PATTERNS = [
    ("policy",       r"\b(policy|policies|sop|standard operating|filing|filings|contract|nda|compliance rule|regulation|handbook)\b"),
    ("personal",     r"\b(my (?:task|leave|activity|inbox|approval)|assigned to me|my todo|my work|my own)\b"),
    ("hr",           r"\b(hire|hiring|recruit|resign|resignation|onboard|attendance|salary|payroll|appraisal|holiday|maternity|paternity|employee\b|staff|headcount|team member|manager|leaves? (of|for) )\b"),
    ("finance",      r"\b(invoice|gst|tds|payment|receivable|payable|expense|cash|bank|refund|revenue|profit|loss|billing|ledger|reconcil|tax|budget|paid|unpaid|overdue.*invoice)\b"),
    ("sales",        r"\b(sale|sales|lead|pipeline|deal|discount|quote|quotation|conversion|customer.*revenue|top customer|top client)\b"),
    ("procurement",  r"\b(vendor|supplier|purchase order|po\b|rfq|procurement|reorder|dealer)\b"),
    ("operations",   r"\b(production|inventory|stock|warehouse|delivery|dispatch|logistics|shipment|quality|defect|workflow)\b"),
    ("org_analytics",r"\b(how (?:is|are).* (?:business|company|going)|kpi|dashboard|company (?:health|metric)|top-level)\b"),
]


def classify_intent(question: str, primary_entity: Optional[str] = None) -> str:
    """Best-guess intent from a natural-language question and (optionally) the
    /ask planner's `primary_entity`. Returns a value from INTENTS."""
    q = (question or "").lower()
    for intent, pat in _INTENT_PATTERNS:
        if re.search(pat, q):
            return intent
    # Entity fallbacks — trust the /ask planner when it identified an entity.
    entity_map = {
        "invoice": "finance", "payment": "finance", "expense": "finance",
        "customer": "sales", "lead": "sales", "deal": "sales",
        "employee": "hr", "leave": "hr", "attendance": "hr",
        "vendor": "procurement", "purchase": "procurement",
        "task": "personal", "activity": "personal", "workflow": "operations",
    }
    if primary_entity and primary_entity in entity_map:
        return entity_map[primary_entity]
    return "general"
