"""Company Brain — Decision Context capture (Phase-2, P2).

Every meaningful outcome in the app (decisions approved/rejected, task approvals,
task completions with notes, complaint/follow-up resolutions) is written as a
compact row into `db.brain_context`. Future queries (P3 multi-agent router) can
retrieve these to answer questions like:
  - "How did we handle the last vendor delay?"
  - "Show me approvals I've given over ₹50k this month"
  - "What was our decision on the Bangalore expansion?"

Design:
  • FIRE-AND-FORGET — every helper wraps its work in try/except so a Brain write
    failure NEVER breaks the parent request that produced the event.
  • DEPARTMENT-AWARE — visibility mirrors the Documents catalog (public/dept/private).
  • SMALL — one record per event, ~1KB. Chunking/embeddings are P5.
  • AUTO-TAGGED — a lightweight keyword tagger enriches each row with canonical
    tags (finance, hr, vendor, customer, sales, ops, compliance, quality,
    procurement, capex) so the P3 router can retrieve by intent without
    owners having to type tags manually.
"""
import re
from typing import List, Optional

from core import db, new_id, now_iso, logger


KIND_VALUES = {"decision", "approval", "task_done", "resolution", "note"}
VISIBILITY_VALUES = {"public", "dept", "private"}


# ---------------------------------------------------------------------------
# Auto-tagger — deterministic, zero-latency keyword vocabulary.
# ---------------------------------------------------------------------------
# Ordered from most specific to most generic so overlapping matches prefer
# the sharper canonical tag (e.g. "invoice" → finance, not just ops).
_TAG_VOCAB: List[tuple] = [
    ("finance",     r"\b(invoice|gst|tds|payroll|payment|receivable|payable|expense|cash|bank|refund|advance|discount|ledger|reconcil|salary|bonus|budget|revenue|profit|loss|billing|charge)\b"),
    ("compliance",  r"\b(compliance|regulation|regulator|licence|license|audit|filing|statutory|legal|contract|nda|policy)\b"),
    ("hr",          r"\b(hire|hiring|recruit|resign|resignation|onboard|leave|attendance|holiday|maternity|paternity|appraisal|review|performance|training|hr|human resource|employee)\b"),
    ("procurement", r"\b(purchase|procure|procurement|po\b|vendor|supplier|rfq|quotation|tender)\b"),
    ("vendor",      r"\b(vendor|supplier|partner|contractor|dealer)\b"),
    ("customer",    r"\b(customer|client|buyer|order|complaint|refund|churn|renew)\b"),
    ("sales",       r"\b(sales|lead|quote|deal|pipeline|conversion|discount|offer|campaign)\b"),
    ("ops",         r"\b(operation|delivery|logistics|shipment|dispatch|inventory|stock|warehouse|production)\b"),
    ("quality",     r"\b(quality|defect|reject|return|warranty|inspection)\b"),
    ("capex",       r"\b(capex|capital|machine|equipment|asset|infrastructure|building|expansion)\b"),
]


def auto_tags(*parts: str, existing: Optional[List[str]] = None, cap: int = 6) -> List[str]:
    """Return canonical tags found in the joined text plus any existing tags,
    de-duplicated and capped. Deterministic and fast — no LLM call."""
    text = " ".join(p or "" for p in parts).lower()
    seen: List[str] = []
    for e in existing or []:
        e = str(e).strip().lower()
        if e and e not in seen:
            seen.append(e)
    for tag, pattern in _TAG_VOCAB:
        if tag in seen:
            continue
        if re.search(pattern, text):
            seen.append(tag)
    return seen[:cap]


async def record_context(
    *,
    tenant_id: str,
    kind: str,
    title: str,
    outcome: str = "",
    why: str = "",
    tags: Optional[List[str]] = None,
    source_type: str = "",
    source_id: str = "",
    actor_id: str = "",
    actor_name: str = "",
    department: str = "",
    visibility: str = "public",
) -> Optional[str]:
    """Insert one context row. Returns the id, or None on failure (never raises)."""
    try:
        k = (kind or "note").lower()
        if k not in KIND_VALUES:
            k = "note"
        v = (visibility or "public").lower()
        if v not in VISIBILITY_VALUES:
            v = "public"
        # Enrich tags automatically from title + why (owners don't type tags).
        enriched = auto_tags(title, why, existing=tags)
        doc = {
            "id": new_id(),
            "tenant_id": tenant_id,
            "kind": k,
            "title": (title or "")[:220].strip(),
            "outcome": (outcome or "")[:60].strip(),
            "why": (why or "")[:800].strip(),
            "tags": enriched,
            "source_type": (source_type or "").strip()[:40],
            "source_id": (source_id or "").strip()[:64],
            "actor_id": actor_id or "",
            "actor_name": (actor_name or "")[:120],
            "department": (department or "").strip().lower()[:60],
            "visibility": v,
            "created_at": now_iso(),
        }
        await db.brain_context.insert_one(doc)
        return doc["id"]
    except Exception as e:
        # Deliberately swallow — Brain context is a best-effort side-signal.
        logger.warning(f"brain_context: record_context failed ({kind}/{source_id}): {e}")
        return None


def _visibility_filter(user: dict) -> dict:
    """Mongo `$or` selecting rows the user may read (mirror of brain_docs rules)."""
    role = (user.get("role") or "").lower()
    return {
        "$or": [
            {"visibility": "public"},
            {"actor_id": user.get("id")},
            {"visibility": "dept", "department": role},
        ]
    }


async def query_context(
    *,
    tenant_id: str,
    user: dict,
    kind: Optional[str] = None,
    tag: Optional[str] = None,
    q: Optional[str] = None,
    limit: int = 25,
) -> list:
    """Read a slice of the Brain context for the current tenant, permission-gated.
    Owner and team_manage see everything; others get the visibility filter."""
    from core import user_perms  # local import to avoid cycles at module load
    filt: dict = {"tenant_id": tenant_id}
    if kind and kind.lower() in KIND_VALUES:
        filt["kind"] = kind.lower()
    if tag:
        filt["tags"] = tag.lower()
    if q:
        filt["$or"] = [{"title": {"$regex": q, "$options": "i"}},
                       {"why": {"$regex": q, "$options": "i"}}]
    is_privileged = user.get("role") == "owner" or "team_manage" in user_perms(user)
    if not is_privileged:
        filt.setdefault("$and", []).append(_visibility_filter(user))
    rows = await db.brain_context.find(filt, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    return rows
