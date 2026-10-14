"""2026-10-12 — the phone walkthrough and the user guide.

The client asked for an in-app walkthrough and a user guide before the store
release. The walkthrough is remembered on the PERSON (POST /auth/tour/done), so
a reinstall or a second phone does not replay it; the guide is a public web
page at /guide that the app opens from More, Settings and the walkthrough's
last step. These tests hold both ends together.
"""
import json
import os
import re
from pathlib import Path

import pytest

import routers.auth as rauth
from models.auth import TourDoneInput

single_process = pytest.mark.skipif(
    bool(os.environ.get("PYTEST_XDIST_WORKER")),
    reason="rebinds module-level db globals - single-process only",
)

ROOT = Path(__file__).resolve().parents[2]


def _fe(*parts):
    return (ROOT / "frontend").joinpath(*parts).read_text(encoding="utf-8")


@single_process
def test_finishing_the_walkthrough_is_kept_on_the_person(with_test_db):
    async def body(db):
        saved = rauth.db
        rauth.db = db
        try:
            await db.users.insert_one({"id": "u-asha", "tenant_id": "t-1", "name": "Asha", "role": "member"})
            await db.users.insert_one({"id": "u-ravi", "tenant_id": "t-1", "name": "Ravi", "role": "member"})
            asha = {"id": "u-asha", "tenant_id": "t-1"}

            r = await rauth.tour_done(TourDoneInput(version=1), asha)
            assert r["ok"] and r["tour_seen"]["version"] == 1
            doc = await db.users.find_one({"id": "u-asha"})
            assert doc["tour_seen"]["version"] == 1 and doc["tour_seen"]["at"]

            # A version out of range is clamped, never stored as given.
            await rauth.tour_done(TourDoneInput(version=0), asha)
            assert (await db.users.find_one({"id": "u-asha"}))["tour_seen"]["version"] == 1
            await rauth.tour_done(TourDoneInput(version=500), asha)
            assert (await db.users.find_one({"id": "u-asha"}))["tour_seen"]["version"] == 99

            # Only the person who finished it.
            assert "tour_seen" not in (await db.users.find_one({"id": "u-ravi"}))
        finally:
            rauth.db = saved

    with_test_db(body)


def test_the_walkthrough_is_mounted_and_reports_back():
    layout = _fe("src", "components", "Layout.js")
    assert "<Walkthrough />" in layout
    tour = _fe("src", "components", "mobile", "Walkthrough.jsx")
    assert '"/auth/tour/done"' in tour and "TOUR_VERSION" in tour
    # It waits for every first-run gate before it starts.
    for gate in ("welcome_pending", "needsOwnerCredentials", "termsAccepted", "dos_welcome"):
        assert gate in tour, gate
    # Android's back gesture skips it rather than leaving the page under it.
    assert "useBackDismiss" in tour


def test_the_guide_phone_always_shows_the_step_it_was_last_asked_for():
    """2026-10-13 (founder): clicking a step sometimes left the mockup on the old
    screen until a refresh, and phone screens could come up blank. The stage
    phone's swap ran twice for a cached screen (`complete` AND `load`) and lost
    track of which image was in front. Each change is numbered now, waits on one
    decode, and only the latest may finish; static phones hold a single image."""
    js = _fe("public", "guide", "guide.js")
    assert "if (token !== p.token) return;" in js
    assert "nxt.onload = swap" not in js and "if (nxt.complete) swap()" not in js
    assert 'makePhone("", { live: true })' in js, "only the stage phone swaps"
    assert "makePhone(plain(d.html), { lazy: true })" in js, "a step's own phone is a single, static image"
    css = _fe("public", "guide", "guide.css")
    sheet = css[css.index("  .toc-sheet {"):css.index("  .toc-open .toc-scrim")]
    assert "display: flex" not in sheet.split("}")[0], "the closed contents sheet must stay display:none"
    assert '"verify:guide"' in _fe("package.json")


