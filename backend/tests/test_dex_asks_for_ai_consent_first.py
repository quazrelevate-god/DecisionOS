"""Dex says where the data goes, and asks for AI consent, before it records (2026-10-17).

App Store Guideline 5.1.2(i) wants an app to say clearly where personal data
goes "including with third-party AI" and to get permission first. The
one-time microphone notice named only the speech providers (Sarvam or OpenAI),
never the AI that reads a decision or answers a question, so in a workspace
where AI was already on (App Review's account included) Dex was used without
anyone being told. Where AI was off, Dex recorded first and refused after, in a
toast, with the recording lost.

Now every Dex recording (Decide, Ask) and dictation asks first: the full notice
once per device, and, if the company has not agreed to AI, the consent step
itself, before anything is recorded. Checked in a browser on a phone-sized
screen against the scratch backend: all five cases, with nothing sent to an AI
service.
"""
import re
from pathlib import Path

SRC = Path(__file__).resolve().parents[2] / "frontend" / "src"


def _read(*parts):
    return SRC.joinpath(*parts).read_text(encoding="utf-8")


def _code(src):
    src = re.sub(r"\{/\*.*?\*/\}", "", src, flags=re.S)
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    return re.sub(r"^\s*//.*$", "", src, flags=re.M)


NOTICE = _code(_read("lib", "micNotice.js"))
HOST = _read("components", "MicNoticeHost.js")


def test_the_notice_names_every_ai_provider():
    # All four, in the once-per-device notice and in the consent step.
    for name in ("Sarvam or OpenAI", "Anthropic", "OpenAI and Google (Gemini)"):
        assert name in HOST, name
    assert "Nothing is used to train AI models" in HOST
    assert 'to="/privacy"' in HOST


def test_everyone_sees_the_whole_notice_once():
    # A new key, so whoever saw the speech-only notice is shown the full one.
    assert 'const KEY = "dos.ai.noticeSeen.v2";' in NOTICE


def test_dex_and_dictation_ask_for_consent_first():
    assert "askBeforeMic({ ai: true })" in _code(_read("hooks", "useDexCapture.js"))
    assert "askBeforeMic({ ai: true })" in _code(_read("components", "MicDictateButton.js"))
    # A voice note as proof of work is not an AI feature: notice only.
    my_work = _code(_read("pages", "MyWork.js"))
    assert "askBeforeMic()" in my_work and "askBeforeMic({ ai: true })" not in my_work


def test_ai_off_means_the_consent_step_not_a_failed_recording():
    assert 'api.get("/tenant/ai-consent")' in NOTICE
    assert 'mode = viewerIsOwner() ? "consent" : "off"' in NOTICE
    assert 'api.post("/tenant/ai-consent"' in NOTICE
    assert "Agree and turn on AI" in HOST
    assert "AI is off for this company" in HOST
    # An owner who agrees goes straight on to the recording they started.
    agree = NOTICE[NOTICE.index("export async function agreeToAi"):]
    assert "answerMicNotice(true)" in agree[: agree.index("\n}\n")]


def test_decide_waits_for_the_answer():
    # Decide closes itself if nothing started; it must not while the question
    # (or the read of the company's consent) is still open.
    assert "export const isMicNoticeOpen = () => pending !== null || checking > 0;" in NOTICE
    well = _code(_read("pages", "desk", "DeskDexWell.jsx"))
    assert "if (isMicNoticeOpen()) { setTimeout(settle, 400); return; }" in well


def test_settings_keeps_the_remembered_consent_honest():
    settings = _code(_read("pages", "Settings.js"))
    assert settings.count("noteAiConsent(data);") == 2   # turned on, turned off
    assert "noteAiConsent(r.data);" in settings
