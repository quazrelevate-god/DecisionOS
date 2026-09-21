"""Stage work reaches real people, and older companies can get theirs.

Two things found by running a textile mill through the product with four
people (scripts/ux_engine_multiuser_0921.py), 2026-09-21:

1. THE DEPARTMENTS NEVER MATCHED. Onboarding named the mill's departments
   `loom_floor_&_production`, `sales_&_exporter_relations`, ... while its
   operating model said each stage belonged to `sales`, `production`,
   `dispatch`. Everything compared them with `==`, so the engine blanked the
   role, a stage's work went to nobody, and the card never moved. Invisible
   in every earlier test because they all seeded the literal keys `sales` /
   `finance` / `production`. shared/roles.resolve_role maps one onto the other.

2. THE BACKFILL. Companies set up before operating_model v1.1 have stages with
   no work at all. suggest → the owner reviews → apply, filling ONLY the gaps,
   never touching cards already moving.
"""
import json
import os

import pytest
from fastapi import HTTPException

from tests.e2e_harness import e2e_env

pytestmark = pytest.mark.skipif(
    bool(os.environ.get("PYTEST_XDIST_WORKER")),
    reason="rebinds module-level db globals - single-process only",
)

MILL = ["loom_floor_&_production", "sales_&_exporter_relations",
        "yarn_&_material_procurement", "dispatch_&_lorry_coordination", "owner"]
SALON = ["front_desk", "senior_stylist", "junior_stylist", "accounts", "inventory", "owner"]


# ═════════════════════════════ 1 · the resolver ════════════════════════════
@pytest.mark.parametrize("word,expected", [
    ("sales", "sales_&_exporter_relations"),
    ("production", "loom_floor_&_production"),
    ("dispatch", "dispatch_&_lorry_coordination"),
    ("procurement", "yarn_&_material_procurement"),
    ("owner", "owner"),
])
def test_a_generic_department_word_finds_the_mills_real_department(word, expected):
    from shared.roles import resolve_role
    assert resolve_role(word, MILL) == expected


def test_a_department_the_company_does_not_have_is_left_unassigned_not_guessed():
    """The mill has no accounts department, although its founder said "Anand
    does accounts" in the interview. Unassigned is visible; a wrong department
    silently sends the work to the wrong people."""
    from shared.roles import resolve_role
    assert resolve_role("finance", MILL) is None


def test_a_word_from_the_same_family_finds_the_department():
    from shared.roles import resolve_role
    assert resolve_role("finance", SALON) == "accounts"
    assert resolve_role("procurement", SALON) == "inventory"
    assert resolve_role("sales", SALON) == "front_desk"


def test_two_departments_that_both_fit_are_not_guessed_between():
    from shared.roles import resolve_role
    assert resolve_role("stylist", SALON) is None, "senior or junior? Not ours to pick"


def test_an_exact_key_always_wins_and_punctuation_does_not_matter():
    from shared.roles import resolve_role
    keys = ["sales", "finance", "production", "owner"]
    assert resolve_role("sales", keys) == "sales"
    assert resolve_role("accounts", keys) == "finance"
    assert resolve_role("Sales & Exporter Relations", MILL) == "sales_&_exporter_relations"
    assert resolve_role("", keys) is None and resolve_role("sales", []) is None


def test_the_owner_never_absorbs_a_department_word():
    from shared.roles import resolve_role
    assert resolve_role("operations", ["owner"]) is None


# ═══════════════════ 1 · the engine gives the work to a person ══════════════
def test_a_stage_that_says_sales_hands_its_work_to_the_mills_sales_people(with_test_db):
    """The bug itself, end to end: before the fix these tasks spawned with no
    department and nobody to do them."""
    picked = []

    async def pick(tenant_id, role, *a, **k):
        picked.append(role)
        return "u-priya" if role == "sales_&_exporter_relations" else None

    async def om(tenant_id, *a, **k):
        return {"pipelines": [{"key": "orders", "label": "Orders", "stages": [
            {"key": "inquiry", "label": "Inquiry", "role": "sales",
             "tasks": [{"title": "Log the buyer's inquiry", "role": "sales"},
                       {"title": "Raise the proforma", "role": "finance"}]},
            {"key": "made", "label": "Made", "role": "production", "tasks": []}]}]}

    async def keys(tenant_id, *a, **k):
        return MILL

    async def scenario(db):
        import services.workflow_engine as eng
        with e2e_env(db, stubs={
            "services.ai.generators.tenant_operating_model": om,
            "services.workflow_engine.tenant_role_keys": keys,
            "services.voice.pick_least_loaded_member": pick,
        }):
            await db.workflows.insert_one({"id": "wf1", "tenant_id": "t1", "type": "orders",
                                           "title": "Kumar Exports", "stage": "inquiry",
                                           "stages": ["inquiry", "made"]})
            await eng.on_stage_enter("t1", "wf1", "u-owner", "Rajesh")
            return await db.tasks.find({"tenant_id": "t1"}, {"_id": 0}).sort("title", 1).to_list(10)

    rows = with_test_db(scenario)
    log = next(r for r in rows if r["title"] == "Log the buyer's inquiry")
    assert log["assignee_role"] == "sales_&_exporter_relations" and log["assignee_id"] == "u-priya"
    proforma = next(r for r in rows if r["title"] == "Raise the proforma")
    assert proforma["assignee_role"] is None and proforma["assignee_id"] is None, \
        "no finance department: left visibly unassigned"
    assert "sales_&_exporter_relations" in picked


