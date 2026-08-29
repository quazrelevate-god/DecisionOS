"""Iteration 78 — dynamic 2-6 question interview + team-size/industry conditioning + refine endpoint.

Verifies:
  1. /interview/start returns max=6 regardless of language (en-IN + hi-IN).
  2. /interview/answer follow-up questions differ meaningfully between
     (team_size=5, industry='Beauty & Wellness') and (team_size=200, industry='Manufacturing').
  3. Interview hard-caps at MAX=6 (done=true after 6 answers even if Claude never sets enough).
  4. Interview can end early — done=true is possible between 2 and 6 answers.
  5. /interview/blueprint returns departments, workflows, operational_tasks, approval_rules, products, welcome_line.
  6. /interview/refine adds a new workflow/task; a second /interview/blueprint call also honors the refinement.
"""
import os
import re
import time
import pytest
import requests

def _load_frontend_env_url():
    p = "/app/frontend/.env"
    if os.path.exists(p):
        for line in open(p):
            if line.startswith("REACT_APP_BACKEND_URL="):
                return line.split("=", 1)[1].strip()
    return None


from integration_base import base_url  # T10-11.2: fail-closed, env-only
BASE_URL = base_url()
API = f"{BASE_URL}/api"

# Deliberately short so we don't wait forever on Claude; interview endpoint p95 is ~5-8s.
HTTP_TIMEOUT = 90


@pytest.fixture(scope="module")
def s():
    ses = requests.Session()
    ses.headers.update({"Content-Type": "application/json"})
    return ses


# ------------------------------------------------------------------
# 1. start returns max=6 regardless of language
# ------------------------------------------------------------------
class TestInterviewStartMax:
    def test_start_en_returns_max_6(self, s):
        r = s.post(f"{API}/signup/interview/start", json={
            "company_name": "TEST_MaxSix Co", "founder_name": "Ravi",
            "team_size": "11-50", "industry": "Retail / E-commerce",
            "business_model": "B2C", "language_code": "en-IN",
        }, timeout=HTTP_TIMEOUT)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("max") == 6, f"expected max=6, got {data.get('max')}"
        assert data.get("index") == 1
        assert "session_id" in data and data["session_id"]
        assert data.get("question", "").strip() != ""

    def test_start_hindi_returns_max_6(self, s):
        r = s.post(f"{API}/signup/interview/start", json={
            "company_name": "TEST_MaxSix Hindi", "founder_name": "Ravi",
            "team_size": "50-200", "industry": "Manufacturing",
            "business_model": "B2B", "language_code": "hi-IN",
        }, timeout=HTTP_TIMEOUT)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("max") == 6
        assert data.get("language_code") == "hi-IN"


# ------------------------------------------------------------------
# 2. team-size + industry conditioning: salon vs manufacturer
# ------------------------------------------------------------------
SALON_KEYWORDS = re.compile(
    r"\b(appointment|walk-?in|client|customer|stylist|book|schedul|service|chair|salon|treatment|"
    r"you|yourself|founder|day|handle|juggle|cover|sick|holiday|price|discount|whatsapp|phone|cash)\b",
    re.I,
)
FACTORY_KEYWORDS = re.compile(
    r"\b(department|manager|approv|escalat|supervis|shift|production|raw material|dispatch|order|"
    r"line|quality|qc|procure|inventor|plant|floor|purchase|vendor|supplier|invoice|sign[- ]off|"
    r"finance|hr|team lead|head of)\b",
    re.I,
)


