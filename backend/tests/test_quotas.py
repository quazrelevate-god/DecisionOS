"""FIX-005-B (S3-04) tests: usage-quota enforcement.

  * check_quota: allow under cap, block over cap, cost-projection
    pre-block, unlimited plan always OK, fail-open on DB blip.
  * quota_status + quota_status_all shape.
  * aggregate_usage groups usage_events by tenant + month window.
  * guarded_llm reads _ctx_tenant and raises 402 on exceed.
  * guarded_llm skip_quota_check bypass (admin probe path).
  * GET /tenant/usage endpoint returns all quotas.
"""
import asyncio
import inspect
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


class _Cursor:
    def __init__(self, docs):
        self._docs = list(docs)

    def __aiter__(self):
        return self._it()

    async def _it(self):
        for d in self._docs:
            yield d

    def sort(self, *a, **kw):
        return self

    def to_list(self, n):
        docs = self._docs[:n] if n else list(self._docs)

        async def _r():
            return [dict(x) for x in docs]
        return _r()


class _Col:
    def __init__(self):
        self.docs = []

    async def find_one(self, q, projection=None):
        for d in self.docs:
            if self._match(d, q):
                return dict(d)
        return None

    def find(self, q, projection=None):
        return _Cursor([dict(d) for d in self.docs if self._match(d, q)])

    async def insert_one(self, doc):
        self.docs.append(dict(doc))
        return SimpleNamespace(inserted_id=doc.get("id"))

    async def count_documents(self, q):
        return sum(1 for d in self.docs if self._match(d, q))

    async def aggregate(self, pipeline):
        """Minimal aggregate: supports {$match} then {$group} with $sum
        + $cond that matches services/quotas.py exactly.

        NB: async to match AsyncMongoClient, where aggregate() is a coroutine
        that must be awaited before iterating. A sync fake here is what let
        BUG-14 (un-awaited aggregate failing open) slip past this suite."""
        docs = list(self.docs)
        for stage in pipeline:
            if "$match" in stage:
                docs = [d for d in docs if self._match(d, stage["$match"])]
            elif "$group" in stage:
                grp = stage["$group"]
                out = {"_id": grp["_id"]}
                for k, expr in grp.items():
                    if k == "_id":
                        continue
                    total = 0
                    for d in docs:
                        val = self._eval_expr(expr, d)
                        total += val
                    out[k] = total
                docs = [out]
        # Return a fake cursor.
        return _AsyncListIter(docs)

    def _eval_expr(self, expr, doc):
        # Handles $sum: "$field" or $sum: {$cond: [...]}
        if isinstance(expr, dict) and "$sum" in expr:
            inner = expr["$sum"]
            if isinstance(inner, str) and inner.startswith("$"):
                v = doc.get(inner[1:])
                return v or 0
            if isinstance(inner, dict) and "$cond" in inner:
                cond_expr, then_expr, else_expr = inner["$cond"]
                # cond_expr is {"$eq": ["$field", val]}
                if isinstance(cond_expr, dict) and "$eq" in cond_expr:
                    left, right = cond_expr["$eq"]
                    lv = doc.get(left[1:]) if isinstance(left, str) and left.startswith("$") else left
                    matched = (lv == right)
                    picked = then_expr if matched else else_expr
                    if isinstance(picked, str) and picked.startswith("$"):
                        return doc.get(picked[1:]) or 0
                    return picked or 0
        return 0

    async def create_index(self, *a, **kw):
        return "ok"

    def _match(self, d, q):
        for k, v in q.items():
            dv = d.get(k)
            if isinstance(v, dict):
                for op, ov in v.items():
                    if op == "$gte" and not (dv is not None and dv >= ov):
                        return False
                    elif op == "$in" and dv not in ov:
                        return False
                    elif op == "$ne" and dv == ov:
                        return False
                    elif op == "$exists" and (k in d) != ov:
                        return False
            elif dv != v:
                return False
        return True


class _AsyncListIter:
    def __init__(self, items):
        self._items = list(items)
        self._i = 0

    def __aiter__(self):
        return self

    async def __anext__(self):
        if self._i >= len(self._items):
            raise StopAsyncIteration
        v = self._items[self._i]
        self._i += 1
        return v


