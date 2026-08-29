"""FIX-003-B tests: Sprint 2 small tenancy-hygiene batch.

Covers four fixes shipped in one commit:
  * S2-05 — enrich_decision(s) accept a tenant_id and filter every
    child-id lookup by it. Defense-in-depth: today decisions come
    only from tenant-scoped queries so cross-tenant task_ids don't
    exist, but a bare {"id": {"$in": ids}} would happily return
    cross-tenant matches if a bug ever slipped one in.
  * S2-08 — contacts collection field is `type` (customer|vendor),
    not `kind`. The old {tenant_id: 1, kind: 1} index was dead and
    every type-filtered read fell back to a partial scan.
  * S2-10 — /auth/register race: two concurrent requests for the
    same email must not create an orphan tenant.
  * S2-12 — the four "active workflows" counter sites all use
    services.workflows.tenant_terminal_stages (from FIX-001-F).
    Sprint 2 backlog item is bookkeeping — this test verifies the
    invariant so it stays true.

All offline — same in-memory Mongo double + monkeypatching approach as
tests/test_tenant_phone_routing.py.
"""
import asyncio
import inspect
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


# =============================================================================
# In-memory Mongo double (kept local so this file is self-contained)
# =============================================================================
class _Cursor:
    def __init__(self, docs):
        self._docs = list(docs)
        self._sort = None

    def sort(self, field, direction=1):
        self._sort = (field, direction)
        return self

    def to_list(self, n):
        docs = list(self._docs)
        if self._sort:
            f, d = self._sort
            docs.sort(key=lambda x: (x.get(f) or ""), reverse=(d == -1))
        if n is not None:
            docs = docs[:n]

        async def _r():
            return docs
        return _r()

    def __aiter__(self):
        return _AIter(iter(self._docs))


class _AIter:
    def __init__(self, it):
        self._it = it

    def __aiter__(self):
        return self

    async def __anext__(self):
        try:
            return next(self._it)
        except StopIteration:
            raise StopAsyncIteration


class _Col:
    def __init__(self):
        self.docs = []
        self.unique_field = None  # set to enforce a unique constraint

    async def find_one(self, q, projection=None):
        for d in self.docs:
            if self._match(d, q):
                return dict(d)
        return None

    def find(self, q, projection=None):
        return _Cursor([d for d in self.docs if self._match(d, q)])

    async def insert_one(self, doc):
        if self.unique_field and doc.get(self.unique_field) is not None:
            for d in self.docs:
                if d.get(self.unique_field) == doc[self.unique_field]:
                    # Simulate DuplicateKeyError shape (name-matches
                    # pymongo's class used in the router code path).
                    from pymongo.errors import DuplicateKeyError
                    raise DuplicateKeyError(
                        f"E11000 duplicate key error: {self.unique_field}"
                    )
        self.docs.append(dict(doc))
        return SimpleNamespace(inserted_id=doc.get("id"))

    async def delete_one(self, q):
        for i, d in enumerate(self.docs):
            if self._match(d, q):
                self.docs.pop(i)
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)

    async def update_one(self, q, u, upsert=False):
        for d in self.docs:
            if self._match(d, q):
                if "$set" in u:
                    d.update(u["$set"])
                return SimpleNamespace(matched_count=1, modified_count=1)
        return SimpleNamespace(matched_count=0, modified_count=0)

    async def count_documents(self, q):
        return sum(1 for d in self.docs if self._match(d, q))

    async def create_index(self, *a, **kw):
        return "ok"

    def _match(self, d, q):
        for k, v in q.items():
            dv = d.get(k)
            if isinstance(v, dict):
                for op, ov in v.items():
                    if op == "$in" and dv not in ov:
                        return False
                    elif op == "$nin" and dv in ov:
                        return False
            elif dv != v:
                return False
        return True


class _FakeDB:
    def __init__(self):
        self.tasks = _Col()
        self.users = _Col()
        self.decisions = _Col()
        self.tenants = _Col()
        self.contacts = _Col()

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


