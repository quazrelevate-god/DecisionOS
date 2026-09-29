"""The Ops page only offers what it can deliver (2026-09-29).

Yokesh walked /operating-score in the browser and asked what should come off
it. Three controls promised something the product could not give:

  * "See breakdown >" on all four category cards. The items behind it
    (demoDrivers / demoDrilldowns) exist for the demo tenant alone, so on every
    real company the dialog answered "a breakdown of what makes it up isn't
    shown for this part yet";
  * "Do these first" led with "Execution is at 11 - open it to see what is
    pulling it down", which opened that same empty dialog. The page's own first
    instruction went nowhere;
  * "Customize weights for your business" - four presets, four sliders, and its
    own small print admitting nothing was saved. It did not even preview:
    moving Execution 35% -> 45% left the score on screen unchanged.

And three things were true but unreadable: a person's page printed stored keys
("sales_&_order_management", "todo", "in_progress", "stage ready_for_dispatch")
at a team member reading about their own work; it addressed the viewer while
showing somebody else ("improve YOUR operating score" over Priya's figures);
and every row in "Their open work" linked to /my-work - five tasks, one
destination, and from another person's page it landed the owner on his own
list.

These are source assertions: the page is React, and what matters is which
affordances exist at all.
"""
from pathlib import Path

import pytest

FE = Path(__file__).resolve().parents[2] / "frontend" / "src"
OPS = (FE / "pages" / "OperatingScore.js").read_text(encoding="utf-8")
DEMO = (FE / "pages" / "_operatingScoreDemo.js").read_text(encoding="utf-8")
FORMAT = (FE / "lib" / "format.js").read_text(encoding="utf-8")


# ───────────────────── what came off ───────────────────────────────────────
def test_the_weight_sliders_are_gone_from_the_page_and_the_module():
    """A control that moves and changes nothing, on a page whose whole job is
    to be trusted about numbers."""
    assert "Customize weights for your business" not in OPS
    assert "WEIGHT_PRESETS" not in OPS and "DEFAULT_WEIGHTS" not in OPS
    assert 'type="range"' not in OPS, "no sliders left"
    assert "WEIGHT_PRESETS" not in DEMO.split("export const")[0] or "export const WEIGHT_PRESETS" not in DEMO
    assert "export const DEFAULT_WEIGHTS" not in DEMO, "the constants went with it"
    # The weights still SHOW - they are real, they come from the scoring
    # service - they just cannot be dragged.
    assert "weight {c.weight}%" in OPS


def test_a_breakdown_is_offered_only_where_one_exists():
    """canDrill, not `has`. The dialog's 'nothing to show' branch is now
    unreachable from a real company's cards."""
    assert "function CategoryCard({ cat, value, reason, onOpen, canDrill = false, to = null })" in OPS
    assert "const opens = has && canDrill;" in OPS
    assert "canDrill={demo}" in OPS, "only the demo tenant has the items"
    # What a card says instead is true: what the category measures.
    assert "{cat.plain}" in OPS


def test_finance_opens_the_finance_page():
    """2026-09-29. Finance carries 25% of the overall score and was the one
    category you could not click into at all: the other three at least say
    what they measure, and Finance showed a number, or a dash, and stopped.
    Every other figure on this page leads somewhere now.

    A LINK, NOT A NEW SECTION. Yokesh pushed back on a broader suggestion of
    mine — money belongs on the Finance page, not duplicated on this one —
    and he was right; what was left of the point is this one affordance.
    Only for somebody who may see the money, because /finance would bounce
    anyone else, and the unscored card keeps saying so, which is the honest
    part and also exactly when an owner should go and raise an invoice."""
    assert 'to={c.key === "finance" && data.can_finance ? "/finance" : null}' in OPS
    assert "const linkTo = !opens && to ? to : null;" in OPS
    assert "{(opens || linkTo) &&" in OPS, "and it is signposted as clickable"
    assert '. Open Finance' in OPS, "the screen reader is told where it goes"
    # The drill still wins where there is one: a demo tenant's Finance card
    # opens its breakdown rather than navigating away.
    assert "!opens && to" in OPS


