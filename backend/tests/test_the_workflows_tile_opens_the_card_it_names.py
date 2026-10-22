"""The Desk's Workflows tile opens the card it names, and the board glows it
(FIX-3, 2026-10-21, founder).

The client was confused by the tile's two buttons: "Approve" under the left
half, "Open Workflows" under the right, while the card they were about sat on
the right. And Approve signed off a stage from a title and a chip, without the
card ever being seen. So the tile makes no move any more: one button, "Open in
Workflows", the tile's full width, opens the board on that card — its board's
tab, its stage opened, brought into view, with a subtle glow — where the whole
card can be read and moved on.

Checked in a browser on a phone-sized screen against a local copy of the demo.
"""
import re
from pathlib import Path

FE = Path(__file__).resolve().parents[2] / "frontend" / "src"


def _code(rel):
    src = (FE / rel).read_text(encoding="utf-8")
    src = re.sub(r"\{/\*.*?\*/\}", "", src, flags=re.S)
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    return re.sub(r"^\s*//.*$", "", src, flags=re.M)


TILE = _code("pages/desk/WorkflowsTile.jsx")
BOARD = _code("pages/Workflows.js")


def test_the_tile_makes_no_move():
    assert "useMutation" not in TILE and "/advance" not in TILE
    assert "-next-action" not in TILE
    assert "onMoved" not in _code("pages/Desk.js")


def test_one_button_the_tiles_width_to_the_card():
    assert 'Open in Workflows' in TILE and "Open Workflows" not in TILE
    assert "export function boardLinkFor(nextUp) {" in TILE
    assert ("`/workflows?wf=${encodeURIComponent(nextUp.id)}"
            "${nextUp.type ? `&wf_type=${encodeURIComponent(nextUp.type)}` : \"\"}`") in TILE
    assert "const boardLink = boardLinkFor(!loading && !quiet ? nextUp : null);" in TILE
    # Under both halves on the phone and on desktop, centred, in the ink.
    assert '{openBoard("col-span-3 row-start-2 px-4")}' in TILE
    assert '{openBoard("col-span-3")}' in TILE
    assert "className={cn(ACTION_PILL, PILL_INK, place)}" in TILE
    assert "justify-center" in TILE[TILE.index("const ACTION_PILL"):TILE.index("const PILL_INK")]
    # The phone type rules style the button by this id (index.css).
    assert "data-testid={`${testid}-open`}" in TILE


def test_the_board_opens_on_the_card_and_glows_it():
    assert 'data-focus={w.id === focusWf ? "true" : undefined}' in BOARD
    assert "ring-2 ring-ng-ink ring-offset-2" not in BOARD
    # Its stage opens (a phone starts every stage folded), once per card, so a
    # refetch never drags the page back to it.
    focus = BOARD[BOARD.index("const focusedFor = useRef(null);"):]
    focus = focus[: focus.index("}, [focusWf, data]);")]
    assert "setOpenStages((s) => ({ ...s, [card.stage]: true }));" in focus
    assert "focusedFor.current = focusWf;" in focus
    assert "scrollIntoView" in focus


def test_a_linked_board_does_not_trap_its_tab():
    sync = BOARD[BOARD.index("const pipelineKeys"):]
    sync = sync[: sync.index("}, [focusWfType, pipelineKeys]);") + 40]
    assert "focusWfType !== tab" not in sync


def test_the_glow_is_soft_and_gold():
    css = (FE / "index.css").read_text(encoding="utf-8")
    rule = css[css.index('.ng-bento[data-focus="true"] {'):]
    rule = rule[: rule.index("}")]
    assert "hsl(var(--ng-gold) / .32)" in rule and "0 0 16px 2px" in rule
    assert '.ng-bento[data-focus="true"]:not([role="dialog"]):not([role="alertdialog"]):hover {' in css
