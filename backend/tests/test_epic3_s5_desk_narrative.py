"""Epic 3 Sprint 5 (E3-06): LLM-generated Desk narrative + 15-min cache.

Verifies the cache (identical counters -> one LLM call) and the fallback (LLM error
-> deterministic template), against the real cache collection with the LLM mocked.
"""
import asyncio

import core
import routers.desk as desk
from database import db

_T = "desk-narr-test"


class _FakeChat:
    def with_model(self, *m):
        return self

    async def send_message(self, msg):
        _calls["n"] += 1
        return "Here is your AI-written briefing for today."


_calls = {"n": 0}


def _fake_claude_chat(**k):
    return _FakeChat()


def test_desk_narrative_cache_and_fallback(monkeypatch):
    async def go():
        await db.desk_narrative_cache.delete_many({"tenant_id": _T})
        cash = {"clear": False, "overdue_receivables_amount": 50000, "unmatched_payments": 1}
        try:
            # 1) LLM path + cache: two identical-counter calls -> exactly ONE LLM call
            monkeypatch.setattr(core, "claude_chat", _fake_claude_chat)
            _calls["n"] = 0
            n1 = await desk.ai_desk_narrative(delayed=2, completed_yday=3, pending_decisions=1,
                                              cash=cash, is_owner=True, tenant_id=_T)
            n2 = await desk.ai_desk_narrative(delayed=2, completed_yday=3, pending_decisions=1,
                                              cash=cash, is_owner=True, tenant_id=_T)
            assert n1 == "Here is your AI-written briefing for today."
            assert n2 == n1                       # served from cache
            assert _calls["n"] == 1               # LLM called once, second was a cache hit

            # 2) different counters -> a fresh generation (new cache key)
            n3 = await desk.ai_desk_narrative(delayed=9, completed_yday=0, pending_decisions=0,
                                              cash={"clear": True}, is_owner=True, tenant_id=_T)
            assert _calls["n"] == 2 and n3 == n1  # fake returns same text, but LLM was called again

            # 3) fallback: LLM raises -> deterministic template (never breaks the Desk)
            def _boom(**k):
                raise RuntimeError("provider down")
            monkeypatch.setattr(core, "claude_chat", _boom)
            await db.desk_narrative_cache.delete_many({"tenant_id": _T})   # force a miss
            n4 = await desk.ai_desk_narrative(delayed=1, completed_yday=0, pending_decisions=0,
                                              cash={"clear": True}, is_owner=False, tenant_id=_T)
            template = desk._narrative(delayed=1, completed_yday=0, pending_decisions=0,
                                       cash={"clear": True}, is_owner=False)
            assert n4 == template
        finally:
            await db.desk_narrative_cache.delete_many({"tenant_id": _T})
    asyncio.run(go())
