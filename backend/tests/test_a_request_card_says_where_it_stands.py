"""A request, one card that says where it stands (founder's reference, 2026-10-29).

The same card on the Requests page and on My Work's My requests: its state,
kind and needed-by date as chips with its number and a menu; what it is for
beside how much; who asked → who says yes, face to face; the approver's
question, what is being asked for, the files as tiles; and a foot with how
long ago and the one thing this person can do now.
"""
from pathlib import Path

FE = Path(__file__).resolve().parents[2] / "frontend" / "src"
CARD = (FE / "components" / "requests" / "RequestCard.jsx").read_text(encoding="utf-8")
PANEL = (FE / "components" / "requests" / "RequestsPanel.jsx").read_text(encoding="utf-8")
LIB = (FE / "lib" / "requests.js").read_text(encoding="utf-8")


def test_both_places_draw_the_same_card():
    assert "<RequestCard key={r.id} r={r}" in PANEL
    # Requests page and My Work's My requests both render RequestsPanel.
    assert "<RequestsPanel" in (FE / "pages" / "Requests.js").read_text(encoding="utf-8")
    assert "<RequestsPanel embedded mineOnly" in (FE / "pages" / "MyWork.js").read_text(encoding="utf-8")


def test_the_head_and_the_people():
    for testid in ("request-status-", "request-type-", "request-needed-", "request-number-", "request-menu-"):
        assert f'data-testid={{`{testid}${{r.id}}`}}' in CARD, testid
    assert "<Party name={r.requester_name} sub=\"Requested\"" in CARD
    assert 'sub: r.status === "rejected" ? "Rejected" : "Approved"' in CARD
    assert "PersonAvatar" in CARD, "faces, not just names"
    # The kind wears the same colour as on the New Request form.
    assert "export const REQUEST_TONES" in LIB and "const tone = requestTone(r.type);" in CARD


def test_the_body_and_the_foot():
    assert "asked:</span> {r.info_note}" in CARD, "the approver's question on the card"
    assert 'data-testid={`request-files-${r.id}`}' in CARD and "FilePdf" in CARD, "files as tiles"
    assert CARD.count("{...fileLink(") == 1, "every file opens signed in, through the one helper"
    assert "{agoWords(r.created_at)}" in CARD, "how long ago, in words"
    for testid in ("request-approve-", "request-reject-", "request-info-", "request-fulfil-", "request-details-toggle-"):
        assert f'data-testid={{`{testid}${{r.id}}`}}' in CARD, testid
    # What it offers is still the server's call.
    assert "const deciding = !action && can.decide;" in CARD and "const paying = !action && can.fulfil;" in CARD


def test_the_list_never_grows_past_the_screen():
    assert PANEL.count('className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"') == 2
