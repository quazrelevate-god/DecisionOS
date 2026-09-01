"""Golden cases for the documents domain:
  - documents.purchase_class : classify a purchase bill's what-was-bought bucket
    (expense / asset / inventory / unknown) so the ledger files it to the right book.
  - documents.doc_extract    : REAL vision OCR on the invoice photos in
    <repo-root>/testdata/ (Epic 10 S9 / Epic 3 vision). These are LIVE-ONLY
    (golden=None) -- Gemini vision can't be replayed from a recorded text golden --
    so they are skipped in the free replay run and only execute under
    `python -m evals.run --domain documents --live` (needs GEMINI_API_KEY + the
    testdata/ images). They are excluded from the CI replay set automatically.
"""
from pathlib import Path

from evals.base import register, EvalCase, one_of, predicate
from services.ingestion import ai_classify_purchase, ai_extract_document, DOC_MIME

# backend/evals/cases/ -> backend -> repo root -> testdata/
_TESTDATA = Path(__file__).resolve().parents[3] / "testdata"


def _img(stem):
    for ext in (".png", ".jpg", ".jpeg"):
        p = _TESTDATA / f"{stem}{ext}"
        if p.exists():
            return str(p), DOC_MIME.get(ext.lstrip("."), "image/png")
    return str(_TESTDATA / f"{stem}.png"), "image/png"  # resolved lazily at --live run time


def _inv_amounts(r):
    return {int(i["amount"]) for i in r.get("records", {}).get("invoices", [])
            if isinstance(i.get("amount"), (int, float))}


def _tax_ids(r):
    return "".join(str(c.get("tax_id", "")) for c in r.get("records", {}).get("contacts", []))


register(EvalCase(
    task="documents.purchase_class", name="asset_purchase",
    fn=ai_classify_purchase,
    kwargs={
        "text": "Tax invoice: 1x CNC lathe machine, Rs 4,50,000, from Precision Tools Pvt Ltd.",
        "expense_categories": ["Rent", "Utilities", "Repairs"],
        "asset_categories": ["Machinery", "Vehicles", "IT Equipment"],
    },
    golden="""{"purchase_type": "asset", "asset_name": "CNC lathe machine",
      "asset_category": "Machinery", "expense_category": ""}""",
    checks=[
        one_of("purchase_type", ["expense", "asset", "inventory", "unknown"]),
        predicate("asset_name is str", lambda r: isinstance(r["asset_name"], str)),
    ],
    note="Purchase classification: purchase_type stays within the 4-value enum.",
))

register(EvalCase(
    task="documents.purchase_class", name="unknown_type_coerced",
    fn=ai_classify_purchase,
    kwargs={"text": "misc bill", "expense_categories": None, "asset_categories": None},
    golden="""{"purchase_type": "capital_goods"}""",
    checks=[
        predicate("out-of-enum type -> 'unknown'", lambda r: r["purchase_type"] == "unknown"),
    ],
    note="An out-of-enum purchase_type is coerced to 'unknown' so the ledger asks the user.",
))

register(EvalCase(
    task="documents.purchase_class", name="expense_purchase",
    fn=ai_classify_purchase,
    kwargs={
        "text": "Electricity bill - TNEB, billing period Aug 2026, amount Rs 8,450. Consumer no 123.",
        "expense_categories": ["Utilities", "Rent", "Repairs"],
        "asset_categories": ["Machinery", "Vehicles"],
    },
    golden="""{"purchase_type": "expense", "expense_category": "Utilities",
      "asset_name": "", "asset_category": ""}""",
    checks=[
        predicate("classified as expense", lambda r: r["purchase_type"] == "expense"),
        predicate("expense_category is str", lambda r: isinstance(r["expense_category"], str)),
    ],
    note="Labeled set: a recurring utility bill is an expense, not an asset/inventory.",
))

register(EvalCase(
    task="documents.purchase_class", name="inventory_purchase",
    fn=ai_classify_purchase,
    kwargs={
        "text": "Purchase bill: 500 kg raw cotton @ Rs 90/kg from Fibre Mills, for production stock.",
        "expense_categories": ["Utilities", "Repairs"],
        "asset_categories": ["Machinery"],
    },
    golden="""{"purchase_type": "inventory", "inventory_qty": 500, "inventory_unit": "kg",
      "asset_name": "", "asset_category": "", "expense_category": ""}""",
    checks=[
        predicate("classified as inventory", lambda r: r["purchase_type"] == "inventory"),
        predicate("qty carried through", lambda r: r.get("inventory_qty") in (500, 500.0)),
    ],
    note="Labeled set: raw material bought as stock is inventory, with quantity/unit preserved.",
))


# --- documents.doc_extract: LIVE vision OCR on real invoice photos ----------
# golden=None -> live-only (skipped in the free replay run + CI eval set).
register(EvalCase(
    task="documents.doc_extract", name="handwritten_gst_invoice",
    fn=ai_extract_document,
    kwargs=dict(zip(("file_path", "mime_type"), _img("4")))
              | {"session_id": "eval-doc-4", "currency": "INR", "company": "Weave Co"},
    golden=None,
    checks=[
        one_of("doc_type", ["sales_invoice", "purchase_bill", "purchase_order", "payment", "other"]),
        predicate("grand total 4490 extracted", lambda r: 4490 in _inv_amounts(r)),
        predicate("GSTIN 27CORPP3939N1ZQ captured", lambda r: "27CORPP3939N1ZQ" in _tax_ids(r)),
        predicate("vendor Gujarat Freight recognised",
                  lambda r: "gujarat freight" in str(r.get("summary", "")).lower()
                            or any("gujarat" in str(i.get("contact_name", "")).lower()
                                   for i in r.get("records", {}).get("invoices", []))),
    ],
    note="Real handwritten GST invoice (Gujarat Freight Tools) -> vendor/GSTIN/total/lines.",
))

register(EvalCase(
    task="documents.doc_extract", name="foreign_usd_invoice_no_gst",
    fn=ai_extract_document,
    kwargs=dict(zip(("file_path", "mime_type"), _img("7")))
              | {"session_id": "eval-doc-7", "currency": "INR", "company": "Weave Co"},
    golden=None,
    checks=[
        predicate("did not crash / has records", lambda r: isinstance(r.get("records"), dict)),
        predicate("USD total 1710 extracted", lambda r: 1710 in _inv_amounts(r)),
        predicate("currency NOT hallucinated as INR",
                  lambda r: all(i.get("currency") != "INR"
                                for i in r.get("records", {}).get("invoices", []))),
        predicate("no fake GSTIN on a US invoice",
                  lambda r: not __import__("re").search(r"\d{2}[A-Z]{5}\d{4}[A-Z]", _tax_ids(r))),
    ],
    note="Foreign (US, USD) invoice with an embedded 'PREVIEW CLEARLY' banner -> graceful, "
         "correct currency, no invented GSTIN, banner not obeyed.",
))
