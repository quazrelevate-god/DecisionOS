"""
Iteration 33 — Auto-create REAL calendar events from AI-detected meetings.

Covers:
- Login owner
- Sales-review + vendor-call directive → produces execution_summary.meetings >= 1 (target: 2)
  and creates type='meeting' events on /api/calendar with future dates that match the
  meeting titles (Friday event, Monday event).
- Date resolution helper (_resolve_meeting_date) verified through actual output — the
  resolved YYYY-MM-DD dates must be in the future (>= today) and plausible.
- Non-meeting directive ('Priya, follow up with Bangalore retailer today') →
  execution_summary.meetings == 0 and no new type='meeting' calendar events created.
- execution_summary regression: still has all 6 numeric keys.
- Meeting also creates a source='meeting' to-do task with due_date=null (does NOT
  duplicate as a 'task' calendar entry).

Cleanup: deletes every voice_note/decision/task/calendar_event created by these tests
from the demo tenant so the calendar returns to baseline.
"""
import os
import time
import pytest
import requests
from datetime import datetime, timezone, timedelta
from pathlib import Path


def _load_frontend_backend_url():
    env_path = Path("/app/frontend/.env")
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if line.startswith("REACT_APP_BACKEND_URL="):
                return line.split("=", 1)[1].strip()
    return os.environ.get("REACT_APP_BACKEND_URL")


BASE_URL = (_load_frontend_backend_url() or "").rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL missing"

OWNER_EMAIL = "owner@sharma.com"
OWNER_PASSWORD = "demo1234"

MEETING_DIRECTIVE = (
    "Arrange a sales review meeting this Friday with the sales team, "
    "and set up a vendor call next Monday."
)
NO_MEETING_DIRECTIVE = "Priya, follow up with the Bangalore retailer today."

POLL_TIMEOUT_S = 120
POLL_INTERVAL_S = 2.0

# Track everything we create for teardown
_CREATED = {
    "note_ids": set(),
    "decision_ids": set(),
    "task_ids": set(),
    "calendar_event_ids": set(),
}


def _login():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD},
        timeout=15,
    )
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    body = r.json()
    tok = body.get("token") or body.get("access_token")
    assert tok, body
    return tok


@pytest.fixture(scope="module")
def token():
    return _login()


@pytest.fixture(scope="module")
def auth_headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _submit_text(auth_headers, text):
    r = requests.post(
        f"{BASE_URL}/api/voice-notes/text",
        json={"text": text, "language": "en"},
        headers=auth_headers,
        timeout=20,
    )
    assert r.status_code == 200, f"submit failed: {r.status_code} {r.text}"
    body = r.json()
    assert "id" in body
    _CREATED["note_ids"].add(body["id"])
    return body["id"]


def _poll_note_done(auth_headers, note_id, timeout=POLL_TIMEOUT_S):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        r = requests.get(f"{BASE_URL}/api/voice-notes", headers=auth_headers, timeout=15)
        assert r.status_code == 200, r.text
        for n in r.json():
            if n.get("id") == note_id:
                last = n
                if n.get("status") == "done":
                    return n
                if n.get("status") == "failed":
                    pytest.fail(f"Voice note failed: {n.get('error')}")
                break
        time.sleep(POLL_INTERVAL_S)
    pytest.fail(f"Voice note {note_id} not done in {timeout}s. Last state: {last}")


