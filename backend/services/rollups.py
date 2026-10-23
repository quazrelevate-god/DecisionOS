"""One row per company per day, kept for good (2026-10-23, admin console v2 P1).

Every chart the admin console will draw — active companies and people over
time, which parts of the product each company uses, AI cost against revenue —
needs history, and the history it would read from is either missing or
temporary: retention can purge `activity`, `usage_events`, `voice_notes` and
`brain_audit` after 30 to 365 days. So each IST day is counted once into
`tenant_daily` (`_id` "<tenant>:<day>"), which retention never touches. It
holds counts only — no names, no content.

A row:
  day, tenant_id
  active_people   distinct people present (presence_days) or acting (activity)
  sign_ins        from presence_days; before it existed, password sign-ins
                  from the audit log
  actions         activity rows by product area (AREAS) and in total
  ai_calls, ai_cost_usd       usage_events
  voice_notes, brain_queries  voice_notes, brain_audit
  plan, seats, is_test        a snapshot, written only for today's row

The scheduler leader re-counts today and yesterday every few hours
(`roll_recent`), and on its first run counts back as far as the data goes
(`backfill`, default 180 days). Counting streams each source once for the
whole window, so a backfill is a handful of reads, not one per company-day.
"""
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from core import db as _db, logger, now_iso

COLLECTION = "tenant_daily"
IST = timezone(timedelta(hours=5, minutes=30))

# activity kind prefix -> product area
AREAS = (
    ("task_", "tasks"), ("decision_", "decisions"), ("request_", "requests"), ("workflow_", "workflows"),
    ("leave_", "people"), ("user_", "people"), ("employees_", "people"), ("role_", "people"),
    ("invoice_", "finance"), ("payment_", "finance"), ("expense_", "finance"), ("income_", "finance"),
    ("asset_", "finance"), ("inventory_", "finance"), ("stock_", "finance"), ("finance_", "finance"),
    ("contact_", "crm"), ("complaint_", "crm"), ("meeting_", "voice"), ("data_ingested", "captures"),
    ("capture_", "captures"), ("billing_", "billing"), ("plan_", "billing"),
)


def area_of(kind: str) -> str:
    kind = kind or ""
    for prefix, area in AREAS:
        if kind.startswith(prefix):
            return area
    return "other"


def ist_day(iso) -> str:
    dt = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(IST).date().isoformat()


def day_start_utc(day: str) -> str:
    """The UTC instant an IST day begins, as an ISO string (comparable with
    the stored created_at strings)."""
    d = datetime.fromisoformat(day).replace(tzinfo=IST)
    return d.astimezone(timezone.utc).isoformat()


def _blank(tenant_id: str, day: str) -> dict:
    return {"tenant_id": tenant_id, "day": day, "people": set(), "sign_ins": 0, "audit_sign_ins": 0,
            "actions": defaultdict(int), "ai_calls": 0, "ai_cost_usd": 0.0, "voice_notes": 0, "brain_queries": 0}


async def _stream(database, coll: str, query: dict, projection: dict):
    cur = database[coll].find(query, {"_id": 0, **projection})
    async for row in cur:
        yield row


async def count_window(first_day: str, last_day: str, database=None) -> dict:
    """{(tenant, day): row} for every IST day in [first_day, last_day]."""
    database = database if database is not None else _db
    since = day_start_utc(first_day)
    until = day_start_utc((datetime.fromisoformat(last_day) + timedelta(days=1)).date().isoformat())
    window = {"$gte": since, "$lt": until}
    rows: dict = {}

    def row(tid, day):
        key = (tid, day)
        if key not in rows:
            rows[key] = _blank(tid, day)
        return rows[key]

    async for a in _stream(database, "activity", {"created_at": window},
                           {"tenant_id": 1, "actor": 1, "kind": 1, "created_at": 1}):
        if not a.get("tenant_id") or not a.get("created_at"):
            continue
        r = row(a["tenant_id"], ist_day(a["created_at"]))
        r["actions"][area_of(a.get("kind"))] += 1
        if a.get("actor") and a["actor"] != "system":
            r["people"].add(a["actor"])
    async for p in _stream(database, "presence_days", {"day": {"$gte": first_day, "$lte": last_day}},
                           {"tenant_id": 1, "user_id": 1, "day": 1, "sign_ins": 1}):
        r = row(p["tenant_id"], p["day"])
        r["people"].add(p["user_id"])
        r["sign_ins"] += int(p.get("sign_ins") or 0)
    async for s in _stream(database, "audit_log", {"action": "login_success", "timestamp": window},
                           {"meta": 1, "tenant_id": 1, "timestamp": 1}):
        tid = s.get("tenant_id") or (s.get("meta") or {}).get("tenant_id")
        if tid and s.get("timestamp"):
            row(tid, ist_day(s["timestamp"]))["audit_sign_ins"] += 1
    async for u in _stream(database, "usage_events", {"created_at": window},
                           {"tenant_id": 1, "cost_estimate": 1, "created_at": 1}):
        if u.get("tenant_id") and u.get("created_at"):
            r = row(u["tenant_id"], ist_day(u["created_at"]))
            r["ai_calls"] += 1
            r["ai_cost_usd"] += float(u.get("cost_estimate") or 0)
    for coll, field in (("voice_notes", "voice_notes"), ("brain_audit", "brain_queries")):
        async for v in _stream(database, coll, {"created_at": window}, {"tenant_id": 1, "created_at": 1}):
            if v.get("tenant_id") and v.get("created_at"):
                row(v["tenant_id"], ist_day(v["created_at"]))[field] += 1
    return rows


