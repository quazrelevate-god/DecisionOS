"""Epic 10 Testing -- Sprint 5 (multi-business niche scenarios).

db-tier: for each supported industry, provision a realistic tenant (tests
factories.build_niche_tenant) and assert the product HANDLES that niche's
distinctive data pattern -- operating score + finance read paths behave, with no
textile assumptions leaking into a non-textile business.

The AI-GENERATION dimension of these niches (does the real model design a distinct
operating model per industry?) lives in the live-LLM golden set
(evals/cases/onboarding.py). These tests cover the DATA/FLOW dimension: the
product's deterministic read paths on niche-shaped data.
"""
import asyncio
from datetime import datetime, timezone, timedelta

from tests.factories import build_niche_tenant, NICHES, seed_tenant, seed_finance
from core import new_id, now_iso


def _use_db(testdb, *mods):
    saved = [(m, m.db) for m in mods if hasattr(m, "db")]
    for m, _ in saved:
        m.db = testdb
    return lambda: [setattr(m, "db", d) for m, d in saved]


def _owner(t, tid="t1"):
    return {"role": "owner", "tenant_id": tid, "id": t["owner_id"], "name": "Owner"}


def _iso_days(n):
    return (datetime.now(timezone.utc) + timedelta(days=n)).isoformat()


def _ymd(n):
    return (datetime.now(timezone.utc) + timedelta(days=n)).strftime("%Y-%m-%d")


async def _company_view(db, t, tid="t1"):
    import routers.operating_score as osr
    import services.operating_score as oss
    restore = _use_db(db, osr, oss)
    try:
        return await osr.operating_score(user_id=None, user=_owner(t, tid))
    finally:
        restore()


async def _overdue_receivables(db, tid="t1"):
    import services.finance_signals as fs
    restore = _use_db(db, fs)
    try:
        return await fs._overdue_receivables(tid)
    finally:
        restore()


async def _sales_invoice(db, tid, amount, *, paid=0, due_days=10, iid=None):
    iid = iid or new_id()
    await db.invoices.insert_one({
        "id": iid, "tenant_id": tid, "type": "sales_invoice", "amount": amount,
        "amount_paid": paid, "status": "paid" if paid >= amount else "open",
        "due_date": _ymd(due_days), "created_at": now_iso()})
    return iid


# ---------------------------------------------------------------------------
# T10-05.1 -- Textile (Sharma baseline): the regression niche runs the full read
# path -- operating score (owner company view) + finance outstanding.
# ---------------------------------------------------------------------------
def test_textile_baseline_full_flow(with_test_db):
    async def scenario(db):
        t = await build_niche_tenant(db, "textile", tenant_id="t1")
        # an unmistakably overdue receivable (>7d) so finance chases it
        await _sales_invoice(db, "t1", 42000, paid=0, due_days=-30, iid="late1")
        company = await _company_view(db, t)
        overdue = await _overdue_receivables(db)
        return company["view"], len(company.get("employees") or []), \
            [o["id"] for o in overdue]

    view, n_emp, overdue_ids = with_test_db(scenario)
    assert view == "owner" and n_emp >= 4, "textile owner gets the full company operating-score view"
    assert "late1" in overdue_ids, "a 30-day-overdue receivable is chased (finance baseline)"


# ---------------------------------------------------------------------------
# T10-05.2 -- Logistics / cold-chain: distinct roles, NO textile terms leak.
# ---------------------------------------------------------------------------
def test_logistics_roles_distinct_no_textile_leak(with_test_db):
    async def scenario(db):
        t = await build_niche_tenant(db, "logistics", tenant_id="t1")
        tenant = await db.tenants.find_one({"id": "t1"}, {"_id": 0})
        return [r["key"] for r in tenant["roles"]], tenant["industry"]

    roles, industry = with_test_db(scenario)
    assert industry == "Logistics & Transport"
    assert {"dispatch", "fleet", "compliance"} & set(roles), "logistics-specific roles present"
    textile_terms = {"yarn", "weaving", "dyeing", "weave", "dye"}
    assert not (textile_terms & set(roles)), "no textile role leaks into a logistics tenant"


# ---------------------------------------------------------------------------
# T10-05.3 -- Electronics manufacturing: BOM/component + asset amounts flow
# through finance as ordinary high-value invoices/bills.
# ---------------------------------------------------------------------------
def test_electronics_bom_and_asset_amounts(with_test_db):
    async def scenario(db):
        t = await build_niche_tenant(db, "electronics", tenant_id="t1")
        # a component purchase bill (BOM) + a finished-goods sale
        await _sales_invoice(db, "t1", 180000, paid=90000, due_days=5, iid="fg1")  # partial
        bills = await db.invoices.count_documents({"tenant_id": "t1", "type": "purchase_bill"})
        import services.finance_signals as fs
        restore = _use_db(db, fs)
        try:
            fg = await db.invoices.find_one({"id": "fg1"}, {"_id": 0})
            remaining = fs._inv_remaining(fg)
        finally:
            restore()
        return bills, remaining

    bills, remaining = with_test_db(scenario)
    assert bills >= 2, "component/BOM purchase bills are seeded for a manufacturer"
    assert remaining == 90000, "high-value finished-goods invoice tracks amount - amount_paid"


