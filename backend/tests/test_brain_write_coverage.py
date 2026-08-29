"""FIX-007-B (Sprint 4 batch B): Brain write-coverage tests.

Covers:
  S4-02  record_context() gained a first-class decision_id param so
         decision -> task -> outcome chains are reconstructable. The
         save_execution_plan endpoint (which was silently completing
         tasks without a Brain write) now fires record_context in
         parity with the update_task status=done path. All 3 existing
         task-related record_context call sites (task_done, approved,
         rejected) thread decision_id through.

  S4-10  Five new write sites drop rows into brain_context so the Dex
         agent + /ask can answer "how did we handle X?" for events
         that were previously invisible:
           * advance_workflow           (kind="workflow")
           * process_meeting complete   (kind="meeting")
           * create_expense (non-manual) (kind="finance")
           * create_income              (kind="finance")
           * reconcile_payment matched  (kind="finance")
         New KIND_VALUES: workflow, finance, meeting, ingestion.
         New optional field related_ids for cross-referencing
         invoice_id / workflow_id / etc. from one context row.
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

# record_context for a workflow advance lives in the ENGINE now, not the router.
import services.workflow_engine as _wfe  # noqa: E402

# --- stale-test compat shim (Epic 8 refactor moved these off server.py) ---
# The functions below moved out of server.py; re-bind them onto the
# server module so the source-inspection asserts resolve unchanged.
import server as _server_mod  # noqa: E402
from routers.workflows import advance_workflow as _shim_advance_workflow  # noqa: E402
from services.meetings import process_meeting as _shim_process_meeting  # noqa: E402
_STALE_SHIMS = {
    'advance_workflow': _shim_advance_workflow,
    'process_meeting': _shim_process_meeting,
}


def _apply_stale_shims():
    for _n, _f in _STALE_SHIMS.items():
        setattr(_server_mod, _n, _f)


_apply_stale_shims()


@pytest.fixture(autouse=True)
def _reapply_stale_shims():
    # Re-bind before every test: a monkeypatch.setattr(server, <fn>) in another
    # module deletes these on teardown (they were absent when it snapshotted),
    # which made these source-grep tests order-flaky under -n/--dist loadscope.
    _apply_stale_shims()
    yield


# ---------------------------------------------------------------------------
# Small async fake — same pattern as the rest of the suite.
# ---------------------------------------------------------------------------
class _Col:
    def __init__(self, name=""):
        self._name = name
        self.docs = []

    async def find_one(self, q, projection=None):
        for d in self.docs:
            if self._match(d, q):
                return dict(d)
        return None

    async def insert_one(self, doc):
        self.docs.append(dict(doc))
        return SimpleNamespace(inserted_id=doc.get("id"))

    def _match(self, d, q):
        for k, v in q.items():
            if d.get(k) != v:
                return False
        return True


class _FakeDB:
    def __init__(self):
        self.brain_context = _Col("brain_context")
        self.tenants = _Col("tenants")


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


# ===========================================================================
# S4-02: record_context now accepts decision_id + related_ids
# ===========================================================================
class TestRecordContextSignature:
    def test_signature_includes_decision_id_and_related_ids(self):
        from services.ai.brain_context import record_context
        sig = inspect.signature(record_context)
        assert "decision_id" in sig.parameters
        assert "related_ids" in sig.parameters
        # Both must be keyword-only + default to None so every existing
        # call site keeps working unchanged.
        for name in ("decision_id", "related_ids"):
            p = sig.parameters[name]
            assert p.default is None
            assert p.kind == inspect.Parameter.KEYWORD_ONLY

    def test_decision_id_written_only_when_provided(self, monkeypatch):
        """No spurious null field on ad-hoc notes."""
        from services.ai import brain_context
        db = _FakeDB()
        monkeypatch.setattr(brain_context, "db", db)
        # Without decision_id.
        _run(brain_context.record_context(
            tenant_id="t1", kind="note", title="ad-hoc note",
        ))
        row = db.brain_context.docs[-1]
        assert "decision_id" not in row

        # With decision_id.
        _run(brain_context.record_context(
            tenant_id="t1", kind="task_done", title="Order confirmed",
            decision_id="dec-42",
        ))
        row = db.brain_context.docs[-1]
        assert row["decision_id"] == "dec-42"

    def test_decision_id_length_capped(self, monkeypatch):
        """Truncate very long ids so a bad caller can't blow the doc."""
        from services.ai import brain_context
        db = _FakeDB()
        monkeypatch.setattr(brain_context, "db", db)
        long_id = "d" * 200
        _run(brain_context.record_context(
            tenant_id="t1", kind="task_done", title="x",
            decision_id=long_id,
        ))
        row = db.brain_context.docs[-1]
        assert len(row["decision_id"]) <= 64

    def test_related_ids_stored_only_when_non_empty(self, monkeypatch):
        from services.ai import brain_context
        db = _FakeDB()
        monkeypatch.setattr(brain_context, "db", db)
        # Empty dict → not stored.
        _run(brain_context.record_context(
            tenant_id="t1", kind="finance", title="x",
            related_ids={},
        ))
        assert "related_ids" not in db.brain_context.docs[-1]
        # None-only values → not stored.
        _run(brain_context.record_context(
            tenant_id="t1", kind="finance", title="y",
            related_ids={"workflow_id": None, "invoice_id": None},
        ))
        assert "related_ids" not in db.brain_context.docs[-1]
        # Mixed → only non-null kept, string-coerced, capped.
        _run(brain_context.record_context(
            tenant_id="t1", kind="finance", title="z",
            related_ids={"workflow_id": "wf-1", "empty": None,
                          "invoice_id": "inv-99"},
        ))
        stored = db.brain_context.docs[-1]["related_ids"]
        assert stored == {"workflow_id": "wf-1", "invoice_id": "inv-99"}