def _get_calendar(auth_headers, days=45):
    r = requests.get(f"{BASE_URL}/api/calendar?days={days}", headers=auth_headers, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    # Flatten
    all_events = []
    for d in body.get("days", []):
        for e in d.get("events", []):
            all_events.append(e)
    return body, all_events


def _meeting_events(events):
    return [e for e in events if e.get("type") == "meeting"]


# ------------------------------------------------------------------
# Tests
# ------------------------------------------------------------------
ISO_DATE_LEN = 10  # YYYY-MM-DD


class TestMeetingsToCalendar:
    """Verify AI-detected meeting_events become real calendar events."""

    def test_1_login_returns_jwt(self, token):
        assert isinstance(token, str) and len(token) > 20

    def test_2_meeting_directive_creates_calendar_events(self, auth_headers):
        # Baseline calendar meeting events
        _, before_events = _get_calendar(auth_headers)
        before_meeting_ids = {e.get("entity_id") for e in _meeting_events(before_events)}

        note_id = _submit_text(auth_headers, MEETING_DIRECTIVE)
        note = _poll_note_done(auth_headers, note_id)

        es = note.get("execution_summary") or {}
        for k in ("tasks", "assignees", "approvals", "workflows", "meetings", "reminders"):
            assert k in es, f"execution_summary missing {k}: {es}"
            assert isinstance(es[k], int), f"{k} not int: {es}"

        assert es["meetings"] >= 1, f"expected meetings>=1, got {es}"
        if es["meetings"] < 2:
            print(f"[WARN] Only {es['meetings']} meeting(s) detected; expected 2 (Friday + Monday).")

        decision_id = note.get("decision_id")
        assert decision_id, f"decision_id missing on note: {note}"
        _CREATED["decision_ids"].add(decision_id)

        # Track tasks from decision (includes source=meeting tasks)
        d_resp = requests.get(f"{BASE_URL}/api/decisions", headers=auth_headers, timeout=15)
        assert d_resp.status_code == 200
        dec = next((d for d in d_resp.json() if d.get("id") == decision_id), None)
        assert dec, f"decision {decision_id} not found in /api/decisions"
        for tid in (dec.get("task_ids") or []):
            _CREATED["task_ids"].add(tid)

        # Fetch calendar and locate the new meeting events
        cal_body, all_events = _get_calendar(auth_headers)
        assert "counts" in cal_body
        counts = cal_body.get("counts") or {}
        assert counts.get("meeting", 0) >= 1, f"counts.meeting missing or zero: {counts}"

        m_events = _meeting_events(all_events)
        new_meetings = [e for e in m_events if e.get("entity_id") not in before_meeting_ids]
        for e in new_meetings:
            if e.get("entity_id"):
                _CREATED["calendar_event_ids"].add(e["entity_id"])

        assert len(new_meetings) >= 1, f"Expected >=1 NEW meeting event on calendar, got 0. all={m_events}"

        today_iso = datetime.now(timezone.utc).date().isoformat()

        # Validate ALL new meetings:
        # - date is a valid YYYY-MM-DD string
        # - date is in the future (>= today) and within 45 days window
        # - type == 'meeting'
        # - title is non-empty
        max_future = (datetime.now(timezone.utc) + timedelta(days=45)).date().isoformat()
        for ev in new_meetings:
            assert ev.get("type") == "meeting", f"event type not meeting: {ev}"
            date = ev.get("date") or ""
            assert len(date) == ISO_DATE_LEN and date[4] == "-" and date[7] == "-", \
                f"date not YYYY-MM-DD: {date} in {ev}"
            # Parse to ensure valid date
            try:
                datetime.strptime(date, "%Y-%m-%d")
            except Exception as e:
                pytest.fail(f"date not parseable: {date} ({e})")
            assert date >= today_iso, f"meeting date {date} not in future (today={today_iso}): {ev}"
            assert date <= max_future, f"meeting date {date} beyond 45-day window: {ev}"
            assert (ev.get("title") or "").strip(), f"meeting title empty: {ev}"
            assert not ev.get("overdue"), f"future meeting flagged overdue: {ev}"

        # If we got both meetings, verify title-to-date semantics loosely
        # (Friday event should differ from Monday event; but LLM non-deterministic)
        if es["meetings"] >= 2 and len(new_meetings) >= 2:
            dates = sorted({e["date"] for e in new_meetings})
            # Should be at least 2 distinct dates for 2 different meetings
            assert len(dates) >= 2, \
                f"Expected 2 distinct meeting dates, got {dates} for events {new_meetings}"

            # Look for likely Friday event & Monday event by weekday of resolved date
            has_friday_or_monday = False
            for ev in new_meetings:
                wday = datetime.strptime(ev["date"], "%Y-%m-%d").weekday()
                # 0=Mon, 4=Fri
                if wday in (0, 4):
                    has_friday_or_monday = True
                    break
            if not has_friday_or_monday:
                print(f"[WARN] No Fri/Mon in resolved meeting dates: {[e['date'] for e in new_meetings]}")

        # Regression: for each NEW meeting calendar event, a source='meeting' task exists
        # with due_date=null (so it does NOT duplicate as a 'task' calendar entry).
        # Meeting-task title format (server.py:779): meeting_title + " (when_text)" if when else ""
        tasks_resp = requests.get(f"{BASE_URL}/api/tasks", headers=auth_headers, timeout=15)
        assert tasks_resp.status_code == 200
        all_tasks = tasks_resp.json()

        def _norm(s):
            return (s or "").strip().lower()

        # Only consider source='meeting' tasks created AFTER the note was submitted
        note_created_at = note.get("processed_at") or note.get("created_at") or ""
        candidate_tasks = [t for t in all_tasks if t.get("source") == "meeting"]
        # Match candidates to any new_meetings by title prefix
        our_meeting_tasks = []
        new_meeting_titles = {_norm(e.get("title")) for e in new_meetings}
        for t in candidate_tasks:
            title_norm = _norm(t.get("title"))
            # Task title may equal meeting title, or meeting title + " (when)"
            for mt in new_meeting_titles:
                if not mt:
                    continue
                if title_norm == mt or title_norm.startswith(mt + " (") or title_norm.startswith(mt):
                    our_meeting_tasks.append(t)
                    _CREATED["task_ids"].add(t["id"])
                    break

        assert len(our_meeting_tasks) >= 1, \
            f"expected >=1 source='meeting' task matching new meeting titles {new_meeting_titles}. " \
            f"candidates={[(t.get('title'), t.get('source')) for t in candidate_tasks]}"

        for t in our_meeting_tasks:
            assert t.get("due_date") in (None, ""), \
                f"meeting task should have null due_date to avoid calendar dup: {t}"
            assert t.get("status") == "todo", f"meeting task status should be todo: {t}"
            assert t.get("decision_id") is None, \
                f"meeting task should have decision_id=None so it stays undated: {t}"

        # Confirm no NEW type='task' calendar entry duplicates a NEW meeting task title
        cal_task_events = [e for e in all_events if e.get("type") == "task"]
        our_task_titles = {_norm(t.get("title")) for t in our_meeting_tasks}
        for te in cal_task_events:
            title_l = _norm(te.get("title"))
            assert title_l not in our_task_titles, \
                f"meeting task duplicated as calendar 'task' entry: {te}"

    def test_3_no_meeting_directive_yields_zero_meetings(self, auth_headers):
        _, before_events = _get_calendar(auth_headers)
        before_meeting_ids = {e.get("entity_id") for e in _meeting_events(before_events)}

        note_id = _submit_text(auth_headers, NO_MEETING_DIRECTIVE)
        note = _poll_note_done(auth_headers, note_id)

        es = note.get("execution_summary") or {}
        assert isinstance(es.get("meetings"), int)

        decision_id = note.get("decision_id")
        if decision_id:
            _CREATED["decision_ids"].add(decision_id)
            d_resp = requests.get(f"{BASE_URL}/api/decisions", headers=auth_headers, timeout=15)
            dec = next((d for d in d_resp.json() if d.get("id") == decision_id), None)
            if dec:
                for tid in (dec.get("task_ids") or []):
                    _CREATED["task_ids"].add(tid)

        # LLM ideally detects 0 meetings for a simple follow-up
        assert es["meetings"] == 0, f"expected meetings=0 for non-meeting directive, got {es}"

        # No NEW meeting calendar events either
        _, after_events = _get_calendar(auth_headers)
        after_meeting_ids = {e.get("entity_id") for e in _meeting_events(after_events)}
        new_meetings = after_meeting_ids - before_meeting_ids
        assert not new_meetings, f"unexpected new meeting events: {new_meetings}"

    def test_4_execution_summary_shape_regression(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/voice-notes", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        notes = r.json()
        for nid in _CREATED["note_ids"]:
            note = next((n for n in notes if n["id"] == nid), None)
            if not note:
                continue
            es = note.get("execution_summary") or {}
            for k in ("tasks", "assignees", "approvals", "workflows", "meetings", "reminders"):
                assert isinstance(es.get(k), int), f"note {nid} es.{k} not int: {es}"

    def test_5_date_resolver_semantics(self, auth_headers):
        """
        Indirectly verify _resolve_meeting_date via the meeting directive result:
        - All meeting dates from test_2 must be strictly in future (or today), YYYY-MM-DD.
        - Confirm the field 'when_text' isn't required but present as subtitle in cal payload.
        """
        _, all_events = _get_calendar(auth_headers)
        m_events = [e for e in _meeting_events(all_events)
                    if e.get("entity_id") in _CREATED["calendar_event_ids"]]
        assert m_events, "no test-created meeting events found in calendar"
        today_iso = datetime.now(timezone.utc).date().isoformat()
        for ev in m_events:
            assert ev["date"] >= today_iso, f"date {ev['date']} not future: {ev}"
            # subtitle carries 'when_text' — may be empty if LLM omitted, so just type-check
            assert isinstance(ev.get("subtitle", ""), str)


# ------------------------------------------------------------------
# Teardown — clean up all TEST-created data from demo tenant
# ------------------------------------------------------------------

@pytest.fixture(scope="module", autouse=True)
def _cleanup(request, auth_headers):
    yield
    try:
        import motor.motor_asyncio
        import asyncio
        mongo_url = os.environ.get("MONGO_URL")
        db_name = os.environ.get("DB_NAME")
        if not mongo_url:
            env = Path("/app/backend/.env").read_text()
            for line in env.splitlines():
                if line.startswith("MONGO_URL="):
                    mongo_url = line.split("=", 1)[1].strip().strip('"').strip("'")
                if line.startswith("DB_NAME="):
                    db_name = line.split("=", 1)[1].strip().strip('"').strip("'")
        mongo_url = (mongo_url or "").strip().strip('"').strip("'")
        db_name = (db_name or "test_database").strip().strip('"').strip("'")

        async def _clean():
            client = motor.motor_asyncio.AsyncIOMotorClient(mongo_url)
            db = client[db_name]
            note_ids = list(_CREATED["note_ids"])
            dec_ids = list(_CREATED["decision_ids"])
            task_ids = list(_CREATED["task_ids"])
            cal_ids = list(_CREATED["calendar_event_ids"])

            # Also match by transcript text as safety net
            note_query_texts = [MEETING_DIRECTIVE, NO_MEETING_DIRECTIVE]
            extra_notes = await db.voice_notes.find(
                {"transcript": {"$in": note_query_texts}},
                {"id": 1, "decision_id": 1, "_id": 0}
            ).to_list(200)
            for n in extra_notes:
                note_ids.append(n["id"])
                if n.get("decision_id"):
                    dec_ids.append(n["decision_id"])

            # Cascade from decisions → task_ids, workflow_ids (rare, but cover)
            wf_ids = []
            if dec_ids:
                cascade = await db.decisions.find(
                    {"id": {"$in": dec_ids}},
                    {"workflow_ids": 1, "task_ids": 1, "_id": 0}
                ).to_list(200)
                for d in cascade:
                    task_ids.extend(d.get("task_ids") or [])
                    wf_ids.extend(d.get("workflow_ids") or [])

                # Any calendar_events linked to our decisions
                extra_cal = await db.calendar_events.find(
                    {"decision_id": {"$in": dec_ids}},
                    {"id": 1, "_id": 0}
                ).to_list(200)
                for c in extra_cal:
                    cal_ids.append(c["id"])

                # Any source='meeting' tasks linked to our decisions (task.decision_id is None,
                # so match on tenant by fetching all source=meeting tasks the note produced —
                # already tracked via decision.task_ids above)

            note_ids = list(set(note_ids))
            dec_ids = list(set(dec_ids))
            task_ids = list(set(task_ids))
            cal_ids = list(set(cal_ids))
            wf_ids = list(set(wf_ids))

            deleted = {}
            if cal_ids:
                r = await db.calendar_events.delete_many({"id": {"$in": cal_ids}})
                deleted["calendar_events"] = r.deleted_count
            if wf_ids:
                r = await db.workflows.delete_many({"id": {"$in": wf_ids}})
                deleted["workflows"] = r.deleted_count
            if task_ids:
                r = await db.tasks.delete_many({"id": {"$in": task_ids}})
                deleted["tasks"] = r.deleted_count
            # Safety net: source='meeting' tasks created within window that reference our transcripts
            # -- skipped (source=meeting tasks aren't linked to decision_id; already captured via
            # decision.task_ids)
            if dec_ids:
                r = await db.decisions.delete_many({"id": {"$in": dec_ids}})
                deleted["decisions"] = r.deleted_count
            if note_ids:
                r = await db.voice_notes.delete_many({"id": {"$in": note_ids}})
                deleted["voice_notes"] = r.deleted_count
            print(f"[cleanup] deleted: {deleted}")
            client.close()

        asyncio.run(_clean())
    except Exception as e:
        print(f"[cleanup] FAILED: {e}")
