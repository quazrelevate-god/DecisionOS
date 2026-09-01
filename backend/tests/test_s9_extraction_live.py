"""Epic 10 Sprint 9 + Epic 3 vision/STT: REAL end-to-end extraction on the
actual invoice photos and Tamil/Tanglish voice notes in <repo-root>/testdata/.

These make LIVE model calls -- Gemini 3.6 vision OCR + Sarvam saaras STT -- so
they are GATED behind RUN_LIVE_LLM=1 and skipped in the default offline/CI suite.
Run them single-process (the async LLM clients bind to one event loop):

    RUN_LIVE_LLM=1 PYTHONIOENCODING=utf-8 backend/.venv/Scripts/python.exe \
        -m pytest backend/tests/test_s9_extraction_live.py -o addopts="" -p no:xdist -v

Needs GEMINI_API_KEY (OCR) + SARVAM_API_KEY (STT) in backend/.env. The extractor
functions are pure (file -> dict); the only DB side effects are AI-telemetry
writes, which the autouse `_no_telemetry` fixture no-ops so a live run never
touches the shared dev database.

Covers:  T10-09.1  clean invoice OCR -> correct fields, high confidence, no review
         T10-09.2  real-photo (angled/low-res) still extracts, degrades not crashes
         T10-09.3  foreign/non-GST invoice -> graceful, correct currency, no hallucinated GSTIN
         T10-09.4  CSV/messy-header spreadsheet -> AI column mapping
         T10-09.5  Tanglish/Tamil voice -> transcript -> decision/tasks
         T10-09.6  five real voice notes transcribe resiliently
         T10-09.10 (image) an invoice photo carrying an injected "PREVIEW CLEARLY /
                   double-click" banner is read as a document, not obeyed
"""
import os
import re
import asyncio
from pathlib import Path

import pytest
from dotenv import load_dotenv

_BACKEND = Path(__file__).resolve().parent.parent
load_dotenv(_BACKEND / ".env")  # ensure GEMINI/SARVAM keys are present for a direct run

from tests.testdata_ground_truth import (  # noqa: E402
    INVOICES, VOICE_FILES, invoice_path, voice_path, have_testdata,
)

LIVE = bool(os.environ.get("RUN_LIVE_LLM"))
pytestmark = [
    pytest.mark.skipif(not LIVE, reason="live AI test; set RUN_LIVE_LLM=1 to run"),
    pytest.mark.skipif(not have_testdata(), reason="testdata/ invoices+voice not present"),
    pytest.mark.skipif(bool(os.environ.get("PYTEST_XDIST_WORKER")),
                       reason="live LLM clients are single-event-loop; run without xdist"),
]

from services.ingestion import ai_extract_document, ai_map_spreadsheet, DOC_MIME  # noqa: E402
from services.transcription import transcribe_audio_full  # noqa: E402
from services.ai.extraction import ai_extract  # noqa: E402


@pytest.fixture(autouse=True)
def _no_telemetry(monkeypatch):
    """Silence the AI-telemetry DB writes so a live run has zero shared-DB effects."""
    async def _noop(*a, **k):
        return None
    import services.ingestion as ing
    import services.ai.extraction as ex
    for mod, name in ((ing, "record_ai_call"), (ing, "log_usage"), (ex, "record_ai_call")):
        monkeypatch.setattr(mod, name, _noop, raising=False)


def _run(coro):
    return asyncio.run(coro)


def _mime(p: Path):
    return DOC_MIME.get(p.suffix.lower().lstrip("."), "application/octet-stream")


def _ints(strings):
    return {int(re.sub(r"[^\d]", "", s)) for s in strings if re.sub(r"[^\d]", "", s)}


_OCR_CACHE = {}


def _extract(stem):
    # OCR each invoice at most once per session (~45s/call) -- several tests
    # assert on the same extraction.
    if stem not in _OCR_CACHE:
        p = invoice_path(stem)
        _OCR_CACHE[stem] = _run(ai_extract_document(str(p), _mime(p), f"s9-live-{stem}",
                                                    currency="INR", company="Weave Co"))
    return _OCR_CACHE[stem]


def _all_text(result):
    """Every string the extractor produced -- for tolerant substring checks."""
    invs = result.get("records", {}).get("invoices", [])
    conts = result.get("records", {}).get("contacts", [])
    parts = [result.get("summary", "")]
    for i in invs:
        parts += [str(i.get("number", "")), str(i.get("contact_name", "")), str(i.get("amount", ""))]
    for c in conts:
        parts += [str(c.get("name", "")), str(c.get("tax_id", ""))]
    return " | ".join(parts)


# ---------------------------------------------------------------------------
# T10-09.1  Clean invoice OCR -> correct fields, high confidence, auto/confirm
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("stem", ["2", "3", "4", "1"])   # the four Indian GST invoices
def test_indian_invoice_extracts_correct_fields(stem):
    gt = INVOICES[stem]
    r = _extract(stem)
    invs = r.get("records", {}).get("invoices", [])
    assert invs, f"invoice {stem}: no invoice record extracted"
    text = _all_text(r)

    # amount -- the human-readable total must appear somewhere in the record
    amounts = {int(i["amount"]) for i in invs if isinstance(i.get("amount"), (int, float))}
    expected = _ints(gt["amount_any"])
    assert amounts & expected, f"invoice {stem}: amounts {amounts} not in expected {expected}"

    # vendor -- at least one expected name substring present
    assert any(v.lower() in text.lower() for v in gt["vendor_any"]), \
        f"invoice {stem}: no vendor of {gt['vendor_any']} in {text!r}"

    # GSTIN -- captured as a contact tax_id (or in the text)
    assert any(g.replace("-", "").replace(" ", "").lower() in text.replace("-", "").replace(" ", "").lower()
               for g in gt["gstin_any"]), f"invoice {stem}: no GSTIN of {gt['gstin_any']}"

    # currency INR, a recognised doc type, and enough line items
    assert all(i.get("currency", "INR") == "INR" for i in invs), f"invoice {stem}: non-INR currency"
    assert r["doc_type"] in ("sales_invoice", "purchase_bill", "purchase_order", "payment", "other")
    assert max(len(i.get("line_items") or []) for i in invs) >= gt.get("line_items_min", 1)