def test_the_phone_finds_help_in_preferences_not_in_more():
    """2026-10-12 (founder): Help & guide left the More menu for Settings, and
    on the phone Settings is called Preferences."""
    guide = _fe("src", "lib", "guide.js")
    assert "https://www.decisionos.biz" in guide and "@capacitor/browser" in guide
    assert '"@capacitor/browser"' in _fe("package.json")
    more = _fe("src", "components", "mobile", "AllAppsPanel.jsx")
    assert 'action: "guide"' not in more and "openGuide" not in more
    assert 't("nav.preferences", "Preferences")' in more
    assert "openGuide" not in _fe("src", "components", "mobile", "DockSlider.jsx")
    settings = _fe("src", "pages", "Settings.js")
    assert "<HelpStrip />" in settings, "Help sits at the top of Settings for owners and members alike"
    assert "settings-open-guide" in settings and "settings-replay-tour" in settings and "?tour=1" in settings
    assert '<span className="lg:hidden">Preferences</span>' in settings
    tour = _fe("src", "components", "mobile", "Walkthrough.jsx")
    assert 'openGuide(steps?.[steps.length - 1]?.guide)' in tour and "Preferences, where Help & guide lives" in tour
    i18n = _fe("src", "i18n.js")
    assert i18n.count("preferences: ") >= 3, "Preferences is labelled in English, Hindi and Tamil"


def test_the_company_brain_points_a_phone_at_the_bar():
    brain = _fe("src", "pages", "CompanyBrain.js")
    # The phone's Ask is a swipe left on the dock, not the desktop Ask page.
    assert "{!isMobile && (" in brain and "company-brain-ask-dex" in brain
    assert 'hintDockSlider("ask")' in brain and "company-brain-ask-hint" in brain
    slider = _fe("src", "components", "neuglass", "DexSlider.jsx")
    assert '"dos:slider-hint"' in slider and "stopHint()" in slider
    assert '"dos:slider-hint"' in _fe("src", "lib", "dockHint.js")
    # No native dropdowns, no window.confirm, no pre-redesign blue on the page.
    docs = _fe("src", "pages", "BrainDocuments.js")
    for src in (brain, docs):
        assert not re.search(r"<select[\s>]", src) and "window.confirm(" not in src
    assert "bg-brand-600" not in docs and "nm-tile" not in docs


def test_error_pills_float_at_the_top_and_never_push_the_page():
    stack = _fe("src", "components", "TopNotice.jsx")
    assert "createPortal" in stack and "top-notices" in stack
    css = _fe("src", "index.css")
    assert ".top-notices {" in css and "position: fixed;" in css[css.index(".top-notices {"):css.index(".top-notices {") + 200]
    assert "<TopNotice" in _fe("src", "components", "mobile", "StaleStamp.jsx")
    assert "<TopNotice" in _fe("src", "components", "ConnectionNotice.js")
    assert "<TopNotice" in _fe("src", "components", "mobile", "DexFailureNotice.jsx")
    assert 'className="shrink-0" data-testid="desk-stale"' not in _fe("src", "pages", "Desk.js")


def test_approvals_leave_and_the_brain_wear_my_works_picture():
    css = _fe("src", "index.css")
    for room in ("approvals", "leave", "company-brain"):
        assert f'html[data-page="{room}"] .app-sky__art' in css, room
        assert f'html[data-page="{room}"],' in css or f'html[data-page="{room}"] {{' in css, room


def test_the_guide_is_served_and_not_swallowed_by_the_app():
    server = _fe("server.js")
    assert '"/guide", "/guide/"' in server
    sw = _fe("src", "service-worker.js")
    assert r"/^\/guide(\/|$)/" in sw, "the service worker must not answer /guide with the app shell"
    assert '"guide",' in _fe("scripts", "prune-native-assets.mjs"), "the guide is web-only, not in the APK"


def test_every_step_of_the_guide_points_at_a_real_screen_and_control():
    html = _fe("public", "guide", "index.html")
    data = json.loads(_fe("public", "guide", "shots.json"))["shots"]
    pairs = re.findall(r'data-shot="([^"]+)" data-target="([^"]+)"', html)
    assert len(pairs) >= 60
    for shot, target in pairs:
        assert (ROOT / "frontend" / "public" / "guide" / "shots" / f"{shot}.webp").exists(), shot
        for key in target.split("+"):
            assert key in data.get(shot, {}), f"{shot} has no box for {key}"
    # The anchors the app links to exist on the page.
    assert 'id="start"' in html
    for anchor in ("sign-in", "decide", "ask", "my-work", "faq"):
        assert f'id="{anchor}"' in html, anchor
