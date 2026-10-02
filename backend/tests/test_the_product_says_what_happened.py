"""The product says what happened (2026-10-03).

A whole-product pass -- owner, a finance-permissioned member, the platform
admin console, phone width, signed out -- looking past "does a failed request
become a sentence" at what a founder actually meets. Eight things were wrong,
each seen in the browser before it was fixed and again after:

  1. NO SIGNAL. Creating a task offline said "Create failed" and nothing else:
     no cause, and no answer to "did it save?". A screen that could not load
     said "a problem on our side" to someone in a lift.
  2. A LINK OPENED SIGNED OUT was spent: sign in, land on the Desk.
  3. A MISTYPED ADDRESS silently became the Desk.
  4. ONE BROKEN PAGE took the sidebar with it, never reset, and its message
     promised "the rest of the app should still work" with nothing left to
     click.
  5. A DELETED DECISION told its owner "You don't have access to this
     decision" -- as did a 500, and no signal.
  6. A LINK TO A DELETED TASK showed the right banner AND a toast saying it
     was "removed while you had it open", which it never was.
  7. THE RAW ROLE KEY on the Coach header ("ACCOUNTS_&_BUYER_PAYMENTS") and on
     sign-up's "You're in this one as sales_&_order_management".
  8. ACCESS DENIED was the last screen in the retired brutalist style.
"""
from pathlib import Path

SRC = Path(__file__).resolve().parents[2] / "frontend" / "src"


def src(rel):
    return (SRC / rel).read_text(encoding="utf-8")


# ── 1. no signal ─────────────────────────────────────────────────────────────
def test_an_unanswered_request_is_written_down():
    api = src("lib/api.js")
    assert "export function connectionTrouble(" in api
    # any answer clears it; a request with no answer that we did not cancel sets it
    assert "(r) => { _silence.open = false; return r; }" in api
    assert 'err?.code !== "ERR_CANCELED"' in api
    assert 'slow: err?.code === "ECONNABORTED" || err?.code === "ETIMEDOUT"' in api


def test_a_timeout_does_not_promise_nothing_saved():
    """A request that timed out may well have landed."""
    api = src("lib/api.js")
    assert "so this may or may not have saved" in api
    assert "We couldn't reach DecisionOS, so nothing was saved." in api


def test_the_shrug_gives_way_to_the_reason():
    api = src("lib/api.js")
    assert 'if (detail == null) return connectionTrouble() || "Something went wrong. Please try again.";' in api


def test_a_failed_save_toast_carries_its_reason():
    api = src("lib/api.js")
    assert "toast.error = (msg, opts) => {" in api
    assert "description: why" in api
    # never over a description the call site wrote
    assert "!opts?.description" in api


def test_a_failed_load_does_not_blame_the_server_for_the_signal():
    common = src("components/common.js")
    assert "connectionTrouble({ sticky: true })" in common
    assert "check your connection. What you have is still there" in common


def test_going_offline_is_said_before_the_save():
    notice = src("components/ConnectionNotice.js")
    assert 'window.addEventListener("offline", goOffline);' in notice
    assert "Changes won&rsquo;t save until you&rsquo;re back." in notice
    assert "<ConnectionNotice />" in src("components/Layout.js")


# ── 2. a link opened signed out ──────────────────────────────────────────────
def test_a_link_opened_signed_out_survives_sign_in():
    app = src("App.js")
    assert "rememberArrival(location.pathname + location.search);" in app
    auth = src("context/AuthContext.js")
    assert "export function rememberArrival(path)" in auth


def test_a_deliberate_sign_out_is_not_brought_back():
    auth = src("context/AuthContext.js")
    assert "if (hadUserThisLoad || !path" in auth
    assert "hadUserThisLoad = true;" in auth


# ── 3. a mistyped address ────────────────────────────────────────────────────
def test_an_unknown_address_says_so():
    app = src("App.js")
    assert '<Route path="*" element={<NotFound />} />' in app
    assert '<Route path="*" element={<Navigate to="/" replace />} />' not in app
    assert "We couldn't find that page" in app


# ── 4. one broken page ───────────────────────────────────────────────────────
def test_a_broken_page_keeps_the_navigation_and_resets_on_leaving():
    app = src("App.js")
    assert "<ErrorBoundary resetKey={location.pathname}>{children}</ErrorBoundary>" in app
    assert "<PageBoundary>{children}</PageBoundary>" in app


def test_the_last_resort_does_not_promise_a_rest_of_the_app():
    app = src("App.js")
    assert 'testid="app-broke"' in app
    assert "Nothing you saved is lost. Reload to carry on" in app


# ── 5. a deleted decision ────────────────────────────────────────────────────
def test_a_missing_decision_is_not_called_a_refusal():
    d = src("components/DecisionDialog.js")
    assert "const status = loadError?.response?.status;" in d
    assert "status === 403" in d and "status === 404" in d
    assert "This decision isn't here" in d
    assert '"decision-load-retry"' in d


# ── 6. a link to a deleted task ──────────────────────────────────────────────
def test_a_task_that_never_opened_is_not_said_to_have_closed():
    mw = src("pages/MyWork.js")
    i = mw.index('if (openTaskGone) {')
    block = mw[i:i + 600]
    assert "if (wasMine.current !== null) {" in block
    assert block.index("wasMine.current !== null") < block.index("task_removed_live")


# ── 7. raw role keys ─────────────────────────────────────────────────────────
def test_the_coach_names_the_role_in_words():
    c = src("pages/WorkCoach.js")
    assert "${target.role}`" not in c
    assert 'roleLabel(target.role, tenant?.roles, "Member")' in c
    assert 'import { roleLabel } from "../lib/departments";' in c


def test_sign_up_names_a_role_in_another_company_in_words():
    b = src("pages/onboarding/BasicsFlow.js")
    assert "as ${w.role}`" not in b
    assert "as ${roleWords(w.role)}`" in b


# ── 8. and the screens that are not the page you asked for ──────────────────
def test_access_denied_is_in_the_current_style():
    app = src("App.js")
    i = app.index("function AccessDenied()")
    block = app[i:i + 500]
    assert "border-2 border-black" not in block
    assert "This page isn't open to you" in block


def test_an_admin_download_failure_is_a_sentence():
    assert '"Download failed: " + e.message' not in src("pages/admin/ComplianceSection.js")
