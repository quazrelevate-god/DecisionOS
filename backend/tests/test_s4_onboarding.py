"""Epic 10 Testing -- Sprint 4 (onboarding & signup scenarios).

db-tier: drive the /signup interview endpoint functions directly against an
isolated Mongo db, with the public rate-limit/CAPTCHA guard no-op'd and (where a
follow-up question needs the LLM) claude_chat faked with a fixed JSON reply.
Validates the interview state machine deterministically: the fixed Q1 opener
(now industry-aware when the industry is known, with a localized "why"), the
MIN 2 / MAX 6 adaptive bounds, and back-step re-answer -- no live LLM, no
network.
"""
import json

import routers.signup as sg


async def _noop_guard(request, kind):
    """Stand in for _guard_signup_endpoint (rate-limit + CAPTCHA) -- the guard is
    exercised in T10-04.6, not here."""
    return "127.0.0.1"


class _FakeChat:
    """Minimal claude_chat stand-in. send_message returns a fixed JSON string
    that _extract_json parses; with_model chains back to self."""
    def __init__(self, payload):
        self._payload = payload

    def with_model(self, *a, **k):
        return self

    async def send_message(self, *a, **k):
        return json.dumps(self._payload)


def _patch(testdb, fake_chat=None):
    """Point the signup module at the isolated db + no-op the public guard.
    Optionally swap claude_chat for a fake (for the LLM-on-path scenarios)."""
    saved = (sg.db, sg._guard_signup_endpoint, sg.claude_chat)
    sg.db = testdb
    sg._guard_signup_endpoint = _noop_guard
    if fake_chat is not None:
        sg.claude_chat = lambda *a, **k: fake_chat

    def restore():
        sg.db, sg._guard_signup_endpoint, sg.claude_chat = saved
    return restore


# ---------------------------------------------------------------------------
# T10-04.2 (opener) -- Q1 is a fixed opener: industry-aware when the industry is
# already known, generic otherwise, with the "why" caption in the founder's
# chosen language.
# ---------------------------------------------------------------------------
def test_q1_opener_is_industry_aware_and_why_is_localized(with_test_db):
    async def scenario(db):
        restore = _patch(db)
        try:
            known = await sg.interview_start(sg.InterviewStartInput(
                company_name="Weave Co", founder_name="Ravi Kumar", team_size="11-50",
                industry="Textile & Apparel", business_model="B2B", language_code="en-IN"), None)
            unknown = await sg.interview_start(sg.InterviewStartInput(
                company_name="Mystery Co", founder_name="Asha", team_size="1-10",
                industry="", language_code="en-IN"), None)
            hindi = await sg.interview_start(sg.InterviewStartInput(
                company_name="Kapda Co", industry="Retail / E-commerce",
                language_code="hi-IN"), None)
            return known, unknown, hindi
        finally:
            restore()

    known, unknown, hindi = with_test_db(scenario)
    # industry known -> opener names the industry back + uses the founder's name
    assert "Textile & Apparel" in known["question"] and "Ravi" in known["question"]
    assert known["index"] == 1 and known["max"] == 6
    assert known["why"] == sg.OPENER_WHY["en-IN"]
    # industry unknown -> generic opener that does NOT invent an industry
    assert "Mystery Co" in unknown["question"]
    assert "Textile & Apparel" not in unknown["question"]
    # the "why" caption follows the interview language (localization fix)
    assert hindi["why"] == sg.OPENER_WHY["hi-IN"] != sg.OPENER_WHY["en-IN"]


# ---------------------------------------------------------------------------
# T10-04.2 (max) -- the interview hard-caps at MAX answers: the 6th answer ends
# the interview with no further question, before any LLM call.
# ---------------------------------------------------------------------------
def test_interview_hard_caps_at_max_answers(with_test_db):
    async def scenario(db):
        restore = _patch(db)   # no fake_chat: this path must return BEFORE the LLM
        try:
            await db.signup_sessions.insert_one({
                "id": "cap1", "company_name": "X", "founder_name": "Y", "team_size": "1-10",
                "industry": "Retail / E-commerce",
                "qa": [{"q": f"q{i}", "a": f"a{i}"} for i in range(sg.MAX_QUESTIONS - 1)],
                "pending_q": "final?", "language_code": "en-IN", "status": "active"})
            r = await sg.interview_answer(sg.InterviewAnswerInput(
                session_id="cap1", answer="my last answer"), None)
            doc = await db.signup_sessions.find_one({"id": "cap1"}, {"_id": 0})
            return r, doc["status"], len(doc["qa"])
        finally:
            restore()

    r, status, n = with_test_db(scenario)
    assert r["done"] is True and r["index"] == sg.MAX_QUESTIONS and r["max"] == sg.MAX_QUESTIONS
    assert status == "done" and n == sg.MAX_QUESTIONS, "the MAX-th answer hard-stops with no further question"


