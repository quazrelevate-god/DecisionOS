"""Epic 10 Testing -- Sprint 2 (functional / lifecycle).

db-tier: each test drives the REAL router handlers against a fresh isolated Mongo
database (with_test_db), pointing every module the flow touches at it. This pins
the end-to-end behavior a client sees -- status codes, cascades, counts, no
orphans -- without a live server.

Batch 1:
  T10-02.14  viewer-aware operating-score dispatch + view-as privacy (403/404)
  T10-02.12  inbox counts reflect the FULL open total even when the list paginates
  T10-02.4   contact rename cascades into invoices/payments/workflows; outstanding
             splits purchase_bill -> payables vs receivables
"""
from fastapi import HTTPException


def _use_db(testdb, *mods):
    """Point each module's global `db` at the isolated test db; return restore()."""
    saved = [(m, m.db) for m in mods]
    for m in mods:
        m.db = testdb
    return lambda: [setattr(m, "db", d) for m, d in saved]


def _u(role, uid, tid="t1", **over):
    u = {"role": role, "tenant_id": tid, "id": uid, "name": f"{role}-{uid}"}
    u.update(over)
    return u


# ---------------------------------------------------------------------------
# T10-02.14 -- operating-score is viewer-aware; view-as is owner-only.
# ---------------------------------------------------------------------------
def test_operating_score_viewer_dispatch_and_privacy(with_test_db):
    import routers.operating_score as osr
    import services.operating_score as oss

    async def scenario(db):
        restore = _use_db(db, osr, oss)
        try:
            tid = "t1"
            await db.users.insert_many([
                {"id": "owner1", "tenant_id": tid, "role": "owner", "name": "Owner"},
                {"id": "sales1", "tenant_id": tid, "role": "sales", "name": "Sam"},
            ])
            owner = _u("owner", "owner1")
            sales = _u("sales", "sales1")
            r = {}
            p = await osr.operating_score(user_id=None, user=owner)
            r["owner_view"], r["owner_snapshot"] = p["view"], ("my_snapshot" in p)
            p = await osr.operating_score(user_id=None, user=sales)
            r["sales_view"] = p["view"]
            p = await osr.operating_score(user_id="sales1", user=owner)   # owner view-as
            r["viewas_view"], r["viewas_id"] = p["view"], p.get("view_as", {}).get("id")
            try:                                                          # non-owner -> 403
                await osr.operating_score(user_id="owner1", user=sales)
                r["privacy"] = None
            except HTTPException as e:
                r["privacy"] = e.status_code
            try:                                                          # owner -> ghost -> 404
                await osr.operating_score(user_id="ghost", user=owner)
                r["missing"] = None
            except HTTPException as e:
                r["missing"] = e.status_code
            return r
        finally:
            restore()

    r = with_test_db(scenario)
    assert r["owner_view"] == "owner" and r["owner_snapshot"]
    assert r["sales_view"] == "self"
    assert r["viewas_view"] == "self" and r["viewas_id"] == "sales1"
    assert r["privacy"] == 403, "a non-owner must NOT see another user's operating page"
    assert r["missing"] == 404


