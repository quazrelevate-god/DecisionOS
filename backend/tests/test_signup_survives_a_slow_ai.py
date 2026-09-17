"""Creating a workspace does not wait on the AI, and pressing twice is safe.

Reported: "everything passed, and finally it said it couldn't create a
workspace — email already registered, but the email was new."

Reproduced by walking the real signup against a throwaway backend:

    check-email (before)  ->  available = True      the email WAS free
    POST /auth/register   ->  200 in 14,425 ms      three AI generations,
                                                    the slowest 10,012 ms
    POST /auth/register   ->  400 Email already registered
    check-email (after)   ->  available = False     the account existed
    POST /auth/login      ->  200                   and the password worked

The three setup generators ran INSIDE the request, BEFORE the user row existed.
Any client that gave up first — KM-61 caught the frontend proxy doing exactly
that at its 60s ceiling — left the founder with a finished workspace and a
screen saying the opposite, and every retry hit the duplicate-email check.

So: the account is written first and the AI fills in behind it, and a retry with
the same password signs the founder in instead of refusing them.
"""
import os

import pytest

pytestmark = pytest.mark.skipif(
    bool(os.environ.get("PYTEST_XDIST_WORKER")),
    reason="rebinds module-level db globals - single-process only",
)


# ---------------------------------------------------------------------------
# The shape of the endpoint: nothing slow before the account exists.
# ---------------------------------------------------------------------------
def test_register_does_not_generate_the_ai_setup_inside_the_request():
    import inspect
    import routers.auth as rauth
    src = inspect.getsource(rauth.register)

    # The account is made from the signup's own data, with the AI marked pending.
    assert "STATUS_PENDING as _AI_PENDING" in src
    assert "db.tenants.insert_one" in src and "users.insert_one" in src

    # And the generators are handed to a background task, not awaited in line.
    assert "background.add_task(" in src, (
        "the three setup generators must run AFTER the response — waiting on "
        "them is what let a 60s proxy timeout cost a founder their workspace"
    )
    for gone in ("ai_generate_lexicon_with_status(",
                 "ai_generate_operating_model_with_status(",
                 "ai_generate_finance_categories_with_status("):
        assert gone not in src, f"{gone} is back inside the request"


def test_the_background_setup_writes_what_the_request_no_longer_waits_for():
    import inspect
    from services.ai.ai_setup import generate_tenant_setup
    src = inspect.getsource(generate_tenant_setup)
    for field in ("lexicon", "operating_model", "finance_categories", "ai_setup_status"):
        assert field in src, f"the background task must fill in {field}"
    assert "db.tenants.update_one" in src


def test_a_workspace_works_while_the_ai_setup_is_still_pending(with_test_db):
    """The gap is safe: every reader already tolerates the AI fields being
    absent, because a failed generator stored exactly that."""
    async def scenario(db):
        import services.ai.generators as gen
        saved = gen.db
        gen.db = db
        try:
            await db.tenants.insert_one({
                "id": "t-new", "name": "New Co",
                "ai_setup_status": {"lexicon": "pending", "operating_model": "pending",
                                     "finance_categories": "pending"},
                "lexicon": None, "operating_model": None, "finance_categories": None})
            om = await gen.tenant_operating_model("t-new")
            return om
        finally:
            gen.db = saved

    om = with_test_db(scenario)
    assert om and om.get("pipelines"), "a brand-new workspace falls back to the default operating model"


# ---------------------------------------------------------------------------
# Pressing "Create workspace" again.
# ---------------------------------------------------------------------------
def _fake_request():
    from starlette.requests import Request
    return Request({"type": "http", "method": "POST", "path": "/api/auth/register",
                    "headers": [], "query_string": b"", "client": ("10.0.0.7", 0)})


def test_a_second_press_with_the_same_password_signs_the_founder_in(with_test_db):
    """The case from the report: their first attempt DID create the workspace,
    they just never saw the answer."""
    async def scenario(db):
        import core
        import routers.auth as rauth
        from fastapi import Response
        from models.auth import RegisterInput
        from core import hash_password
        saved = (rauth.db, core.db)
        rauth.db, core.db = db, db
        try:
            await db.users.insert_one({
                "id": "u-owner", "tenant_id": "t-made", "name": "Arun", "email": "arun@newco.co",
                "role": "owner", "password_hash": hash_password("Scratch-4821")})
            await db.tenants.insert_one({"id": "t-made", "name": "New Co"})
            out = await rauth.register(
                RegisterInput(company_name="New Co", name="Arun", email="arun@newco.co",
                              password="Scratch-4821"),
                _fake_request(), Response())
            # nothing duplicated
            users = await db.users.count_documents({"email": "arun@newco.co"})
            tenants = await db.tenants.count_documents({})
            return out, users, tenants
        finally:
            rauth.db, core.db = saved

    out, users, tenants = with_test_db(scenario)
    assert out.get("user", {}).get("id") == "u-owner", "they are signed into the workspace they already have"
    assert out.get("tenant", {}).get("id") == "t-made"
    assert users == 1 and tenants == 1, "and nothing is created twice"


def test_a_second_press_with_a_different_password_is_refused_with_a_way_out(with_test_db):
    """Someone else's email. Say so in the words the signup form uses, with a
    code the screen turns into a Sign in button."""
    async def scenario(db):
        import core
        import routers.auth as rauth
        from fastapi import HTTPException, Response
        from models.auth import RegisterInput
        from core import hash_password
        saved = (rauth.db, core.db)
        rauth.db, core.db = db, db
        try:
            await db.users.insert_one({
                "id": "u-someone", "tenant_id": "t-theirs", "name": "Someone",
                "email": "taken@newco.co", "role": "owner",
                "password_hash": hash_password("their-own-password")})
            try:
                await rauth.register(
                    RegisterInput(company_name="New Co", name="Arun", email="taken@newco.co",
                                  password="a-different-one"),
                    _fake_request(), Response())
                return None
            except HTTPException as e:
                return e.status_code, e.detail
        finally:
            rauth.db, core.db = saved

    status, detail = with_test_db(scenario)
    assert status == 400
    assert detail.get("code") == "email_registered", "the screen branches on this to offer Sign in"
    assert "Sign in instead" in detail.get("message", "")


def test_the_signup_screen_offers_the_way_out():
    """The founder must not be left pressing a button that cannot work."""
    from pathlib import Path
    src = Path(__file__).resolve().parents[2] / "frontend" / "src" / "pages" / "onboarding" / "BuildReveal.js"
    text = src.read_text(encoding="utf-8")
    assert 'data-testid="build-error-signin"' in text, "a Sign in link on the taken-email failure"
    assert 'email_registered' in text, "branch on the code the API returns"
    assert '/signup/check-email' in text, "and re-check the email before the long call"
