"""Epic 10 Testing -- Sprint 4 (register flow: happy path, dept->role, reveal
counts, duplicate-email race).

db-tier: drive routers.auth.register directly against an isolated Mongo db, with
the AI-setup generators + CAPTCHA faked (no live LLM, no vendor call). Exercises
the whole provisioning path -- stub tenant -> AI setup -> department->role
de-dupe -> owner user + owner membership -> plan=trial -> os_summary reveal
counts -- plus the concurrent same-email race (exactly one workspace, no orphan
tenant left behind).
"""
import asyncio

from fastapi import HTTPException, Response

import routers.auth as auth
from services.ai import ai_setup as aset
import services.captcha as captcha_mod
from services.rate_limit import reset_for_test
from services.auth.membership import STATUS_ACTIVE
from core import PERMISSION_KEYS


class _Req:
    """Minimal Request stand-in: register reads client.host, headers.get, and
    the shared audit/session context does the same."""
    def __init__(self, ip="10.1.2.3", ua="pytest"):
        self.headers = {"X-Forwarded-For": ip, "user-agent": ua}
        self.client = type("C", (), {"host": ip})()


def _reg_patch(testdb):
    saved = (auth.db,
             aset.ai_generate_lexicon_with_status,
             aset.ai_generate_operating_model_with_status,
             aset.ai_generate_finance_categories_with_status,
             captcha_mod.verify_captcha)
    auth.db = testdb

    async def _lex(*a, **k):
        return {"terms": ["bulk order", "dispatch"]}, aset.STATUS_GENERATED

    async def _om(*a, **k):
        return {"pipelines": [{"key": "production", "stages": [{"key": "weave"}]}]}, aset.STATUS_GENERATED

    async def _fc(*a, **k):
        return {"expense": ["Yarn", "Dye", "Wages"]}, aset.STATUS_GENERATED

    async def _cap(*a, **k):
        return True, "test"

    aset.ai_generate_lexicon_with_status = _lex
    aset.ai_generate_operating_model_with_status = _om
    aset.ai_generate_finance_categories_with_status = _fc
    captcha_mod.verify_captcha = _cap

    def restore():
        (auth.db,
         aset.ai_generate_lexicon_with_status,
         aset.ai_generate_operating_model_with_status,
         aset.ai_generate_finance_categories_with_status,
         captcha_mod.verify_captcha) = saved
    return restore


def _os_blueprint():
    return {
        "departments": [
            {"key": "sales", "label": "Sales & Brand Relations"},
            {"key": "production", "label": "Production & Dyeing"},
        ],
        "operational_tasks": [
            {"title": "Weekly yarn order status check", "category": "Review"},
            {"title": "Dispatch schedule review", "category": "Planning"},
            {"title": "Chase outstanding payments", "category": "Review"},
        ],
        "approval_rules": [
            {"name": "Purchase above 50000", "description": "Owner approves any purchase over Rs 50,000."},
        ],
    }


# ---------------------------------------------------------------------------
# T10-04.1 + T10-04.10 -- full happy-path register provisions a trial tenant, an
# owner user + owner membership, records AI setup, and returns reveal counts that
# match what was generated.
# ---------------------------------------------------------------------------
def test_register_full_happy_path_and_reveal_counts(with_test_db):
    async def scenario(db):
        restore = _reg_patch(db)
        await reset_for_test()
        try:
            inp = auth.RegisterInput(
                company_name="Weave Co", name="Ravi Kumar", email="Ravi@WeaveCo.in",
                password="testpass123", industry="Textile & Apparel", company_size="11-50",
                description="Bulk fabric for garment brands",
                roles=[{"key": "sales", "label": "Sales"},
                       {"key": "production", "label": "Production"},
                       {"key": "finance", "label": "Finance"}],
                os_blueprint=_os_blueprint())
            res = await auth.register(inp, _Req(), Response())

            tenant = await db.tenants.find_one({"name": "Weave Co"}, {"_id": 0})
            user = await db.users.find_one({"email": "ravi@weaveco.in"}, {"_id": 0})
            mem = await db.memberships.find_one(
                {"tenant_id": tenant["id"], "user_id": user["id"]}, {"_id": 0})
            n_tenants = await db.tenants.count_documents({})
            return res, tenant, user, mem, n_tenants
        finally:
            restore()

    res, tenant, user, mem, n_tenants = with_test_db(scenario)

    # provisioning
    assert n_tenants == 1 and tenant is not None and user is not None
    assert user["email"] == "ravi@weaveco.in", "email is normalized lowercase"
    assert user["role"] == "owner"
    assert mem and mem["role"] == "owner" and mem["status"] == STATUS_ACTIVE, "owner membership is active"
    assert set(mem["permissions"]) == set(PERMISSION_KEYS), "owner membership carries every permission"

    # plan + AI setup
    assert tenant["plan"] == "trial" and tenant.get("trial_ends_at"), "fresh tenant starts on the 14-day trial"
    assert tenant["ai_setup_status"] == {"lexicon": "generated", "operating_model": "generated",
                                         "finance_categories": "generated"}
    assert tenant["operating_model"]["pipelines"] and tenant["lexicon"]["terms"], "AI fields are stored"
    assert (tenant.get("ai_consent") or {}).get("granted_at"), "signup pre-grants DPDP consent"

    # reveal counts (os_summary) match what was generated
    summary = res["os_summary"]
    assert summary["departments"] == 3, "3 roles (sales/production/finance) after clean-up"
    assert summary["operational_tasks"] == 3 and summary["approval_rules"] == 1
    assert summary == {"departments": len(tenant["roles"]),
                       "operational_tasks": len(tenant["operational_task_templates"]),
                       "approval_rules": len(tenant["approval_rules"])}


