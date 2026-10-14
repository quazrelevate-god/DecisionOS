"""The Desk's Workflows tile, uncluttered on a phone (2026-10-13, founder).

The founder marked three things on the phone tile to go — the "N cards
forecast to miss their target date" line, the "3 you" legend under the bar,
and the NEXT UP eyebrow — and asked for what is left to be re-arranged so the
tile reads fuller but spacious: the count beside the icon, the card's chip /
name / status in the right half, and the two moves side by side along the
tile's foot instead of stacked in a 220px column. The tile came down from 205
to 150 visual px, which is room the Desk's black sheet gets back (three rows
on an iPhone 13 mini, where it had two).

It is a separate PHONE body, like `wide`: the desktop tile keeps all three
elements and every pixel it had.
"""
import re
from pathlib import Path

TILE = (Path(__file__).resolve().parents[2] / "frontend" / "src" / "pages" / "desk" / "WorkflowsTile.jsx").read_text(encoding="utf-8")


def _no_comments(src: str) -> str:
    src = re.sub(r"\{/\*.*?\*/\}", "", src, flags=re.S)
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    return re.sub(r"^\s*//.*$", "", src, flags=re.M)


CODE = _no_comments(TILE)
PHONE = CODE[CODE.index("if (phone) {"):]
PHONE = PHONE[: PHONE.index("\n  return (\n")]
DESKTOP = CODE[CODE.index("\n  return (\n", CODE.index("if (phone) {")):]


def test_the_phone_body_is_chosen_by_the_breakpoint():
    assert 'import { useIsMobile } from "../../hooks/useIsMobile";' in CODE
    assert "const phone = useIsMobile();" in CODE
    # The hook sits with the others, before any early return.
    assert CODE.index("const phone = useIsMobile();") < CODE.index("if (wide) {")


def test_the_three_marked_elements_are_gone_from_the_phone():
    assert "Next up" not in PHONE
    assert "forecast to miss" not in PHONE and "-at-risk" not in PHONE
    # No visible legend ("3 you"); the split is spoken in the bar's aria-label only.
    assert "{p.n} {p.label}" not in PHONE, "the bar's legend ('3 you') must not come back"
    assert "{i > 0 ? \"· \" : \"\"}" not in PHONE


def test_the_phone_arrangement():
    # Count beside the icon; "Need attention" under it.
    icon_row = PHONE[PHONE.index("<IconChip"): PHONE.index("Need attention")]
    assert "BigNumeral" in icon_row
    # The card itself: chip, name, status.
    for tid in ("-next-reason", "-next-title"):
        assert tid in PHONE
    # A long reason ends in an ellipsis rather than being clipped.
    assert '<span className="min-w-0 truncate">{nextUp.reasonLabel}</span>' in PHONE


def test_the_label_is_one_line():
    # Second pass (founder): "Workflows —" goes from the visible label — one line,
    # "Need attention" — and stays for a screen reader.
    assert "Workflows — need attention" not in PHONE
    assert '<span className="sr-only">Workflows — </span>Need attention' in PHONE
    label = PHONE[PHONE.index('<p className="ng-stat__label'):]
    assert "whitespace-nowrap" in label[: label.index(">")]


def test_there_is_no_bar():
    # Third pass (2026-10-14, founder): "3 / 13 is itself enough. There is no
    # need of progress bar." Not the split, not the share, not a legend.
    assert "-split" not in PHONE and "-share" not in PHONE
    assert "p.bar" not in PHONE and "h-1.5" not in PHONE


def test_each_move_sits_under_its_own_half():
    # Two rows either side of one separator, which runs the full height between
    # the two buttons; Approve under the left half, Open Workflows the right.
    assert 'className="grid grid-cols-[auto_1px_minmax(0,1fr)] grid-rows-[1fr_auto] gap-x-5 gap-y-3"' in PHONE
    assert "col-start-2 row-span-2 row-start-1 w-px self-stretch" in PHONE
    action = PHONE[PHONE.index("-next-action`}"):]
    action = action[: action.index("</button>")]
    assert "col-start-1 row-start-2" in action
    # It fills the half without widening it, and always says "Approve" — the
    # founder: "whatever the workflow stage it is, keep a static approve button".
    # The real move is still made, and still named for a screen reader.
    assert "w-0 min-w-full" in action
    assert '<span className="whitespace-nowrap">Approve</span>' in action
    assert "nextUp.actionLabel}</span>" not in action, "no stage name on the phone's button"
    assert 'aria-label={/^approve$/i.test(nextUp.actionLabel) ? "Approve" : `Approve: ${nextUp.actionLabel}`}' in action
    assert "move.mutate()" in action
    link = PHONE[PHONE.index("-open`}"):]
    assert "col-start-3 row-start-2" in link[: link.index("</Link>")]
    assert "hasMove ? PILL_QUIET : PILL_INK" in PHONE


def test_desktop_keeps_everything_it_had():
    assert "Next up" in DESKTOP
    assert "forecast to miss" in DESKTOP
    assert "{p.n} {p.label}" in DESKTOP
