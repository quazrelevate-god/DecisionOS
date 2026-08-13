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
#
# FIX-007-A (S4-11): vocabulary is now industry-aware. The base list
# below is the always-on core (finance / compliance / hr / procurement /
# vendor / customer / sales / ops / quality / capex) that applies to
# every business regardless of industry. INDUSTRY_VOCAB layers domain-
# specific tags on top so clinics, restaurants, agencies and retail
# don't get silently under-tagged. A tenant can also supply their own
# custom pairs via tenant.brain_tag_vocab (list of {tag, pattern}) —
# recorded once at onboarding + editable via Settings > Operations.
# ---------------------------------------------------------------------------
_BASE_TAG_VOCAB: List[tuple] = [
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

# Compat alias — old code may still reference `_TAG_VOCAB`. Points at the
# base list so any legacy import still gets the same behaviour a tenant
# with no industry override + no custom vocab would see.
_TAG_VOCAB: List[tuple] = _BASE_TAG_VOCAB

# Per-industry ADDITIONS to the base vocab. Order still matters (most
# specific first). Keys are normalized industry strings — see
# _industry_key() below.
INDUSTRY_VOCAB: "dict[str, list[tuple]]" = {
    "manufacturing": [
        ("production",  r"\b(bom|batch|run|shift|line|machine|downtime|yield|rework|scrap|tooling)\b"),
        ("logistics",   r"\b(pallet|container|hs code|hsn|awb|bill of lading|freight|customs|export|import)\b"),
    ],
    "healthcare": [
        ("clinical",    r"\b(patient|diagnosis|prescription|rx|opd|ipd|discharge|consultation|referral|lab|test|report)\b"),
        ("pharmacy",    r"\b(drug|medicine|dose|dosage|batch expiry|refill|schedule h|controlled|dispense)\b"),
        ("insurance",   r"\b(claim|tpa|cashless|reimbursement|pre-auth|approval code|coverage)\b"),
    ],
    "clinic": [  # alias — same as healthcare
        ("clinical",    r"\b(patient|diagnosis|prescription|rx|opd|ipd|discharge|consultation|referral|lab|test|report)\b"),
        ("pharmacy",    r"\b(drug|medicine|dose|dosage|batch expiry|refill|dispense)\b"),
        ("appointment", r"\b(appointment|booking|slot|no-show|reschedule|walk-in)\b"),
    ],
    "restaurant": [
        ("kitchen",     r"\b(recipe|prep|kot|kitchen order|menu|dish|special|wastage|spoilage)\b"),
        ("service",     r"\b(table|cover|reservation|walk-in|waitstaff|billing round|tip|feedback)\b"),
        ("inventory",   r"\b(stock|par level|supplier delivery|received|storage|cold room|shelf life)\b"),
    ],
    "restaurant/hospitality": [  # tenant onboarding may write either form
        ("kitchen",     r"\b(recipe|prep|kot|kitchen order|menu|dish|special|wastage|spoilage)\b"),
        ("service",     r"\b(table|cover|reservation|walk-in|waitstaff|tip|feedback)\b"),
    ],
    "agency": [
        ("client_work", r"\b(brief|deliverable|scope|revision|round|approval|signoff|handoff|deck|creative|campaign brief)\b"),
        ("time",        r"\b(timesheet|billable|utilization|utilisation|hours logged|retainer)\b"),
        ("pitch",       r"\b(pitch|proposal|rfp|shortlist|award|win|loss|preferred vendor)\b"),
    ],
    "retail": [
        ("store",       r"\b(store|outlet|sku|shelf|planogram|footfall|conversion|stockout|replenish)\b"),
        ("returns",     r"\b(exchange|refund policy|store credit|damaged|return window|reason code)\b"),
    ],
    "services": [
        ("engagement",  r"\b(engagement|milestone|deliverable|sla|contract term|renewal|retainer)\b"),
    ],
    "logistics": [
        ("shipment",    r"\b(consignment|awb|pod|delivery attempt|failed delivery|address|route)\b"),
        ("fleet",       r"\b(vehicle|driver|fuel|maintenance|trip|dispatch time)\b"),
    ],
    "education": [
        ("academic",    r"\b(student|class|batch|exam|result|grade|attendance|syllabus|semester|fees)\b"),
        ("admissions",  r"\b(admission|enquiry|counseling|counselling|entrance|application form|scholarship)\b"),
    ],
    "construction": [
        ("site",        r"\b(site|project|drawing|boq|estimate|milestone billing|running bill|labor|contractor bill)\b"),
        ("materials",   r"\b(cement|steel|aggregate|delivery challan|dc\b|material request|indent)\b"),
    ],
}


def _industry_key(raw: Optional[str]) -> Optional[str]:
    """Normalize a tenant's industry string to an INDUSTRY_VOCAB key.
    Returns None if the industry isn't in our vocab table."""
    if not raw:
        return None
    k = str(raw).strip().lower()
    if k in INDUSTRY_VOCAB:
        return k
    # Loose fuzzy match — try common substring hits.
    for candidate in INDUSTRY_VOCAB:
        if candidate in k or k in candidate:
            return candidate
    return None


def _resolve_vocab(
    industry: Optional[str] = None,
    tenant_custom: Optional[list] = None,
) -> List[tuple]:
    """Build the effective vocabulary for one tag pass:
      base + industry-specific + tenant custom (all deduped by tag key,
      first occurrence wins so tenant custom > industry > base).
    """
    out: List[tuple] = []
    seen_tags: set = set()

    def _add(pairs):
        for tag, pat in pairs:
            k = (tag or "").strip().lower()
            if not k or k in seen_tags:
                continue
            seen_tags.add(k)
            out.append((k, pat))

    # tenant custom first so a tenant-defined tag can OVERRIDE a base one
    # (e.g. redefine what "vendor" catches for their business).
    if tenant_custom:
        _add(
            (str(x.get("tag") or "").strip(), str(x.get("pattern") or "").strip())
            for x in tenant_custom
            if isinstance(x, dict) and x.get("tag") and x.get("pattern")
        )
    # industry-specific next.
    k = _industry_key(industry)
    if k:
        _add(INDUSTRY_VOCAB[k])
    # base last so its patterns fill gaps but never override.
    _add(_BASE_TAG_VOCAB)
    return out


def auto_tags(
    *parts: str,
    existing: Optional[List[str]] = None,
    cap: int = 6,
    industry: Optional[str] = None,
    tenant_custom: Optional[list] = None,
) -> List[str]:
    """Return canonical tags found in the joined text plus any existing tags,
    de-duplicated and capped. Deterministic and fast — no LLM call.

    FIX-007-A (S4-11): `industry` and `tenant_custom` now shape the
    effective vocabulary. Callers that don't pass them get identical
    behaviour to the pre-fix version (base vocab only) so this is
    100% backward compatible.
    """
    text = " ".join(p or "" for p in parts).lower()
    seen: List[str] = []
    for e in existing or []:
        e = str(e).strip().lower()
        if e and e not in seen:
            seen.append(e)
    vocab = _resolve_vocab(industry=industry, tenant_custom=tenant_custom)
    for tag, pattern in vocab:
        if tag in seen:
            continue
        try:
            if re.search(pattern, text):
                seen.append(tag)
        except re.error:
            # A malformed tenant-supplied regex must not crash tag-time.
            continue
    return seen[:cap]


async def _load_tenant_vocab_shape(tenant_id: str) -> tuple:
    """Read (industry, custom_vocab) for a tenant from db.tenants.
    Best-effort — returns (None, None) on any DB blip so record_context
    can still run its base-vocab tagging."""
    try:
        t = await db.tenants.find_one(
            {"id": tenant_id},
            {"_id": 0, "industry": 1, "brain_tag_vocab": 1},
        ) or {}
        return (t.get("industry"), t.get("brain_tag_vocab"))
    except Exception:
        return (None, None)


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
        # FIX-007-A (S4-11): pass the tenant's industry + any custom vocab
        # so clinics / restaurants / agencies get their domain-specific
        # tags instead of only the manufacturing-flavoured base list.
        _industry, _custom = await _load_tenant_vocab_shape(tenant_id)
        enriched = auto_tags(
            title, why,
            existing=tags,
            industry=_industry,
            tenant_custom=_custom,
        )
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
    Owner and team_manage see everything; others get the visibility filter.
    When `q` is set, results are ranked by Mongo's native text-index score
    (title weight 6, tags 3, why 1) — falls back to regex if the text index
    is unavailable (e.g. fresh DB before bootstrap ran)."""
    from core import user_perms  # local import to avoid cycles at module load
    filt: dict = {"tenant_id": tenant_id}
    if kind and kind.lower() in KIND_VALUES:
        filt["kind"] = kind.lower()
    if tag:
        filt["tags"] = tag.lower()
    is_privileged = user.get("role") == "owner" or "team_manage" in user_perms(user)
    if not is_privileged:
        filt.setdefault("$and", []).append(_visibility_filter(user))

    if q:
        # Primary path — ranked full-text search.
        try:
            text_filt = {**filt, "$text": {"$search": q}}
            rows = await db.brain_context.find(
                text_filt,
                {"_id": 0, "score": {"$meta": "textScore"}},
            ).sort([("score", {"$meta": "textScore"})]).limit(limit).to_list(limit)
            if rows:
                return rows
        except Exception as e:
            logger.warning(f"brain_context text search fallback: {e}")
        # Fallback — regex on title / why so we still return something when the
        # text index hasn't caught up (e.g. immediately after a fresh insert).
        filt["$or"] = [{"title": {"$regex": q, "$options": "i"}},
                       {"why":   {"$regex": q, "$options": "i"}}]

    rows = await db.brain_context.find(filt, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    return rows
