"""ASK-28 item 7 acceptance (plan 6.7): who may CHANGE a task — the drawer offers
exactly what the server accepts. Desktop (1440x900) and phone (390x844) for
owner, sales, production and finance (Sunita Rao, who manages sai), plus sales
with a MOCKED "See all tasks".

The rule (services/tasks.task_edit_rights, lib/taskAccess.taskEditRights):
  stage / progress / Waiting on   doer, helpers, the person who asked, manager, owner
  Complete / Cancel / Reopen      the same minus helpers
  Add or remove people            the person who asked, manager, Manage Team, owner
  See all tasks, the approver, a colleague waited on: notes only.
Hand-off and escalate stay with whoever is on the task (their team lane).

Made-up tasks, one per relationship, are opened by link (?task=fake-edit-...)
and answered by the page's own route handler. Every POST/PATCH/PUT/DELETE to
the server is aborted; the bulk Complete check answers its PATCH to made-up
tasks locally, so nothing is sent. The server side of the rule is real-save
tested in tests/test_task_management_e2e.py::test_who_may_change_a_task.
"""
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from ux_login import demo_login  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

BASE = "http://localhost:3000"
API = "http://localhost:8001/api"
OUT = pathlib.Path(__file__).resolve().parents[2] / ".audit-artifacts" / "ask28_edit"
OUT.mkdir(parents=True, exist_ok=True)
results = []
VP = "desktop"
ROLE = "owner"
NOW = "2026-09-14T06:00:00+00:00"
TERMINAL = ("done", "cancelled")


def rec(key, ok, detail):
    results.append({"check": key, "role": ROLE, "viewport": VP, "ok": ok, "detail": detail})
    print(f"  [{'PASS' if ok is True else 'FAIL' if ok is False else 'INFO'}] {ROLE:<14} {VP:<7} {key}: {detail}", flush=True)


def api_get(p, path):
    return p.evaluate("async ([a, x]) => { const r = await fetch(a + x, {credentials: 'include'}); let b = null; try { b = await r.json(); } catch (e) {} return {status: r.status, body: b}; }", [API, path])


def settle(p, ms=2500):
    p.wait_for_timeout(ms)
    ready = '[id^="task-card-"]:visible, [data-testid="mywork-empty"], [data-testid="mywork-empty-filtered"]'
    for _ in range(24):
        if (p.locator(".animate-pulse:visible, .ds-skeleton:visible, [data-skeleton]:visible").count() == 0
                and p.locator(ready).count() > 0):
            break
        p.wait_for_timeout(500)


def fake(me, key, **kw):
    base = {
        "id": f"fake-edit-{key}", "tenant_id": me.get("tenant_id"), "title": f"Item 7 check: {key}",
        "status": "in_progress", "priority": "medium", "task_type": "general", "progress": 30,
        "assignee_id": "u-fake-doer", "assignee_name": "Kiran", "assignee_role": "fake-team",
        "co_assignee_ids": [], "co_assignees": [], "created_by": "u-fake-asker", "created_by_name": "Priya",
        "approver_id": None, "approval_required": False, "updates": [], "attachments": [],
        "execution_plan": None, "created_at": NOW, "updated_at": NOW,
    }
    return {**base, **kw}


def cases_for(me, users):
    uid, name, role = me["id"], me.get("name"), me.get("role")
    mine = {"assignee_id": uid, "assignee_name": name, "assignee_role": role}
    cases = [
        ("doer", fake(me, "doer", **mine)),
        ("helper", fake(me, "helper", co_assignee_ids=[uid])),
        ("asker", fake(me, "asker", created_by=uid, created_by_name=name)),
        ("approver", fake(me, "approver", approver_id=uid, approver_name=name, approval_required=True,
                          approval_stage="close", approval_status=None)),
        ("waited-on", fake(me, "waited", status="waiting",
                           waiting_on={"user_id": uid, "name": name, "since": NOW, "set_by": "u-fake-doer"})),
        ("team-colleague", fake(me, "colleague", assignee_role=role)),
        ("unrelated", fake(me, "unrelated")),
        ("done-doer", fake(me, "done-doer", status="done", progress=100, **mine)),
        ("done-helper", fake(me, "done-helper", status="done", progress=100, co_assignee_ids=[uid])),
    ]
    report = next((u for u in users if u.get("reporting_manager_id") == uid), None)
    if report:
        cases.append(("manager", fake(me, "manager", assignee_id=report["id"], assignee_name=report.get("name"),
                                      assignee_role="fake-team")))
    return cases


