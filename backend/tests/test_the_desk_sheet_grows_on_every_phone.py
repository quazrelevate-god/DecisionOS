"""Show all grows the Desk sheet on every phone (2026-10-13).

Found on the founder's OnePlus 7T. Tapping "Show all" on the phone Desk's
black sheet did two wrong things at once:

1. THE WHOLE PAGE SLID DOWN UNDER THE BLUR. While the sheet is lifted out
   (`position: fixed`) a spacer holds its place in the page's flex column.
   Below lg the hero is `order-1` and the board `order-2`; the spacer had no
   order, so it was `order: 0` — laid out FIRST, above the greeting — and the
   greeting, score and KPI tiles moved down by the sheet's height.

2. THE SHEET DID NOT GROW. The phone runs with Android's animation scales at
   0, and the WebView left the sheet's inline top/height transition frozen on
   its first frame. The list had already switched to its scroller (that only
   happens at `full`), so the card read as a small box scrolling inside a
   sheet that never moved. Reproduced in Chromium by pausing every animation
   (CDP Animation.setPlaybackRate 0): the board stays at rest with the list
   clipped to 175px — the founder's screenshot to the pixel.

Now the spacer takes the board's order, and the grow lands even when it cannot
glide: reduced motion places it with no transition, and a settle check drops
the transition once the glide has had its time and the sheet is not there.

3. AND THEN A REAL FINGER (same day, same phone). With the glide fixed, a tap
   through adb still left the sheet short: the debugger showed the click's
   render arriving two frames late, and the one-shot measure — two frames
   after the effect — came out with nothing hidden, so `full` equalled `rest`
   (453.986 own px both). A scripted .click() never raced like that, which is
   why every emulator run passed. So the sheet no longer trusts one reading:
   while it is up, every commit (and the settle timer) asks the list whether
   rows are still below the fold, net of any glide in flight, and grows by
   exactly that much up to the top bar.
"""
import re
from pathlib import Path

FE = Path(__file__).resolve().parents[2] / "frontend" / "src"
DESK = (FE / "pages" / "Desk.js").read_text(encoding="utf-8")


def _code_only(src: str) -> str:
    src = re.sub(r"\{/\*.*?\*/\}", "", src, flags=re.S)
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    src = re.sub(r"^\s*//.*$", "", src, flags=re.M)
    return src


CODE = _code_only(DESK)


def _tag(testid: str) -> str:
    """The self-closing JSX tag that carries this data-testid (both are `<div … />`)."""
    at = CODE.index(f'data-testid="{testid}"')
    start = CODE.rindex("<div", 0, at)
    end = CODE.index("/>", at)
    return CODE[start:end]


def test_the_spacer_stands_where_the_board_stood_not_above_the_greeting():
    spacer = _tag("desk-board-spacer")
    assert "order-2" in spacer, "the spacer must share the board's flex order, or it is laid out above the hero"
    assert "lg:order-none" in spacer
    assert "shrink-0" in spacer, "the spacer holds an exact height; it must not be squeezed"
    # And the board it stands in for really is order-2 below lg.
    assert re.search(r'DEX_SLIDER && "order-2 min-h-0 flex-1 lg:order-none', CODE)


def test_the_grow_does_not_depend_on_a_transition_finishing():
    assert "const [popSnap, setPopSnap] = useState(false)" in CODE
    # The board's glide can be switched off…
    assert re.search(r'transition:\s*popSnap \? "none" :', CODE)
    # …up front under reduced motion…
    assert "(prefers-reduced-motion: reduce)" in CODE
    assert "setPopSnap(prefersReducedMotion())" in CODE
    # …and after the fact when the sheet did not reach `full`.
    assert re.search(r"setTimeout\(\(\) => \{[^}]*getBoundingClientRect\(\)\.height \* k;[^}]*setPopSnap\(true\)", CODE, re.S)
    assert CODE.count("landed(full)") == 1, "one geometry path (popGeometry), checked once it has had its time"


def test_the_sheet_corrects_itself_until_the_list_stops_scrolling():
    # One geometry for the first grow and every correction after it.
    assert "function popGeometry(p, want, sheet)" in CODE
    assert "popGeometry(base, rest.height + extra, deskSheet)" in CODE
    # The one-shot measure also reads the list itself, in case it is already a scroller.
    assert re.search(r"list \? list\.scrollHeight - list\.clientHeight : 0", CODE)
    # The correction: what the list hides, net of a glide still in flight.
    body = CODE[CODE.index("const growToList = useCallback"):]
    body = body[: body.index("}, [deskSheet]);")]
    assert "list.scrollHeight - list.clientHeight - (p.full.height - drawn)" in body
    assert "popGeometry(p, p.full.height + short, deskSheet)" in body
    assert 'prev.at === "full"' in body, "a correction must never re-open a sheet that is closing"
    # It runs after every commit while the sheet is up, and once more when the glide should have landed.
    assert "useLayoutEffect(() => { popRef.current = pop; growToList(); });" in CODE
    assert re.search(r"settle = setTimeout\(\(\) => \{.*?growToList\(\);", CODE, re.S)


def test_the_effect_cleans_up_both_frames_and_the_settle_check():
    assert "cancelAnimationFrame(raf); cancelAnimationFrame(raf2); clearTimeout(settle);" in CODE


def test_the_scrim_fade_honours_reduced_motion():
    assert "motion-reduce:transition-none" in _tag("desk-board-scrim")
