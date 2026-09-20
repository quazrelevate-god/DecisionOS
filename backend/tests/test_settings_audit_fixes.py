"""Settings audit (2026-09-20): the fixes that stop Settings losing an owner's work.

Found by walking every Settings field against its endpoint:
- "Regenerate with AI" on the vocabulary saved the built-in defaults over the
  owner's own words whenever the AI failed — including when AI is switched off,
  which fails every call. All three regenerate buttons said "AI regenerated…"
  whatever happened.
- Saving the operating model silently dropped a second pipeline or stage whose
  name made the same key (and that stage's tasks), a pipeline with no stages,
  and anything past the size caps; removing a pipeline left its cards on no
  board; and the editor never sent a stage's department, so every save reset it.
- An owner could change their own sign-in mobile or email on the Team page,
  skipping the code and password Settings › Your Profile asks for.
"""
import os
from pathlib import Path

import pytest
from fastapi import HTTPException

import routers.tenant_settings as ts
import routers.team as team
import core.deps as core_deps
from models.tenant import OperatingModelInput
from models.team import UserUpdateInput
from services.ai import ai_setup
from services.ai_consent import build_grant_payload

pytestmark = pytest.mark.skipif(
    bool(os.environ.get("PYTEST_XDIST_WORKER")),
    reason="rebinds module-level db globals - single-process only",
)

T = "t-audit"
OWNER = {"id": "u-owner", "tenant_id": T, "name": "Rajesh", "role": "owner", "permissions": []}
CUSTOM_LEX = {"customer": {"singular": "Patron", "plural": "Patrons"}}
FE = Path(__file__).resolve().parents[2] / "frontend" / "src"


async def _no_log(*a, **k):
    return None


@pytest.fixture(autouse=True)
def _quiet_activity_log(monkeypatch):
    # log_activity writes through the app's own client, which is bound to
    # whichever test loop used it first; these tests don't read the log.
    monkeypatch.setattr(ts, "log_activity", _no_log)
    if hasattr(team, "log_activity"):
        monkeypatch.setattr(team, "log_activity", _no_log)


def _patch(testdb, *mods):
    saved = [(m, m.db) for m in mods]
    for m in mods:
        m.db = testdb

    def restore():
        for m, d in saved:
            m.db = d
    return restore


async def _seed(db, consent=True):
    await db.tenants.insert_one({
        "id": T, "name": "Audit Co", "industry": "Textiles", "lexicon": CUSTOM_LEX,
        "operating_model": {"pipelines": [
            {"key": "sales", "label": "Sales", "stages": [{"key": "lead", "label": "Lead"}, {"key": "won", "label": "Won"}]},
            {"key": "purchase", "label": "Purchase", "stages": [{"key": "po", "label": "PO"}]},
        ], "task_categories": []},
        **({"ai_consent": build_grant_payload(actor_user_id="u-owner", actor_email="o@a.co")} if consent else {}),
    })


async def _refused(coro):
    try:
        await coro
    except HTTPException as e:
        return e.status_code, e.detail
    return None


# --- Regenerate with AI ------------------------------------------------------
def test_regenerate_with_ai_off_is_refused_and_changes_nothing(with_test_db):
    async def scenario(db):
        restore = _patch(db, ts)
        try:
            await _seed(db, consent=False)
            out = [await _refused(ts.regenerate_lexicon(user=OWNER)),
                   await _refused(ts.regenerate_operating_model(user=OWNER)),
                   await _refused(ts.regenerate_finance_categories(user=OWNER))]
            return out, await db.tenants.find_one({"id": T}, {"_id": 0, "lexicon": 1})
        finally:
            restore()

    refusals, after = with_test_db(scenario)
    assert [r[0] for r in refusals] == [451, 451, 451]
    assert "AI is off" in refusals[0][1]
    assert after["lexicon"] == CUSTOM_LEX, "the owner's words are untouched"


def test_a_failed_vocabulary_regenerate_keeps_the_owners_words(with_test_db, monkeypatch):
    async def defaulted(*a, **k):
        from core import normalize_lexicon
        return normalize_lexicon({}), ai_setup.STATUS_DEFAULTED
    monkeypatch.setattr(ai_setup, "ai_generate_lexicon_with_status", defaulted)

    async def scenario(db):
        restore = _patch(db, ts)
        try:
            await _seed(db)
            refused = await _refused(ts.regenerate_lexicon(user=OWNER))
            return refused, await db.tenants.find_one({"id": T}, {"_id": 0, "lexicon": 1, "ai_setup_status": 1})
        finally:
            restore()

    refused, after = with_test_db(scenario)
    assert refused and refused[0] == 502, "the screen is told it failed"
    assert after["lexicon"] == CUSTOM_LEX, "defaults are NOT saved over the owner's words"
    assert after["ai_setup_status"]["lexicon"] == ai_setup.STATUS_DEFAULTED


# --- Operating model save ----------------------------------------------------
def _om(*pipelines):
    return OperatingModelInput(operating_model={"pipelines": list(pipelines), "task_categories": []})


def test_the_operating_model_save_says_what_it_would_have_dropped(with_test_db):
    async def scenario(db):
        restore = _patch(db, ts)
        try:
            await _seed(db)
            dup_stage = await _refused(ts.update_operating_model(_om(
                {"key": "sales", "label": "Sales", "stages": [{"label": "Lead"}, {"label": "lead"}]},
                {"key": "purchase", "label": "Purchase", "stages": [{"label": "PO"}]}), user=OWNER))
            empty = await _refused(ts.update_operating_model(_om(
                {"key": "sales", "label": "Sales", "stages": []},
                {"key": "purchase", "label": "Purchase", "stages": [{"label": "PO"}]}), user=OWNER))
            too_many = await _refused(ts.update_operating_model(_om(
                *[{"label": f"P{i}", "stages": [{"label": "S"}]} for i in range(7)]), user=OWNER))
            return dup_stage, empty, too_many
        finally:
            restore()

    dup_stage, empty, too_many = with_test_db(scenario)
    assert dup_stage[0] == 400 and 'two stages called "Lead"' in dup_stage[1]
    assert empty[0] == 400 and "needs at least one stage" in empty[1]
    assert too_many[0] == 400 and "At most 6 pipelines" in too_many[1]


