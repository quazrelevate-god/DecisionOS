"""In-app notifications + owner/approver/finance audience resolution
(Epic 8 Sprint 4 -- extracted from server.py).

Writes notification rows and resolves the standard notify audiences (owners,
approvers, finance users). Depends on core (db/new_id/now_iso/logger) and the
email leaf service; imports nothing from server.
"""
import os

from core import db, logger, new_id, now_iso
from services.email import send_email

NOTIF_LEVELS = {1: "reminder", 2: "urgency", 3: "manager", 4: "owner"}


async def _owner_ids(tenant_id: str) -> list:
    return [u["id"] for u in await db.users.find({"tenant_id": tenant_id, "role": "owner"}, {"_id": 0, "id": 1}).to_list(50)]


async def _approver_ids(tenant_id: str) -> list:
    """Owners plus anyone who can approve tasks. 2026-09-15 (RBAC P1): by what
    they can really open — role settings, their membership and temporary grants
    — not only a personal list on the user record."""
    from services.auth.membership import members_effective_perms
    ids = set(await _owner_ids(tenant_id))
    people = await db.users.find({"tenant_id": tenant_id},
                                 {"_id": 0, "id": 1, "role": 1, "permissions": 1, "permissions_custom": 1}).to_list(500)
    perms = await members_effective_perms(db, tenant_id, people)
    ids |= {p["id"] for p in people if "approvals" in perms.get(p["id"], set())}
    return list(ids)


async def _finance_user_ids(tenant_id: str) -> list:
    """Users who should be notified about a bill needing upload: owners, plus
    anyone with the 'finance' or 'ledger' module permission. Introduced by
    FIX-001-B for the workflow→Finance handoff on procurement completion."""
    ids = set(await _owner_ids(tenant_id))
    async for u in db.users.find(
        {"tenant_id": tenant_id, "permissions": {"$in": ["finance", "ledger"]}},
        {"_id": 0, "id": 1},
    ):
        ids.add(u["id"])
    return list(ids)


async def push_notification(tenant_id, user_ids, level, message, entity_type=None, entity_id=None,
                            ntype=None, title=None, sender=None):
    ids = set(u for u in user_ids if u)
    if ntype == "approval" and ids:
        # RBAC P2 (2026-09-16): someone away hands their approvals to a delegate,
        # who hears about new ones too.
        from services.delegation import delegates_of
        ids |= set(await delegates_of(db, tenant_id, ids))
    for uid in ids:
        await db.notifications.insert_one({
            "id": new_id(), "tenant_id": tenant_id, "user_id": uid, "level": NOTIF_LEVELS.get(level, "reminder"),
            "message": message, "entity_type": entity_type, "entity_id": entity_id,
            "type": ntype or "reminder", "work_title": title, "sender_name": sender,
            "read": False, "created_at": now_iso(),
        })


async def dispatch_owner_alert(tenant_id, message):
    # RBAC P2 (2026-09-16): an owner can switch the alert emails off
    # (Settings › Operations › Overdue work). The in-app alert still arrives.
    tenant = await db.tenants.find_one({"id": tenant_id}, {"_id": 0, "owner_alert_email": 1})
    if (tenant or {}).get("owner_alert_email") is False:
        logger.info(f"[owner-alert] email off for tenant {str(tenant_id)[:8]}...: {message}")
        return
    owners = await db.users.find({"tenant_id": tenant_id, "role": "owner"}, {"_id": 0, "email": 1}).to_list(10)
    emails = [o["email"] for o in owners if o.get("email")]
    if emails:
        await send_email(emails, "DecisionOS — Owner Alert", f"<p>{message}</p>")
    # WhatsApp: ready-to-plug (requires WHATSAPP_API_KEY / provider)
    if not os.environ.get("WHATSAPP_API_KEY", ""):
        logger.info(f"[WHATSAPP MOCK] Owner alert: {message}")
