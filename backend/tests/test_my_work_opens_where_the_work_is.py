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
    assert "if (!aiOn || bandChosen.current) return;" in MW


def test_the_chips_are_what_counts_as_choosing():
    """The band bar is the only control that sets it deliberately."""
    assert "onClick={() => pickBand(b.key)}" in MW
    assert "onClick={() => setBand(b.key)}" not in MW


def test_turning_ai_priority_off_hands_the_choice_back():
    """The band resets, and so does whose choice it is — otherwise a tap from
    a previous session would silently outlive the feature it belonged to."""
    assert "if (!aiPriority) { bandChosen.current = false; setBand(\"high\"); }" in MW


def test_only_one_band_is_on_screen_below_lg():
    """The premise of the whole fix: on a phone the other two columns are
    display:none, so choosing the wrong one hides real work."""
    at = MW.index("function TaskPriorityColumns(")
    body = MW[at:at + 900]
    assert 'band === col.key ? "block" : "hidden"' in body
    assert "lg:block" in body, "and all three are shown on a wide screen"


def test_the_measurement_is_recorded_for_the_next_reader():
    assert "620px" in MW and "Medium 3" in MW


# ───────── the Desk stops asking for money it may not see ─────────────────
DESK = (Path(__file__).resolve().parents[2] / "frontend" / "src" / "pages"
        / "desk" / "useDeskMetrics.js").read_text(encoding="utf-8")
LEDGER = (Path(__file__).resolve().parents[2] / "frontend" / "src" / "pages"
          / "Ledger.js").read_text(encoding="utf-8")


def test_the_desk_does_not_ask_for_the_ledger_it_cannot_open():
    """Found walking the app as a sales member: every Desk load fired
    GET /ledger/summary and took a 403 back. Nothing looked wrong -- the money
    tile is correctly hidden either way -- so this was a guaranteed-to-fail
    request on the busiest page in the product, once per member per load,
    landing in the logs and in any monitoring as a permission error nobody
    caused."""
    # 2026-10-03 RBAC audit: owners are no longer special-cased here -- an
    # owner holds the key unless the company switched it off for owners.
    assert "const canLedger = hasPerm(user, \"finance\");" in DESK
    at = DESK.index('queryKey: ["ledger-summary"]')
    assert "enabled: canLedger," in DESK[at:at + 260]


def test_it_is_the_same_gate_the_ledger_page_already_used():
    """Two copies of one query; they should agree about who may run it."""
    # 2026-10-03 RBAC audit: owners are no longer special-cased here -- an
    # owner holds the key unless the company switched it off for owners.
    assert 'hasPerm(user, "finance")' in LEDGER
    assert "enabled: canLedger" in LEDGER
