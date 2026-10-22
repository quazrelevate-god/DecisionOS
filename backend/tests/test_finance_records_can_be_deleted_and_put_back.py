"""Finance delete, undo an import, delete everything, and put it back
(2026-10-22, client: "the records were not correct and they need to refill
them from Tally — they have no way to delete").

Runs in-process on a throwaway database (with_test_db). Every module the
flows touch has its `db` pointed at it.
"""
import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException


def _use_db(testdb, *mods):
    saved = [(m, m.db) for m in mods if hasattr(m, "db")]
    for m, _ in saved:
        m.db = testdb
    return lambda: [setattr(m, "db", d) for m, d in saved]


OWNER = {"id": "o1", "tenant_id": "t1", "role": "owner", "name": "Rajesh", "email": "o@x.test"}
FIN = {"id": "f1", "tenant_id": "t1", "role": "finance", "name": "Sunita", "permissions": ["finance"]}


def _mods():
    import core
    import core.deps as core_deps
    import routers.finance as fin_rt
    import routers.finance_trash as rt
    import routers.invoicing as inv_rt
    import routers.ledger as led
    import services.ai.brain_context as bctx
    import services.finance_trash as ft
    import services.finance_words as fw
    import services.ingestion as ing
    return core, core_deps, fin_rt, rt, inv_rt, led, bctx, ft, fw, ing


async def _seed(db):
    await db.tenants.insert_one({"id": "t1", "name": "Sharma Textiles", "currency": "INR",
                                 "invoice_prefix": "ST", "state": "Tamil Nadu"})
    await db.users.insert_one(dict(OWNER))
    await db.users.insert_one(dict(FIN))


def _inv(iid, number, amount, paid=0, typ="sales_invoice", **kw):
    status = "paid" if paid and paid >= amount else ("partial" if paid else "unpaid")
    return {"id": iid, "tenant_id": "t1", "type": typ, "number": number, "amount": amount,
            "amount_paid": paid, "status": status, "contact_name": kw.pop("contact_name", "Kapoor Retail"),
            "date": "2026-10-01", "created_at": "2026-10-01T10:00:00+00:00", **kw}


def _pay(pid, amount, apps, direction="in", **kw):
    applied = sum(a["amount"] for a in apps)
    return {"id": pid, "tenant_id": "t1", "direction": direction, "amount": amount, "applied": applied,
            "applications": [{"invoice_id": i, "amount": a, "at": "x"} for i, a in [(x["invoice_id"], x["amount"]) for x in apps]],
            "invoice_id": apps[0]["invoice_id"] if apps else None,
            "match_status": "matched" if applied >= amount else ("partial" if applied else "unmatched"),
            "contact_name": "Kapoor Retail", "date": "2026-10-05", "created_at": "2026-10-05T10:00:00+00:00", **kw}


def _run(with_test_db, body):
    def runner(db):
        async def go():
            restore = _use_db(db, *_mods())
            try:
                await _seed(db)
                return await body(db)
            finally:
                restore()
        return go()
    return with_test_db(runner)


# ── a payment ────────────────────────────────────────────────────────────────
def test_deleting_a_payment_makes_its_invoice_owed_again_and_undo_puts_it_back(with_test_db):
    async def body(db):
        _, _, _, rt, _, led, _, ft, _, _ = _mods()
        from models.finance import FinanceDeleteInput
        await db.invoices.insert_one(_inv("i1", "INV-1", 1000, paid=1000))
        await db.payments.insert_one(_pay("p1", 1000, [{"invoice_id": "i1", "amount": 1000}]))
        await db.brain_context.insert_one({"id": "b1", "tenant_id": "t1", "source_type": "payment", "source_id": "p1"})
        prev = await rt.preview_delete(FinanceDeleteInput(items=[{"kind": "payment", "id": "p1"}]), user=FIN)
        assert prev["asked"][0]["label"] == "1 payment received"
        assert any("money due again" in e for e in prev["effects"])
        res = await led.delete_revenue_payment("p1", user=FIN)
        inv = await db.invoices.find_one({"id": "i1"})
        assert inv["amount_paid"] == 0 and inv["status"] == "unpaid", "the invoice is owed again"
        assert await db.brain_context.count_documents({"id": "b1"}) == 0, "Dex stops quoting it"
        await ft.restore("t1", res["batch_id"], FIN)
        inv = await db.invoices.find_one({"id": "i1"})
        assert inv["amount_paid"] == 1000 and inv["status"] == "paid"
        assert await db.payments.count_documents({"id": "p1"}) == 1
        assert await db.brain_context.count_documents({"id": "b1"}) == 1
        return True
    assert _run(with_test_db, body)