# ---------------------------------------------------------------------------
# T10-04.2 (min) -- the MIN floor overrides an early LLM 'enough': even if Dex
# says the picture is clear after one answer, the interview keeps going until at
# least MIN answers exist.
# ---------------------------------------------------------------------------
def test_min_floor_overrides_early_enough(with_test_db):
    async def scenario(db):
        fake = _FakeChat({"question": "Who covers sales when you travel?",
                          "why": "backup coverage", "enough": True})
        restore = _patch(db, fake_chat=fake)
        try:
            await db.signup_sessions.insert_one({
                "id": "min1", "company_name": "Glow", "founder_name": "Meera", "team_size": "1-10",
                "industry": "Beauty & Wellness", "qa": [], "pending_q": "opener?",
                "language_code": "en-IN", "status": "active"})
            # first answer -> qa length 1; the LLM says enough=true but MIN is 2
            r = await sg.interview_answer(sg.InterviewAnswerInput(
                session_id="min1", answer="I run a two-chair salon"), None)
            doc = await db.signup_sessions.find_one({"id": "min1"}, {"_id": 0})
            return r, doc["status"]
        finally:
            restore()

    r, status = with_test_db(scenario)
    assert r["done"] is False, "an LLM 'enough' below the MIN floor must NOT end the interview"
    assert r["question"] and status != "done", "it asks the next question and stays active"


# ---------------------------------------------------------------------------
# T10-04.2 (back) -- back-step pops the last answered Q&A and re-opens it,
# returning the previous answer so the founder can edit and re-send.
# ---------------------------------------------------------------------------
def test_back_step_reopens_last_question_with_prior_answer(with_test_db):
    async def scenario(db):
        restore = _patch(db)
        try:
            await db.signup_sessions.insert_one({
                "id": "back1", "company_name": "X", "founder_name": "Y",
                "qa": [{"q": "q1?", "a": "answer one"}, {"q": "q2?", "a": "answer two"}],
                "pending_q": "q3?", "language_code": "en-IN", "status": "active"})
            r = await sg.interview_back(sg.InterviewSessionInput(session_id="back1"), None)
            doc = await db.signup_sessions.find_one({"id": "back1"}, {"_id": 0})
            return r, doc["qa"], doc["pending_q"]
        finally:
            restore()

    r, qa, pending = with_test_db(scenario)
    assert r["question"] == "q2?" and r["prev_answer"] == "answer two"
    assert len(qa) == 1 and pending == "q2?", "the last Q&A is popped and re-opened for editing"


# ---------------------------------------------------------------------------
# T10-04.5 -- DPDP consent gate: AI features are unavailable (451) until the
# workspace owner grants consent on the CURRENT version; a stale grant needs
# re-consent, a revoked grant is inactive.
# ---------------------------------------------------------------------------
def test_dpdp_consent_451_gate():
    from fastapi import HTTPException
    from services.ai_consent import (
        has_active_consent, require_ai_consent, consent_status,
        build_grant_payload, CURRENT_CONSENT_VERSION)

    # 1. no consent at all -> gate closed (451)
    bare = {"id": "t1"}
    assert has_active_consent(bare) is False
    try:
        require_ai_consent(bare); raised = None
    except HTTPException as e:
        raised = e
    assert raised is not None and raised.status_code == 451
    assert raised.detail["code"] == "ai_consent_required"

    # 2. a fresh grant on the current version -> gate open, no raise
    granted = {"id": "t2", "ai_consent": build_grant_payload(
        actor_user_id="o1", actor_email="Owner@Co.com")}
    assert has_active_consent(granted) is True
    require_ai_consent(granted)  # must NOT raise
    assert granted["ai_consent"]["version"] == CURRENT_CONSENT_VERSION

    # 3. a STALE grant (older version) -> gate closed, flagged needs_reconsent
    stale = {"id": "t3", "ai_consent": {"granted_at": "2026-01-01T00:00:00+00:00",
                                        "revoked_at": None, "version": "0.9"}}
    assert has_active_consent(stale) is False
    st = consent_status(stale)
    assert st["needs_reconsent"] is True and st["active"] is False
    try:
        require_ai_consent(stale); stale_raised = None
    except HTTPException as e:
        stale_raised = e
    assert stale_raised.status_code == 451 and stale_raised.detail["needs_reconsent"] is True

    # 4. a REVOKED grant -> gate closed, but NOT needs_reconsent (they opted out)
    revoked = {"id": "t4", "ai_consent": {"granted_at": "2026-06-01T00:00:00+00:00",
                                          "revoked_at": "2026-07-01T00:00:00+00:00",
                                          "version": CURRENT_CONSENT_VERSION}}
    assert has_active_consent(revoked) is False
    assert consent_status(revoked)["needs_reconsent"] is False


