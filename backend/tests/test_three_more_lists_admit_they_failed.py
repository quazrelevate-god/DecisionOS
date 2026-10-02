"""Three more lists admit they failed (2026-10-02).

Asked whether the UI error work was finished, the honest answer was no. A
census found 17 surfaces with an empty state that never ask `isError`, and
forcing their endpoints to 500 in the browser showed three of them lying:

    /journal   -> the diary chrome and no entries, no error, no retry
    /calendar  -> "Nothing this week" over "Meetings 0  Payments 0  Tasks 0"
    /leave     -> "Loading your leave…" FOR EVER

The third is the worst of the three. react-query had given up; the sentence
had not, so the page went on promising something that was never coming.
Waiting feels like progress, which an empty list at least does not.

A NOTE FOR WHOEVER TESTS THIS NEXT: the honest message takes about ten
seconds to appear, because react-query retries three times with backoff
first. Measured at 3.4s these pages still looked broken and the fix looked
like it had not landed -- the bundle had it all along.
"""
from pathlib import Path

FE = Path(__file__).resolve().parents[2] / "frontend" / "src"
LEAVE = (FE / "pages" / "Leave.js").read_text(encoding="utf-8")
JOURNAL = (FE / "pages" / "Journal.js").read_text(encoding="utf-8")
CALENDAR = (FE / "pages" / "Calendar.js").read_text(encoding="utf-8")


def test_leave_stops_loading_for_ever():
    assert "mineQ.isError && !mineQ.data" in LEAVE
    assert 'testid="leave-load-failed"' in LEAVE
    # and the spinner sentence is still there for the case it is true
    assert "Loading your leave…" in LEAVE


def test_the_journal_does_not_claim_the_diary_is_blank():
    assert "isError && !data ?" in JOURNAL
    assert 'testid="journal-load-failed"' in JOURNAL
    at = JOURNAL.index("isError && !data ?")
    assert JOURNAL.index("Nothing logged yet.") > at, "asked before the empty state answers"


def test_the_calendar_does_not_report_a_free_week():
    assert "isError && !data ?" in CALENDAR
    assert 'testid="calendar-load-failed"' in CALENDAR


def test_no_calendar_count_reads_zero_when_nothing_arrived():
    """"Meetings 0" beside a failed load is a statement about the week, not a
    missing number."""
    assert "n: (isError && !data) ? null : (counts[key] || 0)," in CALENDAR
    assert 'n: (isError && !data) ? null : (data?.total || 0)' in CALENDAR, "the All chip too"
    assert '{f.n == null ? "–" : f.n}' in CALENDAR


def test_all_three_ask_before_the_empty_state_answers():
    for name, src, empty in (
        ("Journal", JOURNAL, "Nothing logged yet."),
        ("Calendar", CALENDAR, "Nothing this week."),
    ):
        assert src.index("isError && !data ?") < src.index(empty), name


# ───────── three more, from reading rather than forcing ───────────────────
# Verified by inspection, not in the browser, and the reason is worth keeping:
# react-query holds the last good answer (gcTime), and the layout's bell
# fetches /notifications on EVERY route, so that list is never cold in a page
# that is already open. The failure these guard is therefore the uncommon one
# -- a first load against a broken endpoint -- which is exactly the case no
# human tester reaches either.
NOTIFS = (FE / "pages" / "Notifications.js").read_text(encoding="utf-8")
BRIEF = (FE / "components" / "mobile" / "blocks" / "BriefBlocks.jsx").read_text(encoding="utf-8")
WA = (FE / "pages" / "finance" / "WhatsAppCard.js").read_text(encoding="utf-8")


def test_notifications_does_not_congratulate_a_failed_load():
    """"You're all caught up." is a congratulation. Said to somebody whose
    list failed to load, it is the app promising there is no approval waiting
    when there may be one."""
    assert "isError && !data && (" in NOTIFS
    assert 'testid="notifications-load-failed"' in NOTIFS
    assert "{!isError && items.length === 0 && (" in NOTIFS


def test_the_brief_detail_does_not_contradict_the_number_just_tapped():
    """The founder tapped a figure on their brief to see what is behind it.
    "Nothing here right now" denies the number, on the same screen, seconds
    apart."""
    assert "!isLoading && isError && !data && (" in BRIEF
    assert 'testid="brief-detail-load-failed"' in BRIEF
    assert "{!isLoading && !isError && items.length === 0 && (" in BRIEF


def test_the_whatsapp_log_does_not_send_an_owner_to_debug_a_working_webhook():
    """That empty state is a DIAGNOSIS -- it tells the owner the webhook is
    probably not reaching the app and sends them into Meta's console. Said
    when the log merely failed to load, it is an afternoon wasted."""
    assert "logsFailed && !logs ? (" in WA
    assert 'data-testid="whatsapp-logs-failed"' in WA
    assert "this is our side, not your WhatsApp setup" in WA


def test_the_pages_that_were_already_right_were_left_alone():
    """ContactProfile already handled `error || !data?.contact`, and Brain's
    only list is local chat state, not a query. Recorded so the next census
    does not re-open them."""
    cp = (FE / "pages" / "ContactProfile.js").read_text(encoding="utf-8")
    assert "if (error || !data?.contact) {" in cp


# ───────── and what those surfaces say when an ACTION fails ───────────────
# A separate question from "did the list arrive", asked of the same 14
# surfaces: when a BUTTON on them fails, is anything said? Counting catches
# against user-visible errors found three files with catches and no toast at
# all. Two were deliberate and correct and are recorded here so they are not
# "fixed" later by someone counting the same way.
LAYOUT = (FE / "components" / "Layout.js").read_text(encoding="utf-8")
BRAIN = (FE / "pages" / "Brain.js").read_text(encoding="utf-8")


def test_mark_read_buttons_say_when_they_did_not():
    """Both called the bare async handler. A failure changed nothing on screen
    and said nothing, leaving a dot that would not clear and an unhandled
    rejection in the console."""
    assert "const markReadSaid = async (id) => {" in NOTIFS
    assert "const markAllSaid = async () => {" in NOTIFS
    assert "onClick={markAllSaid}" in NOTIFS
    assert "markReadSaid(n.id)" in NOTIFS
    assert "Couldn't mark that read" in NOTIFS and "Couldn't mark them all read" in NOTIFS


def test_opening_a_notification_still_swallows_the_mark():
    """The deliberate one: failing to mark something read must not stop the
    person reaching the thing it is about."""
    at = NOTIFS.index("const open = async (n)")
    body = NOTIFS[at:at + 320]
    assert "non-blocking" in body
    assert "markRead(n.id)" in body and "markReadSaid" not in body


def test_ask_turns_its_failure_into_an_answer_rather_than_a_toast():
    """Brain has a catch and no toast BY DESIGN: the failure becomes a reply
    in the conversation, where the question was asked."""
    at = BRAIN.index("const answer = isAiConsentError(e)")
    assert "setLog((l) => [...l," in BRAIN[at:at + 220]


def test_the_workspace_list_failing_is_not_worth_a_toast():
    """A menu that cannot list the other companies still works for the one you
    are in; the switch itself DOES report."""
    assert "the menu still works without it" in LAYOUT
    assert "Couldn't open that company" in LAYOUT
