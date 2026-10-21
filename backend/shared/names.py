"""What the app calls a person in a greeting (client FEATURE-03, 2026-10-22).

Every greeting took the first word of the full name, so "S Rhea" was greeted
"Good afternoon, S". Written initial-first — "S. Rhea", "K Ramesh", "S.R.
Karthik" — is the normal way to write a name in Tamil Nadu, where the client
is, so this was not an edge case.

The rule, in order:
  1. the person's own Preferred name (Settings -> Your profile), if set;
  2. else the first word of the name that is not an initial;
  3. else the first word; else "there".

An initial is one letter ("S", "s", "S."), dotted letters ("S.R."), or two or
three CAPITALS before another word ("SR Rhea"). Two letters in ordinary case
are a name — Om, Al, Jo — and are kept. "S.Rhea" written without a space
counts as "S. Rhea". A title before the name (Mr, Mrs, Ms, Dr, Prof, Er, Smt)
is skipped the same way: "Good morning, Kavya", not "Good morning, Dr.".

The screens use the same rule (frontend/src/lib/names.js); change both.
"""
import re

_GLUED_INITIAL = re.compile(r"\b([A-Za-z])\.(?=[A-Za-z])")       # "S.Rhea" -> "S. Rhea"
_ONE_LETTER = re.compile(r"^[A-Za-z]\.?$")                        # S, s, S.
_DOTTED = re.compile(r"^(?:[A-Za-z]\.){2,3}$")                    # S.R., K.R.S.
_CAPITALS = re.compile(r"^[A-Z]{2,3}\.?$")                        # SR, KRS (only before another word)
_TITLE = re.compile(r"^(?:mr|mrs|ms|miss|dr|prof|er|smt)\.?$", re.I)  # only before another word


def _is_initial(word: str, more_follow: bool) -> bool:
    return bool(_ONE_LETTER.match(word) or _DOTTED.match(word)
                or (more_follow and (_CAPITALS.match(word) or _TITLE.match(word))))


def greeting_name(user: dict, fallback: str = "there") -> str:
    preferred = str((user or {}).get("preferred_name") or "").strip()
    if preferred:
        return preferred
    words = _GLUED_INITIAL.sub(r"\1. ", str((user or {}).get("name") or "")).split()
    words = [w.strip(",") for w in words if w.strip(",")]
    for i, w in enumerate(words):
        if not _is_initial(w, more_follow=i < len(words) - 1):
            return w
    return words[0] if words else fallback
