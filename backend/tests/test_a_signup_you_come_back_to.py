"""A signup you can come back to (2026-09-29).

Found walking the whole signup at 375px, twice: once driving it with synthetic
events, which proved nothing, and once with real taps, which proved this.

TWO THINGS WERE WRONG AND THEY SHARE A CAUSE — resuming was never finished.

1. THE DRAFT WAS NEVER CLOSED. A workspace was created and the draft it came
   from still read `completed_at: null`. FIX-001-D gave /register a `draft_id`
   for two reasons — merge the saved answers back when a retried call arrives
   half-empty, and mark the draft consumed so it cannot be used twice — and the
   wizard has never sent one, so both have been dead since the day they
   shipped. The cost is a signup this browser has already spent: clearDraft()
   on the way in is the only thing stopping "Welcome back, we kept your
   answers" from reopening a company that exists.

   The token goes with the id. GET and PATCH on a draft have required it since
   RBAC-01; merging its answers into a registration is the same read under
   another name, and it was taking a bare id.

2. /signup CAME BACK BLANK. With a saved draft in localStorage the page drew
   the wordmark and nothing else, for ever, on every reload — and the draft
   that caused it is saved in the browser, so there is no way out of it.

   React said `phase: "build", draftReady: true` while the screen showed the
   basics slot. `AnimatePresence mode="wait"` holds the next child back until
   the last one has finished leaving, and the basics node moved to "build" in
   the same tick it was created: it never appeared, so it never left, so
   nothing after it ever mounted. BuildReveal had the same deadlock one level
   down, between "building" and "preview".

   This codebase has met that failure before — see the note on the bloom in
   BuildReveal, where a stranded exit left a founder staring at the review
   screen after their account had been created. The shape of the fix is the
   same both times: do not transition INTO the state you already know you are
   in. Render it.
"""
import os
import re
from pathlib import Path

import pytest
from fastapi import BackgroundTasks, HTTPException, Response
from starlette.requests import Request as StarletteRequest

import core
import routers.auth as rauth
from models.auth import RegisterInput
from services.auth import onboarding_drafts as drafts_svc
from services.auth.draft_tokens import sign_draft_id
from services.auth.phone_proof import issue_phone_proof

pytestmark = pytest.mark.skipif(
    bool(os.environ.get("PYTEST_XDIST_WORKER")),
    reason="rebinds module-level db globals - single-process only",
)

PHONE = "9820044441"
FE = Path(__file__).resolve().parents[2] / "frontend" / "src"
SIGNUP = (FE / "pages" / "Signup.js").read_text(encoding="utf-8")
REVEAL = (FE / "pages" / "onboarding" / "BuildReveal.js").read_text(encoding="utf-8")

_IP = iter(f"10.7.{n // 250}.{n % 250}" for n in range(1, 5000))


def _req():
    """From its own address: register allows three workspaces per network per
    hour, and that bucket outlives a single test."""
    return StarletteRequest({"type": "http", "method": "POST", "path": "/api/auth/register",
                             "headers": [], "query_string": b"", "client": (next(_IP), 0)})


def _bg():
    """Registration hands back the session and generates the AI setup behind
    it. Passing the queue FastAPI would pass means these tests exercise the
    real path and stop short of a model call none of them are about — inline
    is what happens only when there is no request context at all."""
    return BackgroundTasks()


def _patch(testdb, *mods):
    saved = [(m, m.db) for m in mods]
    for m in mods:
        m.db = testdb

    def restore():
        for m, d in saved:
            m.db = d
    return restore


async def _draft_with_answers(db, company="Kaveri Weaves"):
    """A draft as the wizard leaves it: the company named, the rest saved."""
    d = await drafts_svc.create_draft(db)
    await drafts_svc.patch_draft(db, d["id"], "about", {
        "company_name": company, "name": "Asha Kumar", "industry": "Textile & Apparel"})
    await drafts_svc.patch_draft(db, d["id"], "scale", {"team_size": "11-50"})
    return d["id"], sign_draft_id(d["id"])


