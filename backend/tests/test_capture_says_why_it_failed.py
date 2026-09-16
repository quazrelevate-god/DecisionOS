"""A capture that could not be read says so (2026-09-16).

Found by driving the Decision Desk in the browser on a freshly seeded
workspace: every capture came back "Nothing to decide in that", while the server
log said `AI extract call failed: 451 ai_consent_required`. Three things were
wrong, and all three are tested here.

1. A fresh workspace had no consent record at all. A real signup grants it (the
   signup click IS the consent event, routers/auth.py), but the demo/seeded
   workspace — every new install, every dev machine, every demo — was created
   without one, so the AI was off and nobody was told.
2. `ai_extract` caught the 451 and returned a clean, empty extraction, so the
   caller could not tell "the AI read this and found nothing" from "the AI never
   ran".
3. The capture was therefore recorded as done/nothing_to_decide. The only place
   a capture is marked failed is the outer handler, which was never reached —
   and the screen that says "AI is off for this company", with a link to
   Settings, was already built and unreachable.

The reason string is deliberately shaped like the 451 a request path raises, so
the app's one failure reader (frontend/src/lib/dexOutcome.js, which looks for
"ai_consent_required") lights up for both.
"""
import os

import pytest

pytestmark = pytest.mark.skipif(
    bool(os.environ.get("PYTEST_XDIST_WORKER")),
    reason="rebinds module-level db globals - single-process only",
)

TENANT = "t-fresh"


def _patch(testdb, *mods):
    saved = [(m, m.db) for m in mods]
    for m in mods:
        m.db = testdb

    def restore():
        for m, d in saved:
            m.db = d
    return restore


# ---------------------------------------------------------------------------
# 1. A seeded workspace agrees to AI processing, like a real signup does.
# ---------------------------------------------------------------------------
def test_the_demo_workspace_has_ai_consent():
    import inspect
    import bootstrap.seed as seed
    src = inspect.getsource(seed.seed_demo)
    assert '"ai_consent": demo_consent' in src, (
        "a freshly seeded workspace with no consent record has AI off, and the "
        "Desk answers every capture with 'Nothing to decide in that'"
    )
    assert "build_grant_payload" in src, "record it the way the app records consent"


def test_a_granted_consent_payload_passes_the_gate():
    from services.ai_consent import build_grant_payload, has_active_consent, CURRENT_CONSENT_VERSION
    payload = build_grant_payload(actor_user_id="demo-seed", actor_email="owner@sharma.com",
                                  ip="127.0.0.1", ua="DecisionOS demo seed")
    assert payload["version"] == CURRENT_CONSENT_VERSION
    assert has_active_consent({"ai_consent": payload}), "the seeded grant must satisfy the hot-path gate"


# ---------------------------------------------------------------------------
# 2. The extraction says WHY it is empty.
# ---------------------------------------------------------------------------
def test_ai_extract_reports_the_failure_instead_of_looking_empty(with_test_db):
    """The model call raises (this is what a 451 looks like from in here) — the
    result still degrades to empty, but now it says why."""
    async def scenario(db):
        import core
        import services.ai.extraction as ex
        restore = _patch(db, core)          # record_ai_call writes through core.db
        saved_chat = ex.claude_chat
        calls = {"n": 0}

        class _Boom:
            last_call = None

            def with_model(self, *a, **k):
                return self

            async def send_message(self, _msg):
                calls["n"] += 1
                raise RuntimeError("451: {'code': 'ai_consent_required', 'message': 'consent needed'}")

        ex.claude_chat = lambda **k: _Boom()
        try:
            out = await ex.ai_extract("move packaging to Anand Industries", session_id="t-1", allowed_roles=["sales"])
            return calls["n"], out
        finally:
            ex.claude_chat = saved_chat
            restore()

    n, out = with_test_db(scenario)
    assert n, "the stub stood in for the model"
    assert out["tasks"] == [] and out["decisions"] == [], "it still degrades to an empty extraction"
    assert "ai_consent_required" in (out.get("ai_error") or ""), (
        "and it carries the reason, so the caller can tell 'nothing in it' from 'never read'"
    )


def test_a_successful_extraction_carries_no_error(with_test_db):
    async def scenario(db):
        import core
        import services.ai.extraction as ex
        restore = _patch(db, core)
        saved_chat = ex.claude_chat

        class _Ok:
            last_call = None

            def with_model(self, *a, **k):
                return self

            async def send_message(self, _msg):
                return ('{"summary": "Send the quote", "confidence": 0.9, "decisions": [], '
                        '"tasks": [{"title": "Send the quote", "assignee_role": "sales", '
                        '"description": "", "priority": "medium", "due_in_days": 2}], '
                        '"workflow_events": [], "reminders": [], "meeting_events": [], "memory_notes": []}')

        ex.claude_chat = lambda **k: _Ok()
        try:
            return await ex.ai_extract("send the quote", session_id="t-2", allowed_roles=["sales"])
        finally:
            ex.claude_chat = saved_chat
            restore()

    out = with_test_db(scenario)
    assert out.get("ai_error") is None
    assert out["tasks"], "the happy path is untouched"