# ── an invoice ───────────────────────────────────────────────────────────────
def test_a_payment_split_across_invoices_stays_when_one_invoice_goes(with_test_db):
    async def body(db):
        _, _, _, _, _, led, _, ft, _, _ = _mods()
        await db.invoices.insert_one(_inv("i1", "INV-1", 600, paid=600))
        await db.invoices.insert_one(_inv("i2", "INV-2", 400, paid=400))
        await db.payments.insert_one(_pay("p1", 1000, [{"invoice_id": "i1", "amount": 600},
                                                       {"invoice_id": "i2", "amount": 400}]))
        await db.invoices.insert_one(_inv("i3", "INV-3", 200, paid=200))
        await db.payments.insert_one(_pay("p3", 200, [{"invoice_id": "i3", "amount": 200}]))
        res = await led.delete_revenue_invoice("i1", user=OWNER)
        p1 = await db.payments.find_one({"id": "p1"})
        assert p1 and p1["applied"] == 400 and p1["match_status"] == "partial", "the payment stays; i1's part is off"
        assert [a["invoice_id"] for a in p1["applications"]] == ["i2"] and p1["invoice_id"] == "i2"
        assert (await db.invoices.find_one({"id": "i2"}))["status"] == "paid", "the other invoice is untouched"
        # A payment that settled only the invoice still goes with it (E2-65's cascade).
        await led.delete_revenue_invoice("i3", user=OWNER)
        assert await db.payments.count_documents({"id": "p3"}) == 0
        await ft.restore("t1", res["batch_id"], OWNER)
        p1 = await db.payments.find_one({"id": "p1"})
        assert p1["applied"] == 1000 and p1["match_status"] == "matched" and len(p1["applications"]) == 2
        with pytest.raises(HTTPException) as e:
            await led.delete_revenue_invoice("ghost", user=OWNER)
        assert e.value.status_code == 404
        return True
    assert _run(with_test_db, body)


# ── an expense ───────────────────────────────────────────────────────────────
def test_an_expense_booked_from_a_bill_takes_the_bill_and_its_asset(with_test_db):
    async def body(db):
        _, _, _, rt, _, led, _, _, _, _ = _mods()
        from models.finance import FinanceDeleteInput
        await db.invoices.insert_one(_inv("b1", "SUP-9", 50000, typ="purchase_bill", contact_name="Sai Tools"))
        await db.expenses.insert_one({"id": "e1", "tenant_id": "t1", "title": "Sai Tools — Bill SUP-9",
                                      "amount": 50000, "category": "Asset Purchase", "invoice_id": "b1",
                                      "status": "unpaid", "created_at": "2026-10-02"})
        await db.assets.insert_one({"id": "a1", "tenant_id": "t1", "name": "Lathe", "expense_id": "e1"})
        prev = await rt.preview_delete(FinanceDeleteInput(items=[{"kind": "expense", "id": "e1"}]), user=FIN)
        assert prev["label"].startswith("expense Sai Tools")
        assert {p["key"] for p in prev["also"]} == {"purchase_bill", "assets"}
        await led.delete_expense("e1", user=FIN)
        for coll, rid in (("invoices", "b1"), ("expenses", "e1"), ("assets", "a1")):
            assert await db[coll].count_documents({"id": rid}) == 0, coll
        payables = await led.list_payables(user=FIN)
        assert payables["open_invoices"] == [], "the bill has left Bills to pay"
        return True
    assert _run(with_test_db, body)