# ---------------------------------------------------------------------------
# T10-04.9 -- department -> role generation: the owner role is stripped (owner is
# implicit for the creator), duplicates collapse, labels default, and the result
# is a set of assignable roles distinct from owner.
# ---------------------------------------------------------------------------
def test_register_departments_become_clean_roles(with_test_db):
    async def scenario(db):
        restore = _reg_patch(db)
        await reset_for_test()
        try:
            inp = auth.RegisterInput(
                company_name="Dedup Co", name="Asha", email="asha@dedup.in",
                password="testpass123", industry="Retail / E-commerce", company_size="1-10",
                roles=[{"key": "owner", "label": "Owner"},        # implicit -> must be stripped
                       {"key": "sales", "label": "Sales"},
                       {"key": "sales", "label": "Sales Duplicate"},  # dupe -> collapsed
                       {"key": "ops_team", "label": ""}])          # blank label -> defaulted
            await auth.register(inp, _Req(ip="10.9.9.9"), Response())
            tenant = await db.tenants.find_one({"name": "Dedup Co"}, {"_id": 0})
            return tenant["roles"]
        finally:
            restore()

    roles = with_test_db(scenario)
    keys = [r["key"] for r in roles]
    assert "owner" not in keys, "the owner role is stripped -- it's implicit for the workspace creator"
    assert keys.count("sales") == 1, "duplicate role keys collapse to one"
    assert set(keys) == {"sales", "ops_team"}, "only the distinct non-owner roles remain"
    labels = {r["key"]: r["label"] for r in roles}
    assert labels["ops_team"] == "Ops Team", "a blank label defaults to a humanized key"
    assert all(r.get("key") and r.get("label") for r in roles), "every generated role is assignable"


# ---------------------------------------------------------------------------
# T10-04.8 -- duplicate-email race: a second registration with the same email is
# refused, and a concurrent race leaves exactly one workspace with no orphan
# tenant (the loser rolls back the tenant it created before the failed insert).
# ---------------------------------------------------------------------------
def test_duplicate_email_sequential_and_concurrent_no_orphan(with_test_db):
    def _inp(email, company="Race Co"):
        return auth.RegisterInput(
            company_name=company, name="Founder", email=email,
            password="testpass123", industry="Manufacturing", company_size="11-50",
            roles=[{"key": "sales", "label": "Sales"}])

    async def scenario(db):
        restore = _reg_patch(db)
        await reset_for_test()
        # real unique index so the loser of a true race hits DuplicateKeyError
        await db.users.create_index("email", unique=True)
        try:
            # 1. sequential: second register with the same email is refused (400),
            #    and does NOT create a second tenant.
            await auth.register(_inp("dup@race.in"), _Req(ip="10.2.0.1"), Response())
            seq_status = None
            try:
                await auth.register(_inp("dup@race.in"), _Req(ip="10.2.0.2"), Response())
            except HTTPException as e:
                seq_status = e.status_code
            tenants_after_seq = await db.tenants.count_documents({"name": "Race Co"})

            # 2. concurrent race on a fresh email + a DISTINCT company name so the
            #    orphan check is unambiguous: exactly one wins, no orphan tenant.
            results = await asyncio.gather(
                auth.register(_inp("race@race.in", "Racer Co"), _Req(ip="10.3.0.1"), Response()),
                auth.register(_inp("race@race.in", "Racer Co"), _Req(ip="10.3.0.2"), Response()),
                return_exceptions=True)
            wins = sum(1 for r in results if not isinstance(r, Exception))
            fails = [r for r in results if isinstance(r, Exception)]
            users_race = await db.users.count_documents({"email": "race@race.in"})
            tenants_race = await db.tenants.count_documents({"name": "Racer Co"})
            return seq_status, tenants_after_seq, wins, fails, users_race, tenants_race
        finally:
            restore()

    seq_status, tenants_after_seq, wins, fails, users_race, tenants_race = with_test_db(scenario)

    assert seq_status == 400, "a second registration with an existing email is refused"
    assert tenants_after_seq == 1, "the refused registration creates no second tenant"

    assert wins == 1, "exactly one of the racing registrations succeeds"
    assert all(isinstance(e, HTTPException) and e.status_code == 400 for e in fails), \
        "the loser gets a clean 400, not a 500"
    assert users_race == 1, "the unique email index admits exactly one user"
    # the whole point of the rollback: the loser rolled back the tenant it created
    # before its failed insert, so the race leaves exactly one 'Racer Co' tenant.
    assert tenants_race == 1, "the race leaves exactly one 'Racer Co' tenant -- no orphan from the loser"
