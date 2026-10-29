"""A bill uploaded in the app is never lost, and whoever files it can find it
(BUG-16, XCODITS QA report, 2026-10-21).

The testers: "Taking a photo, uploading a bill and entering details manually
all show a notification. The expense appears under neither Filed nor Pending."
Pending and Filed are the Money Inbox's tabs, and they listed only WhatsApp
drafts. An uploaded bill said "Extracted" and then waited for File it with
nothing listing it, Discard left it waiting for good, and an employee without
Finance could file it and never see it again.

Now the Inbox lists uploads too (GET /ingest?status=review|filed): the owner
and Finance see the company's, anyone else their own; Discard really discards;
the Inbox count includes uploads waiting to be filed; filing and discarding
only reach uploads you may see. Checked in a browser as an employee and as the
owner against a local copy of the demo.
"""
import asyncio
import os
import re
from pathlib import Path

import pytest
from fastapi import HTTPException

from tests.e2e_harness import e2e_env

pytestmark = pytest.mark.skipif(
    bool(os.environ.get("PYTEST_XDIST_WORKER")),
    reason="rebinds module-level db globals - single-process only",
)

T = "t-bug16"
OWNER = {"id": "u-owner", "tenant_id": T, "role": "owner", "name": "Rajesh"}
FIN = {"id": "u-fin", "tenant_id": T, "role": "finance", "name": "Sunita", "permissions": ["finance", "data_input"]}
AMIT = {"id": "u-amit", "tenant_id": T, "role": "production", "name": "Amit", "permissions": ["data_input", "inbox"]}
PRIYA = {"id": "u-priya", "tenant_id": T, "role": "sales", "name": "Priya", "permissions": ["data_input", "inbox"]}


def _up(id, by, status="review", source="upload"):
    return {"id": id, "tenant_id": T, "created_by": by, "source": source, "status": status, "kind": "image",
            "filename": f"{id}.jpg", "created_at": f"2026-10-21T0{len(id) % 9}:00:00+00:00",
            "records": {"contacts": [], "invoices": [{"type": "purchase_bill", "purchase_type": "expense",
                                                      "contact_name": "Shree Packaging", "amount": 1200}],
                        "payments": [], "tasks": []}}


SEED = [_up("amit-waiting", AMIT["id"]), _up("amit-filed", AMIT["id"], "filed"),
        _up("priya-waiting", PRIYA["id"]), _up("owner-waiting", OWNER["id"]),
        _up("wa-filed", OWNER["id"], "filed", source="whatsapp")]


def _run(with_test_db, body):
    async def scenario(db):
        with e2e_env(db):
            await db.users.insert_many([{k: v for k, v in u.items() if k != "permissions"}
                                        for u in (OWNER, FIN, AMIT, PRIYA)])
            await db.ingestions.insert_many([dict(s) for s in SEED])
            return await body(db)
    return with_test_db(scenario)


def _ids(rows):
    return sorted(r["id"] for r in rows)


def test_each_person_sees_the_uploads_they_should(with_test_db):
    async def body(db):
        import routers.finance as rf
        return {u["id"]: (_ids(await rf.list_ingestions(status="review", user=u)),
                          _ids(await rf.list_ingestions(status="filed", user=u)))
                for u in (OWNER, FIN, AMIT, PRIYA)}

    seen = _run(with_test_db, body)
    everyone_waiting = ["amit-waiting", "owner-waiting", "priya-waiting"]
    # The owner and Finance review money: the company's uploads, never the
    # WhatsApp ones (that queue already lists those drafts).
    assert seen["u-owner"] == (everyone_waiting, ["amit-filed"])
    assert seen["u-fin"] == (everyone_waiting, ["amit-filed"])
    # Anyone else: their own, waiting and filed.
    assert seen["u-amit"] == (["amit-waiting"], ["amit-filed"])
    assert seen["u-priya"] == (["priya-waiting"], [])