# ── a GST invoice issued from DecisionOS ─────────────────────────────────────
def test_an_issued_gst_invoice_is_kept_unless_the_owner_says_so(with_test_db):
    async def body(db):
        _, _, _, rt, inv_rt, led, _, _, _, _ = _mods()
        from models.finance import FinanceDeleteInput
        await db.invoices.insert_one(_inv("g1", "ST/26-27/001", 5900, kind="gst_invoice", source="invoice_builder"))
        await db.invoices.insert_one(_inv("g2", "ST/26-27/002", 1180, kind="gst_invoice", source="invoice_builder"))
        await db.invoices.insert_one(_inv("i9", "TALLY-51", 300, source="csv"))
        with pytest.raises(HTTPException) as e:
            await led.delete_revenue_invoice("g2", user=OWNER)
        assert e.value.status_code == 409 and "credit note" in e.value.detail
        both = [{"kind": "invoice", "id": "g2"}, {"kind": "invoice", "id": "i9"}]
        prev = await rt.preview_delete(FinanceDeleteInput(items=both), user=FIN)
        assert [k["number"] for k in prev["kept_issued"]] == ["ST/26-27/002"] and prev["total"] == 1
        assert prev["can_include_issued"] is False
        with pytest.raises(HTTPException) as e:
            await rt.delete_records(FinanceDeleteInput(items=both, include_issued=True), user=FIN)
        assert e.value.status_code == 403, "only the owner"
        await rt.delete_records(FinanceDeleteInput(items=both), user=FIN)
        assert await db.invoices.count_documents({"id": "g2"}) == 1, "kept by default"
        assert await db.invoices.count_documents({"id": "i9"}) == 0, "an imported copy goes"
        await rt.delete_records(FinanceDeleteInput(items=[{"kind": "invoice", "id": "g2"}], include_issued=True), user=OWNER)
        assert await db.invoices.count_documents({"id": "g2"}) == 0
        nxt = await inv_rt.next_invoice_number(user=OWNER)
        assert nxt["number"] == "ST/26-27/003", "an issued number is never handed out again"
        return True
    assert _run(with_test_db, body)


# ── an import ────────────────────────────────────────────────────────────────
def test_undoing_an_import_takes_out_what_it_filed_and_nothing_else(with_test_db):
    async def body(db):
        _, _, fin_rt, rt, _, _, _, ft, _, ing = _mods()
        # Before the import: a customer used elsewhere, and an invoice of theirs.
        await db.contacts.insert_one({"id": "c-old", "tenant_id": "t1", "name": "Kapoor Retail", "type": "customer"})
        await db.invoices.insert_one(_inv("i-old", "OLD-1", 700, contact_id="c-old"))
        records = {
            "contacts": [{"name": "Bluewave Exports", "type": "customer"}],
            "invoices": [
                {"type": "sales_invoice", "number": "T-51", "contact_name": "Bluewave Exports", "amount": 2500},
                {"type": "purchase_bill", "number": "SUP-2", "contact_name": "Ganesh Dyes", "amount": 1200,
                 "purchase_type": "inventory", "inventory_qty": 10, "inventory_unit": "kg"},
            ],
            # Matched by number to the invoice that was there BEFORE the import.
            "payments": [{"direction": "in", "amount": 700, "contact_name": "Kapoor Retail", "invoice_number": "OLD-1"}],
            "tasks": [{"title": "Chase Bluewave for T-51", "due_in_days": 3}],
        }
        await db.ingestions.insert_one({"id": "ing1", "tenant_id": "t1", "created_by": "f1", "source": "csv",
                                        "filename": "tally-march.csv", "status": "review",
                                        "created_at": "2026-10-20T09:00:00+00:00"})
        from models.finance import IngestCommitInput
        await fin_rt.commit_ingestion("ing1", IngestCommitInput(records=records), user=FIN)
        old = await db.invoices.find_one({"id": "i-old"})
        assert old["status"] == "paid", "the import's payment settled the older invoice"
        # A task somebody started is theirs now; the other contact is used since.
        ganesh = await db.contacts.find_one({"name": "Ganesh Dyes"})
        await db.complaints.insert_one({"id": "cmp1", "tenant_id": "t1", "contact_id": ganesh["id"]})

        prev = await rt.preview_undo_import("ing1", user=FIN)
        keys = {p["key"]: p["n"] for p in prev["asked"]}
        assert keys == {"sales_invoice": 1, "purchase_bill": 1, "in": 1, "inventory": 1,
                        "contacts": 1, "tasks": 1}, keys
        assert any("money due again" in e for e in prev["effects"])
        assert any("kept" in e for e in prev["effects"]), "Ganesh Dyes is used elsewhere"
        res = await rt.undo_import("ing1", user=FIN)
        assert await db.invoices.count_documents({"ingestion_id": "ing1"}) == 0
        assert await db.payments.count_documents({"ingestion_id": "ing1"}) == 0
        assert await db.inventory.count_documents({"ingestion_id": "ing1"}) == 0
        assert await db.tasks.count_documents({"ingestion_id": "ing1"}) == 0
        assert await db.contacts.count_documents({"name": "Bluewave Exports"}) == 0
        assert await db.contacts.count_documents({"name": "Ganesh Dyes"}) == 1
        assert await db.contacts.count_documents({"id": "c-old"}) == 1, "a contact from before is never touched"
        old = await db.invoices.find_one({"id": "i-old"})
        assert old["amount_paid"] == 0 and old["status"] == "unpaid"
        ing_doc = await db.ingestions.find_one({"id": "ing1"})
        assert ing_doc["status"] == "undone"
        filed = await fin_rt.list_ingestions(status="filed", user=FIN)
        assert [r["id"] for r in filed] == ["ing1"], "it stays on Filed, saying so"
        with pytest.raises(HTTPException):
            await rt.undo_import("ing1", user=FIN)

        await ft.restore("t1", res["batch_id"], FIN)
        assert (await db.ingestions.find_one({"id": "ing1"}))["status"] == "filed"
        assert await db.invoices.count_documents({"ingestion_id": "ing1"}) == 2
        assert (await db.invoices.find_one({"id": "i-old"}))["status"] == "paid"
        assert await db.contacts.count_documents({"name": "Bluewave Exports"}) == 1
        return True
    assert _run(with_test_db, body)


