"""Epic 3 Sprint 10 (E3-10.5): AI quality report aggregation.

Inserts a known set of ai_calls rows for a scoped test tenant, runs ai_quality_report,
and asserts the rollups (ok-rate, parse-ok-rate, degraded, per-task, per-engine, recent
failures). Verifies the real Mongo aggregation, not a mock.

T10-11.2 P3: runs against an ISOLATED test DB (with_test_db) with core.usage.db patched
to it -- so it never touches founder-os-58 and can't cross-loop-contaminate other
modules sharing the app Mongo client (the old `from database import db` + asyncio.run
pattern was order-flaky under -n/loadscope and mutated the dev DB).
"""
import core.usage as _usage
from core import ai_quality_report, now_iso, new_id

_T = "aiq-test-tenant"


def _row(task, ok=True, parse_ok=None, degraded=False, engine="anthropic", model="claude-sonnet-4-6",
         tokens=100, latency=1000, error=None):
    return {"id": new_id(), "tenant_id": _T, "task": task, "engine": engine, "model": model,
            "ok": ok, "parse_ok": parse_ok, "degraded": degraded, "tokens_total": tokens,
            "latency_ms": latency, "error": error, "created_at": now_iso()}


async def _seed(db):
    await db.ai_calls.insert_many([
        _row("extraction.extract", ok=True, parse_ok=True, tokens=1000, latency=8000),
        _row("extraction.extract", ok=True, parse_ok=False, tokens=1200, latency=9000, error="bad json"),
        _row("brain.agent", ok=True, tokens=500, latency=10000),
        _row("embed.default", ok=True, engine="openai", model="text-embedding-3-small", tokens=10, latency=200),
        _row("ledger.ocr", ok=False, degraded=True, engine="none", model=None, tokens=0, latency=500, error="provider down"),
    ])


def test_ai_quality_report(with_test_db):
    async def go(db):
        _prev = _usage.db
        _usage.db = db  # point the usage module's global db at the isolated test db
        try:
            await _seed(db)
            r = await ai_quality_report(tenant_id=_T, since_hours=24)
            ov = r["overall"]
            assert ov["total_calls"] == 5
            assert ov["ok_rate"] == round(4 / 5, 3)          # 4 of 5 ok
            assert ov["parse_ok_rate"] == round(1 / 2, 3)    # 1 of 2 rows with parse_ok set
            assert ov["degraded"] == 1
            assert ov["distinct_tasks"] == 4

            by_task = {t["task"]: t for t in r["by_task"]}
            assert by_task["extraction.extract"]["calls"] == 2
            assert by_task["extraction.extract"]["parse_ok_rate"] == 0.5
            assert by_task["embed.default"]["parse_ok_rate"] is None   # embeddings don't parse
            assert by_task["ledger.ocr"]["degraded"] == 1

            engines = {e["engine"]: e for e in r["by_engine"]}
            assert engines["anthropic"]["calls"] == 3 and engines["openai"]["calls"] == 1

            fails = r["recent_failures"]
            assert len(fails) == 2   # one ok=False, one parse_ok=False
            assert any("provider down" in (f.get("error") or "") for f in fails)

            # empty tenant -> safe zeros, not an error
            empty = await ai_quality_report(tenant_id="no-such-tenant-xyz", since_hours=1)
            assert empty["overall"]["total_calls"] == 0 and empty["by_task"] == []
        finally:
            _usage.db = _prev
    with_test_db(go)
