"""What a new password has to be (2026-09-19).

Members sign in with their mobile and a texted code; owners also have an email
and a password. So this rule is, in practice, the owner's — the person who can
see every rupee and every member. "At least 6 characters" allowed "123456".

Checked wherever a password is CHOSEN: signup, a reset, a change, and an owner
setting theirs. Never at sign-in — a password that predates the rule keeps
working until its owner changes it. frontend/src/lib/password.js says the same
thing; keep the two in step.
"""
import re

MIN_LENGTH = 8
RULE = "Use at least 8 characters, with a letter and a number."

_LETTER = re.compile(r"[A-Za-z]")
_DIGIT = re.compile(r"\d")


def password_problem(pw) -> str:
    """"" when `pw` is acceptable as a new password, else the sentence to show."""
    if not isinstance(pw, str) or len(pw) < MIN_LENGTH:
        return RULE
    if not _LETTER.search(pw) or not _DIGIT.search(pw):
        return RULE
    return ""
