"""The operating model editor fits a phone (2026-09-29).

Found walking Settings at 375px. Settings › Operations is where an owner
decides how work moves — pipelines, stages, task templates, approval gates —
and on a phone half of it could not be reached. Measured:

    the stage's role picker      cut off by  22px
    the "evidence required" tick cut off by  37px
    every row's delete button    cut off by 122px

and the page does not scroll sideways, so those were not awkward: they were
gone. The rows were single-line flexes built for a desktop with no way to
wrap — [stage name][days][role][up][down][delete] on one, and
[task title][role][evidence][delete] on another.

Every row stacks now: the thing being named takes a line, and the controls
that act on it wrap underneath.

AND THE PICKERS WERE NATIVE <select>, 76 of them, which on a phone opens the
OS wheel — against the rule the rest of the app follows with GlassSelect. The
same two faults were in StageWorkReview, which is worse, because that is an
ONBOARDING step: a new owner meets it on their phone before anything else.
"""
import re
from pathlib import Path

import pytest

FE = Path(__file__).resolve().parents[2] / "frontend" / "src"
ED = (FE / "components" / "OperatingModelEditor.js").read_text(encoding="utf-8")
SW = (FE / "components" / "StageWorkReview.js").read_text(encoding="utf-8")


def _code_only(src: str) -> str:
    """The file with its comments taken out.

    A line-prefix test is not enough: a block comment's CONTINUATION lines
    start with ordinary words, and one of the comments here is about the very
    thing being searched for — it says the pickers "were native <select>".
    That sentence should not fail the test it exists to explain.
    """
    src = re.sub(r"\{/\*.*?\*/\}", "", src, flags=re.S)   # JSX comments
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)       # block comments
    src = re.sub(r"^\s*//.*$", "", src, flags=re.M)       # line comments
    return src


FILES = [("OperatingModelEditor", ED), ("StageWorkReview", SW)]
IDS = [n for n, _ in FILES]


# ───────────────────────── no OS wheels ────────────────────────────────────
@pytest.mark.parametrize("name,src", FILES, ids=IDS)
def test_not_one_native_select_is_left(name, src):
    code = _code_only(src)
    assert "<select" not in code, f"{name} still renders a native select"
    assert "<option" not in code, f"{name} still renders native options"


@pytest.mark.parametrize("name,src", FILES, ids=IDS)
def test_each_one_is_a_glass_select(name, src):
    assert "GlassSelect" in src, name
    assert 'from "./karma/GlassSelect"' in src, name


def test_the_trigger_wears_the_same_border_as_the_inputs_beside_it():
    """A picker that looks nothing like the field next to it stops the row
    reading as one form. `pill` is the 48px page-header shape and would tower
    over these."""
    assert "const smSel = `${smInp} h-[34px] justify-between text-left`;" in ED
    assert 'variant="field"' in ED
    assert 'variant="pill"' not in ED


# ───────────────────────── the rows stack ──────────────────────────────────
def test_the_stage_name_gets_its_own_line():
    """Six controls shared one row; that is how the role picker and the
    delete ended up past the right edge."""
    i = ED.index('placeholder="Stage name"')
    row = ED[i - 220:i + 900]
    assert "min-w-0 flex-1" in row, "the name flexes rather than forcing the row wide"
    assert 'aria-label="Move stage up"' in row
    assert 'aria-label="Delete stage"' in row
    assert 'className="mt-1.5 flex flex-wrap items-center gap-1.5"' in ED, \
        "days and owner move to a line of their own, which may wrap"


def test_a_task_template_stacks_its_title_above_its_controls():
    i = ED.index('placeholder="Task title (e.g. Confirm with customer)"')
    row = ED[i - 400:i + 1200]
    assert 'aria-label="Delete task template"' in row
    assert "op-stage-task-role-" in row, "the role picker is addressable"
    assert "flex flex-wrap items-center gap-2" in row


def test_the_onboarding_step_stacks_the_same_way():
    i = SW.index('placeholder="What needs doing at this stage"')
    row = SW[i - 400:i + 1200]
    assert "min-w-0 flex-1" in row
    assert 'aria-label="Drop this task"' in row
    assert "stage-work-role-" in row


# ───────────────────────── reachable, and hittable ─────────────────────────
def test_the_icon_buttons_are_a_tap_target_not_a_pixel_hunt():
    """They were p-1 — about 22px — and hardest to hit precisely because they
    were half off the screen. Sprint 16's rule, applied where it was worst."""
    assert 'const iconBtn = "grid h-9 w-9 shrink-0 place-items-center' in ED
    assert 'className="p-1 text-muted-foreground hover:text-kr-accent"' not in ED
    assert "grid h-9 w-9 shrink-0 place-items-center" in SW


def test_every_picker_can_shrink_rather_than_push_the_row_wide():
    """min-w keeps a picker readable; flex-1 lets it give way. Without the
    second, one long department name is enough to push the delete off the
    edge again."""
    for frag in ("${smSel} min-w-[10rem] flex-1", "${smSel} min-w-[9rem] flex-1"):
        assert frag in ED, frag


def test_the_checkboxes_are_big_enough_to_hit():
    assert 'type="checkbox" className="h-4 w-4"' in ED


# ───────────────────────── said out loud, for the next reader ──────────────
def test_the_file_records_what_was_wrong_and_why_it_is_shaped_this_way():
    assert "UNUSABLE ON A PHONE" in ED
    assert "22px" in ED and "122px" in ED, "the measurements, so nobody re-finds them"
    assert "scroll sideways" in ED, "why clipped meant gone, not merely awkward"