def test_a_decision_task_finds_the_stage_its_real_department_owns():
    from services.workflows import stage_owned_by
    pipeline = {"stages": [{"key": "inquiry", "role": "sales"},
                           {"key": "weaving", "role": "production"},
                           {"key": "dispatched", "role": "dispatch"}]}
    assert stage_owned_by(pipeline, "loom_floor_&_production", MILL) == "weaving"
    assert stage_owned_by(pipeline, "dispatch_&_lorry_coordination", MILL) == "dispatched"
    assert stage_owned_by(pipeline, "loom_floor_&_production") is None, \
        "without the company's keys the old exact comparison stands"


def test_a_new_companys_model_is_stored_with_its_real_department_keys(with_test_db):
    """At the source: the generator is shown the keys, and whatever it answers
    is resolved onto them before it is saved."""
    answer = json.dumps({"pipelines": [{"key": "orders", "label": "Orders", "stages": [
        {"key": "inquiry", "label": "Inquiry", "role": "sales",
         "tasks": [{"title": "Log the inquiry", "role": "sales"}]},
        {"key": "weaving", "label": "Weaving", "role": "production", "tasks": []}]}],
        "task_categories": [{"key": "sales", "label": "Sales"}]})
    seen = {}

    class Chat:
        def with_model(self, *a):
            return self

        async def send_message(self, msg):
            seen["prompt"] = msg.text
            return answer

    def fake_chat(**k):
        return Chat()

    async def scenario(db):
        import services.ai.generators as gen
        with e2e_env(db, stubs={"services.ai.generators.claude_chat": fake_chat}):
            return await gen.ai_generate_operating_model(
                "Textile & Apparel", "11-50",
                [{"key": "sales_&_exporter_relations", "label": "Sales & Exporter Relations"},
                 {"key": "loom_floor_&_production", "label": "Loom Floor & Production"}])

    om = with_test_db(scenario)
    stages = om["pipelines"][0]["stages"]
    assert stages[0]["role"] == "sales_&_exporter_relations"
    assert stages[0]["tasks"][0]["role"] == "sales_&_exporter_relations"
    assert stages[1]["role"] == "loom_floor_&_production"
    assert "sales_&_exporter_relations (Sales & Exporter Relations)" in seen["prompt"], \
        "and the model is shown the keys it must use"


# ═════════════════════════════ 2 · the backfill ════════════════════════════
OWNER = {"id": "u-owner", "tenant_id": "t1", "role": "owner", "name": "Rajesh", "permissions": []}
OLD_MODEL = {"pipelines": [{"key": "orders", "label": "Orders", "sub": "", "approval_stage": None, "stages": [
    {"key": "inquiry", "label": "Inquiry", "role": "sales_&_exporter_relations",
     "tasks": [], "approval": None, "side_effects": []},
    {"key": "weaving", "label": "Weaving", "role": "loom_floor_&_production",
     "tasks": [{"title": "Owner's own step", "role": "loom_floor_&_production", "evidence_required": True}],
     "approval": {"role": "owner", "required": True}, "side_effects": []},
    {"key": "dispatched", "label": "Dispatched", "role": "dispatch_&_lorry_coordination",
     "tasks": [], "approval": None, "side_effects": []}]}],
    "task_categories": [{"key": "sales", "label": "Sales"}]}


def _tenant(**over):
    t = {"id": "t1", "name": "Kaveri Weaves", "industry": "Textile & Apparel",
         "roles": [{"key": k, "label": k} for k in MILL if k != "owner"],
         "operating_model": json.loads(json.dumps(OLD_MODEL)),
         "ai_consent": {"granted": True, "granted_at": "2026-09-01T00:00:00+00:00"}}
    t.update(over)
    return t


def _fake_llm(payload):
    class Chat:
        def with_model(self, *a):
            return self

        async def send_message(self, msg):
            return json.dumps(payload)

    return lambda **k: Chat()


