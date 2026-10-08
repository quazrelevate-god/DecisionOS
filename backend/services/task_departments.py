"""A task's department IS one of the company's teams (audit B-02, 2026-10-08).

WHAT THIS REPLACED. An owner met three "department" lists, each written by a
different AI call at sign-up and each with its own names:

  * Teams (`tenant.roles`) — Sales & Buyer Management, Production, Accounts…
    These route work, carry access, and are what people belong to.
  * "Task type / department labels" in Business vocabulary
    (`tenant.lexicon.task_types`) — read by nothing at all.
  * "Task categories" in Operations (`tenant.operating_model.task_categories`)
    — Buyer Coordination, Quality Control, Finance & Accounts… — the New Task
    form's "Department", My Work's tabs, and what Dex filed a task under.

Nothing tied the third to the first, so a task Dex gave to the Accounts team
was filed under "Finance & Accounts", and the owner could not tell which list
decided what. Now there is one list: the teams. A task's `task_type` holds a
team key, the New Task form and My Work offer the teams, and Dex is told the
teams. `operating_model.task_categories` is left in the database untouched
(nothing reads it) so no data is lost.

Existing tasks were filed under category keys (`buyer_coordination`,
`finance_and_accounts`, or the old defaults `sales` / `hr`). The migration
below moves each one onto the team it plainly means (shared.roles.resolve_role
— the same matcher that already places stage work on teams); one that means
no single team is left as it was and still shows under "All".
"""
import logging
from typing import Any, Dict, Iterable, List, Optional

from shared.normalizers import DEFAULT_OPERATING_MODEL
from shared.roles import resolve_role

logger = logging.getLogger(__name__)

# Kept out of the move: "operational" marks a routine (MyWork's isOp) and
# "other" is the explicit no-department answer.
_KEEP = {"operational", "other"}


def team_categories(roles: Optional[Iterable[Dict[str, Any]]]) -> List[Dict[str, str]]:
    """The company's teams, as the department list ({key, label}). The owner
    is a person, not a department, so it is never one of them."""
    out, seen = [], set()
    for r in roles or []:
        key = (r or {}).get("key")
        if not key or key == "owner" or key in seen:
            continue
        seen.add(key)
        out.append({"key": key, "label": (r.get("label") or key.replace("_", " ").title())})
    return out


async def tenant_task_categories(db, tenant_id: str) -> List[Dict[str, str]]:
    """Departments for this company: its teams. A company with no teams yet
    (a legacy or half-built workspace) keeps the generic six."""
    t = await db.tenants.find_one({"id": tenant_id}, {"_id": 0, "roles": 1})
    cats = team_categories((t or {}).get("roles"))
    return cats or list(DEFAULT_OPERATING_MODEL["task_categories"])


async def align_task_types_with_teams(db, tenant: Dict[str, Any]) -> Dict[str, str]:
    """Move this company's tasks off old category keys onto team keys.
    Returns {old_key: team_key} for what moved. Idempotent."""
    tid = tenant.get("id")
    teams = team_categories(tenant.get("roles"))
    keys = [c["key"] for c in teams]
    if not tid or not keys:
        return {}
    labels = {c.get("key"): c.get("label") for c in
              ((tenant.get("operating_model") or {}).get("task_categories") or []) if isinstance(c, dict)}
    moved = {}
    for old in await db.tasks.distinct("task_type", {"tenant_id": tid}):
        if not old or old in keys or old in _KEEP:
            continue
        # The category's own words first ("Finance & Accounts"), then its key.
        new = resolve_role(labels.get(old) or "", keys) or resolve_role(old, keys)
        if not new:
            continue
        await db.tasks.update_many({"tenant_id": tid, "task_type": old}, {"$set": {"task_type": new}})
        moved[old] = new
    return moved


async def migrate_task_types_to_teams(db) -> None:
    """One-time, every company (bootstrap migration ledger)."""
    n = 0
    async for t in db.tenants.find({}, {"_id": 0, "id": 1, "roles": 1, "operating_model.task_categories": 1}):
        try:
            if await align_task_types_with_teams(db, t):
                n += 1
        except Exception as e:  # noqa: BLE001 — one company must not stop the rest
            logger.warning(f"[B-02] task types for {t.get('id')}: {e}")
    logger.info(f"[B-02] task departments now follow teams; companies with tasks moved={n}")