def _register_missing_its_company(draft_id, token=None):
    """The retry case: the client re-sent the payload and left the answers the
    draft is holding out of it. Without a merge this cannot build anything."""
    return RegisterInput(name="Asha Kumar", email="asha@kaveri.co",
                         phone_token=issue_phone_proof(PHONE)["phone_token"],
                         draft_id=draft_id, **({"draft_token": token} if token else {}))


async def _refused(coro):
    try:
        return None, await coro
    except HTTPException as e:
        return (e.status_code, e.detail), None


# ───────────────── the draft is merged, and then closed ────────────────────
def test_the_draft_fills_the_gaps_and_is_marked_consumed(with_test_db):
    """Both halves of FIX-001-D, on the one call that was never making it."""
    async def scenario(db):
        restore = _patch(db, rauth, core)
        try:
            did, token = await _draft_with_answers(db)
            out = await rauth.register(_register_missing_its_company(did, token), _req(), Response(), _bg())
            return out, await drafts_svc.get_draft(db, did)
        finally:
            restore()

    out, draft = with_test_db(scenario)
    assert out["tenant"]["name"] == "Kaveri Weaves", "the name came back from the draft"
    assert draft["completed_at"], "and the draft is closed behind it"
    assert draft["tenant_id"] == out["tenant"]["id"], "with a crumb to what it built"


def test_a_draft_that_built_a_company_cannot_build_a_second_one(with_test_db):
    """What the closing is FOR. Registering again on a consumed draft finds
    nothing to merge, so it cannot quietly raise the same company twice."""
    async def scenario(db):
        restore = _patch(db, rauth, core)
        try:
            did, token = await _draft_with_answers(db)
            await rauth.register(_register_missing_its_company(did, token), _req(), Response(), _bg())
            first = await drafts_svc.get_draft(db, did)
            again = await _refused(
                rauth.register(_register_missing_its_company(did, token), _req(), Response(), _bg()))
            return first, again[0], await drafts_svc.get_draft(db, did)
        finally:
            restore()

    first, refusal, after = with_test_db(scenario)
    assert refusal and refusal[0] == 400, "no company name to build with: refused"
    assert after["completed_at"] == first["completed_at"], "and not re-stamped"
    assert after["tenant_id"] == first["tenant_id"], "still pointing at the one it made"


# ───────────────── and only for whoever holds the token ────────────────────
def test_a_bare_draft_id_reads_nothing(with_test_db):
    """The hole the token closes. Draft ids are uuid4, so this was never the
    likely attack — but reading a stranger's saved answers is exactly what
    RBAC-01 stopped on GET and PATCH, and this was the third door."""
    async def scenario(db):
        restore = _patch(db, rauth, core)
        try:
            did, _token = await _draft_with_answers(db, company="Someone Else Ltd")
            refusal, _ = await _refused(
                rauth.register(_register_missing_its_company(did), _req(), Response(), _bg()))
            return refusal, await drafts_svc.get_draft(db, did)
        finally:
            restore()

    refusal, draft = with_test_db(scenario)
    assert refusal and refusal[0] == 400, "nothing was merged, so there was nothing to build"
    assert draft["completed_at"] is None, "and somebody else's draft was not consumed either"


def test_a_token_from_another_draft_does_not_travel(with_test_db):
    async def scenario(db):
        restore = _patch(db, rauth, core)
        try:
            mine, _ = await _draft_with_answers(db, company="Mine")
            theirs, their_token = await _draft_with_answers(db, company="Theirs")
            refusal, _ = await _refused(
                rauth.register(_register_missing_its_company(mine, their_token), _req(), Response(), _bg()))
            return refusal, theirs
        finally:
            restore()

    refusal, _ = with_test_db(scenario)
    assert refusal and refusal[0] == 400