SUGGESTED = {"stages": [
    {"pipeline_key": "orders", "stage_key": "inquiry",
     "tasks": [{"title": "Log the buyer's inquiry and quantity", "role": "sales"},
               {"title": "Send the rate card", "role": "sales"},
               {"title": "Check yarn stock", "role": "procurement"},
               {"title": "A fourth one", "role": "sales"}]},
    {"pipeline_key": "orders", "stage_key": "weaving",
     "tasks": [{"title": "SHOULD NEVER BE USED", "role": "production"}]},
    {"pipeline_key": "orders", "stage_key": "dispatched",
     "tasks": [{"title": "Collect the signed lorry receipt", "role": "logistics"}]},
]}


async def _keys(tenant_id, *a, **k):
    return MILL


def _env(db, payload=SUGGESTED):
    return e2e_env(db, stubs={
        "services.ai.stage_work.claude_chat": _fake_llm(payload),
        "routers.tenant_settings.tenant_role_keys": _keys,
        "services.ai_consent.has_active_consent": lambda t: bool((t or {}).get("ai_consent")),
    })


def test_suggest_asks_only_about_empty_stages_and_writes_nothing(with_test_db):
    async def scenario(db):
        import routers.tenant_settings as ts
        with _env(db):
            await db.tenants.insert_one(_tenant())
            out = await ts.suggest_stage_work(user=OWNER)
            stored = (await db.tenants.find_one({"id": "t1"}, {"_id": 0, "operating_model": 1}))["operating_model"]
            return out, stored

    out, stored = with_test_db(scenario)
    assert [s["stage_key"] for s in out["suggestions"]] == ["inquiry", "dispatched"], \
        "the stage the owner already filled is not even asked about"
    assert out["empty"] == 2 and out["filled_already"] == 1
    inquiry = out["suggestions"][0]["tasks"]
    assert len(inquiry) == 3, "the AI may suggest at most three"
    assert {t["role"] for t in inquiry} == {"sales_&_exporter_relations", "yarn_&_material_procurement"}, \
        "its generic words are resolved onto the mill's departments"
    assert out["suggestions"][1]["tasks"][0]["role"] == "dispatch_&_lorry_coordination"
    assert stored == OLD_MODEL, "and nothing was written"


def test_suggest_is_refused_when_ai_is_off(with_test_db):
    async def scenario(db):
        import routers.tenant_settings as ts
        with _env(db):
            await db.tenants.insert_one(_tenant(ai_consent=None))
            try:
                await ts.suggest_stage_work(user=OWNER)
            except HTTPException as e:
                return e.status_code
            return None

    assert with_test_db(scenario) == 451


def test_apply_fills_the_gaps_and_nothing_else(with_test_db):
    from models.tenant import StageWorkApplyInput

    async def scenario(db):
        import routers.tenant_settings as ts
        with _env(db):
            await db.tenants.insert_one(_tenant())
            out = await ts.apply_stage_work(StageWorkApplyInput(fills=[
                {"pipeline_key": "orders", "stage_key": "inquiry",
                 "tasks": [{"title": "Log the inquiry (owner reworded)", "role": "sales_&_exporter_relations"}]},
                {"pipeline_key": "orders", "stage_key": "weaving",
                 "tasks": [{"title": "Overwrite attempt", "role": "loom_floor_&_production"}]},
                {"pipeline_key": "orders", "stage_key": "gone", "tasks": [{"title": "x"}]},
            ]), user=OWNER)
            return out

    out = with_test_db(scenario)
    stages = {s["key"]: s for s in out["operating_model"]["pipelines"][0]["stages"]}
    assert [t["title"] for t in stages["inquiry"]["tasks"]] == ["Log the inquiry (owner reworded)"], \
        "the owner's own words, not the suggestion"
    assert [t["title"] for t in stages["weaving"]["tasks"]] == ["Owner's own step"], "never overwritten"
    assert stages["weaving"]["tasks"][0]["evidence_required"] is True
    assert stages["weaving"]["approval"] == {"role": "owner", "required": True}, "nor its gate"
    assert stages["dispatched"]["tasks"] == [], "a stage the owner dropped stays empty"
    assert [(s["key"], s["label"]) for s in stages.values()] == \
        [("inquiry", "Inquiry"), ("weaving", "Weaving"), ("dispatched", "Dispatched")], "keys, labels, order untouched"
    reasons = {s["stage_key"]: s["reason"] for s in out["stage_work"]["skipped"]}
    assert reasons == {"weaving": "stage already has work", "gone": "stage no longer exists"}
    assert out["stage_work"]["filled"] == [{"pipeline_key": "orders", "stage_key": "inquiry", "tasks": 1}]


