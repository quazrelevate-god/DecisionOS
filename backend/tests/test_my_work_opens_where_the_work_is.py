"""My Work opens on a band that has work in it (2026-10-02).

Found walking every route in the browser looking for errors. At 620px My Work
read

    PRIORITY   High 0   Medium 3   Low 0
    Nothing here

Three open tasks, assigned to the person reading, one tap away in a column
they could not see. Below `lg` only the SELECTED band's column is on screen
(TaskPriorityColumns hides the others), and the band started at "high"
whatever the list actually held.

Nothing was broken: the counts were right, the list was right, the filtering
was right. The CHOICE of which column to show was wrong, and the result was
the same lie the CRM empty card used to tell -- a count and a list
contradicting each other in one glance.

AND ONLY UNTIL THEY CHOOSE. A deliberate tap on an empty band is an answer
("nothing is high today"); bouncing them out of it would be the page arguing
with the person using it.
"""
from pathlib import Path

MW = (Path(__file__).resolve().parents[2] / "frontend" / "src" / "pages" / "MyWork.js").read_text(encoding="utf-8")


def test_the_band_moves_to_where_the_work_is():
    assert "const firstBandWithWork" in MW
    assert "if (!bandHasWork[band] && firstBandWithWork) setBand(firstBandWithWork);" in MW


def test_it_only_chooses_until_the_person_does():
    assert "const bandChosen = useRef(false);" in MW
    assert "const pickBand = (key) => { bandChosen.current = true; setBand(key); };" in MW
    # 2026-10-29 — the phone shows the bands to everyone (not only those who may
    # run the AI ranking), so the guard covers both; it still stops choosing
    # once the person has.
    # 2026-10-31 — the AI ranking is gone; the bands (the phone's) still choose.
    assert "if (!aiPriority || bandChosen.current) return;" in MW


def test_the_chips_are_what_counts_as_choosing():
    """The band bar is the only control that sets it deliberately."""
    assert "onClick={() => pickBand(b.key)}" in MW
    assert "onClick={() => setBand(b.key)}" not in MW


def test_turning_ai_priority_off_hands_the_choice_back():
    """The band resets, and so does whose choice it is — otherwise a tap from
    a previous session would silently outlive the feature it belonged to."""
    assert "if (!aiPriority) { bandChosen.current = false; setBand(\"high\"); }" in MW


def test_only_one_band_is_on_screen_on_a_phone():
    """The premise of the whole fix: on a phone the deck shows one band, so
    choosing the wrong one hides real work. (2026-10-31: the desktop's priority
    columns went with the AI ranking; the phone's deck is the banded list.)"""
    assert "const deckList = bandsOn ? list.filter((tk) => TIER_OF(tk) === band) : list;" in MW
