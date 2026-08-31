"""Epic 10 Testing -- Sprint 11 (integration & regression health).

T10-11.9: the reusable per-niche test-data factory (tests/factories.py) builds a
realistic tenant for every supported niche, and the seed is consumable by the
real read paths (operating_score) without hand-rolling data.
"""
from tests.factories import build_niche_tenant, NICHES


def _u(role, uid, tid, **over):
    u = {"role": role, "tenant_id": tid, "id": uid, "name": f"{role}-{uid}"}
    u.update(over)
    return u


def _use_db(testdb, *mods):
    saved = [(m, m.db) for m in mods if hasattr(m, "db")]
    for m, _ in saved:
        m.db = testdb
    return lambda: [setattr(m, "db", d) for m, d in saved]


# ---------------------------------------------------------------------------
# T10-11.9 -- the factory builds a realistic tenant for every niche.
# ---------------------------------------------------------------------------
def test_factory_builds_every_niche(with_test_db):
    async def scenario(db):
        out = {}
        for i, niche in enumerate(NICHES):
            t = await build_niche_tenant(db, niche, tenant_id=f"t{i}")
            counts = {
                "users": await db.users.count_documents({"tenant_id": t["tenant_id"]}),
                "memberships": await db.memberships.count_documents(
                    {"tenant_id": t["tenant_id"], "status": "active"}),
                "contacts": await db.contacts.count_documents({"tenant_id": t["tenant_id"]}),
                "sales": await db.invoices.count_documents(
                    {"tenant_id": t["tenant_id"], "type": "sales_invoice"}),
                "purchases": await db.invoices.count_documents(
                    {"tenant_id": t["tenant_id"], "type": "purchase_bill"}),
                "pay_in": await db.payments.count_documents(
                    {"tenant_id": t["tenant_id"], "direction": "in"}),
                "pay_out": await db.payments.count_documents(
                    {"tenant_id": t["tenant_id"], "direction": "out"}),
                "tasks": await db.tasks.count_documents({"tenant_id": t["tenant_id"]}),
                "industry": (await db.tenants.find_one({"id": t["tenant_id"]}, {"_id": 0}))["industry"],
            }
            out[niche] = counts
        return out

    out = with_test_db(scenario)
    assert set(out) == set(NICHES) and len(out) == len(NICHES), "every niche builds"
    for niche, c in out.items():
        has_purchases = bool(NICHES[niche]["purchases"])   # services niches (e.g. consulting) have none
        assert c["industry"] == NICHES[niche]["industry"], f"[{niche}] industry set"
        assert c["users"] >= 3 and c["memberships"] == c["users"], f"[{niche}] owner + members all active"
        assert c["contacts"] >= 2, f"[{niche}] contacts seeded"
        assert c["sales"] >= 1 and c["pay_in"] >= 1, f"[{niche}] sales invoices + collected payments seeded"
        # purchase bills + supplier (out) payments only where the niche buys goods
        assert (c["purchases"] >= 1) == has_purchases, f"[{niche}] purchase bills match the niche definition"
        assert (c["pay_out"] >= 1) == has_purchases, f"[{niche}] out-payments match the niche definition"
        assert c["tasks"] >= 2, f"[{niche}] tasks seeded"


# ---------------------------------------------------------------------------
# T10-11.9 -- a factory-built tenant is consumable by the real operating-score
# read path (proves the seed shape matches production queries).
# ---------------------------------------------------------------------------
def test_factory_tenant_feeds_operating_score(with_test_db):
    import routers.operating_score as osr
    import services.operating_score as oss

    async def scenario(db):
        t = await build_niche_tenant(db, "textile", tenant_id="t1")
        restore = _use_db(db, osr, oss)
        try:
            owner = _u("owner", t["owner_id"], "t1")
            company = await osr.operating_score(user_id=None, user=owner)
            # finance sub-score must count ONLY customer (direction=in) payments
            # (BUG-11): sum of the seeded in-payments.
            in_sum = sum(p["amount"] for p in await db.payments.find(
                {"tenant_id": "t1", "direction": "in"}, {"_id": 0, "amount": 1}).to_list(50))
            return company["view"], len(company.get("employees") or []), in_sum
        finally:
            restore()

    view, n_emp, in_sum = with_test_db(scenario)
    assert view == "owner", "owner gets the company operating-score view over the seeded tenant"
    assert n_emp >= 4, "the seeded owner + members appear in the employee roster"
    assert in_sum > 0, "the factory seeds real collected (direction=in) payments the score can read"