def test_applying_twice_changes_nothing_the_second_time(with_test_db):
    from models.tenant import StageWorkApplyInput
    fills = [{"pipeline_key": "orders", "stage_key": "inquiry", "tasks": [{"title": "Log it"}]}]

    async def scenario(db):
        import routers.tenant_settings as ts
        with _env(db):
            await db.tenants.insert_one(_tenant())
            await ts.apply_stage_work(StageWorkApplyInput(fills=fills), user=OWNER)
            second = await ts.apply_stage_work(StageWorkApplyInput(fills=[
                {"pipeline_key": "orders", "stage_key": "inquiry", "tasks": [{"title": "Log it AGAIN"}]}]), user=OWNER)
            return second

    second = with_test_db(scenario)
    inquiry = second["operating_model"]["pipelines"][0]["stages"][0]
    assert [t["title"] for t in inquiry["tasks"]] == ["Log it"]
    assert second["stage_work"]["filled"] == [] and second["stage_work"]["skipped"][0]["reason"] == "stage already has work"


def test_an_owner_may_keep_more_than_the_ai_suggests_up_to_six(with_test_db):
    from models.tenant import StageWorkApplyInput

    async def scenario(db):
        import routers.tenant_settings as ts
        with _env(db):
            await db.tenants.insert_one(_tenant())
            return await ts.apply_stage_work(StageWorkApplyInput(fills=[
                {"pipeline_key": "orders", "stage_key": "inquiry",
                 "tasks": [{"title": f"Step {i}"} for i in range(8)]}]), user=OWNER)

    out = with_test_db(scenario)
    assert len(out["operating_model"]["pipelines"][0]["stages"][0]["tasks"]) == 6


def test_a_model_edited_while_the_owner_was_reviewing_is_not_overwritten(with_test_db):
    """The write is conditional on the model being what was read."""
    from models.tenant import StageWorkApplyInput

    async def scenario(db):
        import routers.tenant_settings as ts
        import services.ai.generators as gen
        with _env(db):
            await db.tenants.insert_one(_tenant())
            real = gen.tenant_operating_model

            async def edited_underneath(tid):
                om = await real(tid)
                await db.tenants.update_one({"id": "t1"}, {"$set": {"operating_model.task_categories": []}})
                return om
            gen.tenant_operating_model = edited_underneath
            try:
                await ts.apply_stage_work(StageWorkApplyInput(fills=[
                    {"pipeline_key": "orders", "stage_key": "inquiry", "tasks": [{"title": "Log it"}]}]), user=OWNER)
            except HTTPException as e:
                return e.status_code, e.detail
            finally:
                gen.tenant_operating_model = real
            return None, None

    status, detail = with_test_db(scenario)
    assert status == 409 and "changed while you were reviewing" in detail


def test_cards_already_on_a_stage_get_no_new_work(with_test_db):
    """Templates act on the next ENTRY to a stage; saving them does not put
    unannounced work on people mid-job."""
    from models.tenant import StageWorkApplyInput

    async def scenario(db):
        import routers.tenant_settings as ts
        with _env(db):
            await db.tenants.insert_one(_tenant())
            await db.workflows.insert_one({"id": "wf1", "tenant_id": "t1", "type": "orders",
                                           "stage": "inquiry", "stages": ["inquiry", "weaving", "dispatched"]})
            await ts.apply_stage_work(StageWorkApplyInput(fills=[
                {"pipeline_key": "orders", "stage_key": "inquiry", "tasks": [{"title": "Log it"}]}]), user=OWNER)
            return await db.tasks.count_documents({"tenant_id": "t1"})

    assert with_test_db(scenario) == 0


def test_the_owners_review_screen_is_in_settings():
    from pathlib import Path
    fe = Path(__file__).resolve().parents[2] / "frontend" / "src" / "components"
    review = (fe / "StageWorkReview.js").read_text(encoding="utf-8")
    assert 'api.post("/tenant/operating-model/stage-work/suggest")' in review
    assert 'api.post("/tenant/operating-model/stage-work", { fills })' in review
    assert 'data-testid="stage-work-review"' in review and 'data-testid="stage-work-apply"' in review
    assert "cards already on a stage aren&rsquo;t changed" in review, "and it says so"
    editor = (fe / "OperatingModelEditor.js").read_text(encoding="utf-8")
    assert "<StageWorkReview model={model}" in editor
    assert "if (!f || (s.tasks || []).length) return s;" in editor, \
        "unsaved edits in the editor survive; a stage filled locally keeps the owner's work"


def test_the_banner_does_not_nag_about_resting_stages():
    """Found walking it in the browser: after an owner filled every working
    stage, the banner still said "2 stages have no work" — the two FINAL
    stages (Paid, Cleared), which rightly have nothing to do. It would have
    stayed up forever."""
    from pathlib import Path
    review = (Path(__file__).resolve().parents[2] / "frontend" / "src" / "components"
              / "StageWorkReview.js").read_text(encoding="utf-8")
    assert "const working = (p.stages || []).slice(0, -1);" in review