# =============================================================================
# S2-05 — enrich_decision(s) tenant-guard
# =============================================================================
class TestEnrichDecisionsTenantGuard:
    def _install(self, monkeypatch):
        import server
        db = _FakeDB()

        async def _enrich_tasks(tasks):
            return list(tasks)
        monkeypatch.setattr(server, "db", db)
        monkeypatch.setattr(server, "enrich_tasks", _enrich_tasks)
        return db

    def test_explicit_tenant_id_filters_task_lookup(self, monkeypatch):
        import server
        db = self._install(monkeypatch)
        # Both tenants have a task with the same id — the wrong-tenant
        # task must NOT come back.
        _run(db.tasks.insert_one({"id": "T1", "tenant_id": "t_A", "title": "A's task"}))
        _run(db.tasks.insert_one({"id": "T1", "tenant_id": "t_B", "title": "B's task"}))
        _run(db.users.insert_one({"id": "u1", "tenant_id": "t_A", "name": "Anita"}))
        d = {"id": "d1", "tenant_id": "t_A", "task_ids": ["T1"], "created_by": "u1"}
        out = _run(server.enrich_decision(d, tenant_id="t_A"))
        assert len(out["tasks"]) == 1
        assert out["tasks"][0]["title"] == "A's task"

    def test_missing_tenant_id_infers_from_batch(self, monkeypatch):
        """When caller omits tenant_id AND every decision in the batch
        shares one tenant_id, we infer it. Prevents leaks in the very
        common single-tenant caller who forgets to pass it."""
        import server
        db = self._install(monkeypatch)
        _run(db.tasks.insert_one({"id": "T1", "tenant_id": "t_A", "title": "A"}))
        _run(db.tasks.insert_one({"id": "T1", "tenant_id": "t_B", "title": "B"}))
        decisions = [
            {"id": "d1", "tenant_id": "t_A", "task_ids": ["T1"], "created_by": None},
            {"id": "d2", "tenant_id": "t_A", "task_ids": ["T1"], "created_by": None},
        ]
        out = _run(server.enrich_decisions(decisions))  # no explicit tenant_id
        for d in out:
            assert all(t["title"] == "A" for t in d["tasks"])

    def test_mixed_batch_tenant_ids_skips_inference(self, monkeypatch):
        """If a batch mixes tenant_ids (never happens in per-tenant
        callers, but admin sweeps could), we skip inference and let
        the caller be responsible."""
        import server
        db = self._install(monkeypatch)
        _run(db.tasks.insert_one({"id": "T1", "tenant_id": "t_A", "title": "A"}))
        _run(db.tasks.insert_one({"id": "T2", "tenant_id": "t_B", "title": "B"}))
        decisions = [
            {"id": "d1", "tenant_id": "t_A", "task_ids": ["T1"], "created_by": None},
            {"id": "d2", "tenant_id": "t_B", "task_ids": ["T2"], "created_by": None},
        ]
        out = _run(server.enrich_decisions(decisions))
        # Both tasks should still enrich correctly by id (no tenant
        # narrowing because the batch is mixed).
        titles = {t["title"] for d in out for t in d["tasks"]}
        assert titles == {"A", "B"}

    def test_creator_lookup_also_tenant_scoped(self, monkeypatch):
        """A cross-tenant creator id must not enrich to another tenant's
        user name."""
        import server
        db = self._install(monkeypatch)
        _run(db.users.insert_one({"id": "u1", "tenant_id": "t_other", "name": "Rogue"}))
        # No task_ids — just creator resolution.
        d = {"id": "d1", "tenant_id": "t_A", "task_ids": [], "created_by": "u1"}
        out = _run(server.enrich_decision(d, tenant_id="t_A"))
        assert out["created_by_name"] == "Unknown"


# =============================================================================
# S2-08 — contacts index uses `type`, not `kind`
# =============================================================================
class TestContactsIndexUsesTypeField:
    def test_bootstrap_creates_type_index_not_kind(self):
        """The bootstrap must add the {tenant_id: 1, type: 1} index —
        the field the query path actually filters on. Regression guard:
        make sure the fix hasn't been reverted."""
        import server
        src = inspect.getsource(server._bootstrap)
        assert '[("tenant_id", 1), ("type", 1)]' in src, (
            "contacts index must key on `type`, not `kind`"
        )

    def test_bootstrap_drops_legacy_kind_index(self):
        """The dead index must be dropped so a `db.contacts.getIndexes()`
        doesn't confuse future maintainers (or `explain()` output)."""
        import server
        src = inspect.getsource(server._bootstrap)
        assert '("tenant_id", 1), ("kind", 1)' in src, (
            "bootstrap must inspect for the legacy kind index before dropping"
        )
        assert 'drop_index' in src


# =============================================================================
# S2-10 — /auth/register concurrent-registration race
# =============================================================================
class TestRegisterConcurrentRace:
    def test_register_source_catches_duplicate_key(self):
        """Regression guard: the register handler must wrap the user
        insert in a try/except that recognizes DuplicateKeyError and
        turns it into a 400. Without this, the second concurrent
        request 500s AND leaves an orphan tenant."""
        from routers.auth import register
        src = inspect.getsource(register)
        assert "DuplicateKeyError" in src, (
            "register must catch DuplicateKeyError on the users insert"
        )
        # Rollback of the orphan tenant.
        assert 'db.tenants.delete_one({"id": tenant_id})' in src, (
            "register must roll back the orphan tenant when the user "
            "insert loses the race"
        )
        # Same friendly 400 as the fast path.
        assert '"Email already registered"' in src

    def test_users_email_unique_index_present(self):
        """The DB-side guarantee that makes the race safe: unique
        index on users.email. The bootstrap already creates it, but
        this test locks it in so a bootstrap refactor can't quietly
        remove it."""
        import server
        src = inspect.getsource(server._bootstrap)
        assert 'db.users.create_index("email", unique=True)' in src, (
            "users.email must have a unique index — that's the DB-side "
            "guarantee that makes the race safe"
        )


# =============================================================================
# S2-12 — "active workflows" counter uses dynamic terminal stages
# =============================================================================
class TestActiveWorkflowsUsesDynamicTerminals:
    def test_no_hardcoded_terminal_stage_pair_in_server(self):
        """Regression guard: no source line in server.py may hardcode
        ["delivered", "paid"] as the terminal-stage set. Every counter
        must resolve stages via services.workflows.tenant_terminal_stages
        (FIX-001-F). S2-12 in the tracker is closed by that fix — this
        test just makes sure it stays closed."""
        import server
        src = inspect.getsource(server)
        # The exact-hardcode pattern the audit called out.
        assert '["delivered", "paid"]' not in src, (
            "server.py hardcoded ['delivered', 'paid'] terminal stages — "
            "must use services.workflows.tenant_terminal_stages instead"
        )
        assert "'delivered', 'paid'" not in src

    def test_active_workflow_counter_uses_dynamic_helper(self):
        """The count_documents that computes `active_workflows` must
        get its terminal-stage list from tenant_terminal_stages."""
        import server
        src = inspect.getsource(server)
        # The variable pattern used in the counter block.
        assert "await tenant_terminal_stages(tid)" in src, (
            "active_workflows counter must await tenant_terminal_stages(tid)"
        )
