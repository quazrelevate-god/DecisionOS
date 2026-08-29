"""Epic 10 Testing -- Sprint 8 (multi-tenant isolation) scenarios.

db-tier: drive the real handlers against a fresh isolated Mongo db with two
tenants seeded, and assert tenant A can never see, serve, or destroy tenant B's
data. (T10-08.1/.2 -- the cross-id read/write matrices -- live in
test_s8_tenant_isolation.py; this file adds the remaining scenarios.)
"""
from fastapi import HTTPException


def _use_db(testdb, *mods):
    saved = [(m, m.db) for m in mods if hasattr(m, "db")]
    for m, _ in saved:
        m.db = testdb
    return lambda: [setattr(m, "db", d) for m, d in saved]


def _u(role, uid, tid, **over):
    u = {"role": role, "tenant_id": tid, "id": uid, "name": f"{role}-{uid}"}
    u.update(over)
    return u


# ---------------------------------------------------------------------------
# T10-08.8 -- tenant deletion wipes A completely and leaves B fully intact.
# ---------------------------------------------------------------------------
def test_tenant_deletion_removes_A_and_keeps_B(with_test_db):
    import core
    import routers.admin as admin
    from routers.admin import TENANT_COLLECTIONS

    async def scenario(db):
        restore = _use_db(db, admin, core)
        try:
            # Seed BOTH tenants a row in every tenant-scoped collection.
            for coll in TENANT_COLLECTIONS:
                await db[coll].insert_many([
                    {"id": f"{coll}-A", "tenant_id": "A"},
                    {"id": f"{coll}-B", "tenant_id": "B"},
                ])
            await db.tenants.insert_many([{"id": "A", "company_name": "Alpha"},
                                          {"id": "B", "company_name": "Beta"}])

            await admin.admin_delete_tenant("A", admin={"id": "adm", "email": "a@x", "role": "super_admin"})

            a_rows = sum([await db[c].count_documents({"tenant_id": "A"}) for c in TENANT_COLLECTIONS])
            b_rows = sum([await db[c].count_documents({"tenant_id": "B"}) for c in TENANT_COLLECTIONS])
            a_tenant = await db.tenants.count_documents({"id": "A"})
            b_tenant = await db.tenants.count_documents({"id": "B"})
            missing = None
            try:
                await admin.admin_delete_tenant("ghost", admin={"id": "adm", "email": "a@x"})
            except HTTPException as e:
                missing = e.status_code
            return a_rows, b_rows, a_tenant, b_tenant, len(TENANT_COLLECTIONS), missing
        finally:
            restore()

    a_rows, b_rows, a_tenant, b_tenant, ncoll, missing = with_test_db(scenario)
    assert a_rows == 0, "deleting tenant A must leave ZERO rows for A across every collection"
    assert b_rows == ncoll, "tenant B's data must be fully intact"
    assert a_tenant == 0 and b_tenant == 1
    assert missing == 404


# ---------------------------------------------------------------------------
# T10-08.5 -- WhatsApp logs are strictly tenant-scoped; unrouted (None) hidden.
# ---------------------------------------------------------------------------
def test_whatsapp_logs_hide_other_tenants_and_unrouted(with_test_db):
    import routers.whatsapp as wa

    async def scenario(db):
        restore = _use_db(db, wa)
        try:
            await db.wa_events.insert_many([
                {"id": "eA1", "tenant_id": "A", "from": "1", "created_at": "2026-01-01"},
                {"id": "eA2", "tenant_id": "A", "from": "2", "created_at": "2026-01-02"},
                {"id": "eB1", "tenant_id": "B", "from": "3", "created_at": "2026-01-03"},
                {"id": "eNone", "tenant_id": None, "from": "4", "created_at": "2026-01-04"},  # unrouted
            ])
            rows = await wa.whatsapp_logs(user=_u("owner", "oA", "A"))
            return {r["id"] for r in rows}
        finally:
            restore()

    ids = with_test_db(scenario)
    assert ids == {"eA1", "eA2"}, f"owner of A must see ONLY A's events (no B, no unrouted None); got {ids}"


# ---------------------------------------------------------------------------
# T10-08.4 -- file serve-by-name: path traversal + cross-tenant both 404.
# ---------------------------------------------------------------------------
def test_file_serve_by_name_tenant_scope_and_traversal(with_test_db):
    import routers.files as files

    async def scenario(db):
        restore = _use_db(db, files)
        try:
            # a file that belongs to tenant B only
            await db.files.insert_one({"id": "fB", "tenant_id": "B", "original_filename": "secret.pdf",
                                       "storage_path": "B/secret.pdf"})
            userA = _u("owner", "oA", "A")
            r = {}
            for bad in ("../../etc/passwd", ".hidden", "a/b.txt"):
                try:
                    await files.get_file(bad, user=userA)
                    r[bad] = None
                except HTTPException as e:
                    r[bad] = e.status_code
            # B's file requested by A -> not found in A's scope
            try:
                await files.get_file("secret.pdf", user=userA)
                r["cross"] = None
            except HTTPException as e:
                r["cross"] = e.status_code
            return r
        finally:
            restore()

    r = with_test_db(scenario)
    assert r["../../etc/passwd"] == 404, "path traversal must be rejected"
    assert r[".hidden"] == 404 and r["a/b.txt"] == 404
    assert r["cross"] == 404, "a file owned by another tenant is not resolvable"
