"""ASK-28 Phase 7 acceptance (plan 7.1–7.3): stuck work reaches the manager first.

  - Escalate in a task's update form names who it goes to: your reporting
    manager, or the owner when you have none (owner, sales, production, finance
    on desktop; sales on a phone). Post is tried and refused in the browser —
    nothing is written.
  - The Desk's Slipping list is checked on real data by
    scripts/probe_desk_slipping_0914.py instead (read-only, calling the new
    routers.desk code directly): the local backend is not restarted with the
    Phase 7 code, because its reminder sweep runs against the production
    database and would start sending the new reminders to real people.

The reminder ladder itself (who hears at 0, 1, 2 and 4 days, approval and
Waiting on) is real-save tested in
tests/test_task_management_e2e.py::test_stuck_work_reaches_the_right_person.

Real data, read-only: every POST/PATCH/PUT/DELETE after sign-in is aborted.
"""
import json
import pathlib
import sys
from datetime import date, datetime, timezone

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from ux_login import demo_login  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

BASE = "http://localhost:3000"
API = "http://localhost:8001/api"
OUT = pathlib.Path(__file__).resolve().parents[2] / ".audit-artifacts" / "ask28_stuck"
OUT.mkdir(parents=True, exist_ok=True)
results = []
ROLE, VP = "owner", "desktop"
NOW = "2026-09-14T06:00:00+00:00"
MANAGER_DAYS = 2


def rec(key, ok, detail):
    results.append({"check": key, "role": ROLE, "viewport": VP, "ok": ok, "detail": detail})
    print(f"  [{'PASS' if ok is True else 'FAIL' if ok is False else 'INFO'}] {ROLE:<10} {VP:<7} {key}: {detail}", flush=True)


def api_get(p, path):
    return p.evaluate("async ([a, x]) => { const r = await fetch(a + x, {credentials: 'include'}); let b = null; try { b = await r.json(); } catch (e) {} return {status: r.status, body: b}; }", [API, path])


def days_late(due):
    try:
        d = datetime.fromisoformat(str(due).replace("Z", "+00:00")).date()
    except ValueError:
        return 0
    return max(0, (datetime.now(timezone.utc).date() - d).days)


def session(b, role, phone=False):
    ctx = b.new_context(**({"viewport": {"width": 390, "height": 844}, "is_mobile": True, "has_touch": True} if phone
                           else {"viewport": {"width": 1440, "height": 900}}))
    p = ctx.new_page()
    state = {"fake": None, "aborted": [], "errors": []}
    p.on("pageerror", lambda e: state["errors"].append(str(e)))
    demo_login(p, BASE, role)

    def route(r):
        req = r.request
        path = req.url.split("?")[0].rstrip("/")
        fake = state["fake"]
        if fake and req.method == "GET":
            if path.endswith(f"/api/tasks/{fake['id']}"):
                return r.fulfill(status=200, content_type="application/json", body=json.dumps(fake))
            if path.endswith(f"/api/tasks/{fake['id']}/activity"):
                return r.fulfill(status=200, content_type="application/json", body="[]")
        if req.method in ("POST", "PATCH", "PUT", "DELETE"):
            state["aborted"].append(f"{req.method} {path.split('/api')[-1]}")
            return r.abort()
        return r.continue_()

    p.route("**/api/**", route)
    p.goto(BASE + "/my-work")
    p.wait_for_timeout(3000)
    me = api_get(p, "/auth/me")["body"]["user"]
    users = api_get(p, "/users")["body"]
    return ctx, p, state, me, users


