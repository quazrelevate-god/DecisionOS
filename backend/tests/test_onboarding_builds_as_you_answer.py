"""Your OS, taking shape (the founder, 2026-10-29): "they should be able to
visualize that something is building in parallel while they answer every
question."

The interview's own question call names what each answer added to the OS, and
the answer endpoint hands it to the screen as `built`; the page draws it
(pages/onboarding/OsAssembly). The waits between answers say what is going on
instead of a spinner, and a spoken answer can be paused.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FE = ROOT.parent / "frontend" / "src"


def test_only_known_short_pieces_reach_the_screen():
    from services.ai.onboarding import _built_pieces
    got = _built_pieces([
        {"kind": "Workflow", "label": "  Order   to dispatch "},
        {"kind": "approval", "label": "Purchases over 1 lakh"},
        {"kind": "spaceship", "label": "Not a piece"},
        {"kind": "rule", "label": ""},
        "not a dict",
        {"kind": "metric", "label": "x" * 80},
        {"kind": "task", "label": "Fourth one is dropped"},
    ])
    assert got == [
        {"kind": "workflow", "label": "Order to dispatch"},
        {"kind": "approval", "label": "Purchases over 1 lakh"},
        {"kind": "metric", "label": "x" * 48},
    ]
    assert _built_pieces(None) == [] and _built_pieces("built") == []


def test_the_answer_carries_what_it_built_and_the_page_draws_it():
    src = (ROOT / "routers" / "signup.py").read_text()
    assert '"built": built}' in src
    iv = (FE / "pages" / "onboarding" / "VoiceInterview.js").read_text(encoding="utf-8")
    assert "onBuilt?.(data.built)" in iv
    assert "<WaitStory" in iv and "Loader" not in iv, "the waits are told, not spun"
    assert 'data-testid="interview-pause-button"' in iv
    voice = (FE / "pages" / "onboarding" / "voice.js").read_text(encoding="utf-8")
    assert "mr.pause()" in voice and "mr.resume()" in voice
    page = (FE / "pages" / "Signup.js").read_text(encoding="utf-8")
    assert "<OsAssembly" in page and "onBuilt={addBuilt}" in page
    assert "app-sky__art--aside" not in page, "the photograph is gone from signup"


def test_the_last_screen_is_their_first_week_played():
    """The founder (2026-10-29): "I can't understand everything all at once…
    show the entire journey as a walkthrough inside the actual UI, populated
    with the new company's data." The review opens on the tour; every detail
    stays one press away beneath it."""
    br = (FE / "pages" / "onboarding" / "BuildReveal.js").read_text(encoding="utf-8")
    assert "<FirstWeek" in br and 'data-testid="build-details-toggle"' in br
    assert br.index("<FirstWeek") < br.index("<OrgMap"), "the tour comes first, the details under it"
    wt = FE / "pages" / "onboarding" / "walkthrough"
    journey = (wt / "journey.js").read_text(encoding="utf-8")
    assert "bp?.approval_rules" in journey and "pipelines" in journey, "built from the company's own draft"
    player = (wt / "Player.jsx").read_text(encoding="utf-8")
    assert 'type="range"' in player, "a slider scrubs it"
    assert "--ui-scale" in player, "notes land on target through the app's page zoom"
