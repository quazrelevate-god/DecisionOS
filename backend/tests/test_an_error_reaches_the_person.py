"""An error reaches the person it happened to (2026-10-02).

Five faults, found by FORCING each failure in the browser rather than waiting
for one — an XHR harness that answers 500, 401, or nothing at all.

1. A BROKEN ENDPOINT WAS SHOWN AS A TRUE, EMPTY ANSWER. With /api/contacts
   answering 500 and auth healthy, CRM rendered "Buyers 0 · Partners 0 ·
   Suppliers 0" and said nothing else. The company has contacts. Worse than an
   ugly error: a confident wrong answer, on the page about customers. Pages
   read `data || []`, so a failed query and an empty one arrive identically,
   and the app's no-signal screen does not catch it — that fires when
   /auth/me itself fails, so a PARTIAL outage walks straight past it.

2. THE SERVER'S OWN VOCABULARY IN A TOAST. Saving company details against a
   500 produced a toast reading, in its entirety, "Internal Server Error".

3. SEVEN NATIVE window.confirm DIALOGS. On a phone an OS sheet; inside the
   Capacitor WebView, worse — and this repo's own notes (ASK-2, FUP-49) record
   that some embed contexts answer it FALSE with nothing drawn, so the button
   looks dead and gets pressed again. Two were user-facing; five were admin,
   including "EXPORT then PERMANENTLY DELETE" a tenant.

4. SIGNING BACK IN LOST YOUR PLACE. (The expiry TOAST was already there and
   correct — an earlier report in this session said otherwise and was wrong,
   having looked 6 seconds after it had auto-dismissed.)

5. A LINK TO A DELETED TASK SAID NOTHING — and the reason is the interesting
   part: ASK-28's "This task no longer exists" banner was already written,
   translated and dismissible, and was UNREACHABLE CODE. The effect that tidies
   ?task= out of the address ran on mount, in the same commit that opens the
   task, saw `openId` still null, and stripped the id. With the id gone,
   `focusDenied` could never become true.
"""
import re
from pathlib import Path

import pytest

FE = Path(__file__).resolve().parents[2] / "frontend" / "src"
API = (FE / "lib" / "api.js").read_text(encoding="utf-8")
COMMON = (FE / "components" / "common.js").read_text(encoding="utf-8")
CRM = (FE / "pages" / "CRM.js").read_text(encoding="utf-8")
MYWORK = (FE / "pages" / "MyWork.js").read_text(encoding="utf-8")
WORKFLOWS = (FE / "pages" / "Workflows.js").read_text(encoding="utf-8")
AUTH = (FE / "context" / "AuthContext.js").read_text(encoding="utf-8")
LOGIN = (FE / "pages" / "Login.js").read_text(encoding="utf-8")

CONFIRM_SITES = [
    "pages/Team.js",
    "pages/BrainDocuments.js",
    "pages/admin/AnnouncementsSection.js",
    "pages/admin/ComplianceSection.js",
    "pages/admin/AdminSections.js",
]


def _code_only(src: str) -> str:
    """The file with its comments removed. Every one of these fixes is
    explained in a comment that names the thing it removed, so a plain search
    finds the explanation and fails the test that exists to protect it."""
    src = re.sub(r"\{/\*.*?\*/\}", "", src, flags=re.S)
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    src = re.sub(r"^\s*//.*$", "", src, flags=re.M)
    return src


# ───────── 1. a failed load is not an empty one ────────────────────────────
def test_there_is_one_place_that_says_a_list_did_not_arrive():
    assert "export function LoadFailed(" in COMMON
    assert "not an empty list" in COMMON, "the sentence does the whole job"
    assert "Try again" in COMMON


@pytest.mark.parametrize("name,src,marker", [
    ("CRM", CRM, "crm-load-failed"),
    ("MyWork", MYWORK, "mywork-load-failed"),
    ("Workflows", WORKFLOWS, "workflows-load-failed"),
], ids=["crm", "mywork", "workflows"])
def test_each_list_asks_whether_it_arrived(name, src, marker):
    assert "LoadFailed" in src, name
    assert marker in src, name
    assert "isError" in src, name


def test_the_question_is_asked_before_the_list_is_called_empty():
    """Order is the whole fix: `length === 0` answers first otherwise."""
    failed = CRM.index("isError && !data ?")
    empty = CRM.index("contacts.length === 0 ?")
    assert failed < empty


def test_my_works_two_empty_states_stand_down_when_nothing_arrived():
    """Both say something about a founder's own work — "Nothing here", "No
    tasks yet" — to somebody who may have fourteen open tasks."""
    code = _code_only(MYWORK)
    assert code.count("!tasksQ.isLoading && !tasksQ.isError && list.length === 0") == 2