def test_the_first_instruction_on_the_page_goes_somewhere():
    """scoreActions still proposes the weakest category; the page only shows
    an action it can honour."""
    assert ".filter((a) => a.to || (demo && a.drill))" in OPS


# ───────────────────── what it says ────────────────────────────────────────
def test_a_task_reads_in_words_not_in_stored_values():
    assert "taskStatusLabel(t.status)" in OPS and "priorityLabel(t.priority)" in OPS
    assert "humanStage(t.stage_key)" in OPS
    assert "{t.status} · {t.priority" not in OPS, "the raw pair is gone"
    assert "` · stage ${t.stage_key}`" not in OPS


def test_a_workflow_reads_in_the_companys_own_words():
    """The pipeline and its stages are named in the tenant's operating model -
    the same words the board shows - not `order_management · stage
    ready_for_dispatch`."""
    assert "opModel(tenant).pipelines" in OPS
    assert "wfLabel(w.type)" in OPS and "stageLabel(w.type, w.stage)" in OPS


def test_the_department_on_the_view_as_strip_is_the_department():
    assert "roleLabelFor(roles, target.role)" in OPS
    assert "· {target.role}</span>" not in OPS


def test_it_speaks_about_the_person_whose_page_it_is():
    assert "Key actions to improve ${firstName}'s operating score." in OPS
    assert "could attach a photo or voice update on the next done task" in OPS
    assert "hasn't used a Dex plan yet" in OPS


# ───────────────────── where it goes ───────────────────────────────────────
def test_a_task_row_opens_that_task():
    assert "`/my-work?task=${encodeURIComponent(t.id)}`" in OPS
    assert 'to="/my-work" className="group flex items-center' not in OPS


def test_a_workflow_card_opens_that_card_on_its_own_pipeline():
    assert "`/workflows?wf=${encodeURIComponent(w.id)}" in OPS
    assert "wf_type=${encodeURIComponent(w.type)}" in OPS


def test_the_lists_open_the_work_of_the_person_being_looked_at():
    """?view=all&person= is the list that holds theirs; without it the owner
    clicked Priya's eight open tasks and got his own three."""
    assert "const workLink = (extra = {}) =>" in OPS
    assert 'q.set("view", "all"); q.set("person", viewAs.id);' in OPS
    for tile in ('ops-self-completed', 'ops-self-open', 'ops-self-overdue', 'ops-self-proof'):
        i = OPS.index(f'testid="{tile}"')
        assert "workLink(" in OPS[i - 320:i], tile


# ───────────────────── the waiting shape ───────────────────────────────────
def test_the_skeleton_is_the_shape_of_the_page_that_is_coming():
    assert "<OperatingScoreSkeleton person={Boolean(userIdParam)} />" in OPS
    assert 'data-shape={person ? "person" : "company"}' in OPS


# ───────────────────── one set of words for a task's state ─────────────────
def test_the_status_words_have_one_home_and_my_work_reads_it_too():
    assert "export const TASK_STATUS_LABELS" in FORMAT
    assert "export const taskStatusLabel" in FORMAT and "export const priorityLabel" in FORMAT
    mywork = (FE / "pages" / "MyWork.js").read_text(encoding="utf-8")
    assert "const STATUS_LABEL = TASK_STATUS_LABELS;" in mywork
    assert "TASK_STATUS_LABELS } from \"../lib/format\"" in mywork


@pytest.mark.parametrize("stored,shown", [
    ("todo", "To do"), ("blocked", "To do"), ("in_progress", "Doing"),
    ("waiting", "Doing"), ("review", "Doing"), ("done", "Done"), ("cancelled", "Cancelled"),
])
def test_every_stored_status_has_a_word(stored, shown):
    """Read straight out of the map, so the two files cannot drift apart."""
    block = FORMAT[FORMAT.index("export const TASK_STATUS_LABELS"):]
    block = block[:block.index("};")]
    assert f'{stored}: "{shown}"' in block
