"""The walkthrough teaches only what the person can do (ACCESS-12, XCODITS QA
report, 2026-10-21).

The testers: "Decision slide instructions are currently visible to normal
employees. They are hidden from standard employee accounts, and only users
with the appropriate role or permissions can view them. Test employee and
manager permissions separately."

Every role lands on the Desk and the walkthrough played one script there:
"Swipe right and say what you decided" with a "Decide →" pill. Decide needs
Decide AI (`voice_capture`), which only owners hold by default; for anyone
else the slider is Ask at both ends. Now the Desk's script is built from the
person's own permissions — the same ones that draw the slider, the tiles, the
dock and the More panel. Checked in a browser: the owner's script is word for
word as before; the Production employee and the Finance member get the ask-only
step and only the tiles, places and More entries they have; the Finance member
given Decide AI gets the Decide step back.
"""
import re
from pathlib import Path

SRC = Path(__file__).resolve().parents[2] / "frontend" / "src"
TOUR = (SRC / "components" / "mobile" / "Walkthrough.jsx").read_text(encoding="utf-8")
CODE = re.sub(r"/\*.*?\*/", "", TOUR, flags=re.S)


def test_the_desk_script_is_built_per_person():
    assert "const DECIDER = [" not in CODE, "no single script for every role"
    assert 'if (path === "/inbox" && hasPerm(user, "inbox")) return deskScript(user);' in CODE


def test_only_who_can_decide_is_taught_to_decide():
    script = CODE[CODE.index("function deskScript(user) {"):CODE.index("const MEMBER = [")]
    assert 'const decides = can("voice_capture");' in script
    decide_step = script[script.index("decides ? {"):script.index("} : {", script.index("decides ? {"))]
    assert "Swipe right and say what you decided" in decide_step and "decide: true" in decide_step
    ask_step = script[script.index("} : {", script.index("decides ? {")):]
    ask_step = ask_step[: ask_step.index("},")]
    assert "Swipe either way to ask Dex anything" in ask_step
    assert "decided" not in ask_step and "decide: true" not in ask_step
    # The "Decide →" pill follows the step, not the script.
    assert "{step.decide && <span" in CODE
    assert "steps === DECIDER" not in CODE


def test_the_other_steps_name_only_what_the_person_has():
    script = CODE[CODE.index("function deskScript(user) {"):CODE.index("const MEMBER = [")]
    # The Desk's own tile gates (pages/Desk.js): complaints, money, workflows.
    assert 'canSeeBuyers(user) && "complaints"' in script
    assert 'can("finance") && "money to collect"' in script
    assert 'can("workflows") && "workflows that are stuck"' in script
    # Approvers are told about approving; others about what waits on them.
    assert 'const signsOff = can("decisions_approve") || can("approvals");' in script
    # The dock's Money slot and the More panel's gates.
    assert 'can("finance") ? "Money for invoices and bills" : can("data_input") && "Money to send in a bill"' in script
    assert 'can("approvals") && "approvals", "leave", canSeeAnyCrm(user) && "CRM", "team"' in script
