"""The Desk briefing speaks in rupees, and about money only to people who
handle money (JOURNEY-1, 2026-09-22).

Amit (production) and Priya (sales) each read, word for word, the owner's
briefing: "you have $685,000 in overdue receivables that need your attention
today — you have a clear runway to focus on chasing". Two things wrong:
  * the model was handed a bare number and wrote it in dollars on an Indian
    company's Desk;
  * the company's receivables went into the briefing of people who cannot open
    Finance at all, telling them to do a job they cannot do.
"""
import routers.desk as desk


def test_money_is_written_the_way_an_indian_company_says_it():
    assert desk.money_words(685000) == "₹6.85 lakh"
    assert desk.money_words(12500000) == "₹1.25 crore"
    assert desk.money_words(64000) == "₹64,000"
    assert desk.money_words(1234567) == "₹12.35 lakh"
    assert desk.money_words(500, "USD") == "$500"


def test_the_template_briefing_says_rupees_and_leaves_money_out_for_others():
    cash = {"clear": False, "overdue_receivables_amount": 685000}
    owner = desk._narrative(delayed=2, completed_yday=0, pending_decisions=0, cash=cash, is_owner=True)
    worker = desk._narrative(delayed=2, completed_yday=0, pending_decisions=0, cash=cash, is_owner=False,
                             sees_money=False)
    assert "₹6.85 lakh" in owner and "$" not in owner and "Rs " not in owner
    assert "receivable" not in worker and "cash" not in worker and "₹" not in worker


def test_the_desk_briefing_is_not_an_ai_call():
    """2026-10-05 (AI audit) — the briefing is the template: the AI version ran on
    every Desk poll and no screen showed it."""
    import inspect
    src = inspect.getsource(desk.desk_summary)
    assert "narrative = _narrative(" in src
    assert not hasattr(desk, "ai_desk_narrative")
    from prompts.base import _REGISTRY as reg
    assert "desk.narrative" not in reg
