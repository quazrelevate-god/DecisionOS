"""The Ops capture box really captures (2026-10-02).

U7-01.35, raised P2 -> P1 during the error audit and fixed here.

`InlineCapture` sits in the empty state a brand-new company sees FIRST -- the
"your score turns on once there is some activity" card. Its submit handler
was:

    const submit = (e) => {
      e.preventDefault();
      if (!text.trim()) return;
      setSent(true);
      setText("");
    };

It cleared the field, showed "sent" for 2.4 seconds, and made NO REQUEST. So
the one decision a founder types to turn their score on was discarded in
silence, and the page then went on telling them they had no activity. A
control that lies is worse than a control that is missing: the missing one
sends you to look for another way in.

It posts to /voice-notes/text now -- the same endpoint the Desk's Dex well
and the mobile sheet use, with the same words on success -- so a decision
captured here is the same object as one captured anywhere else.

PROVED END TO END in the browser, not just at the network boundary: the POST
carried {"text": "...", "file_ids": []}, and the scratch database then held
the voice note (status done) AND the decision the AI made from it, "Ship the
indigo lot before Friday", pending_approval. Probe data removed afterwards.
"""
from pathlib import Path

OPS = (Path(__file__).resolve().parents[2] / "frontend" / "src" / "pages"
       / "OperatingScore.js").read_text(encoding="utf-8")


def _inline_capture() -> str:
    at = OPS.index("function InlineCapture()")
    return OPS[at:OPS.index("function NotEnoughDataEmptyState(")]


def test_it_sends_what_was_typed():
    body = _inline_capture()
    assert 'api.post("/voice-notes/text", { text: body, file_ids: [] })' in body


def test_the_old_pretence_is_gone():
    """The exact shape of the lie, so it cannot come back by accident."""
    body = _inline_capture()
    assert "setSent(" not in body, "no more fake 'sent' flag"
    assert ">sent<" not in OPS


def test_a_failure_is_said_out_loud():
    """It used to be incapable of failing, which is its own kind of wrong."""
    body = _inline_capture()
    assert "toast.error(formatApiError(" in body
    assert "Couldn't capture that" in body


def test_success_uses_the_same_words_as_every_other_capture():
    body = _inline_capture()
    assert "Captured — Dex is structuring it now" in body


def test_the_page_stops_claiming_the_company_is_empty():
    """The whole point of typing here is to watch the page change. Without
    this the founder captures a decision and the score still says nothing has
    happened."""
    body = _inline_capture()
    assert "invalidateQueries" in body
    for key in ('"operating-score"', '"tasks"', '"decisions"'):
        assert key in body, key


def test_a_member_who_may_not_capture_is_told_who_can():
    """Rather than being handed a box whose request will be refused. Same
    permission and same sentence as the Desk's well."""
    body = _inline_capture()
    # 2026-10-03 RBAC audit: owners are no longer special-cased here -- an
    # owner holds the key unless the company switched it off for owners.
    assert 'hasPerm(user, "voice_capture")' in body and 'user?.role === "owner" ||' not in body
    assert "Ask an owner to turn on capture." in body
    assert 'data-testid="operating-inline-capture-denied"' in body


def test_it_cannot_be_sent_twice_while_it_is_sending():
    body = _inline_capture()
    assert "if (!body || sending) return;" in body
    assert "disabled={!text.trim() || sending}" in body
    assert 'Capturing…' in body