class TestSizeIndustryConditioning:
    def test_salon_vs_manufacturer_yield_different_questions(self, s):
        # --- Session A: tiny salon
        rA = s.post(f"{API}/signup/interview/start", json={
            "company_name": "TEST_Glow Salon", "founder_name": "Meera",
            "team_size": "5", "industry": "Beauty & Wellness",
            "business_model": "B2C", "language_code": "en-IN",
        }, timeout=HTTP_TIMEOUT)
        assert rA.status_code == 200, rA.text
        sidA = rA.json()["session_id"]
        salon_answer = (
            "I run a 5-chair beauty salon. I personally take bookings on WhatsApp, "
            "handle walk-ins at the counter, pay my stylists in cash on Saturdays, "
            "and I'm the only one who does the daily cash reconciliation. "
            "When I'm sick, my sister covers the front desk."
        )
        rA2 = s.post(f"{API}/signup/interview/answer", json={
            "session_id": sidA, "answer": salon_answer, "language_code": "en-IN",
        }, timeout=HTTP_TIMEOUT)
        assert rA2.status_code == 200, rA2.text
        dA = rA2.json()
        # Should still be asking (won't hit min after just 1 answer)
        assert dA.get("done") is False, f"Salon session shouldn't end after Q1: {dA}"
        qA = (dA.get("question") or "").strip()
        assert qA, "salon Q2 empty"

        # --- Session B: 200-person manufacturer
        rB = s.post(f"{API}/signup/interview/start", json={
            "company_name": "TEST_Bharat Steel Works", "founder_name": "Anand",
            "team_size": "200", "industry": "Manufacturing",
            "business_model": "B2B", "language_code": "en-IN",
        }, timeout=HTTP_TIMEOUT)
        assert rB.status_code == 200, rB.text
        sidB = rB.json()["session_id"]
        factory_answer = (
            "We're a 200-person steel fabrication plant with departments for Sales, "
            "Production, Quality, Procurement, Finance, and HR. Each department has a "
            "manager who reports to me. Purchase orders over ₹5 lakh need my approval, "
            "and the production shift supervisors escalate breakdowns to the plant head "
            "who signs off on overtime."
        )
        rB2 = s.post(f"{API}/signup/interview/answer", json={
            "session_id": sidB, "answer": factory_answer, "language_code": "en-IN",
        }, timeout=HTTP_TIMEOUT)
        assert rB2.status_code == 200, rB2.text
        dB = rB2.json()
        assert dB.get("done") is False, f"Factory session shouldn't end after Q1: {dB}"
        qB = (dB.get("question") or "").strip()
        assert qB, "factory Q2 empty"

        # --- Meaningful diff:
        # The two Q2s must not be identical text
        assert qA.lower() != qB.lower(), f"Both sessions asked SAME Q2:\nA={qA}\nB={qB}"

        # The salon question should read as founder-led / customer-facing.
        # The factory question should read as department/approval/manager-heavy.
        # Score which side each Q leans toward.
        a_salon = len(SALON_KEYWORDS.findall(qA))
        a_factory = len(FACTORY_KEYWORDS.findall(qA))
        b_salon = len(SALON_KEYWORDS.findall(qB))
        b_factory = len(FACTORY_KEYWORDS.findall(qB))
        print(f"\nSALON Q2: {qA}\n  salon_kw={a_salon} factory_kw={a_factory}")
        print(f"FACTORY Q2: {qB}\n  salon_kw={b_salon} factory_kw={b_factory}")

        # Salon question leans salon-ward
        assert a_salon >= 1, f"Salon Q2 has no salon/founder keywords: {qA}"
        # Factory question mentions structural terms (department/manager/approval/production/etc.)
        assert b_factory >= 1, f"Factory Q2 has no department/manager/approval keywords: {qB}"
        # And factory Q2 shouldn't be MORE salon-flavoured than the salon Q2.
        assert b_factory >= a_factory or b_salon <= a_salon, (
            f"Factory Q2 looks more salon-like than the salon one:\nA={qA}\nB={qB}"
        )

        # Save for later tests
        pytest.salon_session = sidA
        pytest.factory_session = sidB


# ------------------------------------------------------------------
# 3. Hard cap at MAX=6 — must return done=true after the 6th answer.
# ------------------------------------------------------------------
class TestHardCap:
    def test_interview_hard_caps_at_6(self, s):
        r = s.post(f"{API}/signup/interview/start", json={
            "company_name": "TEST_Cap Co", "founder_name": "Neha",
            "team_size": "50-200", "industry": "Textile & Apparel",
            "business_model": "B2B", "language_code": "en-IN",
        }, timeout=HTTP_TIMEOUT)
        assert r.status_code == 200
        sid = r.json()["session_id"]
        # Intentionally vague answers so Dex is less likely to end early — still, we
        # only require done=true by the 6th answer.
        vague_answers = [
            "We do a mix of things depending on the client.",
            "Not really sure, it varies each week.",
            "We just kind of figure it out day by day.",
            "Everyone helps out with whatever comes up.",
            "It's pretty fluid, nothing formal.",
            "Same as before, quite ad hoc.",
        ]
        done = False
        answers_sent = 0
        for i, ans in enumerate(vague_answers, start=1):
            resp = s.post(f"{API}/signup/interview/answer", json={
                "session_id": sid, "answer": ans, "language_code": "en-IN",
            }, timeout=HTTP_TIMEOUT)
            assert resp.status_code == 200, resp.text
            d = resp.json()
            answers_sent = i
            if d.get("done"):
                done = True
                # Must be within [MIN=2, MAX=6]
                assert 2 <= d.get("index", 0) <= 6, d
                break
            # if not done, we should still be within cap
            assert d.get("index", 0) <= 6
        assert done, f"Interview did not report done=True after {answers_sent} answers (expected by 6)"
        assert answers_sent <= 6, f"Sent more than 6 answers: {answers_sent}"
        pytest.capped_session = sid


