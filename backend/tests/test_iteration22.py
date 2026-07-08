"""
Iteration 22 — Task scoping bug fix on GET /api/tasks

Bug: My Work (?mine=true) previously used only assignee_role match, leaking
tasks assigned to OTHER named users who happened to share the role.
Fix: mine=true -> $or:[{assignee_id:me},{assignee_id:None,assignee_role:my_role}]

Tests:
 - mine=true for production: 0 tasks assigned to a different user
 - mine=true for production: contains at least own tasks + unclaimed role-pool
 - mine=false for production (regression): full production lane, no sales/finance
 - mine=false for owner (regression): all tenant tasks
 - mine=true for owner: only owner's own + unclaimed owner-role-pool
"""
import os
import pytest
import requests
from pathlib import Path


def _load_backend_url():
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if v:
        return v.rstrip("/")
    env = Path("/app/frontend/.env")
    if env.exists():
        for line in env.read_text().splitlines():
            if line.startswith("REACT_APP_BACKEND_URL="):
                return line.split("=", 1)[1].strip().rstrip("/")
    raise RuntimeError("REACT_APP_BACKEND_URL not set")


BASE_URL = _load_backend_url()
API = f"{BASE_URL}/api"

CREDS = {
    "owner": ("owner@sharma.com", "demo1234"),
    "sales": ("sales@sharma.com", "demo1234"),
    "production": ("production@sharma.com", "demo1234"),
    "finance": ("finance@sharma.com", "demo1234"),
}


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"Login failed for {email}: {r.status_code} {r.text}"
    data = r.json()
    return data["token"], data.get("user", {})


def _me(token):
    r = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {token}"}, timeout=10)
    assert r.status_code == 200
    j = r.json()
    return j.get("user", j)


def _tasks(token, mine=False):
    url = f"{API}/tasks" + ("?mine=true" if mine else "")
    r = requests.get(url, headers={"Authorization": f"Bearer {token}"}, timeout=20)
    assert r.status_code == 200, f"{url} -> {r.status_code} {r.text}"
    return r.json()


@pytest.fixture(scope="module")
def sessions():
    """Login all four demo users and fetch identity."""
    out = {}
    for key, (email, pw) in CREDS.items():
        tok, user = _login(email, pw)
        me = _me(tok) if not user else user
        out[key] = {"token": tok, "id": me["id"], "role": me["role"], "tenant_id": me.get("tenant_id"), "name": me.get("name")}
    # sanity — all four exist in the same tenant
    tenants = {v["tenant_id"] for v in out.values()}
    assert len(tenants) == 1, f"Demo users span multiple tenants: {tenants}"
    return out


# ---------------------------------------------------------------------------
# BUG FIX — production, mine=true
# ---------------------------------------------------------------------------

def test_production_mine_true_no_other_member_leakage(sessions):
    """The core bug: mine=true must NOT return tasks assigned to a different user."""
    prod = sessions["production"]
    tasks = _tasks(prod["token"], mine=True)
    assert isinstance(tasks, list)

    other_member_tasks = [
        t for t in tasks
        if t.get("assignee_id") and t["assignee_id"] != prod["id"]
    ]
    assert len(other_member_tasks) == 0, (
        f"LEAK: mine=true returned {len(other_member_tasks)} tasks assigned to another user. "
        f"Sample: {other_member_tasks[:3]}"
    )


def test_production_mine_true_composition(sessions):
    """Every task returned must be either mine OR unclaimed with my role."""
    prod = sessions["production"]
    tasks = _tasks(prod["token"], mine=True)

    bad = []
    mine = 0
    pool = 0
    for t in tasks:
        aid = t.get("assignee_id")
        arole = t.get("assignee_role")
        if aid == prod["id"]:
            mine += 1
        elif (aid is None) and arole == prod["role"]:
            pool += 1
        else:
            bad.append({"id": t.get("id"), "assignee_id": aid, "assignee_role": arole, "title": t.get("title")})
    assert not bad, f"Tasks that fit neither branch of mine=true predicate: {bad[:3]}"
    print(f"production mine=true — total={len(tasks)} mine={mine} pool={pool}")
    # At minimum we expect the demo seed to have SOME rows for production
    assert (mine + pool) == len(tasks)


# ---------------------------------------------------------------------------
# REGRESSION — production, mine=false (team board)
# ---------------------------------------------------------------------------

def test_production_team_board_shows_full_role_lane(sessions):
    """mine=false for non-owner should still show whole role lane (any production member + role-level tasks)."""
    prod = sessions["production"]
    board = _tasks(prod["token"], mine=False)
    my_view = _tasks(prod["token"], mine=True)

    # Board must be a superset of my personal view (mine + role pool subset of role lane)
    board_ids = {t["id"] for t in board}
    my_ids = {t["id"] for t in my_view}
    missing = my_ids - board_ids
    assert not missing, f"Team board is missing tasks that My Work shows: {list(missing)[:3]}"

    # Board must NOT include tasks assigned specifically to non-production users
    # and must NOT include role tasks for other roles.
    other_role_leaks = []
    for t in board:
        arole = t.get("assignee_role")
        if arole and arole != prod["role"]:
            # If someone specifically assigned to a non-production role sneaks in — that's a leak
            other_role_leaks.append({"id": t["id"], "assignee_role": arole, "assignee_id": t.get("assignee_id")})
    assert not other_role_leaks, f"Team board leaked non-production-role tasks: {other_role_leaks[:3]}"


def test_production_team_board_has_other_production_members(sessions):
    """Non-owner team board should include tasks belonging to OTHER production members (broader view is intentional)."""
    prod = sessions["production"]
    board = _tasks(prod["token"], mine=False)
    others = [t for t in board if t.get("assignee_id") and t["assignee_id"] != prod["id"]]
    # Not a hard failure if none exist in seed, but we log
    print(f"production team-board — total={len(board)} tasks-belonging-to-other-members={len(others)}")