def _doc(r: dict) -> dict:
    actions = dict(r["actions"])
    return {
        "_id": f"{r['tenant_id']}:{r['day']}", "tenant_id": r["tenant_id"], "day": r["day"],
        "active_people": len(r["people"]),
        # presence_days began 2026-10-23; before that only password sign-ins
        # reached the audit log. Whichever saw more is the better count.
        "sign_ins": max(r["sign_ins"], r["audit_sign_ins"]),
        "actions": actions, "actions_total": sum(actions.values()),
        "ai_calls": r["ai_calls"], "ai_cost_usd": round(r["ai_cost_usd"], 6),
        "voice_notes": r["voice_notes"], "brain_queries": r["brain_queries"],
        "rolled_at": now_iso(),
    }


async def _snapshot(database, tenant_ids: set) -> dict:
    """plan, seats and the test mark as they are now -- for today's rows."""
    from services.admin_workspaces import is_test_tenant
    out = {}
    tenants = await database.tenants.find(
        {"id": {"$in": list(tenant_ids)}},
        {"_id": 0, "id": 1, "plan": 1, "is_test": 1, "is_demo": 1, "demo": 1, "name": 1, "company_name": 1},
    ).to_list(5000)
    for t in tenants:
        seats = await database.memberships.count_documents({"tenant_id": t["id"], "status": "active"})
        out[t["id"]] = {"plan": t.get("plan"), "seats": seats, "is_test": is_test_tenant(t)}
    return out


async def write_window(first_day: str, last_day: str, database=None) -> int:
    database = database if database is not None else _db
    rows = await count_window(first_day, last_day, database=database)
    today = datetime.now(IST).date().isoformat()
    snap = await _snapshot(database, {tid for (tid, d) in rows if d == today})
    for r in rows.values():
        doc = _doc(r)
        if r["day"] == today and r["tenant_id"] in snap:
            doc.update(snap[r["tenant_id"]])
        await database[COLLECTION].update_one({"_id": doc["_id"]}, {"$set": doc}, upsert=True)
    return len(rows)


async def roll_recent(database=None) -> int:
    """Sessions used in the last 26 hours become presence, then today and
    yesterday (IST) are re-counted."""
    database = database if database is not None else _db
    from services.presence import sync_from_sessions
    await sync_from_sessions(database, (datetime.now(timezone.utc) - timedelta(hours=26)).isoformat())
    today = datetime.now(IST).date()
    return await write_window((today - timedelta(days=1)).isoformat(), today.isoformat(), database=database)


async def backfill(days: int = 180, database=None) -> dict:
    """Count back as far as the data goes, then fill each company's
    milestones and its sign-up event. Safe to run again (upserts, and
    milestones / events are only added when missing)."""
    database = database if database is not None else _db
    from services import lifecycle, milestones
    from services.presence import sync_from_sessions
    # sessions live about a week, so a week of presence can be recovered
    await sync_from_sessions(database, (datetime.now(timezone.utc) - timedelta(days=8)).isoformat())
    today = datetime.now(IST).date()
    written = await write_window((today - timedelta(days=days)).isoformat(), today.isoformat(), database=database)
    tenants = await database.tenants.find({}, {"_id": 0, "id": 1, "created_at": 1}).to_list(5000)
    try:
        await milestones.backfill_all(database=database)
    except Exception as e:
        logger.warning(f"[rollups] milestone backfill failed: {e}")
    have_signup = set(await database[lifecycle.COLLECTION].distinct("tenant_id", {"kind": "signed_up"}))
    for t in tenants:
        if t.get("created_at") and t["id"] not in have_signup:
            await lifecycle.record(t["id"], "signed_up", source="backfill", at=t["created_at"], database=database)
    return {"rows": written, "tenants": len(tenants), "days": days}


async def series(tenant_id=None, days: int = 30, database=None) -> list:
    """Daily rows for one company (or all, summed by day), oldest first."""
    database = database if database is not None else _db
    first = (datetime.now(IST).date() - timedelta(days=days - 1)).isoformat()
    q = {"day": {"$gte": first}}
    if tenant_id:
        q["tenant_id"] = tenant_id
    rows = await database[COLLECTION].find(q, {"_id": 0}).to_list(200000)
    if tenant_id:
        return sorted(rows, key=lambda r: r["day"])
    by_day: dict = {}
    for r in rows:
        d = by_day.setdefault(r["day"], {"day": r["day"], "active_workspaces": 0, "active_people": 0,
                                          "sign_ins": 0, "actions_total": 0, "ai_cost_usd": 0.0})
        d["active_workspaces"] += 1 if (r.get("active_people") or r.get("actions_total")) else 0
        for k in ("active_people", "sign_ins", "actions_total"):
            d[k] += r.get(k) or 0
        d["ai_cost_usd"] = round(d["ai_cost_usd"] + (r.get("ai_cost_usd") or 0), 6)
    return [by_day[k] for k in sorted(by_day)]