def test_a_pipeline_with_cards_cannot_be_removed(with_test_db):
    async def scenario(db):
        restore = _patch(db, ts)
        try:
            await _seed(db)
            await db.workflows.insert_one({"id": "w1", "tenant_id": T, "type": "purchase", "stage": "po"})
            refused = await _refused(ts.update_operating_model(_om(
                {"key": "sales", "label": "Sales", "stages": [{"key": "lead", "label": "Lead"}]}), user=OWNER))
            await db.workflows.delete_many({})
            ok = await ts.update_operating_model(_om(
                {"key": "sales", "label": "Sales", "stages": [{"key": "lead", "label": "Lead"}]}), user=OWNER)
            return refused, [p["key"] for p in ok["operating_model"]["pipelines"]]
        finally:
            restore()

    refused, kept = with_test_db(scenario)
    assert refused[0] == 409 and '"Purchase" still has 1 workflow card' in refused[1]
    assert kept == ["sales"], "with no cards left, removing it is fine"


def test_a_stages_department_survives_a_save(with_test_db):
    async def scenario(db):
        restore = _patch(db, ts)
        try:
            await _seed(db)
            out = await ts.update_operating_model(_om(
                {"key": "sales", "label": "Sales", "stages": [
                    {"key": "lead", "label": "Lead", "role": "sales",
                     "tasks": [{"title": "Call", "role": "production"}]}]},
                {"key": "purchase", "label": "Purchase", "stages": [{"key": "po", "label": "PO"}]}), user=OWNER)
            return out["operating_model"]["pipelines"][0]["stages"][0]["role"]
        finally:
            restore()

    assert with_test_db(scenario) == "sales", "the stage keeps its own department, not its first task's"


def test_the_editor_sends_the_stage_department():
    src = (FE / "components" / "OperatingModelEditor.js").read_text(encoding="utf-8")
    load = src[src.index("function withUids"):src.index("export function OperatingModelEditor")]
    save = src[src.index("const toPayload"):src.index("const save = async")]
    assert 'role: s.role || ""' in load and 'role: s.role || ""' in save
    assert 'data-testid={`op-stage-role-${pi}-${si}`}' in src, "and the owner can see and set it"


# --- Your own sign-in details, on the Team page -----------------------------
def test_an_owner_cannot_change_their_own_sign_in_details_on_the_team_page(with_test_db):
    async def scenario(db):
        restore = _patch(db, team, core_deps)
        try:
            await _seed(db)
            await db.users.insert_one({"id": "u-owner", "tenant_id": T, "name": "Rajesh", "role": "owner",
                                       "email": "owner@audit.co", "phone": "+91 98200 10001", "phone_norm": "9820010001"})
            phone = await _refused(team.update_user("u-owner", UserUpdateInput(phone="9820019999"), user=OWNER))
            email = await _refused(team.update_user("u-owner", UserUpdateInput(email="new@audit.co"), user=OWNER))
            # the same values, as the Team form sends them, still save the rest
            same = await _refused(team.update_user("u-owner", UserUpdateInput(
                phone="+91 98200 10001", email="Owner@audit.co", title="Founder"), user=OWNER))
            row = await db.users.find_one({"id": "u-owner"}, {"_id": 0, "phone_norm": 1, "email": 1, "title": 1})
            return phone, email, same, row
        finally:
            restore()

    phone, email, same, row = with_test_db(scenario)
    assert phone[0] == 403 and "Settings › Your Profile" in phone[1]
    assert email[0] == 403
    assert same is None and row["title"] == "Founder"
    assert row["phone_norm"] == "9820010001" and row["email"] == "owner@audit.co"


# --- Frontend guards ---------------------------------------------------------
def test_company_card_keeps_unsaved_sections_when_another_saves():
    src = (FE / "components" / "CompanyDetails.js").read_text(encoding="utf-8")
    effect = src[src.index("const dirty = useRef"):src.index("}, [tenant]);")]
    assert "if (!dirty.current.company)" in effect and "if (!dirty.current.os)" in effect
    assert src.count("dirty.current.company = false") == 1 and src.count("dirty.current.os = false") == 1


def test_regenerate_asks_first_on_all_three_cards():
    for f in ("BusinessVocabulary.js", "OperatingModelEditor.js", "FinanceCategoriesEditor.js"):
        src = (FE / "components" / f).read_text(encoding="utf-8")
        assert "<RegenerateWithAi onConfirm={regenerate}" in src, f
        assert "onClick={regenerate}" not in src, f


def test_team_form_sends_your_own_contact_details_the_proven_way():
    """The manager/owner form saves through PATCH /users, which asks for no code
    and no password, so your own mobile and email are locked there. The
    details-only form on your own card (basicOnly, 535b638) saves through PATCH
    /auth/profile WITH the code or password, so it stays open."""
    src = (FE / "pages" / "Team.js").read_text(encoding="utf-8")
    assert "const ownContact = editing && initial?.id === me?.id && !basicOnly;" in src
    assert "disabled={phoneLocked || ownContact}" in src
    assert "disabled={emailLocked || ownContact}" in src
    assert "...(emailLocked || ownContact ? {} : { email: emailTyped })" in src
    assert "...(phoneLocked || ownContact ? {} : { phone: form.phone })" in src
