"""The Company Brain and the Journal are different places (2026-10-06, founder:
"are we having the brain, company brain separately … right now are we using the
journal as a brain … the journal is the owner's or decision makers' place to
refer the histories of the decisions").

Before: company notes had no screen; the owner-only Journal listed them beside
decisions; anyone with Brain access could write notes; finance records were
copied into the notes with their amounts. Now:
  * Brain notes: owner + Manage Team add / edit / remove; everyone reads what
    they may (who-can-see like documents; money notes are Finance's).
  * Notes are indexed beside documents, so Dex finds them by meaning -- and a
    note someone may not read never reaches their answer.
  * The Journal is decision history, for the owner and anyone who approves
    decisions, each seeing the decisions they may open.

Single-process (reaches shared clients):
    .venv/Scripts/python -m pytest tests/test_company_brain_and_journal.py -o addopts="" -p no:xdist
"""
import os

import pytest
from fastapi import HTTPException

from shared.ids import now_iso
from tests.e2e_harness import e2e_env, seed_tenant_and_users

pytestmark = pytest.mark.skipif(bool(os.environ.get("PYTEST_XDIST_WORKER")),
                                reason="single-process: reaches shared clients")

T = "t1"
OWNER = {"id": "u-owner", "tenant_id": T, "role": "owner", "name": "Owner"}
MANAGER = {"id": "u-operations", "tenant_id": T, "role": "operations", "name": "Ops Lead",
           "permissions": ["brain", "ask", "tasks", "team_manage"]}
SALES = {"id": "u-sales", "tenant_id": T, "role": "sales", "name": "Sales User",
         "permissions": ["brain", "ask", "tasks"]}
APPROVER = {"id": "u-finance", "tenant_id": T, "role": "finance", "name": "Finance User",
            "permissions": ["brain", "ask", "tasks", "finance", "decisions_approve"]}


@pytest.fixture
def no_indexing(monkeypatch):
    """The API schedules indexing in the background; these tests check the API."""
    import services.ai.brain_embed as be
    monkeypatch.setattr(be, "spawn", lambda coro: coro.close())


async def _expect(code, coro):
    try:
        await coro
    except HTTPException as e:
        assert e.status_code == code, e.detail
        return
    raise AssertionError(f"expected {code}")


def test_notes_are_curated_by_the_owner_and_managers(with_test_db, no_indexing):
    async def scenario(db):
        with e2e_env(db):
            await seed_tenant_and_users(db)
            import routers.brain_notes as bn
            n = await bn.create_note(bn.NoteInput(text="Kumar Traders pay by RTGS every Friday", tag="Customer"), user=OWNER)
            assert n["source"] == "manual" and n["tag"] == "customer" and n["visibility"] == "public"
            m = await bn.create_note(bn.NoteInput(text="Loom 4 runs only on the night shift"), user=MANAGER)
            assert m["created_by_name"] == "Ops Lead"
            await _expect(403, bn.create_note(bn.NoteInput(text="mine"), user=SALES))
            await _expect(403, bn.update_note(n["id"], bn.NotePatch(text="x"), user=SALES))
            await _expect(403, bn.delete_note(n["id"], user=SALES))
            edited = await bn.update_note(n["id"], bn.NotePatch(text="Kumar Traders pay by RTGS on Fridays"), user=MANAGER)
            assert edited["text"].endswith("on Fridays")
            await bn.delete_note(m["id"], user=OWNER)
            assert await db.memory.count_documents({"id": m["id"]}) == 0
            # the old write endpoint follows the same rule
            import routers.complaints as cp
            from models.complaints import MemoryInput
            await _expect(403, cp.add_memory(MemoryInput(text="via the old door"), user=SALES))
            return True
    assert with_test_db(scenario) is True


