"""Every pipeline says how many workflows it holds (2026-09-19).

Yokesh: "the count is not displaying very well — it only shows when I click;
in the PWA it's not even listing the count." The board loads one pipeline at a
time (/workflows?type=…) and every pipeline's count was taken from that one
list, so the pipeline on screen showed its number and every other one showed 0
— on the desktop pills and in the phone's pipeline menu alike, and the phone's
header showed no count at all.

GET /workflows/counts returns every pipeline's count in one grouped query, for
the caller's workspace only.
"""
import os
from pathlib import Path

import pytest

pytestmark = pytest.mark.skipif(
    bool(os.environ.get("PYTEST_XDIST_WORKER")),
    reason="rebinds module-level db globals - single-process only",
)


def test_each_pipeline_is_counted_for_this_workspace_only(with_test_db):
    async def scenario(db):
        import routers.workflows as wf
        saved = wf.db
        wf.db = db
        try:
            await db.workflows.insert_many([
                {"id": "a", "tenant_id": "t1", "type": "distribution"},
                {"id": "b", "tenant_id": "t1", "type": "purchase_payment"},
                {"id": "c", "tenant_id": "t1", "type": "purchase_payment"},
                {"id": "d", "tenant_id": "t2", "type": "distribution"},   # another workspace
                {"id": "e", "tenant_id": "t2", "type": "production"},
            ])
            return await wf.workflow_counts(user={"id": "u1", "tenant_id": "t1"})
        finally:
            wf.db = saved

    counts = with_test_db(scenario)
    assert counts == {"distribution": 1, "purchase_payment": 2}, \
        "every pipeline of this workspace, and nothing from another"


def test_an_empty_workspace_counts_nothing(with_test_db):
    async def scenario(db):
        import routers.workflows as wf
        saved = wf.db
        wf.db = db
        try:
            return await wf.workflow_counts(user={"id": "u1", "tenant_id": "t-empty"})
        finally:
            wf.db = saved
    assert with_test_db(scenario) == {}


def test_the_board_reads_counts_from_the_server_not_the_one_pipeline_loaded():
    page = (Path(__file__).resolve().parents[2] / "frontend" / "src" / "pages" / "Workflows.js").read_text(encoding="utf-8")
    assert '"/workflows/counts"' in page
    assert "counts.filter(" not in page and "(data || []).filter((w) => w.type === pip.key)" not in page, \
        "no pipeline is counted from the list of another"
    assert 'data-testid="workflows-pipeline-menu-count"' in page, "the phone's header says how many"
    assert 'queryKey: ["workflows-counts"]' in page.split("const refresh")[1][:400], \
        "and the counts refresh when a workflow is added or removed"