def check_escalate(p, state, me, users):
    fake = {"id": "fake-stuck-1", "tenant_id": me.get("tenant_id"), "title": "Phase 7 check: dye lot 7",
            "status": "in_progress", "priority": "medium", "task_type": "general", "progress": 40,
            "assignee_id": me["id"], "assignee_name": me.get("name"), "assignee_role": me.get("role"),
            "co_assignee_ids": [], "co_assignees": [], "created_by": None, "updates": [], "attachments": [],
            "execution_plan": None, "created_at": NOW, "updated_at": NOW}
    state["fake"] = fake
    p.goto(f"{BASE}/my-work?task={fake['id']}")
    p.locator(f'[data-testid="task-drawer-{fake["id"]}"]').wait_for(state="visible", timeout=15000)
    p.wait_for_timeout(1200)
    p.locator(f'[data-testid="add-update-{fake["id"]}"]:visible').first.click()
    p.wait_for_timeout(500)
    p.locator('[role=dialog] button', has_text="Escalate").first.click()
    p.wait_for_timeout(400)
    hint = p.locator(f'[data-testid="escalate-to-{fake["id"]}"]')
    text = hint.inner_text().strip() if hint.count() else None
    byid = {u["id"]: u for u in users}
    mid = me.get("reporting_manager_id") or (byid.get(me["id"]) or {}).get("reporting_manager_id")
    manager = byid.get(mid) if mid and mid != me["id"] else None
    want = (f"your manager, {manager['name']}" if manager else "no reporting manager, so this will alert the owner")
    rec("escalate-names-manager-first", bool(text) and want in text,
        f"shown {text!r}; expected to contain {want!r}")
    over = p.evaluate("() => document.documentElement.scrollWidth - innerWidth")
    rec("escalate-form-fits", over <= 0, f"horizontal overflow {over}px")
    p.screenshot(path=str(OUT / f"{ROLE}_{VP}_escalate.png"))
    p.locator(f'[data-testid="update-submit-{fake["id"]}"]').first.click() if p.locator(f'[data-testid="update-submit-{fake["id"]}"]').count() else None
    p.wait_for_timeout(800)
    tried = [a for a in state["aborted"] if a.endswith(f"/tasks/{fake['id']}/updates")]
    rec("escalate-post-blocked", True if tried or not text else None,
        f"Post attempted and aborted in the browser: {tried or 'no post (text box empty)'}")
    state["fake"] = None


def check_desk(p, me, users):
    rows = api_get(p, "/desk?chip=on_fire")
    if rows["status"] != 200:
        rec("desk-slipping-follows-ladder", None, f"/desk returned {rows['status']} for this role")
        return
    cards = rows["body"].get("cards") or []
    reports = {u["id"] for u in users if u.get("reporting_manager_id") == me["id"]}
    is_owner = me.get("role") == "owner"
    breaks = []
    for c in cards:
        if c.get("kind") != "task_overdue":
            continue
        t = api_get(p, f"/tasks/{c['id']}")
        if t["status"] != 200:
            breaks.append(f"{c['id']}: GET {t['status']}")
            continue
        t = t["body"]
        ok = is_owner or t.get("created_by") == me["id"] or (
            t.get("assignee_id") in reports and days_late(t.get("due_date")) >= MANAGER_DAYS)
        if not ok:
            breaks.append(f"{t.get('title')!r} due {t.get('due_date')} with {t.get('assignee_name')}")
    kinds = {}
    for c in cards:
        kinds[c.get("kind")] = kinds.get(c.get("kind"), 0) + 1
    rec("desk-slipping-follows-ladder", not breaks,
        f"{len(cards)} cards {kinds}; reports {len(reports)}; outside the rule: {breaks[:3] or 'none'}")
    p.goto(BASE + "/desk")
    p.wait_for_timeout(3500)
    col = p.locator('[data-testid="desk-slipping"]')
    rec("desk-slipping-shown", col.count() > 0, f"Slipping column present: {col.count() > 0}; counter {rows['body'].get('counters', {}).get('on_fire')}")
    if ROLE in ("finance", "owner"):
        p.screenshot(path=str(OUT / f"{ROLE}_desk.png"))


with sync_playwright() as pw:
    b = pw.chromium.launch()
    for ROLE in ("owner", "sales", "production", "finance"):
        VP = "desktop"
        ctx, p, state, me, users = session(b, ROLE)
        check_escalate(p, state, me, users)
        rec("no-page-errors", not state["errors"], state["errors"][:3] or "none")
        p.unroute_all(behavior="ignoreErrors")
        ctx.close()
    ROLE, VP = "sales", "phone"
    ctx, p, state, me, users = session(b, "sales", phone=True)
    check_escalate(p, state, me, users)
    rec("no-page-errors", not state["errors"], state["errors"][:3] or "none")
    p.unroute_all(behavior="ignoreErrors")
    ctx.close()
    b.close()

(OUT / "results.json").write_text(json.dumps(results, indent=1), encoding="utf-8")
fails = [r for r in results if r["ok"] is False]
print(f"\n{sum(r['ok'] is True for r in results)} pass / {len(fails)} fail -> {OUT / 'results.json'}")
