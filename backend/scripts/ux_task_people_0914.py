"""ASK-28 TK-06 acceptance: who is on a task — desktop (1440x900) + a phone check.

  - The drawer says who asked for the task, who approves it and when, and how a
    team task found its doer ("Picked automatically: fewest open tasks in ...").
  - New Task, given to a team, says where it went instead of a silent pick.
  - Supporting employee is gone from the form and the drawer.

Real data, read-only. Every POST/PATCH/PUT/DELETE after sign-in is aborted, except
POST /api/tasks, answered by this script. The auto-assigned drawer uses one
made-up task opened by link (no stored task carries the new note yet, and making
one would write to the production database).
"""
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from ux_login import demo_login  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

BASE = "http://localhost:3000"
API = "http://localhost:8001/api"
OUT = pathlib.Path(__file__).resolve().parents[2] / ".audit-artifacts" / "ask28_people"
OUT.mkdir(parents=True, exist_ok=True)
results = []
VP = "desktop"
TERMINAL = {"done", "cancelled"}


def rec(key, ok, detail):
    results.append({"check": key, "viewport": VP, "ok": ok, "detail": detail})
    print(f"  [{'PASS' if ok is True else 'FAIL' if ok is False else 'INFO'}] {VP:<8} {key}: {detail}", flush=True)


def api_get(p, path):
    return p.evaluate("async ([a, x]) => { const r = await fetch(a + x, {credentials: 'include'}); let b = null; try { b = await r.json(); } catch (e) {} return {status: r.status, body: b}; }", [API, path])


