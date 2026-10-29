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


def test_the_last_screen_sums_up_then_plays_their_first_week():
    """The founder (2026-10-29): "show all the KPIs — how many tasks, how many
    workflows — an interactive view of the workflows and the flow, a summarised
    view, and along with that the walkthrough, in a desktop and a phone window,
    switchable… templatised, so it shows quickly for every new company"."""
    br = (FE / "pages" / "onboarding" / "BuildReveal.js").read_text(encoding="utf-8")
    for marker in ('data-testid="build-kpis"', 'data-testid="build-explorer"', 'data-testid="build-tour"', "<FirstWeek"):
        assert marker in br, marker
    assert br.index('data-testid="build-kpis"') < br.index('data-testid="build-explorer"') < br.index('data-testid="build-tour"')
    wt = FE / "pages" / "onboarding" / "walkthrough"
    journey = (wt / "journey.js").read_text(encoding="utf-8")
    assert "bp?.approval_rules" in journey and '"Tasks set up"' in journey, "counts from the company's own draft"
    scenes = (wt / "scenes.jsx").read_text(encoding="utf-8")
    assert "flowScene" in scenes and "j.flows.slice(0, 3)" in scenes, "a chapter per workflow"
    for chapter in ('key: "glance"', 'key: "ask"', 'key: "addons"', 'key: "cycle"'):
        assert chapter in scenes, chapter
    assert '!j.rules.length && "signoff"' in scenes, "chapters with nothing to show are skipped"
    fw = (wt / "FirstWeek.jsx").read_text(encoding="utf-8")
    assert 'first-week-device-${k}' in fw, "desktop / phone switch"
    player = (wt / "Player.jsx").read_text(encoding="utf-8")
    assert 'type="range"' in player and "--ui-scale" in player
