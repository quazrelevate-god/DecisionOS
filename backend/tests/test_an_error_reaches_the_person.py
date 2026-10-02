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
    assert "function humanPhrase(detail)" in API
    assert "FRAMEWORK_PHRASES[String(detail).trim().toLowerCase()" in API
    # humanPhrase's own body: it ends at its closing brace. (The span used to
    # run to formatApiError, which now has the no-answer code in between.)
    start = API.index("function humanPhrase(detail)")
    body = API[start:API.index("\n}\n", start)]
    assert ".includes(" not in body


# ───────── 2b. and it reaches the 88 places that never asked ──────────────
def test_the_detail_is_translated_once_in_the_interceptor():
    """A census found 141 call sites using formatApiError and 88 MORE reading
    e.response.data.detail raw — so approving a decision against a 500 still
    put "Internal Server Error" on screen, the exact fault that fix was for,
    surviving in a third of the app. Rewriting the detail in the interceptor
    reaches every one of them, and every one written tomorrow."""
    at = API.index("humanPhrase(d.detail)")
    block = API[at - 900:at + 300]
    assert 'typeof d.detail === "string"' in block, "a dict detail is our own shape; leave it"
    assert "try {" in block, "tidying the words must never swallow the error"
    # it lives in the interceptor that owns the session signal, not a new one
    assert API.count("api.interceptors.response.use") == 3, "a fourth would be a second place to look"


def test_the_interceptor_runs_before_the_session_check():
    """Order matters only for readability here, but the 401 handler and the
    rewrite must both still run — neither returns early."""
    at = API.index("humanPhrase(d.detail)")
    after = API[at:at + 3000]
    assert "SESSION_LOST_EVENT" in after, "the 401 signal still follows it"
    assert "return Promise.reject(err);" in after, "and the error is still rejected"


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


# ───────── 6. what the server itself says ──────────────────────────────────
BE = Path(__file__).resolve().parents[1]
BILLING = (BE / "routers" / "billing.py").read_text(encoding="utf-8")
OTP = (BE / "services" / "otp.py").read_text(encoding="utf-8")


def test_the_upgrade_button_stops_naming_our_environment_variables():
    """A census of 545 server-side raises found this one, and it is the worst
    of them: /billing/checkout is owner-facing, so an SME founder pressing
    Upgrade before billing was switched on was told to set
    BILLING_LANDING_URL and RAZORPAY_KEY_ID."""
    assert "RAZORPAY_KEY_ID env vars" not in BILLING
    assert "BILLING_LANDING_URL +" not in BILLING
    assert "Nothing has been charged" in BILLING, "say the thing they are afraid of"


def test_the_plan_refusal_names_plans_rather_than_a_field():
    assert "Invalid plan_key" not in BILLING
    assert "Choose Starter, Business or Enterprise." in BILLING


def test_a_code_bug_is_shouted_in_the_log_and_not_at_the_founder():
    """The comment above it asks to surface it loudly, and it should be —
    loudly in the log. On screen, mid sign-in, "Internal error: OTP issued
    without tenant scope" is a sentence about our code, not their phone."""
    assert "Internal error: OTP issued without tenant scope" not in OTP
    assert "this is a code bug" in OTP and "logger.error" in OTP
    assert 'logger = logging.getLogger("decisionos")' in OTP, "or the log line NameErrors"


def test_a_failed_text_message_says_what_to_do():
    assert "SMS provider returned an unexpected response" not in OTP
    assert "We couldn't send the code just now." in OTP


def test_a_bare_not_found_is_carried_by_the_phrase_map():
    """147 of the 545 raises are 404s and many say exactly "Not found", which
    the interceptor now turns into a sentence. This records WHY those were
    left alone at source rather than rewritten one by one."""
    assert '"not found": "We couldn' in API and "find that" in API


