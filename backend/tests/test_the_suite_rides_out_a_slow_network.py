"""The suite rides out a slow network instead of going red (2026-10-02).

Four tests had been failing intermittently for three sessions -- always under
the suite's two parallel workers, always green when run alone:

    test_s5_niches::test_textile_baseline_full_flow          (pymongo error)
    test_s2_functional::test_decision_approve_and_reject_lifecycle
    test_s8_isolation_scenarios::test_tenant_deletion_removes_A_and_keeps_B
    test_s4_onboarding::test_q1_opener_is_industry_aware_and_why_is_localized

"Flaky test" was the wrong diagnosis. None of them is nondeterministic: the
last one builds its opener from a TEMPLATE, not a model, so there is no AI
variance to blame. What they share is the only thing they all touch -- the
`with_test_db` fixture, which opens a connection to a REMOTE database.

MEASURED FROM THIS MACHINE, against the live test host:

    warm connect + ping     1.26s, 1.28s, 1.29s, 1.31s   (fresh processes)
    bursts of 8 and 16      median 1.3s, max 1.43s, no errors
    one transient           8.16 SECONDS

and the budget was serverSelectionTimeoutMS=8000. So a hiccup of that size
did not make a test slow, it made it FAIL -- and the traceback pointed at
whichever test was unlucky, which is why it was read as four flaky tests
rather than one tight timeout.

Server selection retries throughout its window, so widening it costs nothing
when the network is healthy (still ~1.3s) and absorbs the hiccup when it is
not. This file pins the budget so nobody tightens it back without meeting the
measurement first.
"""
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
CONFTEST = (HERE / "conftest.py").read_text(encoding="utf-8")
LIVE = (HERE / "_live_harness.py").read_text(encoding="utf-8")


def test_the_isolated_db_fixture_can_outlast_a_hiccup():
    assert "serverSelectionTimeoutMS=30000" in CONFTEST
    assert "serverSelectionTimeoutMS=8000" not in CONFTEST


def test_the_live_harness_uses_the_same_budget():
    """It talks to the same remote host, so it had the same 8s cliff."""
    assert "serverSelectionTimeoutMS=8000" not in LIVE
    assert LIVE.count("serverSelectionTimeoutMS=30000") == 2


def test_a_scenario_does_not_ask_for_a_hundred_sockets():
    """One database, one coroutine. The default ceiling was pressure on the
    remote for nothing, ~400 times a run."""
    assert "maxPoolSize=8" in CONFTEST


def test_the_measurement_is_written_down_next_to_the_number():
    """The next person to see a slow suite will want to tighten this. The
    numbers that justify it have to be where they will look."""
    at = CONFTEST.index("serverSelectionTimeoutMS=30000")
    note = CONFTEST[at - 1200:at]
    assert "8.16" in note, "the transient that was actually measured"
    assert "1.3s" in note, "and the healthy case it is compared against"
    assert "retries" in note.lower(), "why a wider budget is not a slower suite"


def test_no_test_path_still_carries_the_old_cliff():
    """Scripts under scripts/ are an operator's problem, not the suite's."""
    mine = Path(__file__).name          # this file QUOTES the old number
    for f in HERE.glob("*.py"):
        if f.name == mine:
            continue
        for n, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
            if "serverSelectionTimeoutMS=8000" not in line:
                continue
            if line.strip().startswith(("#", '"', "'", "*")):
                continue
            raise AssertionError(f"{f.name}:{n} still gives up at 8s")


def test_the_opener_flake_had_no_ai_in_it():
    """Recorded because it was nearly dismissed as model variance, which
    would have left the real cause in place."""
    signup = (HERE.parent / "routers" / "signup.py").read_text(encoding="utf-8")
    at = signup.index("async def interview_start")
    body = signup[at:at + 2000]
    assert "OPENERS" in body, "the opener comes from a template"
    assert not re.search(r"await\s+\w*claude\w*chat|llm_chat", body), "no model call to vary"