# ── everything ───────────────────────────────────────────────────────────────
def test_deleting_everything_needs_the_owner_a_copy_and_the_name(with_test_db):
    async def body(db):
        _, _, _, rt, _, _, _, ft, _, _ = _mods()
        from models.finance import FinanceEverythingInput
        await db.invoices.insert_one(_inv("g1", "ST/26-27/001", 5900, paid=5900, kind="gst_invoice", source="invoice_builder"))
        await db.payments.insert_one(_pay("pg", 5900, [{"invoice_id": "g1", "amount": 5900}]))
        await db.invoices.insert_one(_inv("i1", "T-1", 100))
        await db.expenses.insert_one({"id": "e1", "tenant_id": "t1", "title": "Rent", "amount": 9000})
        await db.inventory.insert_one({"id": "s1", "tenant_id": "t1", "item": "Dye", "quantity": 3})
        await db.stock_movements.insert_one({"id": "m1", "tenant_id": "t1", "inventory_id": "s1", "quantity": 1})

        with pytest.raises(HTTPException) as e:
            await rt.preview_everything(user=FIN)
        assert e.value.status_code == 403
        prev = await rt.preview_everything(user=OWNER)
        assert prev["company_name"] == "Sharma Textiles" and len(prev["kept_issued"]) == 1

        link = await rt.finance_export_link(user=OWNER)
        bad = FinanceEverythingInput(confirm_name="Sharma Textiles", export_id=link["export_id"])
        with pytest.raises(HTTPException) as e:
            await rt.delete_everything(bad, user=OWNER)
        assert "copy" in e.value.detail, "not before the copy is downloaded"
        token = link["path"].rsplit("/", 1)[1]
        resp = await rt.finance_export(token)
        assert resp.body[:2] == b"PK", "an .xlsx"
        with pytest.raises(HTTPException) as e:
            await rt.delete_everything(FinanceEverythingInput(confirm_name="Sharma", export_id=link["export_id"]), user=OWNER)
        assert "name" in e.value.detail
        res = await rt.delete_everything(FinanceEverythingInput(confirm_name="  sharma   textiles ",
                                                                export_id=link["export_id"]), user=OWNER)
        for coll in ("expenses", "inventory", "stock_movements"):
            assert await db[coll].count_documents({"tenant_id": "t1"}) == 0, coll
        assert [i["id"] for i in await db.invoices.find({}, {"_id": 0}).to_list(None)] == ["g1"]
        assert await db.payments.count_documents({"id": "pg"}) == 1, "an issued invoice keeps its payment"
        trash = await rt.list_recently_deleted(user=FIN)
        assert trash["batches"][0]["label"] == "all Finance records"
        await rt.restore_deleted(res["batch_id"], user=FIN)
        assert await db.expenses.count_documents({"id": "e1"}) == 1
        with pytest.raises(HTTPException) as e:
            await rt.restore_deleted(res["batch_id"], user=FIN)
        assert e.value.status_code == 409
        return True
    assert _run(with_test_db, body)


