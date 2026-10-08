"""Play audit C4 (2026-10-08): the signup AI endpoints ask before they send.

Every /api/signup endpoint that hands the founder's voice, answers or website
to an AI or speech provider runs before an account exists, so the workspace
consent gate never covered them. _guard_signup_endpoint now refuses them with
the same 451 unless the request carries the consent version the page asked for
(X-AI-Consent). Endpoints that send nothing to a provider are untouched.
"""
import asyncio
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import pytest
from fastapi import HTTPException

import routers.signup as signup
from services.ai_consent import CURRENT_CONSENT_VERSION

_LOOP = asyncio.new_event_loop()


def _run(coro):
    return _LOOP.run_until_complete(coro)


class _Client:
    host = "203.0.113.7"


class _Req:
    def __init__(self, headers=None):
        self.headers = dict(headers or {})
        self.client = _Client()


@pytest.fixture(autouse=True)
def _open_gates(monkeypatch):
    """Rate limit and CAPTCHA are not what is under test here."""
    async def _ok(*a, **k):
        return True, 0

    async def _human(*a, **k):
        return True, "ok"

    monkeypatch.setattr(signup, "check_rate_limit", _ok)
    monkeypatch.setattr(signup, "verify_captcha", _human)


@pytest.mark.parametrize("kind", sorted(signup._AI_SIGNUP_KINDS))
def test_an_ai_step_without_consent_is_refused(kind):
    with pytest.raises(HTTPException) as e:
        _run(signup._guard_signup_endpoint(_Req(), kind))
    assert e.value.status_code == 451
    assert e.value.detail["code"] == "ai_consent_required"


def test_an_old_consent_version_is_refused():
    with pytest.raises(HTTPException) as e:
        _run(signup._guard_signup_endpoint(_Req({"X-AI-Consent": "0.9"}), "stt"))
    assert e.value.status_code == 451


@pytest.mark.parametrize("kind", sorted(signup._AI_SIGNUP_KINDS))
def test_an_ai_step_with_consent_goes_through(kind):
    ip = _run(signup._guard_signup_endpoint(
        _Req({"X-AI-Consent": CURRENT_CONSENT_VERSION}), kind))
    assert ip


@pytest.mark.parametrize("kind", ["check_email", "phone_code", "phone_verify"])
def test_steps_that_send_nothing_to_ai_need_no_consent(kind):
    assert _run(signup._guard_signup_endpoint(_Req(), kind))