def expected(me, t, users, perms):
    """The rule, written out again here so the screen is checked against it."""
    uid = me["id"]
    owner = me.get("role") == "owner"
    doer = t["assignee_id"] == uid if t.get("assignee_id") else t.get("assignee_role") == me.get("role")
    helper = uid in (t.get("co_assignee_ids") or [])
    creator = t.get("created_by") == uid
    reports = {u["id"] for u in users if u.get("reporting_manager_id") == uid}
    manager = bool(reports & {t.get("assignee_id"), *(t.get("co_assignee_ids") or [])})
    runs = owner or creator or manager
    lane = owner or t.get("assignee_id") == uid or helper or (bool(t.get("assignee_role")) and t.get("assignee_role") == me.get("role"))
    return {"work": runs or doer or helper, "finish": runs or doer,
            "people": runs or "team_manage" in perms, "lane": lane}


def vis(p, testid):
    return p.locator(f'[data-testid="{testid}"]:visible').count() > 0


def check_case(p, name, t, exp, phone):
    tid = t["id"]
    p.goto(f"{BASE}/my-work?task={tid}")
    try:
        p.locator(f'[data-testid="task-drawer-{tid}"]').wait_for(state="visible", timeout=15000)
    except Exception:
        rec(f"{name}", False, "drawer did not open from the link")
        return
    p.wait_for_timeout(1500)
    is_open = t["status"] not in TERMINAL
    sfx = "-m" if phone else ""
    got = {
        "stage": vis(p, f"status-pills-m-{tid}" if phone else f"status-select-{tid}"),
        "complete": vis(p, f"complete{sfx}-{tid}"),
        "doer-marks-done": vis(p, f"finish-hint{sfx}-{tid}"),
        "reopen": vis(p, f"reopen{sfx}-{tid}"),
        "follow-hint": vis(p, f"requester-hint-{tid}"),
    }
    want = {
        "stage": exp["work"] and is_open,
        "complete": exp["finish"] and is_open,
        "doer-marks-done": exp["work"] and not exp["finish"] and is_open,
        "reopen": exp["finish"] and not is_open,
        "follow-hint": not exp["work"],
    }
    if phone:
        # 8fbe532 (founder): the phone has no "Cancel this task" link any more.
        got["cancel"] = vis(p, f"cancel-m-{tid}")
        want["cancel"] = False
    people_ctrl = (p.locator(f'[data-testid="task-people-add-{tid}"]:visible').count()
                   + p.locator('[data-testid^="task-people-remove-"]:visible').count())
    people_ok = exp["people"] or people_ctrl == 0
    labels = []
    trigger = p.locator(f'[data-testid="add-update-{tid}"]:visible').first
    if trigger.count():
        trigger.click()
        p.wait_for_timeout(500)
        labels = p.evaluate("""() => [...document.querySelectorAll('[role=dialog] button')]
          .map(b => b.textContent.trim()).filter(t => ['Log note', 'Hand off', 'Escalate'].includes(t))""")
    labels_ok = ("Hand off" in labels) if exp["lane"] else labels == ["Log note"]
    diff = {k: (got[k], want[k]) for k in want if got[k] != want[k]}
    rec(name, not diff and people_ok and labels_ok,
        f"{'matches' if not diff else 'got/want ' + str(diff)}; people controls {people_ctrl} (may edit people: {exp['people']}); "
        f"update actions {labels}")
    if name in ("helper", "asker", "unrelated") and ROLE == "sales":
        p.screenshot(path=str(OUT / f"{ROLE}_{VP}_{name}.png"))


