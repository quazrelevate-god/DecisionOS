"""A bill is read first and saved only as the person confirmed it (2026-10-30,
founder: "it directly accepts the AI's values — sometimes they're wrong; show
us what it filled, then we confirm").

Add income / expense / asset / stock used to send an attached bill to the AI on
Save and file whatever it read. Now:
  * POST /ledger/read-bill stores and reads the bill and returns what it found —
    and saves no record;
  * Save sends the checked values with the stored bill's path: it is attached
    as it is, and not read again;
  * only this company's ledger uploads can be attached that way;
  * a bill sent with Save and ai_read=false is attached, not read;
  * the dialogs show what the AI filled and wait for the person.
"""
import io
import os
from pathlib import Path

import pytest
from fastapi import HTTPException, UploadFile
from starlette.datastructures import Headers

from tests.e2e_harness import e2e_env

pytestmark = pytest.mark.skipif(
    bool(os.environ.get("PYTEST_XDIST_WORKER")),
    reason="rebinds module-level db globals - single-process only",
)

TENANT = "t-bill"
OWNER = {"id": "u-own", "tenant_id": TENANT, "role": "owner", "name": "Rajesh", "permissions": []}
SRC = Path(__file__).resolve().parents[2] / "frontend" / "src" / "pages" / "finance" / "FinanceForms.jsx"


def _pdf(name="invoice.pdf"):
    return UploadFile(file=io.BytesIO(b"%PDF-1.4 test"), filename=name,
                      headers=Headers({"content-type": "application/pdf"}))


def _run(with_test_db, fn, monkeypatch):
    import routers.ledger as led
    from services import obj_store
    stored = []

    async def save(tenant_id, content, filename, content_type=None):
        key = f"{obj_store.APP_NAME}/{tenant_id}/ledger/f{len(stored) + 1}.pdf"
        stored.append(key)
        return {"fname": f"ledger-f{len(stored)}.pdf", "storage_path": key, "url": f"/api/files/ledger-f{len(stored)}.pdf",
                "filename": filename}

    async def to_temp(path):
        p = Path(os.environ.get("TMP", "/tmp")) / "bill-test.pdf"
        p.write_bytes(b"%PDF")
        return p

    reads = []

    async def ai(path, mime, kind, currency, typed, categories=None):
        reads.append(kind)
        return {"title": "Dyeing job, lot 14", "customer_name": "Kapoor Retail", "amount": 48200, "number": "INV-88",
                "date": "2026-10-12", "due_date": "", "notes": ""}

    monkeypatch.setattr(led, "_save_upload_async", save)
    monkeypatch.setattr(led, "ai_extract_ledger_file", ai)
    import services.uploads as up
    monkeypatch.setattr(up, "download_to_temp", to_temp)

    async def scenario(db):
        with e2e_env(db):
            await db.tenants.insert_one({"id": TENANT, "company_name": "Sharma Textiles", "currency": "INR"})
            return await fn(db, led, stored, reads)

    return with_test_db(scenario)


def test_reading_a_bill_fills_the_form_and_saves_nothing(with_test_db, monkeypatch):
    async def fn(db, led, stored, reads):
        out = await led.read_bill(kind="income", file=_pdf(), user=OWNER)
        n = await db.invoices.count_documents({"tenant_id": TENANT})
        return out, n, stored, reads
    out, n, stored, reads = _run(with_test_db, fn, monkeypatch)
    assert n == 0, "reading a bill saves no record"
    assert reads == ["income"] and len(stored) == 1, "stored once, read once"
    assert out["fields"] == {"title": "Dyeing job, lot 14", "customer_name": "Kapoor Retail", "amount": 48200,
                             "number": "INV-88", "date": "2026-10-12"}, "empty values aren't sent to fill the form"
    assert out["read"] is True and out["attachment"]["storage_path"] == stored[0]


