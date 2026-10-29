"""Two phone tweaks (founder, 2026-10-22).

1. The Requests page wears the Money page's sky: the picture, the darker
   secondary text, the gradient and no blur on its glass.
2. The dock's More menu: Preferences is a pill the size of the others, filling
   the half-row the Requests tile left (the owner has nine tiles); and the
   "More" heading is gone, so the sheet is that much shorter. Checked in a
   browser at phone size: ten pills in five full rows. The sheet's top corners
   match the pills (30px: the pill's 22px end plus the 8px around it, one
   centre, an even 8px gap); the bottom corners and the foot are untouched.
"""
from pathlib import Path

SRC = Path(__file__).resolve().parents[2] / "frontend" / "src"
CSS = (SRC / "index.css").read_text(encoding="utf-8")
DOCK = (SRC / "components" / "mobile" / "DockSlider.jsx").read_text(encoding="utf-8")
PANEL = (SRC / "components" / "mobile" / "AllAppsPanel.jsx").read_text(encoding="utf-8")


def test_requests_takes_every_money_sky_rule():
    # 2026-10-29 — and Notifications wears it too (the founder: not the amber glow).
    assert 'html[data-page="finance"],\nhtml[data-page="requests"],\nhtml[data-page="notifications"] {\n    --sky-art: url("/sky/finance.webp");' in CSS
    assert 'html[data-page="finance"] .app-sky,\nhtml[data-page="requests"] .app-sky,\nhtml[data-page="notifications"] .app-sky {' in CSS
    assert 'html[data-page="requests"] .ng-frost:not(.ng-keep-blur),' in CSS
    # Every finance rule has its requests twin.
    assert CSS.count('html[data-page="finance"]') == CSS.count('html[data-page="requests"]')


def test_preferences_fills_the_hole_and_never_leaves_one():
    assert "const wide = tiles.length % 2 === 0;" in DOCK
    assert "...buildUtility({ user, t }).map((x) => ({ ...x, wide }))" in DOCK
    assert "wide: true" not in DOCK
    assert "const fillHole = shown.length % 2 === 1;" in PANEL


def test_the_more_sheet_has_no_heading():
    more = DOCK[DOCK.index("function DockMore("):DOCK.index("/* THE BAR, GROWN INTO A CONVERSATION.")]
    assert 'bottomnav.more' not in more, "no 'More' label inside the sheet"
    assert "px-2 pb-2 pt-2" in more, "8px on every side: the pills sit concentric in the 30px top corners"


def test_the_more_sheets_top_corners_follow_the_pills():
    """2026-10-22 (founder): the top corners match the pills inside — 30px, a
    44px pill's 22px end plus the 8px it sits in, so corner and pill end share
    one centre. The bottom pair keeps the bar's own radius."""
    slider = (SRC / "components" / "neuglass" / "DexSlider.jsx").read_text(encoding="utf-8")
    assert '"flex-col rounded-b-[calc(var(--desk-slider-track)/2)] rounded-t-[1.875rem]"' in slider