# ---------------------------------------------------------------------------
# T10-05.4 -- Restaurant: high-volume small-ticket cash + no-invoice days.
# Operating score must not misfire when most revenue has no invoice.
# ---------------------------------------------------------------------------
def test_restaurant_high_volume_cash_no_invoice(with_test_db):
    async def scenario(db):
        t = await build_niche_tenant(db, "restaurant", tenant_id="t1")
        # 80 small standalone cash payments, NO matching invoice (typical F&B day)
        await asyncio.gather(*[
            db.payments.insert_one({"id": new_id(), "tenant_id": "t1", "direction": "in",
                                    "amount": 150 + (i % 20) * 10, "applied": 0,
                                    "match_status": "standalone", "date": _iso_days(-(i % 5)),
                                    "created_at": now_iso()})
            for i in range(80)])
        company = await _company_view(db, t)   # must not divide-by-zero / crash on cash-heavy data
        n_pay = await db.payments.count_documents({"tenant_id": "t1", "direction": "in"})
        return company["view"], "company" in company, n_pay

    view, has_company, n_pay = with_test_db(scenario)
    assert view == "owner" and has_company, "operating score renders for a cash-heavy, low-invoice restaurant"
    assert n_pay >= 80, "80 small-ticket cash payments recorded without an invoice each"


# ---------------------------------------------------------------------------
# T10-05.5 -- Healthcare / clinic: appointment-driven, no sales pipeline. The
# read paths must not assume a sales funnel.
# ---------------------------------------------------------------------------
def test_clinic_non_sales_model_no_crash(with_test_db):
    async def scenario(db):
        t = await build_niche_tenant(db, "clinic", tenant_id="t1")
        tenant = await db.tenants.find_one({"id": "t1"}, {"_id": 0})
        company = await _company_view(db, t)
        return tenant["industry"], [r["key"] for r in tenant["roles"]], company["view"]

    industry, roles, view = with_test_db(scenario)
    assert industry == "Healthcare"
    assert "sales" not in roles, "a clinic has no 'sales' role -- non-sales operating model"
    assert view == "owner", "operating score renders for an appointment-driven clinic"


# ---------------------------------------------------------------------------
# T10-05.6 -- Retail / e-commerce: high transaction volume; payment matching +
# outstanding aggregation hold at volume within one tenant.
# ---------------------------------------------------------------------------
def test_retail_high_volume_outstanding_aggregation(with_test_db):
    async def scenario(db):
        t = await build_niche_tenant(db, "retail", tenant_id="t1")
        # 60 unpaid sales invoices of 1000 each -> outstanding 60,000
        await asyncio.gather(*[
            db.invoices.insert_one({"id": f"r{i}", "tenant_id": "t1", "type": "sales_invoice",
                                    "amount": 1000, "amount_paid": 0, "status": "open",
                                    "due_date": _ymd(-30), "created_at": now_iso()})
            for i in range(60)])
        import services.finance_signals as fs
        restore = _use_db(db, fs)
        try:
            overdue = await fs._overdue_receivables("t1")
            outstanding = round(sum(fs._inv_remaining(r) for r in overdue), 2)
        finally:
            restore()
        return len(overdue), outstanding

    n_overdue, outstanding = with_test_db(scenario)
    assert n_overdue >= 60, "all 60 high-volume receivables are aggregated"
    assert outstanding >= 60000, "outstanding sums correctly at volume"


# ---------------------------------------------------------------------------
# T10-05.7 -- Pharma distribution: GST-inclusive gross invoices. No GST math
# exists, so the gross amount is the number the app tracks (as-is).
# ---------------------------------------------------------------------------
def test_pharma_gst_gross_handled_as_is(with_test_db):
    async def scenario(db):
        t = await build_niche_tenant(db, "pharma", tenant_id="t1")
        # a 236,000 gross (= 200,000 base + 18% GST). No tax field, no extraction.
        await _sales_invoice(db, "t1", 236000, paid=100000, due_days=10, iid="gst1")
        import services.finance_signals as fs
        restore = _use_db(db, fs)
        try:
            inv = await db.invoices.find_one({"id": "gst1"}, {"_id": 0})
            remaining = fs._inv_remaining(inv)
        finally:
            restore()
        return remaining

    remaining = with_test_db(scenario)
    assert remaining == 136000, "outstanding = gross - paid (236000-100000); GST is not split out"


