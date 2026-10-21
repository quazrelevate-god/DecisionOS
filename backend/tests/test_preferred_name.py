"""Preferred name (Epic 11 Sprint 3, client FEATURE-03, 2026-10-22).

"S Rhea" was greeted "Good afternoon, S": every greeting took the first word of
the full name. Written initial-first is the normal way to write a name in
Tamil Nadu, so the fix is two-part and both parts are pinned here:

  * a Preferred name in the profile, which every greeting uses;
  * for everyone who never sets one, the first word that is not an initial
    (or a title) — so "S Rhea" is greeted Rhea on day one.

Pure unit tests — fake Mongo, no live DB, no server, no network.
"""
import asyncio
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import pytest

import routers.auth as auth
import routers.desk as desk
from models.auth import ProfileUpdateInput
from services.ai.brain_rbac import closed_message
from shared.names import greeting_name
from tests.fake_mongo import FakeDB

_LOOP = asyncio.new_event_loop()


def run(coro):
    return _LOOP.run_until_complete(coro)


@pytest.mark.parametrize("name, expected", [
    ("S Rhea", "Rhea"),                    # the client's example
    ("S. Rhea", "Rhea"),
    ("S.Rhea", "Rhea"),                    # glued, no space
    ("K.R.S. Rajesh Kumar", "Rajesh"),
    ("S R Karthik", "Karthik"),
    ("SR Karthik", "Karthik"),             # capitals before another word
    ("Dr. Kavya Raman", "Kavya"),          # a title is skipped too
    ("Mr Rajesh", "Rajesh"),
    ("Priya Nair", "Priya"),               # ordinary names unchanged
    ("Om Prakash", "Om"),                  # two letters in ordinary case is a name
    ("Rajesh K", "Rajesh"),                # a trailing initial is fine as it was
    ("Meena", "Meena"),
    ("S", "S"),                            # nothing else to use
    ("SR", "SR"),                          # capitals alone are the name
    ("  ", "there"),
    ("", "there"),
])
def test_the_greeting_skips_initials_and_titles(name, expected):
    assert greeting_name({"name": name}) == expected


def test_the_preferred_name_wins_and_blank_falls_back():
    assert greeting_name({"name": "S Rhea", "preferred_name": "Rhea Madam"}) == "Rhea Madam"
    assert greeting_name({"name": "S Rhea", "preferred_name": "   "}) == "Rhea"
    assert greeting_name({"name": "S Rhea", "preferred_name": None}) == "Rhea"
    assert greeting_name({}) == "there" and greeting_name(None) == "there"


def test_the_desk_greets_by_it():
    assert desk._greeting_for({"name": "S Rhea"}).endswith(", Rhea")
    assert desk._greeting_for({"name": "S Rhea", "preferred_name": "Rhea"}).endswith(", Rhea")
    assert desk._greeting_for({"name": "Priya Nair", "preferred_name": "Pri"}).endswith(", Pri")
    assert desk._greeting_for({"name": "S Rhea"}).split(",")[0] in ("Good morning", "Good afternoon", "Good evening")


def test_dex_says_sorry_to_the_right_name():
    assert closed_message({"name": "S Rhea", "role": "sales", "permissions": []}, "finance").startswith("Sorry Rhea")


def test_the_phone_brief_greets_by_it():
    src = (ROOT / "routers" / "brief.py").read_text(encoding="utf-8")
    assert '"greeting": f"{greet}, {greeting_name(user)}"' in src
    assert "user['name'].split(' ')[0]" not in src


def test_the_screens_use_the_same_rule():
    """frontend/src/lib/names.js is the same rule for the Dex welcome, the Ops
    page and the profile preview; a change to one side must reach the other."""
    js = (ROOT.parent / "frontend" / "src" / "lib" / "names.js").read_text(encoding="utf-8")
    py = (ROOT / "shared" / "names.py").read_text(encoding="utf-8")
    for pattern in ("mr|mrs|ms|miss|dr|prof|er|smt", "[A-Z]{2,3}", "(?:[A-Za-z]\\.){2,3}", "[A-Za-z]\\.?"):
        assert pattern in js and pattern in py, pattern
    for page in ("pages/Brain.js", "pages/OperatingScore.js", "components/ProfileDialog.js"):
        assert "greetingName(" in (ROOT.parent / "frontend" / "src" / page).read_text(encoding="utf-8"), page


@pytest.fixture
def db(monkeypatch):
    fake = FakeDB()
    monkeypatch.setattr(auth, "db", fake)
    run(fake.tenants.insert_one({"id": "t1", "name": "Nila"}))
    run(fake.users.insert_one({"id": "u1", "tenant_id": "t1", "name": "S Rhea", "email": "rhea@nila.test"}))
    return fake


ME = {"id": "u1", "tenant_id": "t1", "name": "S Rhea", "email": "rhea@nila.test", "role": "sales"}


def test_the_profile_saves_it_trims_it_and_clears_it(db):
    out = run(auth.update_profile(ProfileUpdateInput(preferred_name="  Rhea  "), user=ME))
    assert out["user"]["preferred_name"] == "Rhea"
    run(auth.update_profile(ProfileUpdateInput(preferred_name="R" * 60), user=ME))
    assert len(run(db.users.find_one({"id": "u1"}))["preferred_name"]) == 40
    out = run(auth.update_profile(ProfileUpdateInput(preferred_name=""), user=ME))
    assert out["user"]["preferred_name"] is None
    assert greeting_name(out["user"]) == "Rhea", "cleared: the fallback still skips the initial"


def test_saving_the_rest_of_the_profile_leaves_it_alone(db):
    run(auth.update_profile(ProfileUpdateInput(preferred_name="Rhea"), user=ME))
    run(auth.update_profile(ProfileUpdateInput(name="S Rhea Kumar"), user=ME))
    assert run(db.users.find_one({"id": "u1"}))["preferred_name"] == "Rhea"
