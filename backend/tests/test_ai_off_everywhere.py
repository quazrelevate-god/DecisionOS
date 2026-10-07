"""AB-05 (2026-10-07): "AI off" stops every AI path, not only Claude's.

guarded_llm checked consent before each Claude call; Gemini document/image
reading, speech-to-text (Sarvam / OpenAI / Whisper) and embeddings did not, so
a company that switched AI off still sent bills, voices and Ask questions to
those providers. Each entry point now asks services.ai.llm_limits.
require_ai_allowed first. These tests prove each one refuses BEFORE any
provider is touched, and lets the call through when consent is given.
"""
import asyncio
from pathlib import Path

import pytest
from fastapi import HTTPException

import core
from tests.fake_mongo import FakeDB, consenting_tenant

ROOT = Path(__file__).resolve().parents[1]


class Tripwire(Exception):
    """Raised by a fake provider: reaching it means data would have left."""


def _with_tenant(monkeypatch, consent: bool):
    d = FakeDB()
    d.tenants.docs.append(consenting_tenant("t1") if consent else {"id": "t1"})
    monkeypatch.setattr(core, "db", d)
    return d


def _run_as(tid, coro_fn):
    async def go():
        core._ctx_tenant.set(tid)
        return await coro_fn()
    return asyncio.run(go())


# --- the gate ------------------------------------------------------------------------------
def test_gate_refuses_without_consent_and_passes_with_it(monkeypatch):
    from services.ai.llm_limits import require_ai_allowed
    _with_tenant(monkeypatch, consent=False)
    with pytest.raises(HTTPException) as ei:
        _run_as("t1", lambda: require_ai_allowed())
    assert ei.value.status_code == 451 and ei.value.detail["code"] == "ai_consent_required"
    _with_tenant(monkeypatch, consent=True)
    assert _run_as("t1", lambda: require_ai_allowed()) is None


def test_gate_has_nothing_to_check_without_a_company(monkeypatch):
    from services.ai.llm_limits import require_ai_allowed
    _with_tenant(monkeypatch, consent=False)
    assert _run_as(None, lambda: require_ai_allowed()) is None      # pre-signup interview


def test_gate_names_the_company_explicitly(monkeypatch):
    from services.ai.llm_limits import require_ai_allowed
    _with_tenant(monkeypatch, consent=False)
    with pytest.raises(HTTPException):
        _run_as(None, lambda: require_ai_allowed("t1"))


def test_a_consent_read_failure_fails_open(monkeypatch):
    from services.ai.llm_limits import require_ai_allowed

    class Broken:
        def __getattr__(self, n):
            raise RuntimeError("mongo blip")

    monkeypatch.setattr(core, "db", Broken())
    assert _run_as("t1", lambda: require_ai_allowed()) is None


# --- each entry point refuses before the provider ----------------------------------------------
def _trip(*a, **k):
    raise Tripwire()


async def _atrip(*a, **k):
    raise Tripwire()


def test_image_reading(monkeypatch):
    import services.vision as vision
    monkeypatch.setattr(vision, "get_gemini_client", _trip)
    _with_tenant(monkeypatch, consent=False)
    with pytest.raises(HTTPException) as ei:
        _run_as("t1", lambda: vision.ai_read_image_general("x.png", "image/png", "s"))
    assert ei.value.status_code == 451


def test_document_import(monkeypatch):
    import services.ingestion as ing
    monkeypatch.setattr(ing, "get_gemini_client", _trip)
    _with_tenant(monkeypatch, consent=False)
    with pytest.raises(HTTPException):
        _run_as("t1", lambda: ing.ai_extract_document("x.pdf", "application/pdf", "s"))


def test_finance_bill_reading(monkeypatch):
    import routers.ledger as led
    import services.vision as vision
    monkeypatch.setattr(vision, "get_gemini_client", _trip)
    _with_tenant(monkeypatch, consent=False)
    with pytest.raises(HTTPException):
        _run_as("t1", lambda: led.ai_extract_ledger_file("x.jpg", "image/jpeg", "expense", "INR", {}))


def test_speech_to_text(monkeypatch):
    import services.transcription as tr
    monkeypatch.setattr(tr, "get_ai_key", _trip)
    monkeypatch.setattr(tr._stt, "get_openai_stt_client", _trip)
    monkeypatch.setattr(tr._stt, "whisper_stt", _atrip)
    _with_tenant(monkeypatch, consent=False)
    with pytest.raises(HTTPException):
        _run_as("t1", lambda: tr._transcribe_audio_full_local("x.webm"))


def test_embeddings(monkeypatch):
    import integrations.embeddings as emb
    monkeypatch.setattr(emb, "_openai_embed", _atrip)
    monkeypatch.setattr(emb, "_voyage_embed", _atrip)
    _with_tenant(monkeypatch, consent=False)
    with pytest.raises(HTTPException):
        _run_as("t1", lambda: emb.embed_texts(["what is our refund policy"], input_type="query"))


def test_with_consent_the_call_reaches_the_provider(monkeypatch):
    import integrations.embeddings as emb
    monkeypatch.setattr(emb, "_openai_embed", _atrip)
    monkeypatch.setattr(emb, "_voyage_embed", _atrip)
    _with_tenant(monkeypatch, consent=True)
    with pytest.raises(Tripwire):
        _run_as("t1", lambda: emb.embed_texts(["q"], input_type="query"))


# --- what people are told -------------------------------------------------------------------------
def test_whatsapp_says_ai_is_off_instead_of_try_again():
    src = (ROOT / "services" / "whatsapp.py").read_text(encoding="utf-8")
    at = src.index("except HTTPException as e:")
    block = src[at:at + 1200]
    assert "if e.status_code == 451:" in block and "AI is switched off for your company" in block
    assert "elif e.status_code == 402:" in block


def test_a_bill_upload_says_why_it_was_not_read():
    src = (ROOT / "routers" / "ledger.py").read_text(encoding="utf-8")
    assert "AI is switched off, so the bill wasn't read" in src
    assert src.count('"bill_note": (_att or {}).get("read_note")') == 4
    forms = (ROOT.parent / "frontend" / "src" / "pages" / "finance" / "FinanceForms.jsx").read_text(encoding="utf-8")
    assert forms.count("(res.data.bill_note || t(\"finance.bill_not_read\"))") == 3