def test_discard_takes_it_out_of_pending_and_cannot_be_filed_after(with_test_db):
    async def body(db):
        import routers.finance as rf
        from models.finance import IngestCommitInput
        out = {"discarded": await rf.discard_ingestion("amit-waiting", user=AMIT)}
        out["pending"] = _ids(await rf.list_ingestions(status="review", user=AMIT))
        try:
            await rf.commit_ingestion("amit-waiting", IngestCommitInput(records={}), user=AMIT)
        except HTTPException as e:
            out["refile"] = (e.status_code, e.detail)
        try:
            await rf.discard_ingestion("amit-filed", user=AMIT)
        except HTTPException as e:
            out["discard_filed"] = e.status_code
        return out

    out = _run(with_test_db, body)
    assert out["discarded"] == {"discarded": True}
    assert out["pending"] == []
    assert out["refile"] == (400, "This upload was discarded")
    assert out["discard_filed"] == 400, "what a filed upload put in the books stays"


def test_nobody_acts_on_someone_elses_upload_without_finance(with_test_db):
    async def body(db):
        import routers.finance as rf
        from models.finance import IngestCommitInput
        codes = {}
        for name, call in (("open", rf.get_ingestion("priya-waiting", user=AMIT)),
                           ("discard", rf.discard_ingestion("priya-waiting", user=AMIT)),
                           ("file", rf.commit_ingestion("priya-waiting", IngestCommitInput(records={}), user=AMIT))):
            try:
                await call
            except HTTPException as e:
                codes[name] = e.status_code
        # Finance may open it (and so file or discard it).
        codes["finance_open"] = (await rf.get_ingestion("priya-waiting", user=FIN))["id"]
        return codes

    codes = _run(with_test_db, body)
    assert codes == {"open": 404, "discard": 404, "file": 404, "finance_open": "priya-waiting"}


def test_the_inbox_count_includes_uploads_waiting_to_be_filed(with_test_db):
    async def body(db):
        import routers.captures as rc
        return {u["id"]: (await rc.captures_pending_count(user=u))["count"] for u in (OWNER, AMIT, PRIYA)}

    counts = _run(with_test_db, body)
    assert counts == {"u-owner": 3, "u-amit": 1, "u-priya": 1}


# ------------------------------------------------------------------ screens
FE = Path(__file__).resolve().parents[2] / "frontend" / "src"


def _code(rel):
    src = (FE / rel).read_text(encoding="utf-8")
    src = re.sub(r"\{/\*.*?\*/\}", "", src, flags=re.S)
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    return re.sub(r"^\s*//.*$", "", src, flags=re.M)


def test_reading_a_bill_does_not_claim_it_was_saved():
    # Raw source: "image/*" in an accept= list reads as a comment opener to _code.
    ledger = (FE / "pages" / "Ledger.js").read_text(encoding="utf-8")
    assert 'toast.success("Extracted — review below")' not in ledger
    assert 'toast.message("Read it — check the details below, then tap File it to save it.")' in ledger
    # Adding by hand needs Finance; it is offered only to who has it.
    add = ledger[ledger.index('data-testid="finance-hero-add-m"') - 120: ledger.index('data-testid="finance-hero-add-m"')]
    assert "{canLedger && (" in add


def test_the_inbox_lists_uploads_and_filing_says_where_it_went():
    captures = _code("pages/Captures.js")
    assert 'const UPLOAD_STATUS = { pending_review: "review", executed: "filed" };' in captures
    assert "api.get(`/ingest?status=${uploadStatus}`)" in captures
    assert "{uploads.map((u) => <UploadCard" in captures
    panel = _code("pages/finance/ReviewPanel.js")
    assert "await api.post(`/ingest/${ingestion.id}/discard`);" in panel
    assert 'const where = canLedger ? (w.place ? ` — in ${w.place}` : "") : " — see Inbox › Filed";' in panel
