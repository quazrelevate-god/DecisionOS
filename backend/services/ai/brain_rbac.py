"""Who may ask Dex about what — access follows the DATA, not the words.

2026-10-05 (founder: "hope the ask has the RBAC right… make the ask question
more reliable, better design"). The gate this replaces decided from the
question's WORDS and from hard-coded role names: "sales" in the question was a
"sales" intent, and only a role literally called "sales" could ask it. Real
companies name their teams ("Sales & Order Management", "Accounts & Buyer
Payments"), so Priya — in Sales — was refused "what were our sales?", and
"what is the status of the Bluewave UK order?" (her own order) was refused as
a finance question because the planner thought "order" meant invoices.

Now there is one rule per KIND OF RECORD, the same rule its own screen uses:

  tasks, people's workload,      always — trimmed to what the asker may see
  decisions, leaves                (routers/brain._retrieve, services/record_access)
  workflows (pipelines)          "workflows" — only the pipelines their team works in
  contacts (customers/suppliers) any CRM side — only the sides they may open
  invoices, payments, expenses   "finance"
  memory (company notes)         "brain"

A question is never refused for the words in it. It is refused only when the
records it needs are ones the asker cannot open — and then the message says
which access that takes and what they CAN ask. Money is never shown without
Finance: money columns are stripped and the answer is told not to state amounts.
"""
import re
from typing import Optional

from core.permissions import crm_types, user_perms


# Kind of record -> (what it is called on screen, the access it takes or None,
# plural?). Documents are open to every asker: each document carries its own
# visibility, applied when they are searched (brain_retrieval).
_AREAS = {
    "tasks":     ("tasks", None, True),
    "employees": ("people's workload", None, False),
    "decisions": ("decisions", None, True),
    "leaves":    ("leave", None, False),
    "documents": ("company documents and policies", None, True),
    "workflows": ("pipelines (Workflows)", "workflows", True),
    "contacts":  ("customers and suppliers (CRM)", "crm", True),
    "invoices":  ("invoices, payments and balances (Finance)", "finance", True),
    "payments":  ("invoices, payments and balances (Finance)", "finance", True),
    "expenses":  ("expenses (Finance)", "finance", True),
    "memory":    ("the company memory (Company Brain)", "brain", False),
}

FINANCE_AREAS = {"invoices", "payments", "expenses"}

# What the planner may pick instead when its first choice is closed to the
# asker and the question NAMES something: pipeline cards, then work, then
# decisions, then contacts — the places a named order, shipment or customer
# lives outside the ledger.
REROUTE_ORDER = ("workflows", "tasks", "decisions", "contacts")


def entity_open(user: dict, entity: str) -> bool:
    """May this person read this kind of record at all?"""
    need = (_AREAS.get(entity) or (None, "closed", True))[1]
    if need is None:
        return True
    if need == "crm":
        return bool(crm_types(user))
    if need == "closed":
        return False
    return need in user_perms(user)


def what_you_can_ask(user: dict) -> list:
    """Plain words for the kinds of records this person can ask about."""
    out, seen = [], set()
    for entity in ("tasks", "decisions", "workflows", "contacts", "invoices", "expenses", "leaves", "documents", "memory"):
        label = _AREAS[entity][0]
        if entity_open(user, entity) and label not in seen:
            seen.add(label)
            out.append(label)
    return out


def closed_message(user: dict, entity: str) -> str:
    """Why this is refused, in the screen's words, and what they can ask."""
    name = (user.get("name") or "").split()[0] if user.get("name") else "there"
    label, _need, plural = _AREAS.get(entity) or ("that", None, False)
    can = what_you_can_ask(user)
    tail = ""
    if can:
        tail = " You can ask me about " + (", ".join(can[:-1]) + f" or {can[-1]}" if len(can) > 1 else can[0]) + "."
    return (f"Sorry {name} — {label} {'are' if plural else 'is'}n't part of your access, so I can't answer that. "
            f"Your workspace owner can give you that access.{tail}")


# A question that ASKS for a money figure. Only these are refused outright when
# the money records are closed; anything else that names a record is answered
# from the records the asker can open. "invoice" alone is not here: "who is
# working on the Bluewave proforma invoice?" is a question about a TASK.
_MONEY_Q = re.compile(
    r"\b(how much|owe[sd]?|owing|outstanding|balances?|amounts?|totals?|revenue|turnover|profit|margin|"
    r"loss(?:es)?|price[sd]?|pricing|cost(?:s|ing)?|spen[dt]|paid|unpaid|payments?|receivables?|payables?|"
    r"cash|bank|gst|tds|tax(?:es)?|rupees?|rs\.?|inr|lakhs?|crores?|sales figures?|how much did we (?:sell|make))\b"
    r"|₹", re.I)


def asks_for_money(question: str) -> bool:
    return bool(_MONEY_Q.search(question or ""))


# "mine": the asker's own records. "show me …" is NOT mine ("show me all
# tasks"), so "me" counts only after for/to/on/with.
_MINE_Q = re.compile(
    r"\b(my|mine|myself)\b|\b(assigned to|for|on|with|from) me\b|\bi (have|need|own|am|should|must|did)\b"
    r"|\b(do|should|must|can) i\b", re.I)
# "my team / my company / my attention / my customers …" is the asker speaking
# for the business, not asking for their own records: an owner asking "what
# needs my attention today?" means the company's open work, not tasks
# assigned to her (live: she was told she had nothing to do).
_COLLECTIVE_MY = re.compile(
    r"\bmy (attention|focus|team|teams|company|business|staff|employees|people|workers|workspace|"
    r"organi[sz]ation|customers?|clients?|buyers?|suppliers?|vendors?|orders?|sales|shop|factory|mill|firm|day|week)\b",
    re.I)


def is_about_me(question: str) -> bool:
    return bool(_MINE_Q.search(_COLLECTIVE_MY.sub(" ", question or "")))


def speaks_for_the_business(question: str) -> bool:
    return bool(_COLLECTIVE_MY.search(question or ""))


def reroute_note(entity_from: str, entity_to: str) -> Optional[str]:
    """One sentence prepended to an answer that came from other records."""
    if entity_from == entity_to:
        return None
    label, _need, plural = _AREAS.get(entity_from) or ("that", None, False)
    verb = "are" if plural else "is"
    source = "the company documents you can read" if entity_to == "documents" else "the records you can open"
    return f"({label[0].upper() + label[1:]} {verb}n't part of your access — this answer uses {source}.)"
