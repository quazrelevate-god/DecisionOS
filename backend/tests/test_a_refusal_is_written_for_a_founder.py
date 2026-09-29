"""A refused call says what to do about it (2026-09-29).

Found on the signup reveal, directly under "Couldn't create your workspace":

    email: value is not a valid email address: The part after the @-sign
    contains invalid characters: '@', SPACE.

That is pydantic talking to a developer, printed at a founder. Nobody outside
this repository knows what an @-sign rule is, and the one thing they needed —
go back and fix the address — is the one thing it does not say.

formatApiError is the only error formatter the app has: 139 call sites across
35 files, on every screen that can fail. So the words are written there once,
translated from the STABLE `type` rather than from `msg`, which is prose that
changes between pydantic versions and carries the internals.

THESE TESTS RUN THE REAL FUNCTION. The source is lifted out of lib/api.js and
executed in node against payloads TAKEN FROM THE RUNNING BACKEND, because a
test that greps the file for its own sentences proves the sentences are typed,
not that a 422 ever reaches them.
"""
import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

API_JS = (Path(__file__).resolve().parents[2] / "frontend" / "src" / "lib" / "api.js")
NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(NODE is None, reason="node is not on PATH")


def _formatter_source() -> str:
    """Everything from the field words to the end of formatApiError.

    Lifted rather than imported: lib/api.js builds an axios instance and reads
    the CRA environment at module scope, and none of that is what is on trial
    here."""
    src = API_JS.read_text(encoding="utf-8")
    start = src.index("const FIELD_WORDS = {")
    end = src.index("export function formatApiError(")
    tail = src[end:]
    # the function ends at the first line that is a closing brace on its own
    close = re.search(r"^\}", tail, re.M)
    assert close, "could not find the end of formatApiError"
    body = src[start:end] + tail[:close.end()]
    return body.replace("export function", "function")


def _say(*details):
    """What each detail reads as, through the real formatter."""
    driver = _formatter_source() + (
        "\nconst input = JSON.parse(process.argv[1]);"
        "\nconsole.log(JSON.stringify(input.map(formatApiError)));"
    )
    out = subprocess.run([NODE, "-e", driver, json.dumps(list(details))],
                         capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


# Straight off the wire: POST /api/auth/register on the dev server, 2026-09-29.
FROM_THE_SERVER_BAD_EMAIL = [{
    "type": "value_error", "loc": ["body", "email"],
    "msg": "value is not a valid email address: The part after the @-sign "
           "contains invalid characters: '@', SPACE.",
    "input": "a@b.com c@d.com",
    "ctx": {"reason": "The part after the @-sign contains invalid characters: '@', SPACE."},
}]
FROM_THE_SERVER_WRONG_TYPE = [{
    "type": "string_type", "loc": ["body", "company_name"],
    "msg": "Input should be a valid string", "input": ["a"],
    "url": "https://errors.pydantic.dev/2.13/v/string_type",
}]


# ───────────────── the sentence that started this ──────────────────────────
def test_the_address_that_broke_signup_now_reads_like_english():
    said, = _say(FROM_THE_SERVER_BAD_EMAIL)
    assert said == "That email address does not look right."


def test_not_one_word_of_the_parser_survives():
    """The specific leak. If any of these ever reach a screen again, the
    translation has been bypassed rather than improved."""
    said, = _say(FROM_THE_SERVER_BAD_EMAIL, FROM_THE_SERVER_WRONG_TYPE)[:1]
    for leak in ("@-sign", "pydantic", "value_error", "Input should be",
                 "loc", "value is not a valid"):
        assert leak not in said, leak


def test_a_field_we_have_no_word_for_still_gets_a_direction():
    """A field nested somewhere we have no word for. The sentence can no
    longer point at it, so it says what KIND of thing is wrong instead —
    vaguer than a bespoke line, and still not the parser's diary."""
    said, = _say([{"type": "string_type", "loc": ["body", "roles", 0, "headcount"],
                   "msg": "Input should be a valid string"}])
    assert said == "One of the answers is in the wrong format."
    assert "Input should be" not in said and "headcount" not in said


# ───────────────── each kind of refusal ────────────────────────────────────
@pytest.mark.parametrize("entry,expected", [
    ({"type": "missing", "loc": ["body", "email"]},
     "Your email address is needed."),
    ({"type": "missing", "loc": ["body", "company_name"]},
     "Your company name is needed."),
    ({"type": "value_error", "loc": ["body", "phone"], "msg": "whatever pydantic says"},
     "That mobile number does not look right."),
    ({"type": "string_too_short", "loc": ["body", "password"], "msg": "…"},
     "Your password is too short."),
    ({"type": "int_parsing", "loc": ["body", "amount"], "msg": "…"},
     "Check the amount."),
    ({"type": "greater_than_equal", "loc": ["body", "amount"], "msg": "…"},
     "That amount is out of range."),
    ({"type": "string_type", "loc": ["body", "company_name"], "msg": "…"},
     "Check the company name."),
], ids=["missing-email", "missing-company", "bad-phone", "short-password",
        "amount-not-a-number", "amount-out-of-range", "company-wrong-type"])
def test_each_rule_says_which_answer_and_what_about_it(entry, expected):
    said, = _say([entry])
    assert said == expected


def test_a_missing_field_nobody_named_still_admits_something_is_missing():
    said, = _say([{"type": "missing", "loc": ["body", "os_blueprint", "departments"]}])
    assert said == "Something needed was left out."


# ───────────────── what it must NOT touch ──────────────────────────────────
def test_a_message_we_wrote_ourselves_is_left_exactly_alone():
    """Every deliberate refusal in this API is already written for the person
    reading it. Paraphrasing those would be the same fault in the other
    direction."""
    ours = "This email already has a workspace. Sign in instead."
    said, = _say(ours)
    assert said == ours


def test_our_structured_refusals_speak_through_their_message():
    """register's own shape: {code, message}. The message is the sentence a
    founder was meant to read; `code` is for the client to branch on."""
    said, = _say({"code": "identity_unknown",
                  "message": "This number has no workspace yet, so this is your first one."})
    assert said == "This number has no workspace yet, so this is your first one."


# ───────────────── and it never shows a shrug ──────────────────────────────
@pytest.mark.parametrize("junk", [None, [], {}, [{"type": "missing"}, None]],
                         ids=["null", "empty-list", "empty-object", "ragged"])
def test_nothing_ever_renders_as_object_Object(junk):
    said, = _say(junk)
    assert said and "[object" not in said and said != "undefined"
    assert said[0].isupper() and said.endswith("."), said


def test_one_bad_answer_is_not_read_out_twice():
    """A single bad address can arrive as two entries — the type rule and the
    format rule — and the same correction printed twice reads like two
    separate faults."""
    said, = _say([
        {"type": "value_error", "loc": ["body", "email"], "msg": "one"},
        {"type": "value_error", "loc": ["body", "email"], "msg": "and another"},
    ])
    assert said == "That email address does not look right."


def test_two_different_answers_are_both_named():
    said, = _say([
        {"type": "missing", "loc": ["body", "company_name"]},
        {"type": "value_error", "loc": ["body", "email"], "msg": "…"},
    ])
    assert said == "Your company name is needed. That email address does not look right."