# ---------------------------------------------------------------------------
# 3. The capture is marked failed, with the reason the UI already reads.
# ---------------------------------------------------------------------------
def test_a_capture_in_a_workspace_with_ai_off_fails_and_says_why(with_test_db):
    async def scenario(db):
        import core
        import services.voice as voice
        restore = _patch(db, voice, core)
        spent = {"stt": 0}

        async def _never(*a, **k):
            spent["stt"] += 1
            return {"transcript": "should not be reached"}

        saved_stt = voice.transcribe_audio_full
        voice.transcribe_audio_full = _never
        try:
            await db.tenants.insert_one({"id": TENANT, "name": "Fresh Co"})   # no ai_consent
            await db.voice_notes.insert_one({
                "id": "n1", "tenant_id": TENANT, "created_by": "u1", "kind": "audio",
                "audio_path": "x.webm", "status": "queued"})
            await voice.process_voice_note("n1")
            note = await db.voice_notes.find_one({"id": "n1"}, {"_id": 0})
            decisions = await db.decisions.count_documents({"tenant_id": TENANT})
            return note, decisions, spent["stt"]
        finally:
            voice.transcribe_audio_full = saved_stt
            restore()

    note, decisions, stt_calls = with_test_db(scenario)
    assert note["status"] == "failed", "a capture that could not be read is a failure, not an empty one"
    assert note.get("outcome") != "nothing_to_decide", "and must never be reported as nothing to decide"
    assert "ai_consent_required" in note["error"], "the reason the app turns into 'AI is off for this company'"
    assert decisions == 0, "nothing is raised"
    assert stt_calls == 0, "and nothing is spent: the check runs before speech-to-text"


def test_a_capture_the_model_could_not_answer_also_fails(with_test_db):
    """Not only consent: a provider outage, a rate limit or a bad key must reach
    the founder as a failure with a reason, not as an empty decision. Driven
    through the e2e harness, which rebinds every module the pipeline awaits."""
    async def scenario(db):
        from tests.e2e_harness import e2e_env
        import services.voice as voice
        from services.ai_consent import build_grant_payload

        async def _failed_extract(*a, **k):
            return {"summary": "", "confidence": 0.5, "decisions": [], "tasks": [],
                    "workflow_events": [], "reminders": [], "meeting_events": [],
                    "memory_notes": [], "ai_error": "ReadTimeout: provider did not respond"}

        with e2e_env(db, stubs={"services.voice.ai_extract": _failed_extract}):
            await db.tenants.insert_one({
                "id": TENANT, "name": "Fresh Co",
                "ai_consent": build_grant_payload(actor_user_id="u1", actor_email="o@x.co", ip=None, ua=None)})
            await db.voice_notes.insert_one({
                "id": "n2", "tenant_id": TENANT, "created_by": "u1", "kind": "text",
                "transcript": "Move packaging to Anand Industries", "status": "queued"})
            await voice.process_voice_note("n2")
            note = await db.voice_notes.find_one({"id": "n2"}, {"_id": 0})
            decisions = await db.decisions.count_documents({"tenant_id": TENANT})
            return note, decisions

    note, decisions = with_test_db(scenario)
    assert note["status"] == "failed"
    assert "ReadTimeout" in note["error"], "the founder is told what went wrong"
    assert decisions == 0


def test_a_meeting_recording_is_not_spent_when_ai_is_off(with_test_db):
    async def scenario(db):
        import core
        import services.meetings as meetings
        restore = _patch(db, meetings, core)
        spent = {"stt": 0}

        async def _never(*a, **k):
            spent["stt"] += 1
            return "should not be reached"

        saved = meetings.transcribe_audio
        meetings.transcribe_audio = _never
        try:
            await db.tenants.insert_one({"id": TENANT, "name": "Fresh Co"})   # no ai_consent
            await db.meetings.insert_one({
                "id": "m1", "tenant_id": TENANT, "created_by": "u1", "kind": "audio",
                "audio_path": "x.webm", "status": "queued"})
            await meetings.process_meeting("m1")
            row = await db.meetings.find_one({"id": "m1"}, {"_id": 0})
            return row, spent["stt"]
        finally:
            meetings.transcribe_audio = saved
            restore()

    row, stt_calls = with_test_db(scenario)
    assert row["status"] == "failed"
    assert "ai_consent_required" in row["error"]
    assert stt_calls == 0, "speech-to-text is billed per minute — do not spend it on a call that cannot work"


# ---------------------------------------------------------------------------
# The reason string is the one the app already knows how to read.
# ---------------------------------------------------------------------------
def test_the_reason_string_matches_what_the_app_looks_for():
    from services.ai_consent import consent_error_detail
    detail = consent_error_detail(None)
    assert "ai_consent_required" in detail, (
        "frontend/src/lib/dexOutcome.js finds the consent screen by this code"
    )
    assert detail.startswith("451:"), "shaped like the 451 a request path raises"