# ── thirty days ──────────────────────────────────────────────────────────────
def test_after_thirty_days_a_delete_cannot_be_put_back(with_test_db):
    async def body(db):
        _, _, _, rt, _, led, _, ft, _, _ = _mods()
        await db.expenses.insert_one({"id": "e1", "tenant_id": "t1", "title": "Rent", "amount": 9000})
        res = await led.delete_expense("e1", user=FIN)
        old = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
        await db.finance_trash.update_one({"id": res["batch_id"]}, {"$set": {"restore_until": old}})
        with pytest.raises(HTTPException) as e:
            await rt.restore_deleted(res["batch_id"], user=FIN)
        assert e.value.status_code == 410
        assert await ft.purge_expired("t1") == 1
        assert await db.finance_trash_rows.count_documents({"batch_id": res["batch_id"]}) == 0
        assert (await rt.list_recently_deleted(user=FIN))["batches"] == []
        # An expired export link is refused.
        link = await rt.finance_export_link(user=OWNER)
        await db.finance_exports.update_one({"id": link["export_id"]}, {"$set": {"expires_at": old}})
        with pytest.raises(HTTPException) as e:
            await rt.finance_export(link["path"].rsplit("/", 1)[1])
        assert e.value.status_code == 404
        return True
    assert _run(with_test_db, body)


def test_the_delete_routes_are_owner_and_finance_only():
    """Every route sits behind require_ledger; the export download is the one
    open route, and it carries a token."""
    import inspect

    import routers.finance_trash as rt
    from routers.ledger import require_ledger
    for route in rt.router.routes:
        deps = [p.default.dependency for p in inspect.signature(route.endpoint).parameters.values()
                if hasattr(p.default, "dependency")]
        if route.path == "/api/finance/export/{token}":
            assert deps == []
        else:
            assert deps == [require_ledger], route.path


if __name__ == "__main__":  # pragma: no cover
    asyncio.run(asyncio.sleep(0))


# ── the screens ──────────────────────────────────────────────────────────────
from pathlib import Path as _Path  # noqa: E402

_SRC = _Path(__file__).resolve().parents[2] / "frontend" / "src"


def _read(rel):
    return (_SRC / rel).read_text(encoding="utf-8")


def test_every_delete_on_the_finance_page_asks_first():
    ledger = _read("pages/Ledger.js")
    assert "api.delete(" not in ledger, "no delete straight from a bin tap"
    assert "const deleting = useFinanceDelete();" in ledger and "{deleting.dialog}" in ledger
    assert ledger.count("onDelete={deleting.ask}") == 4, "Revenue, Expenses, Assets, Inventory"
    assert "{canLedger && <FinanceMoreMenu cur={cur} />}" in ledger


def test_each_list_can_be_selected_and_deleted():
    rec = _read("pages/finance/FinanceRecords.jsx")
    for testid in ("revenue-invoices-select", "revenue-payments-select", "expenses-select",
                   "payments-made-select", "assets-select", "inventory-select"):
        assert f'testid="{testid}"' in rec, testid
    assert rec.count("<SelectionBar ") == 6
    assert 'onDelete={(b) => onDelete([{ kind: "bill", id: b.id }])}' in rec, "a supplier bill can be deleted"
    dl = _read("components/neuglass/DataList.jsx")
    assert "export function DataList({ columns, rows, rowKey, rowTestid, rowClass, testid, footer, select })" in dl
    assert '!(selecting && r === "action")' in dl, "a phone card's bin steps aside while selecting"


def test_the_confirmation_says_what_goes_and_that_it_can_come_back():
    fd = _read("pages/finance/FinanceDelete.jsx")
    for s in ('"/finance/delete/preview"', "/undo/preview", '"/finance/everything/preview"',
              "To cancel one, issue a credit note.", "Recently deleted", 'label: "Undo"',
              '"/finance/export-link"', "downloadFrom(url", "p.can_include_issued"):
        assert s in fd, s
    caps = _read("pages/Captures.js")
    assert "Undo this import" in caps and "undo.askImport(u)" in caps and "restoreBatch(u.undo_batch_id" in caps
