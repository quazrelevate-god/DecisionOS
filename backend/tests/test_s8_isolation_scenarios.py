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


# ---------------------------------------------------------------------------
# T10-08.6 -- brain-doc visibility: a user cannot see a doc they aren't cleared for.
# ---------------------------------------------------------------------------
def test_brain_chunk_visibility_matrix():
    from services.ai.brain_retrieval import _chunk_visible
    owner = _u("owner", "o1", "t1")
    sales = _u("sales", "s1", "t1")
    tm = _u("sales", "m1", "t1", permissions=["team_manage"])

    # owner + team_manage see everything, incl. private
    assert _chunk_visible({"visibility": "private", "roles_allowed": []}, owner)
    assert _chunk_visible({"visibility": "private", "roles_allowed": []}, tm)
    # the uploader always sees their own doc
    assert _chunk_visible({"visibility": "private", "roles_allowed": [], "uploaded_by": "s1"}, sales)
    # public -> anyone
    assert _chunk_visible({"visibility": "public"}, sales)
    # dept -> only the matching department (or an allow-listed role)
    assert _chunk_visible({"visibility": "dept", "department": "sales"}, sales)
    assert not _chunk_visible({"visibility": "dept", "department": "finance", "roles_allowed": []}, sales)
    assert _chunk_visible({"visibility": "dept", "department": "finance", "roles_allowed": ["sales"]}, sales)
    # private -> only allow-listed roles
    assert not _chunk_visible({"visibility": "private", "roles_allowed": ["finance"]}, sales)
    assert _chunk_visible({"visibility": "private", "roles_allowed": ["sales"]}, sales)


# ---------------------------------------------------------------------------
# T10-08.9 -- global email uniqueness + compound-unique memberships.
# ---------------------------------------------------------------------------
def test_email_global_unique_and_membership_compound_unique(with_test_db):
    from pymongo.errors import DuplicateKeyError

    async def scenario(db):
        # users.email is unique ACROSS tenants (legacy users index).
        await db.users.create_index("email", unique=True)
        await db.users.insert_one({"id": "u1", "tenant_id": "A", "email": "raj@x.com"})
        email_dup = False
        try:
            await db.users.insert_one({"id": "u2", "tenant_id": "B", "email": "raj@x.com"})
        except DuplicateKeyError:
            email_dup = True

        # memberships are (user_id, tenant_id) compound-unique.
        await db.memberships.create_index([("user_id", 1), ("tenant_id", 1)], unique=True)
        await db.memberships.insert_one({"user_id": "u1", "tenant_id": "A"})
        mem_dup = False
        try:
            await db.memberships.insert_one({"user_id": "u1", "tenant_id": "A"})
        except DuplicateKeyError:
            mem_dup = True
        # ...but the same user in a DIFFERENT tenant is allowed.
        await db.memberships.insert_one({"user_id": "u1", "tenant_id": "B"})
        cross_ok = await db.memberships.count_documents({"user_id": "u1"})
        return email_dup, mem_dup, cross_ok

    email_dup, mem_dup, cross_ok = with_test_db(scenario)
    assert email_dup, "the same email cannot back a second tenant's user (global unique)"
    assert mem_dup, "(user_id, tenant_id) membership is compound-unique"
    assert cross_ok == 2, "the same user CAN belong to two tenants via distinct memberships"


# ---------------------------------------------------------------------------
# T10-08.3 + T10-08.10 -- auth guards: legacy-token fallback is tenant-matched;
# logout revokes the jti; suspended user / tenant are refused everywhere.
# ---------------------------------------------------------------------------
def test_get_current_user_isolation_guards_present():
    import inspect
    import core.deps as deps
    src = inspect.getsource(deps.get_current_user)
    # T10-08.3: the legacy no-membership fallback is only trusted when the
    # user's own tenant_id matches the token's claimed tenant (no confusion).
    assert 'tenant_id") == claimed_tenant' in src, "legacy fallback must be tenant-matched"
    # T10-08.10: a revoked jti is refused, and suspended user/tenant are 403.
    assert "is_revoked" in src, "logout must be able to blacklist the jti"
    assert 'user.get("suspended")' in src and 'user.get("tenant_suspended")' in src, \
        "suspended user or tenant must be gated"


# ---------------------------------------------------------------------------
# T10-08.7 -- OTP rows are keyed by (phone, tenant): two tenants sharing a phone
# get INDEPENDENT codes, never one overwriting the other.
# ---------------------------------------------------------------------------
def test_otp_is_keyed_by_phone_and_tenant(with_test_db):
    import services.otp as otp

    async def scenario(db):
        restore = _use_db(db, otp)
        try:
            phone_norm, disp = "9820011122", "+91 98200 11122"
            await otp._issue_otp(phone_norm, disp, tenant_id="A", enforce_cooldown=False)
            await otp._issue_otp(phone_norm, disp, tenant_id="B", enforce_cooldown=False)
            rows = await db.otp_codes.find({"phone": phone_norm}, {"_id": 0, "tenant_id": 1}).to_list(10)
            return sorted(r["tenant_id"] for r in rows)
        finally:
            restore()

    tenants = with_test_db(scenario)
    assert tenants == ["A", "B"], f"a shared phone must have one OTP row PER tenant; got {tenants}"