def wait_for(p, fn, ms=8000):
    for _ in range(ms // 250):
        if fn():
            return True
        p.wait_for_timeout(250)
    return False


def text_of(p, testid):
    el = p.locator(f'[data-testid="{testid}"]:visible')
    return el.first.inner_text().replace("\n", " ").strip() if el.count() else None


def open_by_link(p, tid):
    p.goto(f"{BASE}/my-work?task={tid}")
    wait_for(p, lambda: p.locator(f'[data-testid="task-people-{tid}"]:visible').count() > 0, ms=12000)


with sync_playwright() as pw:
    b = pw.chromium.launch()
    ctx = b.new_context(viewport={"width": 1440, "height": 900})
    p = ctx.new_page()
    errors = []
    p.on("pageerror", lambda e: errors.append(str(e)))
    demo_login(p, BASE, "owner")
    me = api_get(p, "/auth/me")["body"]
    me = me.get("user", me)
    users = api_get(p, "/users")["body"]
    sales_person = next((u for u in users if u.get("role") == "sales" and u.get("name") == "Priya Nair"), None) \
        or next(u for u in users if u.get("role") == "sales")

    fake = None
    sent = []

    def route(r):
        req = r.request
        path = req.url.split("?")[0].rstrip("/")
        if fake and req.method == "GET" and path.endswith(f"/api/tasks/{fake['id']}"):
            return r.fulfill(status=200, content_type="application/json", body=json.dumps(fake))
        if fake and req.method == "GET" and path.endswith(f"/api/tasks/{fake['id']}/activity"):
            return r.fulfill(status=200, content_type="application/json", body="[]")
        if req.method == "POST" and path.endswith("/api/tasks"):
            body = json.loads(req.post_data or "{}")
            sent.append(body)
            role = body.get("assignee_role")
            reply = {**body, "id": "fake-people-created", "status": "todo", "co_assignees": [],
                     "assignee_id": sales_person["id"] if role else body.get("assignee_id"),
                     "assignee_name": sales_person["name"] if role else None,
                     "auto_assigned": {"role": role, "rule": "fewest_open_tasks"} if role else None}
            return r.fulfill(status=200, content_type="application/json", body=json.dumps(reply))
        if req.method in ("POST", "PATCH", "PUT", "DELETE"):
            return r.abort()
        return r.continue_()

    p.route("**/api/**", route)
    p.goto(BASE + "/my-work")
    p.wait_for_timeout(3000)

    rows = api_get(p, "/tasks?mine=false")["body"]
    asked_by_other = next((t for t in rows if t.get("created_by") and t["created_by"] != me["id"]
                           and t.get("created_by_name") and t.get("status") not in TERMINAL), None)
    mine_created = next((t for t in rows if t.get("created_by") == me["id"] and t.get("status") not in TERMINAL), None)
    approval = next((t for t in rows if t.get("approval_required") and t.get("status") not in TERMINAL), None)

    # Asked by — someone else, and "You".
    if asked_by_other:
        open_by_link(p, asked_by_other["id"])
        txt = text_of(p, f"task-asked-by-{asked_by_other['id']}")
        rec("drawer-asked-by-name", txt == f"Asked by {asked_by_other['created_by_name']}", f"'{txt}'")
        p.keyboard.press("Escape")
        p.wait_for_timeout(600)
    else:
        rec("drawer-asked-by-name", None, "no open task created by someone else")
    if mine_created:
        open_by_link(p, mine_created["id"])
        txt = text_of(p, f"task-asked-by-{mine_created['id']}")
        rec("drawer-asked-by-you", txt == "Asked by You", f"'{txt}'")
        p.keyboard.press("Escape")
        p.wait_for_timeout(600)

    # Approver and the approval moment.
    if approval:
        open_by_link(p, approval["id"])
        txt = text_of(p, f"task-approver-{approval['id']}") or ""
        moment = "before it's marked done" if approval.get("approval_stage") == "close" else "before work starts"
        who = ("You" if approval.get("approver_id") == me["id"] else approval.get("approver_name")) \
            if approval.get("approver_id") else "anyone with approval access"
        rec("drawer-approver", moment in txt and bool(who) and who in txt, f"'{txt}' (expected moment '{moment}', approver '{who}')")
        p.screenshot(path=str(OUT / "drawer_people_approval.png"))
        p.keyboard.press("Escape")
        p.wait_for_timeout(600)
    else:
        rec("drawer-approver", None, "no open approval task")

    # Picked automatically (made-up task opened by link).
    base = asked_by_other or rows[0]
    fake = {**base, "id": "fake-auto-assigned", "title": "TK-06 check: team task", "status": "todo",
            "assignee_id": sales_person["id"], "assignee_name": sales_person["name"], "assignee_role": "sales",
            "co_assignee_ids": [], "co_assignees": [], "auto_assigned": {"role": "sales", "rule": "fewest_open_tasks"},
            "approval_required": False, "updates": [], "attachments": [], "execution_plan": None}
    open_by_link(p, "fake-auto-assigned")
    txt = text_of(p, "task-auto-assigned-fake-auto-assigned") or ""
    rec("drawer-auto-assigned", txt.startswith("Picked automatically: fewest open tasks in") and "Sales" in txt, f"'{txt}'")
    p.screenshot(path=str(OUT / "drawer_auto_assigned.png"))
    rec("drawer-no-supporting-line", p.locator('[role="dialog"]:visible').first.inner_text().count("+ ") == 0,
        "no '+ name' supporting-employee line in the drawer")
    p.keyboard.press("Escape")
    p.wait_for_timeout(600)
    fake = None

    # New Task given to a team says where it went.
    p.goto(BASE + "/my-work")
    p.wait_for_timeout(2500)
    p.locator('[data-testid="new-task-button"]:visible').first.click()
    p.wait_for_timeout(700)
    dlg = p.locator('[role="dialog"]')
    labels = dlg.inner_text()
    rec("form-no-supporting-employee", "Supporting employee" not in labels, "field absent from New Task")
    dlg.locator('[data-testid="task-title-input"]').fill("TK-06 check: price the new order")
    dlg.locator('[data-testid="task-assign-select"]').click()
    p.locator('[data-testid="task-assign-select-option-r:sales"]').click()
    p.wait_for_timeout(300)
    dlg.locator('[data-testid="task-create-submit"]').click()
    wait_for(p, lambda: "fewest open tasks" in " ".join(p.locator("[data-sonner-toast]").all_inner_texts()), ms=6000)
    toast = " | ".join(t.strip() for t in p.locator("[data-sonner-toast]").all_inner_texts())
    body = sent[-1] if sent else {}
    rec("team-task-toast-says-where-it-went",
        body.get("assignee_role") == "sales" and f"Assigned to {sales_person['name']}: fewest open tasks in Sales" in toast
        and "support_id" not in body,
        f"toast '{toast[:120]}'; sent assignee_role={body.get('assignee_role')!r} (POST answered by the script)")
    rec("no-page-errors", not errors, errors[:3] or "none")
    p.unroute_all(behavior="ignoreErrors")
    ctx.close()

    # ---- Phone: the people section fits -----------------------------------------------
    VP = "phone"
    ctx = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    p = ctx.new_page()
    errors = []
    p.on("pageerror", lambda e: errors.append(str(e)))
    demo_login(p, BASE, "owner")
    p.route("**/api/**", lambda r: r.abort() if r.request.method in ("POST", "PATCH", "PUT", "DELETE") else r.continue_())
    target = approval or asked_by_other
    if target:
        open_by_link(p, target["id"])
        roles = p.locator(f'[data-testid="task-roles-{target["id"]}"]:visible')
        inner = roles.first.evaluate("e => e.scrollWidth - e.clientWidth") if roles.count() else None
        rec("phone-people-lines-fit", roles.count() == 1 and inner is not None and inner <= 0
            and p.evaluate("() => document.documentElement.scrollWidth - innerWidth") <= 0,
            f"lines shown {roles.count()}; sideways overflow {inner}")
        p.screenshot(path=str(OUT / "phone_drawer_people.png"))
    rec("no-page-errors", not errors, errors[:3] or "none")
    p.unroute_all(behavior="ignoreErrors")
    ctx.close()
    b.close()

(OUT / "results.json").write_text(json.dumps(results, indent=1), encoding="utf-8")
fails = [r for r in results if r["ok"] is False]
print(f"\n{sum(r['ok'] is True for r in results)} pass / {len(fails)} fail -> {OUT / 'results.json'}")
