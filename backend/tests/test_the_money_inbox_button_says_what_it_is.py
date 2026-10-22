"""The way to the Money Inbox says what it is (BUG-15, XCODITS QA report,
2026-10-21).

The testers: "On the Money page, the index box button in the top section is
inaccessible, or its purpose is unclear." It was the phone's Quick capture
card's round black tray icon — "Open Inbox" to a screen reader, nothing to the
eye — and it only switched to the Inbox tab in the row above it, so on the
Inbox (where everyone without Finance always is) it did nothing. Now it is a
labelled "N in Inbox →" pill, shown only when something is waiting and you are
elsewhere; and the one-cell tab bar that a person without Finance saw (always
selected, doing nothing) is gone. Checked in a browser at phone size as a
Finance member and as an employee.
"""
from pathlib import Path

LEDGER = (Path(__file__).resolve().parents[2] / "frontend" / "src" / "pages" / "Ledger.js").read_text(encoding="utf-8")


def test_the_phone_card_has_no_inbox_button():
    # 2026-10-22 (founder): the labelled pill that replaced the tray icon goes
    # too — on a phone the Inbox tab already carries the count on its icon.
    assert 'data-testid="finance-hero-inbox-m"' not in LEDGER
    # Desktop keeps its pill, only when something waits and you are elsewhere.
    assert "const showInbox = pendingCount > 0 && tab !== \"inbox\";" in LEDGER
    desktop = LEDGER[LEDGER.index('data-testid="finance-hero-inbox-badge"') - 120:]
    assert "{showInbox && (" in desktop[:200]
    assert "tab={tab}" in LEDGER[LEDGER.index("<QuickCapture "):LEDGER.index("<QuickCapture ") + 200]


def test_a_single_tab_is_not_drawn_as_a_bar():
    assert "{!isMobile && tabs.length > 1 && (" in LEDGER
    assert "{tabs.length > 1 && <SectionTabs " in LEDGER
