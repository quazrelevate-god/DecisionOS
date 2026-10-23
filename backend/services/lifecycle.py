"""A company's life with us, as events (2026-10-23, admin console v2 P1).

`tenants.plan` is overwritten on every change and a suspension was a bare
boolean, so the console could not draw money moving (new, upgraded, churned),
trial-to-paid, or say since when a company was suspended and why. Each of
those moments is now one `lifecycle_events` row:

  signed_up · plan_changed (from, to) · payment_received · payment_failed ·
  subscription_halted · suspended (reason) · reactivated

Written where the change happens (sign-up, the Razorpay webhook, the admin
plan override, admin suspend / reactivate). Never purged by retention; wiped
with the company. Best-effort: a failed write never blocks the change itself.
"""
from typing import Optional

from core import db as _db, logger, new_id, now_iso

COLLECTION = "lifecycle_events"
KINDS = ("signed_up", "plan_changed", "payment_received", "payment_failed",
         "subscription_halted", "suspended", "reactivated")


async def record(tenant_id: str, kind: str, *, by: Optional[str] = None, source: Optional[str] = None,
                 reason: Optional[str] = None, data: Optional[dict] = None, at: Optional[str] = None,
                 database=None) -> None:
    if not tenant_id or kind not in KINDS:
        return
    database = database if database is not None else _db
    try:
        await database[COLLECTION].insert_one({
            "id": new_id(), "tenant_id": tenant_id, "kind": kind, "by": by, "source": source,
            "reason": (reason or "").strip()[:300] or None, "data": data or {},
            "created_at": at or now_iso(),
        })
    except Exception as e:
        logger.warning(f"[lifecycle] {kind} for {str(tenant_id)[:8]} not recorded: {e}")


async def plan_changed(tenant_id: str, old: Optional[str], new: Optional[str], *, source: str,
                       by: Optional[str] = None, reason: Optional[str] = None, database=None) -> None:
    if old == new:
        return
    await record(tenant_id, "plan_changed", by=by, source=source, reason=reason,
                 data={"from": old, "to": new}, database=database)


async def events_for(tenant_id: str, limit: int = 50, database=None) -> list:
    database = database if database is not None else _db
    rows = await database[COLLECTION].find({"tenant_id": tenant_id}, {"_id": 0}).to_list(500)
    rows.sort(key=lambda r: r.get("created_at") or "", reverse=True)
    return rows[:limit]
