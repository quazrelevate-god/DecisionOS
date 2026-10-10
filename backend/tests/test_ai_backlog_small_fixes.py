"""AI backlog small fixes (2026-10-07): AB-14, AB-15, AB-18.

AB-14  A finance brief that could not be written was cached as "Not enough
       data yet" against the current figures, so a company over its AI
       allowance was told its books were empty until the next invoice.
AB-15  Ask filed every attachment into the Company Brain (refused for members
       without Manage Team, and permanent for everyone else). Files now go to
       /files and /ask reads them for that one answer.
AB-18  Every log line went to stderr, which Railway marks "error".
"""
import asyncio
import logging
from pathlib import Path

import pytest
from fastapi import HTTPException

import core  # noqa: F401  -- load order
from tests.fake_mongo import FakeDB

FE = Path(__file__).resolve().parents[2] / "frontend" / "src"


def _run(c):
    return asyncio.run(c)


# --- AB-14 -------------------------------------------------------------------------------
class _RefusingChat:
    def __init__(self, exc):
        self.exc = exc

    def with_model(self, *a):
        return self

    async def send_message(self, m):
        raise self.exc


@pytest.mark.parametrize("exc, words", [
    (HTTPException(status_code=402, detail={"code": "quota_exceeded", "message": "x"}), "allowance is used up"),
    (HTTPException(status_code=451, detail={"code": "ai_consent_required"}), "AI is switched off"),
    (RuntimeError("timeout"), "Press Refresh to try again"),
])
def test_an_unwritten_brief_says_why_and_is_not_cached(monkeypatch, exc, words):
    import routers.ledger as led
    d = FakeDB()
    monkeypatch.setattr(led, "db", d)
    monkeypatch.setattr(led, "claude_chat", lambda **k: _RefusingChat(exc))
    out = _run(led._generate_analysis("t1", "brief", ctx={"currency": "INR", "today": "2026-10-07", "totals": {"sales_count": 1}}))
    assert out["unavailable"] is True and words in out["headline"]
    assert "Not enough data" not in out["headline"]
    assert out["insights"] == [] and out["generated_at"] is None
    assert d.ledger_ai.docs == []          # nothing stored: the next view asks again


def test_a_written_brief_is_still_cached(monkeypatch):
    import routers.ledger as led
    d = FakeDB()
    monkeypatch.setattr(led, "db", d)

    class Ok(_RefusingChat):
        async def send_message(self, m):
            return '{"headline": "Spend is up 12% on freight", "insights": []}'

    monkeypatch.setattr(led, "claude_chat", lambda **k: Ok(None))
    out = _run(led._generate_analysis("t1", "brief", ctx={"currency": "INR", "today": "2026-10-07", "totals": {"sales_count": 1}}))
    assert out["headline"] == "Spend is up 12% on freight" and not out.get("unavailable")
    assert len(d.ledger_ai.docs) == 1


def test_the_panel_draws_it_as_a_note():
    src = (FE / "pages" / "finance" / "FinanceAi.jsx").read_text(encoding="utf-8")
    assert ") : data?.unavailable ? (" in src
    assert "if (!d?.unavailable) toast.success(" in src


# --- AB-15 -------------------------------------------------------------------------------
def test_ask_reads_only_the_askers_own_attachments(monkeypatch):
    import routers.brain as brain
    import services.files as files
    d = FakeDB()
    d.files.docs += [
        {"id": "f-mine", "tenant_id": "t1", "uploaded_by": "u1", "is_deleted": False, "original_filename": "bill.jpg"},
        {"id": "f-theirs", "tenant_id": "t1", "uploaded_by": "u2", "is_deleted": False, "original_filename": "x.pdf"},
        {"id": "f-other-co", "tenant_id": "t2", "uploaded_by": "u1", "is_deleted": False, "original_filename": "y.pdf"},
        {"id": "f-gone", "tenant_id": "t1", "uploaded_by": "u1", "is_deleted": True, "original_filename": "z.pdf"},
    ]
    monkeypatch.setattr(brain, "db", d)

    async def read(rec, tenant_id="", max_chars=6000):
        return f"text of {rec['id']}"

    monkeypatch.setattr(files, "_read_reference_text", read)
    out = _run(brain._attached_files("t1", "u1", ["f-mine", "f-theirs", "f-other-co", "f-gone", "nope"]))
    assert out == [{"id": "f-mine", "title": "bill.jpg", "text": "text of f-mine"}]
    assert _run(brain._attached_files("t1", "u1", [])) == []


def test_ask_takes_file_ids_and_nothing_files_into_the_brain():
    from models.brain import AskRequest
    assert AskRequest(question="q").file_ids == []
    assert AskRequest(question="q", file_ids=["a"]).file_ids == ["a"]
    hook = (FE / "hooks" / "useDexConversation.js").read_text(encoding="utf-8")
    code = "\n".join(l for l in hook.splitlines() if not l.strip().startswith(("//", "/*", "*")))
    assert 'api.post("/brain/documents"' not in code
    assert 'api.post("/ask", { question, context_id: ctxId, file_ids: fileIds })' in hook
    brain_js = (FE / "pages" / "Brain.js").read_text(encoding="utf-8")
    assert "file_ids: files.map((a) => a.id)" in brain_js


# --- AB-18 -------------------------------------------------------------------------------
def test_routine_lines_go_to_stdout_and_errors_to_stderr():
    import sys
    out, err = core._log_handlers()
    assert out.stream is sys.stdout and err.stream is sys.stderr

    def rec(level):
        return logging.LogRecord("decisionos", level, __file__, 1, "m", None, None)

    assert out.filter(rec(logging.INFO)) and out.filter(rec(logging.WARNING))
    assert not out.filter(rec(logging.ERROR))
    assert err.level == logging.ERROR