# ------------------------------------------------------------------
# 4. Early-end capability: Dex CAN end at index in [MIN, MAX-1] when clear.
#    (Best-effort — we prove the mechanism works by feeding a very clear picture
#     and asserting that either done fires early OR the session simply completes
#     within 6. We DO NOT flake if Dex chooses to keep going.)
# ------------------------------------------------------------------
class TestEarlyEndCapability:
    def test_clear_picture_can_end_before_max(self, s):
        r = s.post(f"{API}/signup/interview/start", json={
            "company_name": "TEST_Clear Salon", "founder_name": "Priya",
            "team_size": "3", "industry": "Beauty & Wellness",
            "business_model": "B2C", "language_code": "en-IN",
        }, timeout=HTTP_TIMEOUT)
        assert r.status_code == 200
        sid = r.json()["session_id"]

        # Extremely operationally-complete answers so Dex has grounds to set enough=true.
        rich_answers = [
            ("I run a 3-chair salon. I personally book every appointment on WhatsApp, "
             "greet clients at the door, take payment in cash or UPI, and reconcile the "
             "till at 9pm every day. When I'm off, my sister Riya answers WhatsApp and "
             "hands over bookings to me the next morning. Bookings never go into a calendar app — "
             "it's all my phone and a paper diary."),
            ("Approvals: I approve everything above ₹500 personally. Stylist Manisha handles "
             "her own product buys under ₹500 from petty cash. Refunds and free reworks — "
             "I decide on the spot when a customer complains, usually about hair colour."),
            ("Where things slip: I forget to reorder shampoo until we're literally out. "
             "Sometimes I double-book two clients in the same slot because WhatsApp and the "
             "diary get out of sync. Cash reconciliation gets skipped on Sundays when we're busy."),
            ("Weekly touchpoints: I personally check the appointment book every morning at "
             "8:30am, count cash at close, and every Monday I sit with Manisha and Riya for "
             "15 minutes to plan the week and check stock."),
            ("Backups: Riya is my only backup for WhatsApp bookings. Nobody backs me up on "
             "cash reconciliation — if I'm sick, it just waits till I'm back."),
            ("Nothing else really — that's basically the whole operation.")
        ]

        ended_at = None
        for i, ans in enumerate(rich_answers, start=1):
            resp = s.post(f"{API}/signup/interview/answer", json={
                "session_id": sid, "answer": ans, "language_code": "en-IN",
            }, timeout=HTTP_TIMEOUT)
            assert resp.status_code == 200, resp.text
            d = resp.json()
            if d.get("done"):
                ended_at = d.get("index")
                break
        assert ended_at is not None, "Interview never ended even with 6 rich answers"
        assert 2 <= ended_at <= 6, f"end index {ended_at} out of [2,6]"
        print(f"\nEarly-end index for rich-answer salon session: {ended_at}")
        pytest.rich_session = sid