# ---------------------------------------------------------------------------
# T10-05.8 -- Professional services / consulting: recurring retainers, no
# inventory. Finance handles repeating sales invoices; no purchase bills.
# ---------------------------------------------------------------------------
def test_consulting_retainers_no_inventory(with_test_db):
    async def scenario(db):
        t = await build_niche_tenant(db, "consulting", tenant_id="t1")
        sales = await db.invoices.count_documents({"tenant_id": "t1", "type": "sales_invoice"})
        purchases = await db.invoices.count_documents({"tenant_id": "t1", "type": "purchase_bill"})
        company = await _company_view(db, t)
        return sales, purchases, company["view"]

    sales, purchases, view = with_test_db(scenario)
    assert sales >= 3, "recurring retainer + project invoices are seeded"
    assert purchases == 0, "a services business has no purchase bills / inventory"
    assert view == "owner", "operating score renders for a retainer-based consultancy"


# ---------------------------------------------------------------------------
# T10-05.9 -- Construction: large staged/milestone contracts with partial
# payments. Outstanding must reflect amount - the staged partial.
# ---------------------------------------------------------------------------
def test_construction_milestone_partial_payments(with_test_db):
    async def scenario(db):
        t = await build_niche_tenant(db, "construction", tenant_id="t1")
        # a 10,00,000 contract with a 3,00,000 milestone paid so far
        await _sales_invoice(db, "t1", 1000000, paid=300000, due_days=10, iid="proj1")
        import services.finance_signals as fs
        restore = _use_db(db, fs)
        try:
            inv = await db.invoices.find_one({"id": "proj1"}, {"_id": 0})
            remaining = fs._inv_remaining(inv)
        finally:
            restore()
        return remaining

    remaining = with_test_db(scenario)
    assert remaining == 700000, "milestone billing: outstanding = contract - staged partial (1,000,000-300,000)"


# ---------------------------------------------------------------------------
# T10-05.10 -- Agriculture (seasonal): lumpy, seasonal gaps. Overdue detection
# fires on a genuinely old receivable, not on a recent one.
# ---------------------------------------------------------------------------
def test_agriculture_seasonal_gaps_no_misfire(with_test_db):
    async def scenario(db):
        t = await build_niche_tenant(db, "agriculture", tenant_id="t1")
        await _sales_invoice(db, "t1", 220000, paid=0, due_days=-200, iid="old_season")   # last season
        await _sales_invoice(db, "t1", 40000, paid=0, due_days=3, iid="this_season")      # not due yet
        overdue = await _overdue_receivables(db)
        ids = [o["id"] for o in overdue]
        return ids

    ids = with_test_db(scenario)
    assert "old_season" in ids, "a genuinely overdue seasonal receivable is chased"
    assert "this_season" not in ids, "a not-yet-due receivable does NOT misfire across a seasonal gap"


# ---------------------------------------------------------------------------
# T10-05.11 -- Custom 'Other' free-text industry (not one of the 26): the read
# paths must still work with sensible defaults, no crash.
# ---------------------------------------------------------------------------
def test_custom_other_industry_no_crash(with_test_db):
    async def scenario(db):
        t = await seed_tenant(db, tenant_id="t1", name="Bespoke Co", industry="Artisanal Drone Assembly",
                              roles=["makers", "sales"], member_roles=["makers", "sales"])
        await _sales_invoice(db, "t1", 55000, paid=0, due_days=-30, iid="c1")
        await db.tasks.insert_one({"id": new_id(), "tenant_id": "t1", "assignee_id": t["owner_id"],
                                   "status": "done", "title": "Assemble unit"})
        company = await _company_view(db, t)
        overdue = await _overdue_receivables(db)
        tenant = await db.tenants.find_one({"id": "t1"}, {"_id": 0})
        return tenant["industry"], company["view"], len(overdue)

    industry, view, n_overdue = with_test_db(scenario)
    assert industry == "Artisanal Drone Assembly", "a free-text industry is stored as-is"
    assert view == "owner" and n_overdue == 1, "operating score + finance work with sensible defaults, no crash"


# ---------------------------------------------------------------------------
# T10-05.12 -- Per-niche distinctness sweep: every niche yields a DISTINCT role
# set + industry -- not a textile template copy.
# ---------------------------------------------------------------------------
def test_all_niches_are_distinct(with_test_db):
    async def scenario(db):
        out = {}
        for i, niche in enumerate(NICHES):
            t = await build_niche_tenant(db, niche, tenant_id=f"t{i}")
            tenant = await db.tenants.find_one({"id": t["tenant_id"]}, {"_id": 0})
            out[niche] = (tenant["industry"], tuple(r["key"] for r in tenant["roles"]))
        return out

    out = with_test_db(scenario)
    assert len(out) == 10, "all 10 niches build"
    industries = [ind for ind, _ in out.values()]
    role_sets = [roles for _, roles in out.values()]
    assert len(set(industries)) == len(industries), "every niche has a distinct industry"
    # textile's role set must not be copied wholesale onto another niche
    textile_roles = out["textile"][1]
    copies = [n for n, (_, roles) in out.items() if n != "textile" and roles == textile_roles]
    assert not copies, f"no niche reuses the textile role template: {copies}"
    # at least 7 distinct role signatures across the 10 niches (real variety)
    assert len(set(role_sets)) >= 7, "niches produce varied role structures, not one template"