# ───────── 7. the structured refusals (402 / 410 / 415 / 451) ─────────────
AICONSENT = (FE / "lib" / "aiConsent.js").read_text(encoding="utf-8")
TEAM = (FE / "pages" / "Team.js").read_text(encoding="utf-8")
REVEAL = (FE / "pages" / "onboarding" / "BuildReveal.js").read_text(encoding="utf-8")


def test_a_structured_refusal_is_flattened_to_its_sentence():
    """17 server raises use our {code, message} shape -- the seat limit, the
    AI budget, the consent gate. formatApiError reads `.message`, but the 88
    call sites that pass the detail straight to toast.error handed React an
    OBJECT, and React does not render objects. Forced in the browser on the
    decision-approve path: "Objects are not valid as a React child (found:
    object with keys {code, message, seat_limit})", thrown during the commit.
    The founder saw nothing and the tree was left broken."""
    at = API.index("d.detail_full = full")
    block = API[at - 2000:at + 400]
    assert 'typeof d.detail === "object"' in block
    assert "!Array.isArray(d.detail)" in block, "a 422 list is not our shape"
    assert "full.message" in block
    assert "Something went wrong" in block, "a shape with no message still says something"


def test_the_object_it_came_from_is_kept_for_the_four_that_need_it():
    assert "detail_full" in API
    assert "detail_full" in TEAM and "detail_full" in REVEAL and "detail_full" in AICONSENT


def test_the_seat_wall_is_still_built_from_the_object():
    """402 seat_limit_reached drives a wall with counts on it, not a toast."""
    assert 'full?.code === "seat_limit_reached"' in TEAM
    assert "setSeatWall(full)" in TEAM


def test_signups_phone_and_email_branches_still_read_their_code():
    assert 'const code = e.response?.data?.detail_full?.code;' in REVEAL
    assert 'code === "phone_unverified"' in REVEAL
    assert 'code === "email_registered"' in REVEAL


def test_the_consent_check_looks_at_the_kept_object_first():
    assert "x.response?.data?.detail_full?.code === AI_CONSENT_CODE" in AICONSENT
    # and the older shapes still answer, for errors we never passed through
    assert 'detail.code === AI_CONSENT_CODE' in AICONSENT
    assert "x.response?.status === 451" in AICONSENT


def test_the_invite_and_media_refusals_were_already_written_for_a_person():
    """410 and 415 needed no change -- recorded so the next census does not
    re-open them."""
    otp = (Path(__file__).resolve().parents[1] / "routers" / "auth_otp.py").read_text(encoding="utf-8")
    ledger = (Path(__file__).resolve().parents[1] / "routers" / "ledger.py").read_text(encoding="utf-8")
    assert "This invite link has expired — ask your admin to resend" in otp
    assert "Only image or PDF bills are supported" in ledger


# ───────── 8. one refusal, one toast, and a door that opens ───────────────
SETTINGS = (FE / "pages" / "Settings.js").read_text(encoding="utf-8")


def test_a_consent_refusal_says_itself_once():
    """Seen in the browser: a 451 produced TWO toasts -- the rich one with the
    way out, and a plain copy from whichever of the 88 call sites made the
    request. One fact, twice, and only one of them carried the button."""
    assert "guardTheDuplicate" in AICONSENT
    assert "msg === aiConsentMessage()" in AICONSENT
    assert "Date.now() - _shownAt < QUIET_MS" in AICONSENT


def test_the_rich_toast_does_not_swallow_itself():
    """The first version showed NOTHING: showAiConsentToast sets _shownAt and
    then calls toast.error, so it met its own guard. It uses the unwrapped
    reference for exactly that reason."""
    assert "_rawToastError" in AICONSENT
    assert "(_rawToastError || toast.error)(aiConsentMessage()" in AICONSENT


