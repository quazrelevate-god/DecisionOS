"""ASK-28 Phase 7 (plan 7.3) — the Desk's Slipping list on REAL data, read-only.

Runs the new routers.desk._cards_on_fire in-process for the four demo seats
(owner, sales, production, finance - Sunita Rao, who manages sai) and checks
every card against the ladder:
  - a task_overdue card is a task I asked for, or a direct report's task at
    least FOLLOWUP_MANAGER_DAYS late; the owner keeps every overdue task;
  - a task_escalation / task_handoff card is addressed to me.

Why not through the browser: the local backend is not restarted with the Phase 7
code, because its reminder sweep runs against the production database and would
start sending the new reminders to real people. Here the Desk code gets a
database handle that only allows reads - any write raises.

    cd backend && .venv/Scripts/python.exe scripts/probe_desk_slipping_0914.py
"""
import asyncio
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import core  # noqa: E402
import routers.desk as desk  # noqa: E402
from services.tasks import FOLLOWUP_MANAGER_DAYS  # noqa: E402

OUT = pathlib.Path(__file__).resolve().parents[2] / ".audit-artifacts" / "ask28_stuck_desk"
OUT.mkdir(parents=True, exist_ok=True)
SEATS = {"owner": "owner@sharma.com", "sales": "sales@sharma.com",
         "production": "production@sharma.com", "finance": "finance@sharma.com"}
READS = {"find", "find_one", "count_documents", "aggregate", "distinct"}
results = []


class ReadOnlyCollection:
    def __init__(self, coll):
        self._c = coll

    def __getattr__(self, name):
        if name not in READS:
            raise PermissionError(f"read-only probe: {name} is not allowed")
        return getattr(self._c, name)


class ReadOnlyDB:
    def __init__(self, db):
        self._db = db

    def __getattr__(self, name):
        return ReadOnlyCollection(getattr(self._db, name))

    def __getitem__(self, name):
        return ReadOnlyCollection(self._db[name])


def rec(role, key, ok, detail):
    results.append({"check": key, "role": role, "ok": ok, "detail": detail})
    print(f"  [{'PASS' if ok is True else 'FAIL' if ok is False else 'INFO'}] {role:<10} {key}: {detail}", flush=True)


async def main():
    ro = ReadOnlyDB(core.db)
    desk.db = ro
    for role, email in SEATS.items():
        me = await ro.users.find_one({"email": email}, {"_id": 0, "id": 1, "tenant_id": 1, "role": 1, "name": 1})
        if not me:
            rec(role, "seat-found", False, f"no user {email}")
            continue
        tid, uid, is_owner = me["tenant_id"], me["id"], me.get("role") == "owner"
        reports = {u["id"] async for u in ro.users.find({"tenant_id": tid, "reporting_manager_id": uid}, {"_id": 0, "id": 1})}
        cards = await desk._cards_on_fire(tid, me)
        breaks, kinds, report_cards = [], {}, 0
        for c in cards:
            kinds[c["kind"]] = kinds.get(c["kind"], 0) + 1
            t = await ro.tasks.find_one({"id": c["id"], "tenant_id": tid}, {"_id": 0})
            if not t:
                breaks.append(f"{c['id']}: task missing")
                continue
            if c["kind"] == "task_overdue":
                late = desk._days_between(t.get("due_date"))
                mine = t.get("created_by") == uid
                report = t.get("assignee_id") in reports and late >= FOLLOWUP_MANAGER_DAYS
                report_cards += int(report and not mine)
                if not (is_owner or mine or report) or t.get("status") in ("done", "cancelled") or late < 1:
                    breaks.append(f"overdue {t.get('title')!r} due {t.get('due_date')} ({late}d) with {t.get('assignee_id')}")
            else:
                last = desk._latest_update(t) or {}
                to_me = last.get("to_id") == uid or (is_owner and bool(last.get("to_role")))
                if (last.get("kind") or last.get("action")) not in ("escalate", "handoff") or not (
                        to_me or last.get("to_role") == me.get("role")):
                    breaks.append(f"{c['kind']} {t.get('title')!r} not addressed to me: {last.get('to_name')}")
        rec(role, "slipping-follows-ladder", not breaks,
            f"{len(cards)} cards {kinds}; direct reports {len(reports)}, their late tasks shown {report_cards}; "
            f"outside the rule: {breaks[:3] or 'none'}")
        esc = await ro.tasks.count_documents({"tenant_id": tid, "status": {"$nin": ["done", "cancelled"]},
                                              "updates.kind": {"$in": ["escalate", "handoff"]}})
        rec(role, "escalations-readable", None,
            f"open tasks with an escalation or hand-off in the company: {esc} (the Desk read none of them before)")


asyncio.run(main())
(OUT / "results.json").write_text(json.dumps(results, indent=1), encoding="utf-8")
fails = [r for r in results if r["ok"] is False]
print(f"\n{sum(r['ok'] is True for r in results)} pass / {len(fails)} fail -> {OUT / 'results.json'}")