def test_saving_files_what_the_person_checked_and_does_not_read_again(with_test_db, monkeypatch):
    async def fn(db, led, stored, reads):
        read = await led.read_bill(kind="income", file=_pdf(), user=OWNER)
        # The person corrects the amount the AI got wrong, then saves.
        doc = await led.add_revenue_with_file(
            title="Dyeing job, lot 14", customer_name="Kapoor Retail", amount="42800", number="INV-88",
            date="2026-10-12", due_date="", status="unpaid", received="false", notes="", file=None, contact_id="",
            attachment_path=read["attachment"]["storage_path"], attachment_name="invoice.pdf", ai_read="true", user=OWNER)
        row = await db.invoices.find_one({"id": doc["id"]}, {"_id": 0})
        return row, reads, read
    row, reads, read = _run(with_test_db, fn, monkeypatch)
    assert row["amount"] == 42800, "the corrected amount, not the AI's 48,200"
    assert reads == ["income"], "the bill is read once, before the person checks it — not again on save"
    assert row["attachment"]["storage_path"] == read["attachment"]["storage_path"]
    assert row["attachment"]["reviewed"] is True and row["attachment"]["url"].startswith("/api/files/ledger-")


def test_only_this_companys_uploads_can_be_attached(with_test_db, monkeypatch):
    async def fn(db, led, stored, reads):
        from services import obj_store
        bad = [f"{obj_store.APP_NAME}/other-co/ledger/f1.pdf", f"{obj_store.APP_NAME}/{TENANT}/ledger/../x.pdf",
               f"{obj_store.APP_NAME}/{TENANT}/tasks/f1.pdf", "/etc/passwd"]
        codes = []
        for path in bad:
            try:
                await led.add_expense_with_file(title="x", amount="10", vendor_name="", category="", date="", status="paid",
                                                notes="", file=None, vendor_id="", attachment_path=path,
                                                attachment_name="", ai_read="true", user=OWNER)
                codes.append(200)
            except HTTPException as e:
                codes.append(e.status_code)
        return codes
    assert _run(with_test_db, fn, monkeypatch) == [400, 400, 400, 400]


def test_a_bill_sent_with_save_and_ai_read_false_is_attached_not_read(with_test_db, monkeypatch):
    async def fn(db, led, stored, reads):
        doc = await led.add_expense_with_file(title="Courier", amount="350", vendor_name="", category="", date="",
                                              status="paid", notes="", file=_pdf("bill.pdf"), vendor_id="",
                                              attachment_path="", attachment_name="", ai_read="false", user=OWNER)
        return doc, reads
    doc, reads = _run(with_test_db, fn, monkeypatch)
    assert reads == [] and doc["amount"] == 350 and doc["attachment"]["storage_path"]


def test_an_old_app_build_still_gets_its_bill_read(with_test_db, monkeypatch):
    """A file sent the old way (no attachment_path, ai_read unset) is read and
    merged as before, so phones on an older build keep working."""
    async def fn(db, led, stored, reads):
        doc = await led.add_revenue_with_file(title="", customer_name="", amount="", number="", date="", due_date="",
                                              status="unpaid", received="false", notes="", file=_pdf(), contact_id="",
                                              user=OWNER)
        return doc, reads
    doc, reads = _run(with_test_db, fn, monkeypatch)
    assert reads == ["income"] and doc["amount"] == 48200


def test_the_dialogs_show_what_the_ai_filled_and_wait_for_the_person():
    src = SRC.read_text(encoding="utf-8")
    assert 'api.post("/ledger/read-bill", fd)' in src
    assert src.count("useBillReader(") == 5, "one reader, used by income, expense, asset and stock"
    assert src.count("reader.payload(f)") == 4 and "formData(f, file)" not in src, "no dialog sends the bill to be read on save"
    assert 'fd.append("attachment_path", bill.attachment.storage_path);' in src
    assert 'fd.append("ai_read", "false");' in src
    assert "Check the highlighted ones, then save." in src
    assert src.count("busy={busy || reader.reading}") == 4, "Save waits while the AI reads"
