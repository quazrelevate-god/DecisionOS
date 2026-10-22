"""Dex Ask in the dock grows with the conversation (2026-10-22, founder).

The panel opened to the Desk sheet's line and stayed that height for good, so
a long conversation was read through a letterbox with most of the screen
unused above it. It still OPENS at the sheet's line; as the conversation
outgrows that, it grows up the screen with it, to just under the status bar,
and only then does the transcript scroll inside. Clearing brings it back down.
Checked in a browser at phone size: 442px resting, then 500, 636 and 790px
(the ceiling) as questions were asked, scrolling from there; Clear, 442 again.
"""
import re
from pathlib import Path

SRC = (Path(__file__).resolve().parents[2] / "frontend" / "src" / "components" / "mobile" / "DockSlider.jsx").read_text(encoding="utf-8")
CODE = re.sub(r"/\*.*?\*/", "", SRC, flags=re.S)


def test_it_opens_at_the_sheet_line_and_grows_to_just_under_the_status_bar():
    fit = CODE[CODE.index("const fit = () => {"):CODE.index("fit();")]
    assert "const resting = (r.bottom - deskSheetTop()) / zoom;" in fit
    assert "const ceiling = Math.max(resting, (r.bottom - safeTopOnScreen()) / zoom - TOP_GAP);" in fit
    assert "el.style.height = `${Math.round(Math.min(ceiling, Math.max(resting, need)))}px`;" in fit
    # The CSS cap (85dvh) would stop it short of the ceiling; the ceiling replaces it.
    assert "el.style.maxHeight = `${Math.round(ceiling)}px`;" in fit
    assert "const TOP_GAP = 20;" in CODE
    assert "height:var(--sa-top,0px)" in CODE, "the status bar is measured, not guessed"


def test_it_follows_the_conversation_as_it_changes():
    assert "new ResizeObserver(() => fit())" in CODE
    assert "ro.observe(contentRef.current)" in CODE
    # Measured from a box sized by its content, not by the panel.
    assert '<div ref={contentRef} className="flex flex-col gap-2.5" data-testid="dock-ask-content">' in CODE
    assert "<div ref={scrollRef} className=\"ng-scroll-quiet min-h-0 flex-1 overflow-y-auto" in CODE


def test_no_height_transition():
    # On a phone with animations off a CSS height transition freezes at its
    # first frame (the Desk sheet's lesson): the panel sets its height outright.
    panel = CODE[CODE.index("function DockAskPanel("):]
    assert "transition" not in panel[: panel.index("return (")]