# ---------------------------------------------------------------------------
# T10-04.4 -- website-intel SSRF guard + graceful fallback: internal/metadata
# URLs are refused (400) before any fetch; an unreachable public URL degrades to
# {"fetched": False} so onboarding can continue.
# ---------------------------------------------------------------------------
class _FakeHTTPX:
    """httpx stand-in whose client always fails the GET (simulates an
    unreachable host) -- keeps the fallback test fully offline."""
    class AsyncClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, url):
            raise RuntimeError("simulated unreachable host")


def test_website_intel_ssrf_block_and_fallback(with_test_db):
    from fastapi import HTTPException

    async def scenario(db):
        restore = _patch(db)
        blocked = []
        try:
            # SSRF: private / loopback / cloud-metadata targets are refused (400)
            for bad in ("http://169.254.169.254/latest/meta-data/", "http://127.0.0.1/",
                        "http://10.0.0.5/admin", "http://192.168.1.1/"):
                try:
                    await sg.website_intel(sg.WebsiteIntelInput(url=bad, company_name="X"), None)
                    blocked.append(("no-raise", bad))
                except HTTPException as e:
                    blocked.append((e.status_code, bad))

            # Fallback: a public but unreachable URL -> graceful {"fetched": False}
            saved_httpx, saved_safe = sg.httpx, sg.is_url_safe_for_fetch
            sg.httpx = _FakeHTTPX
            sg.is_url_safe_for_fetch = lambda u: (True, "")
            try:
                fb = await sg.website_intel(sg.WebsiteIntelInput(
                    url="https://unreachable.example.com", company_name="X"), None)
            finally:
                sg.httpx, sg.is_url_safe_for_fetch = saved_httpx, saved_safe
            return blocked, fb
        finally:
            restore()

    blocked, fb = with_test_db(scenario)
    assert all(code == 400 for code, _ in blocked), f"every internal URL must be refused 400: {blocked}"
    assert fb == {"fetched": False}, "an unreachable URL degrades gracefully so onboarding continues"


# ---------------------------------------------------------------------------
# T10-04.7 -- draft persistence + resume: HMAC token gates access, only valid
# step keys persist, register merges the draft (client wins) and completion
# freezes further edits.
# ---------------------------------------------------------------------------
def test_draft_hmac_token_round_trip():
    from services.auth.draft_tokens import sign_draft_id, verify_draft_token
    tok = sign_draft_id("draft-abc")
    assert tok and verify_draft_token("draft-abc", tok) is True
    assert verify_draft_token("draft-abc", tok + "x") is False, "a tampered token is rejected"
    assert verify_draft_token("draft-xyz", tok) is False, "a token for another draft is rejected"
    assert verify_draft_token("draft-abc", None) is False and verify_draft_token("", tok) is False


