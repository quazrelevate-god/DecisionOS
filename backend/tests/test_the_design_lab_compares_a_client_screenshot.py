"""The design lab's "client screenshot vs now" check (2026-10-13).

The client tested 1.0.7 on a 412-wide Android and found the text small. The lab
now puts a phone screenshot beside the live Desk at the same CSS width, with a
table of on-screen text sizes against what 1.0.7 drew (measured from that build:
11.2dp for most labels, under Android's 12sp floor).

Three promises are pinned here:
  * the screenshot stays in the browser tab — the component has no network
    code at all, so a client's names and numbers are never uploaded or saved;
  * the dropdown is the glass one, never a native <select> (house rule);
  * the frame meant for the real Desk cannot be put into fixture mode by the
    lab's other frames, and nothing here drags the fixture DATA into the
    production bundle (/design-lab ships for owners; names.js exists so it
    does not have to).
"""
import re
from pathlib import Path

SRC = Path(__file__).resolve().parents[2] / "frontend" / "src"
CMP = (SRC / "pages" / "designlab" / "ScreenshotCompare.jsx").read_text(encoding="utf-8")
LAB = (SRC / "pages" / "DesignLab.js").read_text(encoding="utf-8")
NAMES = (SRC / "fixtures" / "mobile" / "names.js").read_text(encoding="utf-8")
FIX = (SRC / "fixtures" / "mobile" / "index.js").read_text(encoding="utf-8")


def _code(src: str) -> str:
    src = re.sub(r"\{/\*.*?\*/\}", "", src, flags=re.S)
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    return re.sub(r"^\s*//.*$", "", src, flags=re.M)


def test_the_lab_mounts_the_comparison_and_can_show_it_alone():
    assert 'import ScreenshotCompare from "./designlab/ScreenshotCompare";' in LAB
    assert "<ScreenshotCompare />" in LAB
    assert '.get("only") === "compare"' in LAB and "<ScreenshotCompare alone />" in LAB


def test_the_screenshot_never_leaves_the_tab():
    code = CMP  # raw: see test_no_native_dropdown
    for net in ("lib/api", "fetch(", "axios", "XMLHttpRequest", "FormData", "sendBeacon", "localStorage", "indexedDB"):
        assert net not in code, f"{net} has no business in the screenshot comparison"
    assert "URL.createObjectURL(file)" in code
    assert "URL.revokeObjectURL(shot.url)" in code


def test_no_native_dropdown():
    # On the raw source: `accept="image/*"` opens what a comment-stripper takes
    # for a block comment, and no comment here mentions a select anyway.
    assert "<select" not in CMP
    assert "<GlassSelect" in CMP


def test_the_real_desk_frame_cannot_be_put_into_fixture_mode():
    assert 'export const REAL_DATA_FRAME = "dos-real-data";' in NAMES
    assert "if (typeof window !== \"undefined\" && window.name === REAL_DATA_FRAME) return null;" in FIX
    assert "name={REAL_DATA_FRAME}" in CMP and 'src="/inbox?fixture=off"' in CMP


def test_the_fixture_data_stays_out_of_the_lab_bundle():
    for src in (CMP, LAB):
        assert not re.search(r'from "\.\./(\.\./)?fixtures/mobile"', src), "import names.js, never fixtures/mobile/index.js"
    assert 'from "../../fixtures/mobile/names"' in CMP


def test_the_107_reference_is_the_measured_one():
    # Measured from commit 5331bf9 (Play release 1.0.7) at 412 CSS px, ui-scale 0.8.
    assert "kpiLabel: 11.2" in CMP and "rowTitle: 13.6" in CMP and "greeting: 21.1" in CMP
