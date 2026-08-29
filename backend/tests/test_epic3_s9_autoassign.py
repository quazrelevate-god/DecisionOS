"""Epic 3 Sprint 9 (E3-13): auto-assign AI tasks to a person.

The selection strategy is deterministic (not agentic): a named person wins; else the
least-loaded ACTIVE member of the role, with a stable tiebreak. This covers the
multi-person edge cases -- 0 / 1 / many members, ties, inactive members, named
person, and named-but-not-found.

T10-11.2 P3: runs against an ISOLATED test DB (with_test_db) with services.voice.db
patched to it -- so it never touches founder-os-58 and never cross-loop-contaminates
other modules that share the app's Mongo client (the old `from database import db`
+ asyncio.run pattern was order-flaky under -n/loadscope and mutated the dev DB).
"""
import services.voice as _voice
from services.voice import resolve_assignee, pick_least_loaded_member

_T = "aa-test-tenant"


async def _seed(db):
    # 3 active sales (Priya 0 load, Ravi 1, Anil 2), 1 finance, 1 removed sales
    await db.users.insert_many([
        {"id": "aa-u1", "tenant_id": _T, "name": "Anil Kumar", "role": "sales", "email": "aa-u1@t.test"},
        {"id": "aa-u2", "tenant_id": _T, "name": "Priya Nair", "role": "sales", "email": "aa-u2@t.test"},
        {"id": "aa-u3", "tenant_id": _T, "name": "Ravi Shah", "role": "sales", "email": "aa-u3@t.test"},
        {"id": "aa-uf", "tenant_id": _T, "name": "Fatima Sayed", "role": "finance", "email": "aa-uf@t.test"},
        {"id": "aa-ux", "tenant_id": _T, "name": "Gone Person", "role": "sales", "email": "aa-ux@t.test"},
    ])
    await db.memberships.insert_many([
        {"tenant_id": _T, "user_id": "aa-u1", "status": "active"},
        {"tenant_id": _T, "user_id": "aa-u2", "status": "active"},
        {"tenant_id": _T, "user_id": "aa-u3", "status": "active"},
        {"tenant_id": _T, "user_id": "aa-uf", "status": "active"},
        {"tenant_id": _T, "user_id": "aa-ux", "status": "removed"},   # deprovisioned
    ])
    # loads: Anil 2, Ravi 1, Priya 0  (removed person has 0 but must be ignored)
    await db.tasks.insert_many([
        {"id": "t1", "tenant_id": _T, "assignee_id": "aa-u1", "status": "todo"},
        {"id": "t2", "tenant_id": _T, "assignee_id": "aa-u1", "status": "in_progress"},
        {"id": "t3", "tenant_id": _T, "assignee_id": "aa-u3", "status": "todo"},
    ])


def test_auto_assign_edge_cases(with_test_db):
    async def go(db):
        _prev = _voice.db
        _voice.db = db  # point the service's module-global db at the isolated test db
        try:
            await _seed(db)
            # many members -> least-loaded active member (Priya, 0 open tasks)
            assert await pick_least_loaded_member(_T, "sales") == "aa-u2"

            # sole member of a role
            r = await resolve_assignee(_T, role="finance")
            assert r == {"assignee_id": "aa-uf", "role": "finance", "how": "load"}

            # no members in role -> unassigned (role only)
            r = await resolve_assignee(_T, role="marketing")
            assert r["assignee_id"] is None and r["how"] == "unassigned"

            # explicit name wins over role load-balancing
            r = await resolve_assignee(_T, role="sales", assignee_name="Ravi")
            assert r["assignee_id"] == "aa-u3" and r["how"] == "named"

            # named-but-not-found -> falls back to role (least-loaded)
            r = await resolve_assignee(_T, role="sales", assignee_name="Nobody McGhost")
            assert r["assignee_id"] == "aa-u2" and r["how"] == "load"

            # deprovisioned member is never auto-assigned, even at 0 load
            for _ in range(3):
                assert await pick_least_loaded_member(_T, "sales") != "aa-ux"

            # deterministic tiebreak: clear all loads -> equal -> lowest id (aa-u1) wins, stably
            await db.tasks.delete_many({"tenant_id": _T})
            picks = {await pick_least_loaded_member(_T, "sales") for _ in range(4)}
            assert picks == {"aa-u1"}   # same answer every time, lowest active id
        finally:
            _voice.db = _prev
    with_test_db(go)