class _FakeDB:
    def __init__(self):
        self.tenants = _Col()
        self.usage_events = _Col()
        self.files = _Col()
        self.brain_documents = _Col()

    def __getattr__(self, name):
        col = _Col()
        setattr(self, name, col)
        return col

    def __getitem__(self, name):
        return getattr(self, name)


# Dedicated module-scoped loop (see audit-log note): owning our own loop
# keeps every call in this module on one live loop and is immune to another
# module's asyncio.run() closing the process current loop under -n/loadscope.
_LOOP = asyncio.new_event_loop()


def _run(coro):
    return _LOOP.run_until_complete(coro)


# ===========================================================================
# check_quota — allow / block / unlimited / fail-open
# ===========================================================================
class TestCheckQuota:
    def test_unlimited_always_ok(self):
        from services.quotas import check_quota
        db = _FakeDB()
        _run(db.tenants.insert_one({"id": "t1", "plan": "enterprise"}))
        ok, detail = _run(check_quota(db, "t1", "llm_tokens_total"))
        assert ok is True
        assert detail["cap"] is None
        assert detail["over"] is False

    def test_allows_under_cap(self):
        from services.quotas import check_quota
        db = _FakeDB()
        _run(db.tenants.insert_one({"id": "t1", "plan": "trial"}))  # cap 300k
        _run(db.usage_events.insert_one({
            "tenant_id": "t1", "created_at": datetime.now(timezone.utc).isoformat(),
            "tokens_total": 50_000, "unit_type": None, "units": 0,
        }))
        ok, detail = _run(check_quota(db, "t1", "llm_tokens_total"))
        assert ok is True
        assert detail["usage"] == 50_000
        assert detail["cap"] == 300_000
        assert detail["remaining"] == 250_000

    def test_blocks_over_cap(self):
        from services.quotas import check_quota
        db = _FakeDB()
        _run(db.tenants.insert_one({"id": "t1", "plan": "trial"}))
        _run(db.usage_events.insert_one({
            "tenant_id": "t1", "created_at": datetime.now(timezone.utc).isoformat(),
            "tokens_total": 400_000, "unit_type": None, "units": 0,
        }))
        ok, detail = _run(check_quota(db, "t1", "llm_tokens_total"))
        assert ok is False
        assert detail["over"] is True
        assert detail["usage"] == 400_000

    def test_cost_projection_preblocks(self):
        """A call that would push us OVER the cap is blocked even if
        current usage is under."""
        from services.quotas import check_quota
        db = _FakeDB()
        _run(db.tenants.insert_one({"id": "t1", "plan": "trial"}))
        _run(db.usage_events.insert_one({
            "tenant_id": "t1", "created_at": datetime.now(timezone.utc).isoformat(),
            "tokens_total": 299_000, "unit_type": None, "units": 0,
        }))
        # 299k + projected 5k call = 304k, over the 300k cap
        ok, detail = _run(check_quota(db, "t1", "llm_tokens_total", cost=5_000))
        assert ok is False
        assert detail["over"] is True

    def test_last_month_usage_excluded(self):
        """Aggregation window = current month. Old usage doesn't count."""
        from services.quotas import check_quota
        db = _FakeDB()
        _run(db.tenants.insert_one({"id": "t1", "plan": "trial"}))
        # Insert an event dated 40 days ago
        old = (datetime.now(timezone.utc) - timedelta(days=40)).isoformat()
        _run(db.usage_events.insert_one({
            "tenant_id": "t1", "created_at": old,
            "tokens_total": 400_000, "unit_type": None, "units": 0,
        }))
        ok, detail = _run(check_quota(db, "t1", "llm_tokens_total"))
        # Should be well under cap — old usage excluded.
        assert ok is True
        assert detail["usage"] == 0

    def test_other_tenants_usage_isolated(self):
        from services.quotas import check_quota
        db = _FakeDB()
        _run(db.tenants.insert_one({"id": "t1", "plan": "trial"}))
        _run(db.usage_events.insert_one({
            "tenant_id": "t_other", "created_at": datetime.now(timezone.utc).isoformat(),
            "tokens_total": 999_999, "unit_type": None, "units": 0,
        }))
        ok, detail = _run(check_quota(db, "t1", "llm_tokens_total"))
        assert ok is True
        assert detail["usage"] == 0