class TestKindValuesExpanded:
    def test_new_kinds_are_recognised(self):
        from services.ai.brain_context import KIND_VALUES
        for kind in ("workflow", "finance", "meeting", "ingestion"):
            assert kind in KIND_VALUES, f"{kind} missing from KIND_VALUES"

    def test_old_kinds_still_present(self):
        """Additive only — no regression."""
        from services.ai.brain_context import KIND_VALUES
        for kind in ("decision", "approval", "task_done", "resolution", "note"):
            assert kind in KIND_VALUES

    def test_unknown_kind_still_falls_back_to_note(self, monkeypatch):
        from services.ai import brain_context
        db = _FakeDB()
        monkeypatch.setattr(brain_context, "db", db)
        _run(brain_context.record_context(
            tenant_id="t1", kind="not-a-real-kind", title="x",
        ))
        assert db.brain_context.docs[-1]["kind"] == "note"


# ===========================================================================
# S4-02: source-inspection guards on task-lifecycle call sites
# ===========================================================================
class TestTaskCallSitesPassDecisionId:
    """Every record_context call inside routers/tasks.py that touches
    a task with a potential parent decision must thread t.get('decision_id')
    through. Grep-based backstop so a future refactor can't silently
    drop the linkage."""

    def test_update_task_done_passes_decision_id(self):
        from routers import tasks as t
        src = inspect.getsource(t.update_task)
        assert "record_context(" in src
        assert 'decision_id=t.get("decision_id")' in src, (
            "S4-02 regression: update_task's task_done branch must "
            "pass decision_id=t.get('decision_id') to record_context"
        )

    def test_approve_task_passes_decision_id(self):
        from routers import tasks as t
        src = inspect.getsource(t.approve_task)
        assert 'decision_id=t.get("decision_id")' in src

    def test_reject_task_passes_decision_id(self):
        from routers import tasks as t
        src = inspect.getsource(t.reject_task)
        assert 'decision_id=t.get("decision_id")' in src

    def test_save_execution_plan_now_writes_brain_context(self):
        """THE S4-02 gap: this endpoint auto-transitions a task to
        status='done' when the plan hits 100% but wasn't writing to
        brain_context. Every OTHER completion path did. Fix must
        add the record_context call and pass decision_id."""
        from routers import tasks as t
        src = inspect.getsource(t.save_execution_plan)
        assert "record_context(" in src, (
            "S4-02 regression: save_execution_plan must call "
            "record_context when auto-completing a task"
        )
        assert 'kind="task_done"' in src
        assert 'decision_id=t.get("decision_id")' in src

    def test_save_execution_plan_only_writes_when_status_flips_to_done(self):
        """Guard against a stray record_context that would fire on
        every save (not just completion). The write must sit inside
        the `if updates.get("status") == "done":` block."""
        from routers import tasks as t
        src = inspect.getsource(t.save_execution_plan)
        idx_done = src.find('if updates.get("status") == "done"')
        idx_record = src.find("record_context(")
        assert idx_done >= 0 and idx_record >= 0
        assert idx_record > idx_done, (
            "S4-02 regression: record_context must be inside the "
            "status='done' branch of save_execution_plan"
        )