def test_the_answers_the_client_did_send_still_win(with_test_db):
    """The merge goes UNDERNEATH. A founder who edited the final screen gets
    what they typed, not what the draft remembers."""
    async def scenario(db):
        restore = _patch(db, rauth, core)
        try:
            did, token = await _draft_with_answers(db, company="Old Name")
            out = await rauth.register(
                RegisterInput(company_name="New Name", name="Asha Kumar",
                              email="asha@newname.co",
                              phone_token=issue_phone_proof(PHONE)["phone_token"],
                              draft_id=did, draft_token=token),
                _req(), Response(), _bg())
            return out
        finally:
            restore()

    assert with_test_db(scenario)["tenant"]["name"] == "New Name"


def test_a_completed_draft_is_still_readable(with_test_db):
    """get_draft's docstring claimed for a year that it filtered these and it
    never did. The behaviour is what stays — /register and the resume endpoint
    both look at `completed_at` themselves — so the sentence was the thing to
    fix, and this is the sentence."""
    async def scenario(db):
        d = await drafts_svc.create_draft(db)
        await drafts_svc.mark_completed(db, d["id"], "t-1")
        return await drafts_svc.get_draft(db, d["id"])

    got = with_test_db(scenario)
    assert got is not None and got["completed_at"] and got["tenant_id"] == "t-1"


# ───────────────── the wizard sends them ───────────────────────────────────
def test_the_reveal_names_its_draft_when_it_registers():
    i = REVEAL.index("await register({")
    call = REVEAL[i:i + 400]
    assert "draft_id: heldDraft.id" in call
    assert "draft_token: heldDraft.token" in call
    assert 'import { currentDraft } from "../../lib/onboardingDraft";' in REVEAL


# ───────────────── and the page always opens ───────────────────────────────
def test_the_wizard_draws_even_if_the_saved_draft_cannot_be_read():
    """`draftReady` was set on exactly one line: the last statement of an async
    block with nothing catching it. Anything that threw on the way left an
    empty white card and no way back."""
    assert ".finally(() => setDraftReady(true));" in SIGNUP
    assert "signup: the saved draft could not be restored" in SIGNUP


def test_nothing_is_keyed_until_we_know_which_phase_they_are_on():
    """The deadlock itself: a keyed child that changed key before it had ever
    appeared, inside an AnimatePresence that waits for it to leave."""
    gate = SIGNUP.index("{!draftReady ? (")
    stage = SIGNUP.index('<AnimatePresence mode="wait">')
    assert gate < stage, "the waiting card is OUTSIDE the AnimatePresence"
    assert 'data-testid="signup-restoring"' in SIGNUP
    assert "draftReady ? (\n              <BasicsFlow" not in SIGNUP, \
        "and the old gate around the first phase is gone, not doubled up"


def test_a_resumed_build_opens_on_its_os_rather_than_travelling_to_it():
    assert 'useState(savedBlueprint ? "preview" : "building")' in REVEAL
    assert "useState(savedBlueprint || null)" in REVEAL
    assert "useState(savedBlueprint ? 100 : 0)" in REVEAL
    # the mount effect no longer moves the stage; it only refuses to rebuild
    i = REVEAL.index("if (ranRef.current) return;")
    effect = REVEAL[i:i + 700]
    assert 'setStage("preview")' not in effect
    assert "generate();" in effect, "a fresh signup still builds"


def test_a_resumed_build_asks_the_model_for_nothing():
    """The expensive half. Rebuilding costs another AI call and can hand back
    a different company than the one they left."""
    i = REVEAL.index("if (ranRef.current) return;")
    effect = REVEAL[i:i + 700]
    saved = effect[effect.index("if (savedBlueprint) {"):]
    body = saved[:saved.index("}")]
    assert "api.post" not in body and "generate(" not in body


def test_the_measurements_are_written_down_where_the_next_reader_will_look():
    """So nobody re-finds them at 375px with a stopwatch."""
    assert 'mode="wait"' in SIGNUP, "the note names the mechanism"
    assert "AnimatePresence" in REVEAL
    for word in ("never appeared", "finished leaving"):
        assert word in SIGNUP, word
