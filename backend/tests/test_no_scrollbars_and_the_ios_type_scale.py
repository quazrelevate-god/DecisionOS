"""No scrollbars anywhere, and iOS type scales with the page (2026-10-13).

1. THE SCROLLBAR. Show all lifts the Desk's black sheet, and on the founder's
   Android a bar appeared down its right edge and squeezed the rows. index.css
   styled ::-webkit-scrollbar at 10px for the whole app, and in Chromium —
   Android's WebView included — styling the bar is what turns the thin overlay
   one into a classic bar that takes layout width. The founder's rule now: no
   scrollbar anywhere in the app. Everything still scrolls; nothing is drawn.

2. THE iOS SCALE. Phones draw at 0.8 (hooks/useUiScale). In the iPhone 17 Pro
   simulator (iOS 26.5) a 100px box came back 80px and 100px of text came back
   100px — WebKit applied CSS zoom to boxes and not to type. Every word was a
   quarter too big for its box: the greeting wrapped to three lines, the hero
   grew 75px, and the Desk sheet cut its three rows to one. The zoom check
   measured a box only, so it called that a success. It now measures a box AND
   a line of type, and anything short of both takes the viewport route —
   which is pinned in the app (so a field still cannot focus-zoom), is not
   overwritten by the native viewport pin, and is announced with a resize
   because WKWebView re-lays the page out at the new width without firing one.
"""
import re
from pathlib import Path

FE = Path(__file__).resolve().parents[2] / "frontend" / "src"
CSS = (FE / "index.css").read_text(encoding="utf-8")
SCALE = (FE / "hooks" / "useUiScale.js").read_text(encoding="utf-8")
PIN = (FE / "lib" / "native" / "viewport.js").read_text(encoding="utf-8")


def _no_comments(src: str) -> str:
    src = re.sub(r"\{/\*.*?\*/\}", "", src, flags=re.S)
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    return re.sub(r"^\s*//.*$", "", src, flags=re.M)


def test_one_global_rule_hides_every_scrollbar():
    css = _no_comments(CSS)
    assert "* { scrollbar-width: none !important; -ms-overflow-style: none !important; }" in css
    assert re.search(r"\*::-webkit-scrollbar \{ display: none !important; width: 0 !important; height: 0 !important;", css)


def test_nothing_draws_a_bar_back():
    css = _no_comments(CSS)
    # No sized or styled bar anywhere in the stylesheet…
    assert not re.search(r"::-webkit-scrollbar\s*\{[^}]*width:\s*[1-9]", css)
    assert "::-webkit-scrollbar-thumb" not in css
    assert not re.search(r"scrollbar-width:\s*(thin|auto)", css)
    # …and no utility in the components asks for one.
    offenders = []
    for path in list(FE.rglob("*.js")) + list(FE.rglob("*.jsx")):
        src = _no_comments(path.read_text(encoding="utf-8"))
        if re.search(r"scrollbar-width:\s*(thin|auto)|scrollbarWidth:\s*[\"'](thin|auto)", src):
            offenders.append(str(path.relative_to(FE)))
    assert not offenders, f"a thin/auto scrollbar is back in: {offenders}"


def test_the_zoom_check_measures_type_as_well_as_boxes():
    code = _no_comments(SCALE)
    assert "effectiveScale" not in code, "the box-only ruler must not come back"
    body = code[code.index("const zoomLanded = (s) =>"):]
    body = body[: body.index("const widenViewport")]
    assert "font:100px/1 monospace" in body
    assert "type.getBoundingClientRect().height / 100" in body
    assert "Math.abs(boxAt - s) <= 0.01 && Math.abs(typeAt - s) <= 0.02" in body
    assert "if (zoomLanded(s)) return;" in code


def test_the_viewport_route_is_pinned_in_the_app_and_announced():
    code = _no_comments(SCALE)
    assert "isNativeApp()" in code
    assert "minimum-scale=${fit}, maximum-scale=${fit}, user-scalable=no, viewport-fit=cover" in code
    assert 'meta.setAttribute("data-ui-width", String(width));' in code
    assert 'meta.removeAttribute("data-ui-width");' in code, "the cleanup must drop the marker"
    # WKWebView does not fire resize on a viewport change: the hook does, once the width has moved.
    assert 'window.dispatchEvent(new Event("resize"))' in code
    assert "window.innerWidth !== before" in code


def test_the_native_pin_does_not_undo_the_viewport_route():
    code = _no_comments(PIN)
    guard = code.index('if (tag.hasAttribute("data-ui-width")) return true;')
    assert guard < code.index('tag.setAttribute("content", PINNED);')
