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
    src = (ROOT / "routers" / "signup.py").read_text(encoding="utf-8")
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


def test_the_summary_then_their_first_week_inside_the_app():
    """The founder (2026-10-30): "show the walkthrough in the actual DecisionOS
    application, blended with the illustrative elements… templatised… mock
    data and mock replies so it is quick… the last call to action enters the
    actual app." The summary keeps the counts and the explorer; Enter keeps the
    company's script, and the app plays it over the real pages once."""
    br = (FE / "pages" / "onboarding" / "BuildReveal.js").read_text(encoding="utf-8")
    assert 'data-testid="build-kpis"' in br and 'data-testid="build-explorer"' in br
    assert br.index("saveFirstTour(buildJourney(") < br.index("onEnter();"), "the script is kept before entering"
    assert "<FirstWeek" not in br, "the video left the summary"
    tour = (FE / "components" / "tour" / "FirstWeekTour.jsx").read_text(encoding="utf-8")
    for key in ('key: "glance"', 'key: "desk"', 'key: "numbers"', 'key: "decide"', 'key: "flow"', 'key: "work"',
                'key: "routines"', 'key: "signoff"', 'key: "ask"', 'key: "more"', 'key: "cycle"'):
        assert key in tour, key
    assert "clearToStart(user)" in tour and "if (phone ||" in tour, "desktop only; the phone keeps its short walkthrough"
    assert "first-tour-lens" not in tour, "the real page is never drawn over"
    assert 'cta: "Start using DecisionOS"' in tour and 'finish("/inbox")' in tour
    layout = (FE / "components" / "Layout.js").read_text(encoding="utf-8")
    assert "<FirstWeekTour />" in layout and 'data-testid="nav-first-tour"' in layout
    wt = (FE / "components" / "mobile" / "Walkthrough.jsx").read_text(encoding="utf-8")
    assert "export function clearToStart" in wt
    journey = (FE / "pages" / "onboarding" / "walkthrough" / "journey.js").read_text(encoding="utf-8")
    assert "bp?.approval_rules" in journey and '"Tasks set up"' in journey
