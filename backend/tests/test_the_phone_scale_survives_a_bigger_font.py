"""The phone scale survives Android's font size (FIX-4, 2026-10-21).

The client: on OnePlus / OPPO / Realme phones on OxygenOS / ColorOS 16 (and
Vivo), every screen came up oversized — the greeting wrapped to four lines,
"Complaints" was cut off, the dock covered the Desk's sheet. Reproduced on an
Android 16 emulator by moving the system font size one step (1.15):

1. Android's web view draws text at the system font size, so the check that
   CSS zoom had landed (hooks/useUiScale.zoomLanded) measured a 100px line at
   115 x 0.8 instead of 80 and decided zoom had failed.
2. Its fallback lays the page out wider (width=515) and pins the scale at 0.8,
   but Android's WebView ignores that width unless wide viewport is on, so the
   page stayed at 1.0 — every box a quarter too big, the text bigger still.

Now the line is measured against itself outside the zoom, and MainActivity
turns wide viewport on so the fallback works wherever it is still needed.
Checked on the emulator at font sizes 1.0, 1.15 and 1.3.
"""
import re
from pathlib import Path

FE = Path(__file__).resolve().parents[2] / "frontend"


def _code(src):
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    return re.sub(r"^\s*//.*$", "", src, flags=re.M)


def test_type_is_measured_against_itself_outside_the_zoom():
    code = _code((FE / "src" / "hooks" / "useUiScale.js").read_text(encoding="utf-8"))
    check = code[code.index("const zoomLanded = (s) =>"): code.index("const widenViewport")]
    assert "const type = ruler(document.body, TYPE, true);" in check
    assert "const plain = ruler(document.documentElement, TYPE, true);" in check
    assert "plain.remove();" in check


def test_android_honours_the_viewport_width():
    main = (FE / "android" / "app" / "src" / "main" / "java" / "com" / "decisionos" / "app" / "MainActivity.java").read_text(encoding="utf-8")
    assert "webView.getSettings().setUseWideViewPort(true);" in main
    # The text keeps following the phone's font size (B32): no text zoom pin.
    assert "setTextZoom" not in main