def test_draft_persist_valid_steps_resume_and_freeze_on_complete(with_test_db):
    from services.auth import onboarding_drafts as dsvc

    async def scenario(db):
        d = await dsvc.create_draft(db, email="Founder@Co.com")
        did = d["id"]
        # a valid step persists under step_data
        ok = await dsvc.patch_draft(db, did, "about",
                                    {"company_name": "Weave Co", "industry": "Textile & Apparel"})
        # an invalid step key is refused (nothing stashed)
        bad = await dsvc.patch_draft(db, did, "evil_blob", {"x": 1})
        # resume: get returns the full draft with the saved step
        resumed = await dsvc.get_draft(db, did)
        # completion freezes further edits
        await dsvc.mark_completed(db, did, tenant_id="t-new")
        after = await dsvc.patch_draft(db, did, "team", {"members": []})
        done = await dsvc.get_draft(db, did)
        return (ok is not None, bad, resumed["step_data"].get("about"),
                d["email"], after, done.get("completed_at"), done.get("tenant_id"))

    ok, bad, about, email, after, completed_at, tid = with_test_db(scenario)
    assert ok and about == {"company_name": "Weave Co", "industry": "Textile & Apparel"}
    assert bad is None, "an unknown step key is rejected -- no arbitrary data stashed"
    assert email == "founder@co.com", "email is normalized lowercase on create"
    assert after is None, "a completed draft blocks further step edits"
    assert completed_at and tid == "t-new", "completion is recorded with the tenant crumb"


def test_draft_merge_into_register_client_wins():
    from services.auth.onboarding_drafts import merge_draft_into_register_input
    draft = {"step_data": {"about": {
        "company_name": "Draft Weaves", "industry": "Textile & Apparel",
        "description": "handloom exporter"}}}
    provided = {"company_name": "Final Weaves Pvt Ltd", "email": "f@co.com"}
    merged = merge_draft_into_register_input(draft, provided)
    assert merged["company_name"] == "Final Weaves Pvt Ltd", "client-provided value wins over the draft"
    assert merged["industry"] == "Textile & Apparel", "a value only in the draft falls through"
    assert merged["description"] == "handloom exporter"


# ===========================================================================
# T10-04.3 -- AI-generation status tracking: each generator records
# generated|defaulted|failed; owner retry re-runs only the non-generated ones.
# ===========================================================================
def test_ai_setup_status_classification(with_test_db):
    """with_status wrappers classify a live/meaningful result as generated, an
    empty (fallback) result as defaulted, and a raising generator as failed."""
    from services.ai import ai_setup as aset
    from services.ai import generators as gen

    async def scenario(_db):
        saved = gen.ai_generate_lexicon
        try:
            async def meaningful(*a, **k):
                return {"terms": ["purchase order", "dispatch"]}
            gen.ai_generate_lexicon = meaningful
            _, s_gen = await aset.ai_generate_lexicon_with_status("Textile", "11-50", [], "")

            async def empty(*a, **k):
                return {}
            gen.ai_generate_lexicon = empty
            _, s_def = await aset.ai_generate_lexicon_with_status("Textile", "11-50", [], "")

            async def boom(*a, **k):
                raise RuntimeError("LLM down")
            gen.ai_generate_lexicon = boom
            _, s_fail = await aset.ai_generate_lexicon_with_status("Textile", "11-50", [], "")
            return s_gen, s_def, s_fail
        finally:
            gen.ai_generate_lexicon = saved

    s_gen, s_def, s_fail = with_test_db(scenario)
    assert s_gen == aset.STATUS_GENERATED, "a meaningful AI result records generated"
    assert s_def == aset.STATUS_DEFAULTED, "an empty/fallback result records defaulted"
    assert s_fail == aset.STATUS_FAILED, "a raising generator records failed"


def test_summarize_ai_setup_status():
    from services.ai.ai_setup import (summarize_ai_setup_status,
                                       STATUS_GENERATED, STATUS_DEFAULTED, STATUS_FAILED)
    s = summarize_ai_setup_status({"lexicon": STATUS_GENERATED,
                                   "operating_model": STATUS_DEFAULTED,
                                   "finance_categories": STATUS_FAILED})
    assert s["healthy"] is False
    assert set(s["needs_retry"]) == {"operating_model", "finance_categories"}
    healthy = summarize_ai_setup_status({"lexicon": STATUS_GENERATED,
                                         "operating_model": STATUS_GENERATED,
                                         "finance_categories": STATUS_GENERATED})
    assert healthy["healthy"] is True and healthy["needs_retry"] == []


