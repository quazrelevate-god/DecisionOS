"""Pressing "Enter DecisionOS" lands in the Desk (2026-09-20).

Yokesh: "after clicking the enter decision button it directly goes into the
Decision Desk, but it is again showing a PWA screen on desktop and asking again
to go to the Decision Desk — if it is the desktop version it should go to that."

He is describing WelcomeOverlay. It is a full-screen frosted pane with a
`max-w-xl` column and a "Step inside" button, and at desktop width that centred
column over a blurred page reads as a phone screen dropped into a monitor — a
second confirmation of the door the founder has just pressed. On a phone the
column IS the screen, it is the width the piece was drawn for, and it covers
the dock underneath, so there it stays.
"""
from pathlib import Path

FE = Path(__file__).resolve().parents[2] / "frontend" / "src"


def _fe(*parts):
    return FE.joinpath(*parts).read_text(encoding="utf-8")


def test_entering_goes_to_the_desk():
    signup = _fe("pages", "Signup.js")
    assert 'navigate("/brief")' in signup
    app = _fe("App.js")
    assert '<Route path="/brief" element={<Navigate to="/inbox?scope=morning" replace />} />' in app


def test_the_welcome_pane_does_not_meet_a_desktop_founder():
    src = _fe("components", "WelcomeOverlay.js")
    effect = src[src.index('const v = localStorage.getItem("dos_welcome");'):src.index("const clear = useCallback")]
    assert 'window.matchMedia?.("(min-width: 1024px)").matches' in effect
    assert 'if (onDesktop) { localStorage.removeItem("dos_welcome"); return; }' in effect, \
        "and the flag is cleared, so it cannot resurface on a later visit"
    assert "setName(v === \"1\" ? \"\" : v);" in effect, "a phone still gets it"


def test_nothing_else_raises_that_pane():
    """It exists only as the one-time welcome signup sets — worth keeping true,
    because a second writer of this flag would bring the pane back on desktop."""
    import subprocess
    out = subprocess.run(["git", "grep", "-l", "dos_welcome", "--", "frontend/src"],
                         cwd=str(FE.parents[1]), capture_output=True, text=True).stdout.split()
    assert sorted(Path(p).name for p in out) == ["Signup.js", "WelcomeOverlay.js"]
