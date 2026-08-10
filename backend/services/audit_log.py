"""FIX-004-F (RBAC-20): immutable audit log.

Append-only ledger of security-relevant events: who did what, to whom,
from what IP + UA, when, before/after. Required for SOC 2 / DPDP /
GDPR compliance + operational forensics ("who deleted this decision?").

Design:
  * `audit_log` collection. Compound indexes on (tenant_id, timestamp
    DESC) and (actor_id, timestamp DESC) for the two read patterns
    ops need: "everything in tenant X since Monday" and "everything
    user Y did".
  * No TTL — audit rows live forever. Compliance regimes typically
    require 12-24 months minimum; a Sprint-5 retention policy can
    add explicit purge later, but the default is retain-all.
  * NEVER exposed as a PATCH/DELETE endpoint. The API only supports
    read (owner-only) and record (server-side only). "Append-only"
    is enforced at the API layer — Mongo itself doesn't prevent an
    admin with DB access from tampering, but the audit-log-tampering
    attack surface should be the DB creds, not an HTTP endpoint.
  * Best-effort record: a Mongo hiccup MUST NOT fail the user's
    action. We log the failure locally and continue. Missing audit
    rows are recoverable via app logs; a blocked user action is not.
  * Actor context extraction: `context_from(request, user)` builds
    the actor_* fields from a FastAPI Request + user dict. If the
    request is missing (background task), IP/UA are omitted.

Contract:
  record(db, *, action, actor_id, actor_email, tenant_id,
         entity_type=None, entity_id=None, before=None, after=None,
         actor_ip=None, actor_ua=None, meta=None) -> None

  query(db, *, tenant_id, filters=None, limit=100, before_ts=None)
  -> list of audit rows, most-recent-first.

  context_from(request, user) -> {actor_id, actor_email, actor_ip,
    actor_ua, tenant_id}
"""
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from core import logger, new_id


COLLECTION = "audit_log"

# Canonical action name registry — keep in sync with the record() call
# sites so a typo doesn't create an unqueryable action key. Free-form
# strings are still accepted by record(); this list is documentation.
ACTIONS = {
    # Auth / session
    "login_success",
    "login_failure",
    "logout",
    "session_revoked",
    "password_changed",
    "password_reset_requested",
    "password_reset_completed",
    "email_verification_sent",
    "email_verified",
    # User / membership
    "user_created",
    "user_updated",
    "user_deleted",
    "user_uninvited",
    "user_deprovisioned",
    "membership_created",
    "membership_updated",
    "membership_removed",
    "role_created",
    "role_renamed",
    "role_deleted",
    "role_permissions_updated",
    "owner_exclusions_updated",
    # Tenant lifecycle
    "tenant_created",
    "tenant_updated",
    "tenant_suspended",
    "tenant_deleted",
    # High-value domain writes
    "decision_approved",
    "decision_rejected",
    "workflow_deleted",
    "task_deleted",
    "capture_approved",
    "capture_rejected",
    # AI keys / platform admin
    "ai_key_updated",
    "platform_admin_login",
    "platform_admin_tenant_wipe",
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def context_from(request: Any, user: Optional[dict]) -> Dict[str, Any]:
    """Extract actor context for a record() call.

    `request` may be None for background tasks / scheduler jobs — in
    that case IP + UA are omitted. `user` may be None for pre-auth
    events (login_failure). Falls back to "system" for a fully
    anonymous internal event.
    """
    ctx: Dict[str, Any] = {
        "actor_id": None,
        "actor_email": None,
        "actor_ip": None,
        "actor_ua": None,
        "tenant_id": None,
    }
    if user:
        ctx["actor_id"] = user.get("id")
        ctx["actor_email"] = user.get("email")
        ctx["tenant_id"] = user.get("tenant_id")
    if request is not None:
        try:
            headers = getattr(request, "headers", {}) or {}
            xff = headers.get("X-Forwarded-For") if hasattr(headers, "get") else None
            if xff:
                ctx["actor_ip"] = xff.split(",")[0].strip()
            elif hasattr(headers, "get") and headers.get("X-Real-IP"):
                ctx["actor_ip"] = headers.get("X-Real-IP").strip()
            else:
                client = getattr(request, "client", None)
                ctx["actor_ip"] = getattr(client, "host", None) if client else None
            ctx["actor_ua"] = (headers.get("User-Agent") if hasattr(headers, "get") else None)
            if ctx["actor_ua"]:
                ctx["actor_ua"] = str(ctx["actor_ua"])[:500]
        except Exception:
            # Never let context extraction fail the audit write.
            pass
    return ctx


async def record(
    db,
    *,
    action: str,
    actor_id: Optional[str] = None,
    actor_email: Optional[str] = None,
    tenant_id: Optional[str] = None,
    entity_type: Optional[str] = None,
    entity_id: Optional[str] = None,
    before: Optional[Dict[str, Any]] = None,
    after: Optional[Dict[str, Any]] = None,
    actor_ip: Optional[str] = None,
    actor_ua: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> None:
    """Best-effort append to the audit log. Never raises.

    A single audit row shape:
      {id, timestamp, action, actor_id, actor_email, actor_ip,
       actor_ua, tenant_id, entity_type, entity_id, before, after, meta}

    `before`/`after` should be small dicts capturing the semantically
    meaningful field-level change (e.g. {"role": "sales"} ->
    {"role": "operations"}). Large blobs (full task doc, contact PII
    beyond what's needed) SHOULD NOT be dumped here — they inflate
    the log without adding audit value and risk leaking data.
    """
    # Cap UA at 500 chars — some scrapers send multi-kilobyte UAs.
    if actor_ua and len(actor_ua) > 500:
        actor_ua = actor_ua[:500]
    doc = {
        "id": new_id(),
        "timestamp": _now_iso(),
        "action": str(action)[:100],
        "actor_id": actor_id,
        "actor_email": (actor_email or None),
        "actor_ip": (actor_ip or None),
        "actor_ua": (actor_ua or None),
        "tenant_id": tenant_id,
        "entity_type": (entity_type or None),
        "entity_id": (entity_id or None),
        "before": before,
        "after": after,
        "meta": meta,
    }
    try:
        await db[COLLECTION].insert_one(doc)
    except Exception as e:
        # Fail-open: audit-log write must never block the user action.
        # Log locally so ops can spot systematic write failures.
        logger.warning(
            f"[audit_log] failed to record action={action!r} "
            f"actor={actor_id!r} tenant={tenant_id!r}: {e}"
        )


async def query(
    db,
    *,
    tenant_id: str,
    filters: Optional[Dict[str, Any]] = None,
    limit: int = 100,
    before_ts: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Read audit rows for a tenant. Owner-only at the HTTP layer.

    `filters` accepts optional {action, actor_id, entity_type,
    entity_id, since_ts} narrowing. `before_ts` is a cursor for
    paging older entries. Rows returned most-recent-first.
    """
    q: Dict[str, Any] = {"tenant_id": tenant_id}
    if filters:
        for k in ("action", "actor_id", "entity_type", "entity_id"):
            v = filters.get(k)
            if v:
                q[k] = v
        since = filters.get("since_ts")
        if since:
            q["timestamp"] = {"$gte": since}
    if before_ts:
        # Merge with an existing timestamp filter if present.
        ts_q = q.get("timestamp") or {}
        ts_q["$lt"] = before_ts
        q["timestamp"] = ts_q
    limit = max(1, min(int(limit or 100), 500))
    rows = await db[COLLECTION].find(
        q, {"_id": 0},
    ).sort("timestamp", -1).to_list(limit)
    return rows