def session(b, role, phone=False, me_patch=None):
    ctx = b.new_context(**({"viewport": {"width": 390, "height": 844}, "is_mobile": True, "has_touch": True} if phone
                           else {"viewport": {"width": 1440, "height": 900}}))
    p = ctx.new_page()
    state = {"fakes": {}, "list": None, "patches": [], "errors": [], "refused": []}
    p.on("pageerror", lambda e: state["errors"].append(str(e)))
    demo_login(p, BASE, role)
    p.on("response", lambda r: state["refused"].append(f"{r.status} {r.request.method} {r.url.split('/api')[-1][:60]}")
         if "/api/" in r.url and r.status == 403 else None)

    def route(r):
        req = r.request
        path = req.url.split("?")[0].rstrip("/")
        for fid, body in state["fakes"].items():
            if path.endswith(f"/api/tasks/{fid}/activity"):
                return r.fulfill(status=200, content_type="application/json", body="[]")
            if path.endswith(f"/api/tasks/{fid}"):
                if req.method == "GET":
                    return r.fulfill(status=200, content_type="application/json", body=json.dumps(body))
                if req.method == "PATCH":
                    sent = req.post_data_json or {}
                    state["patches"].append((fid, sent))
                    return r.fulfill(status=200, content_type="application/json", body=json.dumps({**body, **sent}))
        if state["list"] is not None and req.method == "GET" and path.endswith("/api/tasks"):
            return r.fulfill(status=200, content_type="application/json", body=json.dumps(state["list"]))
        if req.method in ("POST", "PATCH", "PUT", "DELETE"):
            return r.abort()
        if me_patch and path.endswith("/api/auth/me"):
            resp = r.fetch()
            data = resp.json()
            data["user"] = me_patch(data["user"])
            return r.fulfill(response=resp, body=json.dumps(data))
        return r.continue_()

    p.route("**/api/**", route)
    p.goto(BASE + "/my-work")
    settle(p)
    body = api_get(p, "/auth/me")["body"]
    me = body["user"]
    if me_patch:
        me = me_patch(me)
    users = api_get(p, "/users")["body"]
    return ctx, p, state, me, users


def run_role(b, role, label, phone, me_patch=None, only=None):
    global ROLE, VP
    ROLE, VP = label, ("phone" if phone else "desktop")
    ctx, p, state, me, users = session(b, role, phone=phone, me_patch=me_patch)
    perms = me.get("effective_permissions") or []
    cases = cases_for(me, users)
    if only:
        cases = [c for c in cases if c[0] in only]
    state["fakes"] = {t["id"]: t for _, t in cases}
    for name, t in cases:
        check_case(p, name, t, expected(me, t, users, perms), phone)
    if not phone and role == "sales" and not me_patch:
        bulk_complete(p, state, me)
    rec("no-refused-requests", not state["refused"], state["refused"][:4] or "none")
    rec("no-page-errors", not state["errors"], state["errors"][:3] or "none")
    p.unroute_all(behavior="ignoreErrors")
    ctx.close()


def bulk_complete(p, state, me):
    """Select a task I do and one I only help on; bulk Complete sends only mine."""
    uid = me["id"]
    doer = fake(me, "bulk-doer", assignee_id=uid, assignee_name=me.get("name"), assignee_role=me.get("role"))
    helper = fake(me, "bulk-helper", co_assignee_ids=[uid])
    state["fakes"].update({doer["id"]: doer, helper["id"]: helper})
    state["list"] = [doer, helper]
    state["patches"] = []
    p.goto(BASE + "/my-work")
    settle(p)
    for t in (doer, helper):
        box = p.locator(f'[data-testid="bulk-select-{t["id"]}"]').first
        if box.count():
            box.check(force=True)
    p.wait_for_timeout(400)
    btn = p.locator('[data-testid="bulk-complete"]')
    if not btn.count():
        rec("bulk-complete-only-what-you-may-finish", False, "bulk bar did not appear")
    else:
        btn.click()
        p.wait_for_timeout(1500)
        toast = " | ".join(p.locator("[data-sonner-toast]").all_inner_texts())
        sent = [fid for fid, _ in state["patches"]]
        rec("bulk-complete-only-what-you-may-finish", sent == [doer["id"]] and "1 skipped" in toast,
            f"PATCH sent for {sent} (answered locally); toast: {toast[:120]!r}")
        p.screenshot(path=str(OUT / "sales_bulk_complete.png"))
    state["list"] = None


with sync_playwright() as pw:
    b = pw.chromium.launch()
    for role in ("owner", "sales", "production", "finance"):
        for phone in (False, True):
            run_role(b, role, role, phone)

    def see_all(u):
        return {**u, "effective_permissions": sorted(set(u.get("effective_permissions") or []) | {"tasks_view_all"})}

    run_role(b, "sales", "sales+see-all", False, me_patch=see_all, only=("unrelated", "helper", "doer"))
    b.close()

(OUT / "results.json").write_text(json.dumps(results, indent=1), encoding="utf-8")
fails = [r for r in results if r["ok"] is False]
print(f"\n{sum(r['ok'] is True for r in results)} pass / {len(fails)} fail -> {OUT / 'results.json'}")