def test_only_that_one_sentence_is_ever_dropped():
    """A different error in the same second must still be shown -- verified in
    the browser with a 500 inside the quiet window."""
    at = AICONSENT.index("toast.error = (msg, opts)")
    body = AICONSENT[at:at + 320]
    assert 'typeof msg === "string"' in body
    assert "return plain(msg, opts);" in body, "everything else goes straight through"


def test_both_routes_hand_over_the_same_sentence():
    """Without this the two say the same thing in two wordings, and neither
    can tell they are the same fact."""
    assert "err.response.data.detail = aiConsentMessage();" in API
    assert "showAiConsentToast, aiConsentMessage" in API, "imported at the top"


def test_the_way_out_points_at_something_that_exists():
    """The button is only worth having if it lands on the switch."""
    assert 'AI_CONSENT_HREF = "/settings?tab=business#ai-consent"' in AICONSENT
    assert 'id="ai-consent"' in SETTINGS, "the anchor it jumps to"
    assert "scroll-mt-24" in SETTINGS, "or the header covers the card it jumped to"
    assert 'tab === "business"' in SETTINGS, "and the card lives on that tab"


# ───────── 9. going somewhere without restarting the app ──────────────────
NAV = (FE / "lib" / "navigate.js").read_text(encoding="utf-8")
NATIVEBACK = (FE / "hooks" / "useNativeBack.js").read_text(encoding="utf-8")
LAYOUT = (FE / "components" / "Layout.js").read_text(encoding="utf-8")


def test_the_toast_action_no_longer_restarts_the_application():
    """`window.location.href` is a full document load: the bundle parsed
    again, every cache dropped, the session re-fetched. A blink in a browser;
    in the installed PWA and the Capacitor shell it is the app restarting in
    front of somebody who pressed a button on a toast."""
    assert "window.location.href = AI_CONSENT_HREF" not in AICONSENT
    assert "onClick: () => goTo(AI_CONSENT_HREF)" in AICONSENT


def test_it_is_the_mechanism_the_app_already_had():
    """lib/native/links takes a go(path) and useNativeBack supplies navigate,
    because it is mounted at the root inside the Router. This is that, named —
    a second way to navigate would have been the worse outcome."""
    assert "export function setAppNavigate(" in NAV and "export function goTo(" in NAV
    assert "setAppNavigate(navigate)" in NATIVEBACK
    assert "return () => setAppNavigate(null);" in NATIVEBACK, "and let go on unmount"


def test_it_still_works_with_no_router_listening():
    """Before React mounts, in a test, or if the bridge is ever left
    unregistered. The caller must never have to ask which happened."""
    at = NAV.index("export function goTo(")
    body = NAV[at:at + 420]
    assert "if (!_navigate)" in body and "window.location.assign(path)" in body


def test_the_hash_is_scrolled_to_by_us_now():
    """The browser only jumps to an anchor on a real document load, which is
    exactly what we stopped doing — and the target is not on screen yet: the
    page has to mount, its tab has to switch, its data has to arrive."""
    assert "scrollToWhenReady" in NAV
    assert "requestAnimationFrame" in NAV, "looked for over a budget, not once"
    assert "LOOK_FOR_MS" in NAV


def test_the_workspace_switch_keeps_its_full_load_on_purpose():
    """The one remaining reload is the feature: a different workspace is a
    different everything, and a router navigation would keep every cached
    query from the company being left behind."""
    assert 'window.location.href = "/";' in LAYOUT
    assert "AND THIS ONE STAYS A FULL LOAD, deliberately" in LAYOUT


def test_no_other_code_navigates_by_reloading():
    """So the next one is a choice somebody made, not a habit."""
    import re
    hits = []
    for f in FE.rglob("*.js"):
        if "node_modules" in str(f):
            continue
        for n, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
            if re.search(r"window\.location\.href\s*=", line) and not line.strip().startswith(("*", "//")):
                hits.append(f"{f.name}:{n}")
    assert hits == ["Layout.js:181"] or all("Layout.js" in h for h in hits), hits
