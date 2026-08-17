"""Epic 7 Sprint 1 Phase A -- regression guard on the /operating-score
role-aware payload shape.

Founder ask 2026-08-17: 'if the team person login and go the ops it have to
show the individuals person metrics right'. Before this ship the endpoint
was owner-gated (require_role('owner')) so a non-owner just got 403. After
this ship the endpoint dispatches by role: owner keeps the company payload
(now with a `my_snapshot` widget for owner-as-IC), everyone else gets a
self payload with their own stats, their open work, their active workflows,
and their peer context.

This test is a grep-level guard on the endpoint's shape contract, not a live
DB test -- the two payload shapes are structural and easy to drift on refactor.
"""
from pathlib import Path
import re


SERVER_PY = Path(__file__).resolve().parent.parent / "server.py"


def _read_server():
    return SERVER_PY.read_text(encoding="utf-8")


def test_operating_score_is_open_to_any_authenticated_user():
    """require_role('owner') was the old gate; must now be get_current_user
    or the founder ask isn't fulfilled."""
    src = _read_server()
    m = re.search(
        r'@api\.get\("/operating-score"\)\s*\nasync def operating_score\(([\s\S]*?)\):',
        src,
    )
    assert m, "operating_score route signature not found -- update this test"
    sig = m.group(1)
    assert "get_current_user" in sig, (
        "REGRESSION: /operating-score is not open to any authenticated user. "
        "Founder ask 2026-08-17: 'if the team person login and go the ops it "
        "have to show the individuals person metrics'. Use get_current_user, "
        "not require_role('owner') -- dispatch by role INSIDE the handler.")
    assert "require_role" not in sig, (
        "REGRESSION: /operating-score signature still has require_role. "
        "The role gate belongs inside the body, not on the dependency.")


def test_operating_score_dispatches_by_role_via_view_discriminator():
    """The payload must carry a `view` field ('owner' or 'self') so the
    frontend dispatcher can pick OwnerView vs SelfView without probing the
    shape."""
    src = _read_server()
    m = re.search(
        r'async def operating_score\(.*?\n(.*?)(?=\n@api\.|\nasync def |\ndef |\Z)',
        src, re.DOTALL,
    )
    assert m, "operating_score body not found -- update this test"
    body = m.group(1)
    assert 'payload["view"] = "owner"' in body, (
        'REGRESSION: owner-view payload is missing view="owner". '
        "Frontend dispatcher depends on this discriminator.")
    assert 'payload["view"] = "self"' in body, (
        'REGRESSION: self-view payload is missing view="self". '
        "Frontend dispatcher depends on this discriminator.")


def test_owner_view_carries_my_snapshot():
    """Owner is also an IC -- OwnerView needs a personal snapshot widget so
    the founder can see their own execution without switching views."""
    src = _read_server()
    m = re.search(
        r'async def operating_score\(.*?\n(.*?)(?=\n@api\.|\nasync def |\ndef |\Z)',
        src, re.DOTALL,
    )
    body = m.group(1)
    assert 'payload["my_snapshot"] = await compute_employee_stats' in body, (
        "REGRESSION: owner payload no longer carries my_snapshot. This is "
        "the owner-as-IC widget added in Epic 7 Sprint 1 Phase A.")


def test_self_view_shape():
    """SelfView payload must carry {self, stats, my_open_work,
    my_active_workflows, peer_context}. Frontend components depend on each key."""
    src = _read_server()
    m = re.search(
        r'async def _self_operating_view\(.*?\n(.*?)(?=\n\nasync def |\ndef |\n@api\.|\Z)',
        src, re.DOTALL,
    )
    assert m, "_self_operating_view not found -- update this test"
    body = m.group(1)
    for key in ('"self":', '"stats":', '"my_open_work":',
                '"my_active_workflows":', '"peer_context":'):
        assert key in body, (
            f"REGRESSION: self-view payload missing {key} -- "
            "frontend SelfView depends on this key.")


def test_self_view_reuses_compute_employee_stats():
    """The individual endpoint's compute_employee_stats already computes
    richer signals (proof_upload_rate, plan adoption, photos, voice) that
    the company view discards. SelfView must reuse it, not reimplement."""
    src = _read_server()
    m = re.search(
        r'async def _self_operating_view\(.*?\n(.*?)(?=\n\nasync def |\ndef |\n@api\.|\Z)',
        src, re.DOTALL,
    )
    body = m.group(1)
    assert "compute_employee_stats" in body, (
        "REGRESSION: _self_operating_view isn't calling compute_employee_stats. "
        "Don't reimplement the richer signals; reuse the WorkCoach path.")


def test_operating_score_accepts_user_id_for_owner_view_as():
    """Sprint 1 batch 4 (2026-08-17): owner can view any teammate's ops via
    ?user_id=X. Founder ask: 'from the owner side if i click the team member
    is it working better or not will show their tasks all the things the
    individual ops has right'. Before this ship the leaderboard click went
    to /coach (WorkCoach) which only shows stats + AI review, no open work
    or active workflows. Now it goes to /operating-score?user=X which
    returns the target's full self-view."""
    src = _read_server()
    m = re.search(
        r'@api\.get\("/operating-score"\)\s*\nasync def operating_score\(([\s\S]*?)\):',
        src,
    )
    assert m, "operating_score signature not found -- update this test"
    sig = m.group(1)
    assert "user_id" in sig, (
        "REGRESSION: /operating-score no longer accepts user_id query param. "
        "Owner drill-down into a teammate's ops view is broken. "
        "Founder ask 2026-08-17.")


def test_operating_score_view_as_is_owner_only():
    """Non-owners passing user_id must get 403 -- otherwise anyone can
    read anyone else's stats. Privacy holds."""
    src = _read_server()
    m = re.search(
        r'async def operating_score\(.*?\n(.*?)(?=\n\nasync def |\ndef |\n@api\.|\Z)',
        src, re.DOTALL,
    )
    body = m.group(1)
    assert "is_owner" in body and "403" in body, (
        "REGRESSION: view-as is not gated on is_owner. Non-owners could pass "
        "user_id and read any teammate's private stats.")


def test_operating_score_view_as_returns_view_as_metadata():
    """Frontend needs to know when the owner is drilled-in vs viewing their
    own page so it can render the 'viewing as X' breadcrumb. Backend must
    return view_as: {id, name, role} on drilled-in payloads."""
    src = _read_server()
    m = re.search(
        r'async def operating_score\(.*?\n(.*?)(?=\n\nasync def |\ndef |\n@api\.|\Z)',
        src, re.DOTALL,
    )
    body = m.group(1)
    assert 'payload["view_as"]' in body, (
        "REGRESSION: view-as payload is missing view_as metadata. "
        "Frontend breadcrumb depends on this.")