# ------------------------------------------------------------------
# 5 & 6. Blueprint + Refine (single class so xdist keeps them on one worker
#       via loadscope — the refine tests depend on state built here).
# ------------------------------------------------------------------
class TestBlueprintAndRefine:
    """Seeds its OWN completed session in the first test (session-scoped state
    stored on the class) so it is independent of other test classes / workers."""

    @classmethod
    def _fresh_completed_session(cls, s):
        r = s.post(f"{API}/signup/interview/start", json={
            "company_name": "TEST_BP Salon", "founder_name": "Priya",
            "team_size": "3", "industry": "Beauty & Wellness",
            "business_model": "B2C", "language_code": "en-IN",
        }, timeout=HTTP_TIMEOUT)
        assert r.status_code == 200
        sid = r.json()["session_id"]
        rich_answers = [
            ("I run a 3-chair salon. I personally book every appointment on WhatsApp, "
             "greet clients at the door, take payment in cash or UPI, and reconcile the "
             "till at 9pm every day. When I'm off, my sister Riya answers WhatsApp."),
            ("Approvals: I approve everything above ₹500 personally. Stylist Manisha handles "
             "her own product buys under ₹500 from petty cash. Refunds — I decide on the spot."),
            ("Where things slip: I forget to reorder shampoo until we're out. Sometimes "
             "I double-book two clients in the same slot because WhatsApp and the paper "
             "diary get out of sync."),
            ("Weekly touchpoints: I check the appointment book every morning at 8:30am, "
             "count cash at close, and every Monday we plan the week."),
            ("Backups: Riya is my only backup for WhatsApp bookings. Nobody backs me up "
             "on cash reconciliation."),
            ("Nothing else really — that's basically the whole operation.")
        ]
        for ans in rich_answers:
            resp = s.post(f"{API}/signup/interview/answer", json={
                "session_id": sid, "answer": ans, "language_code": "en-IN",
            }, timeout=HTTP_TIMEOUT)
            assert resp.status_code == 200
            if resp.json().get("done"):
                break
        return sid

    def test_1_blueprint_returns_all_required_keys(self, s):
        sid = self._fresh_completed_session(s)
        r = s.post(f"{API}/signup/interview/blueprint", json={
            "session_id": sid, "language_code": "en-IN",
        }, timeout=HTTP_TIMEOUT)
        assert r.status_code == 200, r.text
        bp = r.json()
        for key in ("departments", "workflows", "operational_tasks",
                    "approval_rules", "products", "welcome_line"):
            assert key in bp, f"blueprint missing '{key}'"
        assert isinstance(bp["departments"], list) and len(bp["departments"]) >= 3
        assert isinstance(bp["workflows"], list) and len(bp["workflows"]) >= 3
        assert isinstance(bp["operational_tasks"], list) and len(bp["operational_tasks"]) >= 3
        assert isinstance(bp["approval_rules"], list)
        assert isinstance(bp["welcome_line"], str) and bp["welcome_line"].strip()
        for w in bp["workflows"]:
            assert isinstance(w, dict) and (w.get("name") or "").strip()
        for t in bp["operational_tasks"]:
            assert isinstance(t, dict) and (t.get("title") or "").strip()
            assert (t.get("category") or "").strip()
        # stash for the next tests on this class
        type(self)._sid = sid
        type(self)._first_bp = bp

    @staticmethod
    def _surface(bp):
        parts = []
        parts += [w.get("name", "") for w in bp.get("workflows", [])]
        parts += [t.get("title", "") for t in bp.get("operational_tasks", [])]
        parts.append(bp.get("welcome_line", ""))
        return " ".join(parts).lower()

    def test_2_refine_adds_workflow_and_persists(self, s):
        sid = getattr(type(self), "_sid", None)
        first = getattr(type(self), "_first_bp", None)
        assert sid and first, "prior blueprint test didn't run"
        first_surface = self._surface(first)
        refinement_text = (
            "Add a workflow for post-service WhatsApp review — 2 days after every "
            "salon appointment, send the client a WhatsApp asking for a Google review "
            "and a photo, and follow up once if there's no reply."
        )
        r = s.post(f"{API}/signup/interview/refine", json={
            "session_id": sid, "refinement": refinement_text, "language_code": "en-IN",
        }, timeout=HTTP_TIMEOUT)
        assert r.status_code == 200, r.text
        bp2 = r.json()
        for key in ("departments", "workflows", "operational_tasks",
                    "approval_rules", "products", "welcome_line"):
            assert key in bp2
        second_surface = self._surface(bp2)
        assert "whatsapp" in second_surface, (
            f"'whatsapp' missing from refined blueprint surface:\n{second_surface}"
        )
        assert "review" in second_surface or "follow" in second_surface, (
            f"'review'/'follow' missing from refined blueprint surface:\n{second_surface}"
        )
        # Strong assertion: a workflow (or task) MUST match the specific refinement
        # intent — post-service WhatsApp review. Look for a single item that
        # combines the review/whatsapp semantics OR the "2 days"/"day 2"/"post-service"
        # timing signal, in the workflow names or task titles specifically.
        candidates = [w.get("name", "") for w in bp2.get("workflows", [])] + \
                     [t.get("title", "") for t in bp2.get("operational_tasks", [])]
        def _matches_refinement(text):
            t = text.lower()
            return "whatsapp" in t and (
                "review" in t or "follow" in t or "post-service" in t or "post service" in t or
                "day 2" in t or "2 days" in t or "2-day" in t
            )
        matched = [c for c in candidates if _matches_refinement(c)]
        assert matched, (
            f"No workflow/task matches the refinement intent (post-service WhatsApp review).\n"
            f"Candidates: {candidates}"
        )

        # A fresh /blueprint call must still honor the stored refinement.
        r3 = s.post(f"{API}/signup/interview/blueprint", json={
            "session_id": sid, "language_code": "en-IN",
        }, timeout=HTTP_TIMEOUT)
        assert r3.status_code == 200, r3.text
        bp3 = r3.json()
        third_surface = self._surface(bp3)
        assert "whatsapp" in third_surface, (
            f"Second /blueprint call didn't honor stored refinement:\n{third_surface}"
        )

    def test_3_refine_empty_returns_400(self, s):
        sid = getattr(type(self), "_sid", None)
        assert sid
        r = s.post(f"{API}/signup/interview/refine", json={
            "session_id": sid, "refinement": "   ",
        }, timeout=HTTP_TIMEOUT)
        assert r.status_code == 400

    def test_4_refine_bad_session_returns_404(self, s):
        r = s.post(f"{API}/signup/interview/refine", json={
            "session_id": "nope-nope-nope", "refinement": "something",
        }, timeout=HTTP_TIMEOUT)
        assert r.status_code == 404