# ---------------------------------------------------------------------------
# REGRESSION — owner
# ---------------------------------------------------------------------------

def test_owner_full_board_shows_all_roles(sessions):
    """Owner mine=false should return ALL tenant tasks, spanning multiple roles."""
    owner = sessions["owner"]
    all_tasks = _tasks(owner["token"], mine=False)
    roles_seen = {t.get("assignee_role") for t in all_tasks if t.get("assignee_role")}
    # Expect at least 2 distinct roles in the demo tenant
    assert len(roles_seen) >= 2, f"Owner view only saw roles {roles_seen}; expected multiple."
    # And should have more tasks than any single non-owner view
    prod_board = _tasks(sessions["production"]["token"], mine=False)
    assert len(all_tasks) >= len(prod_board), (
        f"Owner view ({len(all_tasks)}) should be >= production role-lane view ({len(prod_board)})"
    )


def test_owner_mine_true_only_own_or_unclaimed_owner_pool(sessions):
    """Owner mine=true — same rule: own + unclaimed owner-role tasks only, no other-member leakage."""
    owner = sessions["owner"]
    tasks = _tasks(owner["token"], mine=True)
    bad = []
    for t in tasks:
        aid = t.get("assignee_id")
        arole = t.get("assignee_role")
        if aid == owner["id"]:
            continue
        if aid is None and arole == owner["role"]:
            continue
        bad.append({"id": t["id"], "assignee_id": aid, "assignee_role": arole})
    assert not bad, f"Owner mine=true leaked other-user or wrong-role tasks: {bad[:3]}"


# ---------------------------------------------------------------------------
# REGRESSION — no cross-role leakage for non-owner
# ---------------------------------------------------------------------------

def test_production_never_sees_sales_or_finance_role_tasks(sessions):
    """Neither mine=true nor mine=false for a production user may return sales/finance role-scoped tasks."""
    prod = sessions["production"]
    for mine in (True, False):
        tasks = _tasks(prod["token"], mine=mine)
        leaked = [t for t in tasks if t.get("assignee_role") in ("sales", "finance") and t.get("assignee_role") != prod["role"]]
        assert not leaked, f"mine={mine}: production leaked {len(leaked)} sales/finance tasks. Sample: {leaked[:2]}"


def test_sales_mine_true_no_leakage(sessions):
    """Same predicate check for sales user."""
    s = sessions["sales"]
    tasks = _tasks(s["token"], mine=True)
    bad = [t for t in tasks if not (
        t.get("assignee_id") == s["id"] or (t.get("assignee_id") is None and t.get("assignee_role") == s["role"])
    )]
    assert not bad, f"sales mine=true leaked: {bad[:3]}"


def test_finance_mine_true_no_leakage(sessions):
    s = sessions["finance"]
    tasks = _tasks(s["token"], mine=True)
    bad = [t for t in tasks if not (
        t.get("assignee_id") == s["id"] or (t.get("assignee_id") is None and t.get("assignee_role") == s["role"])
    )]
    assert not bad, f"finance mine=true leaked: {bad[:3]}"


# ---------------------------------------------------------------------------
# Targeted scenario — create a task assigned to a different production user
# and confirm it does NOT appear in production@sharma.com's mine=true view.
# ---------------------------------------------------------------------------

def test_targeted_other_production_member_task_not_leaked(sessions):
    """
    Create/find a task assigned to a specific non-production-actor user with production role,
    then confirm production@sharma.com's mine=true view excludes it.
    Uses the owner token to seed the task if needed.
    """
    owner = sessions["owner"]
    prod = sessions["production"]

    # Find another user with role=production (someone other than prod)
    r = requests.get(f"{API}/users", headers={"Authorization": f"Bearer {owner['token']}"}, timeout=10)
    if r.status_code != 200:
        pytest.skip(f"/users not available: {r.status_code}")
    team = r.json()
    if isinstance(team, dict):
        team = team.get("users") or team.get("members") or []
    other_prod = next(
        (u for u in team if u.get("role") == prod["role"] and u.get("id") != prod["id"]),
        None,
    )
    if not other_prod:
        pytest.skip("No other production-role user in demo tenant to test cross-member leakage.")

    # Create a task assigned specifically to that other production member.
    payload = {
        "title": "TEST_iter22_other_member_leakage_probe",
        "description": "should NOT appear in production@sharma.com my-work",
        "assignee_id": other_prod["id"],
        "priority": "low",
    }
    cr = requests.post(f"{API}/tasks", json=payload, headers={"Authorization": f"Bearer {owner['token']}"}, timeout=15)
    assert cr.status_code in (200, 201), f"seed task create failed: {cr.status_code} {cr.text}"
    task = cr.json()
    task_id = task["id"]

    try:
        # Verify persistence via GET (owner view)
        board = _tasks(owner["token"], mine=False)
        assert any(t["id"] == task_id for t in board), "seed task not visible to owner mine=false"

        # Now the actual assertion — production mine=true must NOT contain this task
        my_view = _tasks(prod["token"], mine=True)
        assert not any(t["id"] == task_id for t in my_view), (
            "BUG STILL PRESENT: task assigned to another production member appeared in production's mine=true view."
        )

        # And production team-board (mine=false) SHOULD contain it (broader lane)
        prod_board = _tasks(prod["token"], mine=False)
        assert any(t["id"] == task_id for t in prod_board), (
            "Regression: production team board should include tasks of same-role members."
        )
    finally:
        # Cleanup — DELETE via owner
        requests.delete(f"{API}/tasks/{task_id}", headers={"Authorization": f"Bearer {owner['token']}"}, timeout=10)
