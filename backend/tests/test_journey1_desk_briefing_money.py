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
import core
import routers.desk as desk

_T = "desk-j1-money"
_seen = []


class _FakeChat:
    def with_model(self, *m):
        return self

    async def send_message(self, msg):
        _seen.append(msg.text)
        return "Briefing."


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


def test_the_model_gets_money_only_for_someone_who_sees_money(monkeypatch, with_test_db):
    async def go(db):
        prev = desk.db
        desk.db = db
        try:
            monkeypatch.setattr(core, "claude_chat", lambda **k: _FakeChat())
            _seen.clear()
            cash = {"clear": False, "overdue_receivables_amount": 685000, "unmatched_payments": 1}
            await desk.ai_desk_narrative(delayed=2, completed_yday=0, pending_decisions=1, cash=cash,
                                         is_owner=True, tenant_id=_T, sees_money=True, currency="INR")
            await desk.ai_desk_narrative(delayed=2, completed_yday=0, pending_decisions=1, cash=cash,
                                         is_owner=False, tenant_id=_T, sees_money=False, currency="INR")
            return list(_seen)
        finally:
            desk.db = prev

    owner_counters, worker_counters = with_test_db(go)
    assert "₹6.85 lakh" in owner_counters and "685000" not in owner_counters
    assert "receivables" not in worker_counters and "₹" not in worker_counters
    assert "pending_decisions\": 0" in worker_counters


def test_the_prompt_forbids_dollars_and_money_talk_without_money():
    from prompts import render
    text = render("desk.narrative")
    assert "never use a dollar sign" in text
    assert "do not mention money" in text