class TestStorageAndBrainDocsQuotas:
    def test_storage_bytes_sums_files(self):
        from services.quotas import check_quota
        db = _FakeDB()
        _run(db.tenants.insert_one({"id": "t1", "plan": "trial"}))  # 100MB cap
        _run(db.files.insert_one({"tenant_id": "t1", "size": 50 * 1024 * 1024}))
        _run(db.files.insert_one({"tenant_id": "t1", "size": 60 * 1024 * 1024}))
        ok, detail = _run(check_quota(db, "t1", "storage_bytes"))
        assert ok is False   # 110MB > 100MB cap
        assert detail["usage"] == 110 * 1024 * 1024

    def test_brain_docs_counts_documents(self):
        from services.quotas import check_quota
        db = _FakeDB()
        _run(db.tenants.insert_one({"id": "t1", "plan": "trial"}))  # cap 20
        for i in range(25):
            _run(db.brain_documents.insert_one({
                "id": f"d{i}", "tenant_id": "t1", "is_deleted": False,
            }))
        ok, detail = _run(check_quota(db, "t1", "brain_docs"))
        assert ok is False
        assert detail["usage"] == 25


# ===========================================================================
# quota_status shape (frontend dashboard)
# ===========================================================================
class TestQuotaStatus:
    def test_shape_unlimited(self):
        from services.quotas import quota_status
        db = _FakeDB()
        s = _run(quota_status(db, {"id": "t1", "plan": "enterprise"},
                                "llm_tokens_total"))
        assert s["cap"] is None
        assert s["percent"] == 0

    def test_shape_with_usage(self):
        from services.quotas import quota_status
        db = _FakeDB()
        _run(db.usage_events.insert_one({
            "tenant_id": "t1", "created_at": datetime.now(timezone.utc).isoformat(),
            "tokens_total": 150_000, "unit_type": None, "units": 0,
        }))
        s = _run(quota_status(db, {"id": "t1", "plan": "trial"}, "llm_tokens_total"))
        assert s["cap"] == 300_000
        assert s["usage"] == 150_000
        assert s["percent"] == 50.0
        assert s["remaining"] == 150_000


class TestQuotaStatusAll:
    def test_returns_row_per_quota(self):
        from services.quotas import quota_status_all
        db = _FakeDB()
        rows = _run(quota_status_all(db, {"id": "t1", "plan": "trial"}))
        keys = {r["resource"] for r in rows}
        # trial plan has 4 quotas: llm, stt, storage, brain_docs
        assert {"llm_tokens_total", "stt_minutes", "storage_bytes", "brain_docs"} == keys


# ===========================================================================
# guarded_llm wires quota check
# ===========================================================================
class TestGuardedLlmEnforcesQuota:
    def test_source_reads_ctx_tenant_and_calls_check_quota(self):
        import inspect
        from services.ai.llm_limits import guarded_llm
        src = inspect.getsource(guarded_llm)
        assert "_ctx_tenant" in src
        assert "check_quota" in src
        assert "status_code=402" in src
        assert '"quota_exceeded"' in src

    def test_source_supports_skip_quota_check(self):
        import inspect
        from services.ai.llm_limits import guarded_llm
        src = inspect.getsource(guarded_llm)
        assert "skip_quota_check" in src
        sig = inspect.signature(guarded_llm)
        assert "skip_quota_check" in sig.parameters

    def test_admin_probe_passes_skip_quota_check_true(self):
        import inspect
        import routers.admin
        src = inspect.getsource(routers.admin)
        # The admin key-probe path invokes guarded_llm with the skip flag.
        assert "skip_quota_check=True" in src

    def test_source_fails_open_on_quota_db_error(self):
        """A Mongo blip during the quota check must NOT block the LLM
        call — log + allow. Only genuine over-cap raises 402."""
        import inspect
        from services.ai.llm_limits import guarded_llm
        src = inspect.getsource(guarded_llm)
        # Quota-check block is wrapped in try/except that re-raises
        # HTTPException but swallows other errors.
        assert "if isinstance(_quota_err, HTTPException)" in src


# ===========================================================================
# GET /tenant/usage endpoint
# ===========================================================================
class TestUsageEndpoint:
    def test_endpoint_reads_all_quotas(self):
        # Epic 8 moved GET /api/tenant/usage -> routers/tenant_settings.py.
        from routers.tenant_settings import get_tenant_usage
        src = inspect.getsource(get_tenant_usage)
        assert "quota_status_all" in src
        # Any logged-in user can read (frontend needs it).
        assert "get_current_user" in src