def test_who_sees_which_note(with_test_db, no_indexing):
    async def scenario(db):
        with e2e_env(db):
            await seed_tenant_and_users(db)
            import routers.brain_notes as bn
            now = now_iso()
            await db.memory.insert_many([
                {"id": "pub", "tenant_id": T, "text": "Public rule", "tag": "policy", "created_at": now},
                {"id": "old", "tenant_id": T, "text": "A note from before visibility existed", "tag": "note", "created_at": now},
                {"id": "sales", "tenant_id": T, "text": "Sales team only", "visibility": "dept", "department": "sales", "created_at": now},
                {"id": "ops", "tenant_id": T, "text": "Operations only", "visibility": "dept", "department": "operations", "created_at": now},
                {"id": "mgr", "tenant_id": T, "text": "Owner and managers only", "visibility": "private", "created_at": now},
                {"id": "money", "tenant_id": T, "text": "Expense: Yarn - INR 45,000", "tag": "expense", "created_at": now},
            ])

            async def ids(user):
                return sorted(x["id"] for x in (await bn.list_notes(user=user))["notes"])
            assert await ids(SALES) == ["old", "pub", "sales"]
            assert await ids(APPROVER) == ["money", "old", "pub"], "Finance sees money notes, not other teams' notes"
            assert await ids(OWNER) == ["mgr", "money", "old", "ops", "pub", "sales"]
            assert (await bn.list_notes(user=SALES))["can_manage"] is False
            return True
    assert with_test_db(scenario) is True


def test_dex_finds_a_note_by_meaning_and_never_one_you_may_not_read(with_test_db, monkeypatch):
    async def scenario(db):
        with e2e_env(db):
            await seed_tenant_and_users(db)
            import integrations.qdrant as q
            import integrations.embeddings as emb
            import services.ai.brain_embed as be
            import services.ai.brain_retrieval as br
            q.reset_client()
            vec = [1.0, 0.0, 0.0, 0.0]

            async def fake_texts(texts, **k):
                return [vec for _ in texts]

            async def fake_query(text, **k):
                return vec
            monkeypatch.setattr(be, "embed_texts", fake_texts)
            monkeypatch.setattr(be, "embedding_dim", lambda task="default": 4)
            monkeypatch.setattr(emb, "embed_query", fake_query)
            notes = [{"id": "n-pub", "tenant_id": T, "text": "Call Kumar Traders before 11 am", "tag": "customer"},
                     {"id": "n-mgr", "tenant_id": T, "text": "Kumar Traders credit limit is under review",
                      "visibility": "private", "tag": "customer"}]
            await db.memory.insert_many([dict(n) for n in notes])
            for n in notes:
                assert await be.index_note(dict(n)) == 1
            got = await br.search_chunks(user=SALES, query="when to phone Kumar", limit=5)
            assert [h.get("note_id") for h in got] == ["n-pub"] and got[0]["source"] == "note"
            assert {h.get("note_id") for h in await br.search_chunks(user=OWNER, query="Kumar", limit=5)} == {"n-pub", "n-mgr"}
            cites = br.cites_from_hits(note_hits=got)
            assert cites[0]["type"] == "note" and cites[0]["deep_link"] == "/company-brain?tab=notes&note=n-pub"
            await db.memory.delete_one({"id": "n-pub"})
            assert await br.search_chunks(user=SALES, query="Kumar", limit=5) == [], "a deleted note is never cited"
            return True
    assert with_test_db(scenario) is True


def test_the_journal_is_the_decision_makers_history(with_test_db):
    async def scenario(db):
        with e2e_env(db):
            await seed_tenant_and_users(db)
            now = now_iso()
            await db.decisions.insert_many([
                {"id": "d-fin", "tenant_id": T, "title": "Buy yarn from Erode", "status": "approved",
                 "created_by": "u-sales", "approver_id": "u-finance", "created_at": now},
                {"id": "d-other", "tenant_id": T, "title": "Hire a night supervisor", "status": "approved",
                 "created_by": "u-owner", "approver_id": "u-owner", "created_at": now},
            ])
            await db.memory.insert_one({"id": "n1", "tenant_id": T, "text": "A note", "created_at": now})
            import routers.decisions as dec

            def ids(res):
                return sorted(d["id"] for day in res["days"] for d in day["decisions"])
            owner = await dec.ceo_journal(user=OWNER)
            assert ids(owner) == ["d-fin", "d-other"]
            assert not any(day.get("notes") for day in owner["days"]), "notes are the Company Brain's"
            assert ids(await dec.ceo_journal(user=APPROVER)) == ["d-fin"], "only the decisions they may open"
            # the gate is on the route (require_perm("decisions_approve")); a member without it is refused there
            from core.permissions import user_perms
            assert "decisions_approve" not in user_perms(SALES)
            return True
    assert with_test_db(scenario) is True