# ---------------------------------------------------------------------------
# T10-02.12 -- inbox counts reflect the FULL open total, not the paginated slice.
# ---------------------------------------------------------------------------
def test_inbox_counts_full_open_total_and_status_validation(with_test_db):
    import routers.inbox as inbox
    from routers.inbox import InboxStatusInput

    async def scenario(db):
        restore = _use_db(db, inbox)
        try:
            tid = "t1"
            docs = ([{"id": f"a{i}", "tenant_id": tid, "classification": "complaint",
                      "status": "open", "created_at": f"2026-01-0{i+1}"} for i in range(3)]
                    + [{"id": f"b{i}", "tenant_id": tid, "classification": "payment",
                        "status": "open", "created_at": f"2026-02-0{i+1}"} for i in range(2)]
                    + [{"id": "d0", "tenant_id": tid, "classification": "complaint",
                        "status": "done", "created_at": "2026-03-01"}])
            await db.inbox.insert_many(docs)
            user = _u("owner", "owner1")
            listed = await inbox.list_inbox(classification=None, status="open", limit=2, user=user)
            ok = await inbox.set_inbox_status("a0", InboxStatusInput(status="done"), user=user)
            bad = missing = None
            try:
                await inbox.set_inbox_status("a1", InboxStatusInput(status="bogus"), user=user)
            except HTTPException as e:
                bad = e.status_code
            try:
                await inbox.set_inbox_status("nope", InboxStatusInput(status="done"), user=user)
            except HTTPException as e:
                missing = e.status_code
            return len(listed["items"]), listed["open_total"], listed["counts"], ok, bad, missing
        finally:
            restore()

    n_items, open_total, counts, ok, bad, missing = with_test_db(scenario)
    assert n_items == 2, "list is paginated to the limit"
    assert open_total == 5, "open_total must reflect ALL open items, not the page"
    assert counts.get("complaint") == 3 and counts.get("payment") == 2
    assert ok == {"ok": True, "status": "done"}
    assert bad == 400, "invalid status must 400"
    assert missing == 404, "unknown item id must 404"


# ---------------------------------------------------------------------------
# T10-02.4 -- rename cascades the denormalized name; outstanding splits by type.
# ---------------------------------------------------------------------------
def test_contact_rename_cascade_and_outstanding_split(with_test_db):
    import routers.contacts as contacts
    import routers.crm as crm
    from routers.contacts import ContactUpdateInput

    async def scenario(db):
        restore = _use_db(db, contacts, crm)
        try:
            tid = "t1"
            await db.contacts.insert_one({"id": "c1", "tenant_id": tid, "name": "Old Name",
                                          "type": "customer"})
            # denormalized copies of the name across three collections
            await db.invoices.insert_many([
                {"id": "inv-recv", "tenant_id": tid, "contact_id": "c1", "contact_name": "Old Name",
                 "type": "sales_invoice", "amount": 1000, "amount_paid": 0, "status": "unpaid"},
                {"id": "inv-pay", "tenant_id": tid, "contact_id": "c1", "contact_name": "Old Name",
                 "type": "purchase_bill", "amount": 400, "amount_paid": 0, "status": "unpaid"},
            ])
            await db.payments.insert_one({"id": "p1", "tenant_id": tid, "contact_id": "c1",
                                          "contact_name": "Old Name", "amount": 100})
            await db.workflows.insert_one({"id": "w1", "tenant_id": tid, "contact_id": "c1",
                                           "counterparty": "Old Name"})
            owner = _u("owner", "owner1")

            await contacts.update_contact("c1", ContactUpdateInput(name="New Name"), user=owner)

            inv = await db.invoices.find_one({"id": "inv-recv"}, {"_id": 0, "contact_name": 1})
            pay = await db.payments.find_one({"id": "p1"}, {"_id": 0, "contact_name": 1})
            wf = await db.workflows.find_one({"id": "w1"}, {"_id": 0, "counterparty": 1})
            con = await db.contacts.find_one({"id": "c1"}, {"_id": 0, "name": 1})

            outstanding = await crm.outstanding_by_contact(user=owner)
            return (inv["contact_name"], pay["contact_name"], wf["counterparty"], con["name"],
                    outstanding.get("c1"))
        finally:
            restore()

    inv_name, pay_name, wf_cp, con_name, bucket = with_test_db(scenario)
    assert con_name == "New Name"
    assert inv_name == "New Name", "invoice contact_name must cascade on rename"
    assert pay_name == "New Name", "payment contact_name must cascade on rename"
    assert wf_cp == "New Name", "workflow counterparty must cascade on rename"
    # outstanding: sales invoice -> receivables (1000), purchase bill -> payables (400)
    assert bucket is not None
    assert bucket["receivables"] == 1000 and bucket["payables"] == 400