def test_owner_retry_reruns_only_non_generated(with_test_db):
    """retry_ai_setup re-runs the generators that are defaulted/failed and leaves
    an already-generated one untouched (idempotent)."""
    import routers.onboarding as ob
    from services.ai import ai_setup as aset

    async def scenario(db):
        calls = []
        saved = (ob.db, ob.log_activity,
                 aset.ai_generate_lexicon_with_status,
                 aset.ai_generate_operating_model_with_status,
                 aset.ai_generate_finance_categories_with_status)
        ob.db = db

        async def _noop_log(*a, **k):
            return None
        ob.log_activity = _noop_log

        def _mk(name, data):
            async def _f(*a, **k):
                calls.append(name)
                return data, aset.STATUS_GENERATED
            return _f
        aset.ai_generate_lexicon_with_status = _mk("lexicon", {"terms": ["x"]})
        aset.ai_generate_operating_model_with_status = _mk("operating_model", {"pipelines": [1]})
        aset.ai_generate_finance_categories_with_status = _mk("finance_categories", {"expense": [1, 2]})
        try:
            await db.tenants.insert_one({
                "id": "t1", "name": "Weave Co", "industry": "Textile & Apparel",
                "roles": [], "ai_setup_status": {
                    "lexicon": aset.STATUS_GENERATED,             # already good -> must be skipped
                    "operating_model": aset.STATUS_FAILED,        # -> re-run
                    "finance_categories": aset.STATUS_DEFAULTED,  # -> re-run
                }})
            res = await ob.retry_ai_setup(user={"tenant_id": "t1", "id": "u1", "name": "Owner"})
            doc = await db.tenants.find_one({"id": "t1"}, {"_id": 0})
            return calls, doc["ai_setup_status"], res
        finally:
            (ob.db, ob.log_activity,
             aset.ai_generate_lexicon_with_status,
             aset.ai_generate_operating_model_with_status,
             aset.ai_generate_finance_categories_with_status) = saved

    calls, status_map, res = with_test_db(scenario)
    assert "lexicon" not in calls, "an already-generated generator is NOT re-run (idempotent)"
    assert set(calls) == {"operating_model", "finance_categories"}, "only the non-generated ones re-run"
    assert all(v == aset.STATUS_GENERATED for v in status_map.values()), "after retry every generator is generated"
    assert res["status"] == "ok" and res["ai_setup_status"]["healthy"] is True


# ===========================================================================
# T10-04.6 -- abuse / rate limits: the sliding window admits up to the cap then
# refuses (429), and the shared signup guard enforces the burst ceiling per IP.
# ===========================================================================
def test_sliding_window_admits_to_cap_then_refuses():
    import asyncio
    from services.rate_limit import check_rate_limit, reset_for_test

    async def run():
        await reset_for_test()
        cap, window, bucket, key = 5, 10, "t46", "1.1.1.1"
        results = [await check_rate_limit(key, cap, window, bucket=bucket) for _ in range(cap + 2)]
        other = await check_rate_limit("2.2.2.2", cap, window, bucket=bucket)  # independent bucket
        await reset_for_test()
        return results, other

    results, other = asyncio.run(run())
    allowed = [ok for ok, _ in results]
    assert allowed[:5] == [True] * 5, "the first `cap` hits are admitted"
    assert allowed[5] is False and allowed[6] is False, "hits past the cap are refused"
    assert results[5][1] > 0, "a refusal returns a positive Retry-After"
    assert other[0] is True, "a different IP is an independent bucket"


def test_signup_guard_enforces_burst_429(with_test_db):
    from fastapi import HTTPException
    from services.rate_limit import reset_for_test
    import routers.signup as sg

    class _Req:
        def __init__(self, ip):
            self.headers = {"X-Forwarded-For": ip}
            self.client = None

    async def scenario(_db):
        await reset_for_test()
        req = _Req("203.0.113.7")
        statuses = []
        try:
            for _ in range(sg._SIGNUP_BURST_LIMIT[0] + 2):   # burst cap + 2 hits from one IP
                try:
                    await sg._guard_signup_endpoint(req, "website_intel")
                    statuses.append("ok")
                except HTTPException as e:
                    statuses.append(e.status_code)
        finally:
            await reset_for_test()
        return statuses

    statuses = with_test_db(scenario)
    cap = sg._SIGNUP_BURST_LIMIT[0]
    assert statuses[:cap] == ["ok"] * cap, f"the first {cap} signup hits from an IP pass"
    assert 429 in statuses[cap:], f"the burst ceiling refuses with 429: {statuses}"
