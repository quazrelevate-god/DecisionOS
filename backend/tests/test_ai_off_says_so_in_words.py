"""AI off: said in words, with the way to turn it on (2026-09-26).

Yokesh, from the screen of a migrated customer's owner, who pressed the mic on
the Desk and was shown:

    451: {'code': 'ai_consent_required', 'message': 'This AI feature is
    unavailable until your workspace owner grants consent for AI data
    processing.', 'current_version': '1.0', 'granted_version': None, ...}

Companies migrated from the old product carry no consent record — the feature
post-dates their data — so this refusal is the FIRST thing many of them meet,
and it was a Python dict. His ask: one good sentence, and a way through to the
consent screen.

The refusal arrives in two shapes and both are covered here: a 451 response,
and the reason written onto a background job (a capture is processed after its
request has gone). Nothing may print either raw.
"""
from pathlib import Path

FE = Path(__file__).resolve().parents[2] / "frontend" / "src"


def _read(*parts):
    return (FE.joinpath(*parts)).read_text(encoding="utf-8")


# ═════════════════════════ one place says it ═══════════════════════════════
def test_the_words_the_link_and_the_switch_live_in_one_file():
    src = _read("lib", "aiConsent.js")
    assert 'AI_CONSENT_CODE = "ai_consent_required"' in src
    assert 'AI_CONSENT_HREF = "/settings?tab=business#ai-consent"' in src, "the screen that fixes it"
    for fn in ("isAiConsentError", "aiConsentMessage", "showAiConsentToast", "toastAiConsentOr"):
        assert f"export function {fn}" in src


def test_it_reads_differently_for_the_person_who_can_turn_it_on():
    src = _read("lib", "aiConsent.js")
    assert "Turn it on in Settings" in src, "an owner is offered the switch"
    assert "An owner has to turn it on" in src, "everyone else is told who can"
    assert '"Turn on AI" : "See settings"' in src, "and the button matches"
    # The axios interceptor is outside React, so the flag is kept beside the words.
    assert "export function setViewerIsOwner" in src
    assert "setViewerIsOwner(user?.role === \"owner\")" in _read("context", "AuthContext.js")


def test_both_shapes_of_the_refusal_are_recognised():
    src = _read("lib", "aiConsent.js")
    assert "status === 451" in src, "the response"
    assert "detail.includes(AI_CONSENT_CODE)" in src, "the reason stored on a job"


# ═════════════════════════ nothing prints it raw ═══════════════════════════
def test_the_voice_capture_path_no_longer_prints_the_servers_reason():
    """The line from the founder's screenshot (hooks/useDexCapture.js)."""
    src = _read("hooks", "useDexCapture.js")
    assert 'toast.error(note.error || "Could not transcribe that")' not in src
    assert 'toastAiConsentOr(note.error' in src


def test_the_document_path_too():
    src = _read("pages", "Ledger.js")
    assert 'toast.error("Extraction failed: "' not in src
    assert "toastAiConsentOr(data.error" in src


def test_the_451_interceptor_uses_the_same_words():
    src = _read("lib", "api.js")
    assert "showAiConsentToast()" in src
    assert "AI features need the owner's consent" not in src, "its own copy is gone"


def test_the_capture_note_and_the_toast_cannot_drift():
    """dexOutcome's words for a failed capture read the code from the same file."""
    src = _read("lib", "dexOutcome.js")
    assert 'import { AI_CONSENT_CODE, AI_CONSENT_HREF } from "./aiConsent"' in src
    assert 'AI_CONSENT_CODE = "ai_consent_required"' not in src, "no second definition"


# ═════════════════════════ and at signup ═══════════════════════════════════
def test_signup_says_what_pressing_the_button_agrees_to():
    """Yokesh: "are we asking the tick before signing up — check that as well."

    The server records the press as the consent event (routers/auth.py), so the
    screen that press is on has to say so. It is a line beside the button, not
    a tickbox: there is no DecisionOS without AI, and Settings is where it is
    taken back. If that line ever goes, the recorded consent is one nobody was
    shown."""
    src = _read("pages", "onboarding", "BuildReveal.js")
    assert 'data-testid="build-ai-consent-line"' in src
    assert "go to our AI providers" in src
    assert "Settings" in src.split('data-testid="build-ai-consent-line"')[1][:400], "and where to undo it"


def test_the_server_records_that_press_as_the_consent():
    src = (Path(__file__).resolve().parents[1] / "routers" / "auth.py").read_text(encoding="utf-8")
    assert '"ai_consent": _stub_consent' in src
    assert "build_grant_payload" in src