def test_clean_invoices_route_to_auto_or_confirm_not_attention():
    """T10-09.1 tail: a clean, high-confidence extraction is NOT flagged for review
    (needs_review False) -> it would route to auto/confirm, never the attention queue."""
    for stem in ("2", "3", "4"):
        r = _extract(stem)
        assert r["needs_review"] is False, f"invoice {stem} wrongly needs review: {r['review_reasons']}"
        assert r["confidence"] >= 0.6


# ---------------------------------------------------------------------------
# T10-09.3 + .10  Foreign / non-GST invoice + injected banner
# ---------------------------------------------------------------------------
def test_foreign_invoice_graceful_no_gst_no_injection():
    r = _extract("7")            # US invoice, USD, low-res, embedded "PREVIEW CLEARLY" banner
    assert isinstance(r, dict) and "records" in r          # no crash
    invs = r.get("records", {}).get("invoices", [])
    assert invs, "foreign invoice: nothing extracted"
    inv = invs[0]
    # currency must NOT be hallucinated as INR (it's USD)
    assert inv.get("currency") != "INR", f"foreign invoice mislabeled currency {inv.get('currency')}"
    # the USD total appears
    assert int(inv.get("amount", 0)) in _ints(INVOICES["7"]["amount_any"])
    # no Indian GSTIN invented for a US invoice
    tax_ids = [c.get("tax_id", "") for c in r["records"].get("contacts", [])]
    assert all(not re.match(r"^\d{2}[A-Z]{5}\d{4}[A-Z]", (t or "")) for t in tax_ids), \
        f"hallucinated a GSTIN on a US invoice: {tax_ids}"
    # the injected "double click / preview clearly" banner was NOT obeyed:
    # the model returned a normal document extraction, not an instruction echo
    assert r["doc_type"] in ("sales_invoice", "purchase_bill", "purchase_order", "payment", "other")


# ---------------------------------------------------------------------------
# T10-09.4  CSV / messy-header spreadsheet -> AI column mapping
# ---------------------------------------------------------------------------
def test_csv_messy_headers_map_to_fields():
    headers = ["Sr", "Party Name", "Bill No", "Bill Dt", "Amt (Rs)", "GSTIN"]
    rows = [
        ["1", "Sharma Textiles", "INV-101", "01-04-2025", "45,000", "27ABCDE1234F1Z5"],
        ["2", "Kumar Traders", "INV-102", "03-04-2025", "1,20,000", "29ZZZZZ9999Z1Z1"],
    ]
    out = _run(ai_map_spreadsheet(headers, rows, session_id="s9-live-csv",
                                  currency="INR", company="Weave Co"))
    assert isinstance(out, dict)
    blob = str(out).lower()
    # the mapping/records must recognise the money + party columns
    assert "sharma textiles" in blob or "kumar traders" in blob
    assert "45000" in blob.replace(",", "") or "120000" in blob.replace(",", "")


# ---------------------------------------------------------------------------
# T10-09.5 / .6  Voice -> transcript -> task
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("fname", VOICE_FILES)
def test_voice_note_transcribes(fname):
    p = voice_path(fname)
    if not p.exists():
        pytest.skip(f"{fname} not present")
    stt = _run(transcribe_audio_full(str(p), language="auto"))
    assert stt.get("engine") in ("sarvam", "openai", "whisper"), stt
    assert isinstance(stt.get("transcript"), str) and stt["transcript"].strip(), \
        f"{fname}: empty transcript"
    assert stt.get("language_name")            # a language was identified


def test_tanglish_voice_directive_becomes_task():
    """T10-09.5: a real Tamil/Tanglish directive -> transcript -> structured task.

    Transcribe the first clip, then structure it. STT wording can vary run-to-run,
    so we assert the STRUCTURED result shape (a task or decision was produced from
    a real directive), not exact transcript text."""
    p = voice_path(VOICE_FILES[0])
    if not p.exists():
        pytest.skip("voice clip missing")
    stt = _run(transcribe_audio_full(str(p), language="auto"))
    transcript = stt["transcript"].strip()
    assert transcript

    ex = _run(ai_extract(transcript, session_id="s9-live-voice",
                         allowed_roles=["sales", "finance", "operations"]))
    for bucket in ("decisions", "tasks", "workflow_events", "reminders",
                   "meeting_events", "memory_notes"):
        assert isinstance(ex.get(bucket), list)
    assert (len(ex["tasks"]) + len(ex["decisions"]) + len(ex["workflow_events"])) >= 1, \
        f"no actionable item structured from directive {transcript!r}"
    assert 0.0 <= ex.get("confidence", 0) <= 1.0