def test_a_count_is_not_reported_when_the_list_failed():
    """"Buyers 0" beside a failed load is the same lie the empty card told."""
    assert 'isError && !data ? "–" : s.count' in CRM


# ───────── 2. the server's words are not ours ──────────────────────────────
def test_the_frameworks_reason_phrases_are_translated():
    assert "FRAMEWORK_PHRASES" in API
    for phrase in ("internal server error", "bad gateway", "service unavailable",
                   "too many requests", "not authenticated"):
        assert f'"{phrase}"' in API, phrase


def test_the_500_sentence_says_what_to_do_and_blames_nobody():
    i = API.index('"internal server error":')
    said = API[i:i + 200]
    assert "Nothing you did caused it" in said
    assert "try again" in said.lower()


def test_a_phrase_is_matched_whole_so_our_own_words_survive():
    """A sentence of ours that merely CONTAINS "not found" is still ours."""
    assert "FRAMEWORK_PHRASES[detail.trim().toLowerCase()" in API
    assert ".includes(" not in API[API.index("FRAMEWORK_PHRASES = {"):API.index("export function formatApiError")]


# ───────── 3. nothing asks through the browser any more ────────────────────
@pytest.mark.parametrize("rel", CONFIRM_SITES, ids=[p.split("/")[-1] for p in CONFIRM_SITES])
def test_not_one_native_confirm_is_left(rel):
    code = _code_only((FE / rel).read_text(encoding="utf-8"))
    assert "window.confirm" not in code, f"{rel} still asks through the browser"


@pytest.mark.parametrize("rel", CONFIRM_SITES, ids=[p.split("/")[-1] for p in CONFIRM_SITES])
def test_each_one_asks_in_the_app_instead(rel):
    assert "ConfirmAction" in (FE / rel).read_text(encoding="utf-8"), rel


def test_the_shared_confirm_exists_and_names_the_deed():
    assert "export function ConfirmAction(" in COMMON
    assert "confirmLabel" in COMMON and "busyLabel" in COMMON
    assert "never \"OK\"" in COMMON or 'never "OK"' in COMMON


def test_the_wipe_asks_before_it_wipes():
    """The one that cannot be undone: the button opens the question, it does
    not start the deletion."""
    src = (FE / "pages" / "admin" / "ComplianceSection.js").read_text(encoding="utf-8")
    assert 'onClick={() => setPending("delete")}' in src
    assert "onClick={deleteWithExport}" not in src
    assert "admin-delete-tenant-confirm" in src


def test_sending_real_email_asks_too():
    src = (FE / "pages" / "admin" / "AnnouncementsSection.js").read_text(encoding="utf-8")
    assert "admin-announcement-email-confirm" in src
    assert "Email cannot be unsent" in src


# ───────── 4. signing back in returns you ──────────────────────────────────
def test_the_session_toast_was_already_right_and_is_still_there():
    """Recorded because an earlier report in this session called this silent.
    It was not; the toast had auto-dismissed before the check."""
    assert "You were signed out. Sign in again to carry on." in AUTH


def test_where_they_were_is_remembered_and_handed_back():
    assert "RETURN_TO_KEY" in AUTH and "export function takeReturnTo()" in AUTH
    assert "sessionStorage" in AUTH, "the tab that was thrown out, not every tab"
    assert LOGIN.count('navigate(takeReturnTo() || "/", { replace: true })') == 3


def test_the_return_is_read_once():
    """A stale value would send a later, deliberate sign-in somewhere nobody
    asked to go."""
    i = AUTH.index("export function takeReturnTo()")
    assert "removeItem(RETURN_TO_KEY)" in AUTH[i:i + 400]


def test_a_sign_in_page_is_never_the_place_to_return_to():
    i = AUTH.index("RETURN_TO_KEY, here")
    assert 'here.startsWith("/login")' in AUTH[i - 400:i]


# ───────── 5. the banner that could never render ───────────────────────────
def test_the_address_is_only_tidied_after_the_task_was_really_open():
    assert "const hadOpen = useRef(false);" in MYWORK
    assert "!openId && focusTaskId && hadOpen.current && !focusDenied" in MYWORK


def test_a_task_that_is_gone_keeps_its_id():
    """`focusDenied` is what the banner is about, and it needs the id that
    produced the 404 to still be in the address."""
    i = MYWORK.index("hadOpen.current && !focusDenied")
    assert "setFilterParams" in MYWORK[i:i + 120]


def test_closing_a_task_still_takes_it_out_of_the_address():
    """The behaviour the old effect was reaching for, moved onto the close
    itself where no render order can race it."""
    assert 'onToggleOpen={() => { setOpenId(null); setFilterParams({ task: "", focus: "" }); }}' in MYWORK


def test_the_banner_it_unblocks_is_still_there():
    assert 'data-testid="access-restricted-banner"' in MYWORK
    assert "task_missing" in MYWORK