# ===========================================================================
# S4-10: new write sites
# ===========================================================================
class TestNewWriteSites:
    def test_advance_workflow_writes_brain_context(self):
        import server
        src = inspect.getsource(_wfe.advance)
        assert "brain_context.record_context(" in src
        assert 'kind="workflow"' in src
        # Terminal-stage detection so retrieval can rank completed above in-flight.
        assert 'outcome="completed"' in src or 'outcome=\'completed\'' in src
        assert 'source_type="workflow"' in src
        assert 'decision_id=wf.get("decision_id")' in src

    def test_advance_workflow_write_is_fail_open(self):
        """A Brain-write blip must not 500 the workflow advance."""
        import server
        src = inspect.getsource(_wfe.advance)
        # The new write must sit inside a try/except.
        i = src.find("brain_context.record_context(")
        assert i >= 0
        preface = src[max(0, i - 200):i]
        assert "try:" in preface

    def test_process_meeting_writes_brain_context(self):
        import server
        src = inspect.getsource(_shim_process_meeting)
        assert "brain_context.record_context(" in src
        assert 'kind="meeting"' in src
        assert 'source_type="meeting"' in src

    def test_create_expense_writes_brain_context_for_non_manual(self):
        from routers import ledger
        src = inspect.getsource(ledger.create_expense)
        assert "brain_context.record_context(" in src
        assert 'kind="finance"' in src
        assert 'source_type="expense"' in src
        # Wrapped in the same write_brain gate so manual-entry expenses
        # stay Brain-invisible unless the caller opts in.
        idx_gate = src.find("if write_brain")
        idx_rec = src.find("brain_context.record_context(")
        assert idx_gate < idx_rec, (
            "S4-10 regression: expense brain_context write must live "
            "inside the write_brain gate — manual entries stay quiet"
        )

    def test_create_income_writes_brain_context(self):
        from routers import ledger
        src = inspect.getsource(ledger.create_income)
        assert "brain_context.record_context(" in src
        assert 'kind="finance"' in src
        assert 'source_type="invoice"' in src

    def test_reconcile_payment_writes_brain_context(self):
        from routers import ledger
        src = inspect.getsource(ledger.reconcile_payment)
        assert "brain_context.record_context(" in src
        assert 'kind="finance"' in src
        assert 'source_type="payment"' in src
        # Only writes when an invoice was actually matched.
        i_ret_none = src.find("return None")
        i_rec = src.find("brain_context.record_context(")
        assert i_ret_none < i_rec, (
            "S4-10 regression: payment brain_context write must land "
            "AFTER the no-match early-return, or every unmatched "
            "payment would spam the Brain"
        )


class TestFinanceWritesUseFailOpen:
    """A Brain-write hiccup must never 500 a ledger operation. The
    tracker specifically said 'best-effort side-signal' — every new
    finance write site is wrapped in try/except."""

    def test_expense_write_wrapped_in_try(self):
        from routers import ledger
        src = inspect.getsource(ledger.create_expense)
        i = src.find("brain_context.record_context(")
        preface = src[max(0, i - 250):i]
        assert "try:" in preface

    def test_income_write_wrapped_in_try(self):
        from routers import ledger
        src = inspect.getsource(ledger.create_income)
        i = src.find("brain_context.record_context(")
        preface = src[max(0, i - 250):i]
        assert "try:" in preface

    def test_reconcile_write_wrapped_in_try(self):
        from routers import ledger
        src = inspect.getsource(ledger.reconcile_payment)
        i = src.find("brain_context.record_context(")
        # reconcile_payment builds several _cur/_amt/_dir/_party locals
        # between `try:` and the record_context call, so widen the
        # window vs. expense/income which have the try right before.
        preface = src[max(0, i - 800):i]
        assert "try:" in preface


class TestRecordContextEndToEnd:
    """One end-to-end drive of record_context with all the new fields
    populated — proves the full doc shape lands correctly."""

    def test_full_workflow_row_shape(self, monkeypatch):
        from services.ai import brain_context
        db = _FakeDB()
        monkeypatch.setattr(brain_context, "db", db)
        _run(brain_context.record_context(
            tenant_id="tenant-abc",
            kind="workflow",
            title="Sales pipeline — Kapoor order",
            outcome="completed",
            why="Advanced to Paid stage",
            tags=["procurement"],
            source_type="workflow",
            source_id="wf-42",
            decision_id="dec-99",
            related_ids={"workflow_type": "sales", "counterparty": "Kapoor Retail"},
            actor_id="user-7", actor_name="Priya",
            department="sales", visibility="public",
        ))
        row = db.brain_context.docs[-1]
        assert row["tenant_id"] == "tenant-abc"
        assert row["kind"] == "workflow"
        assert row["title"] == "Sales pipeline — Kapoor order"
        assert row["outcome"] == "completed"
        assert row["source_type"] == "workflow"
        assert row["source_id"] == "wf-42"
        assert row["decision_id"] == "dec-99"
        assert row["related_ids"] == {"workflow_type": "sales",
                                        "counterparty": "Kapoor Retail"}
        assert row["visibility"] == "public"
        # Auto-tag was called too — at least "procurement" plus any base matches.
        assert "procurement" in row["tags"]

    def test_write_never_raises_on_db_blip(self, monkeypatch):
        """record_context is the poster child for fail-open — a Mongo
        outage MUST return None, never propagate."""
        from services.ai import brain_context

        class _Boom:
            async def insert_one(self, *a, **k):
                raise RuntimeError("mongo down")

        class _BoomDB:
            brain_context = _Boom()
            tenants = _Col("tenants")

        monkeypatch.setattr(brain_context, "db", _BoomDB())
        out = _run(brain_context.record_context(
            tenant_id="t1", kind="task_done", title="x",
            decision_id="d1",
        ))
        assert out is None  # returned None, did not raise
