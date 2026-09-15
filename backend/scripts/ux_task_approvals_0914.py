"""ASK-28 TK-02 acceptance: "Waiting for my approval", on the Approvals view
that 3c23e49 (ASK-25) added to My Work, now fed by GET /tasks?view=approvals.

Desktop first. Every POST/PATCH/PUT/DELETE after sign-in is aborted, so nothing
is written. Approve is answered BY THIS SCRIPT (a fake approved task), so the
click path is proven without touching the database.

Mocked: the non-owner named-approver check. In the demo company only the owner
and one non-demo account hold approval access, and no task names a demo user
as approver; making one would write to the production database.
"""
import json
import pathlib
import sys
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from ux_login import demo_login  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

BASE = "http://localhost:3000"
API = "http://localhost:8001/api"
OUT = pathlib.Path(__file__).resolve().parents[2] / ".audit-artifacts" / "ask28_approvals"
OUT.mkdir(parents=True, exist_ok=True)
results = []
VP = "desktop"
TERMINAL = {"done", "cancelled"}


def rec(key, ok, detail):
    results.append({"check": key, "viewport": VP, "ok": ok, "detail": detail})
    print(f"  [{'PASS' if ok is True else 'FAIL' if ok is False else 'INFO'}] {VP:<8} {key}: {detail}", flush=True)


def block(route):
    if route.request.method in ("POST", "PATCH", "PUT", "DELETE"):
        return route.abort()
    return route.continue_()


def settle(p, ms=2500):
    p.wait_for_timeout(ms)
    for _ in range(16):
        if p.locator(".animate-pulse:visible, .ds-skeleton:visible").count() == 0:
            break
        p.wait_for_timeout(500)


def hub_cards(p):
    return p.evaluate("""() => [...document.querySelectorAll('[data-testid="approvals-hub"] [id^="task-card-"]:not([id^="task-card-body-"])')]
      .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
      .map(e => e.id.replace('task-card-', ''))""")


def qs(p):
    return {k: v[0] for k, v in parse_qs(urlparse(p.url).query).items()}


def api_get(p, path):
    return p.evaluate("async ([api, path]) => { const r = await fetch(api + path, {credentials: 'include'}); return {status: r.status, body: await r.json()}; }", [API, path])


def me_of(p):
    b = api_get(p, "/auth/me")["body"]
    return b.get("user") if isinstance(b.get("user"), dict) else b


def pending(rows):
    return [t for t in rows if t.get("approval_required") and t.get("approval_status") == "pending" and t.get("status") not in TERMINAL]


with sync_playwright() as pw:
    b = pw.chromium.launch()

    # ---- Owner, desktop ---------------------------------------------------------
    ctx = b.new_context(viewport={"width": 1440, "height": 900})
    p = ctx.new_page()
    errors = []
    p.on("pageerror", lambda e: errors.append(str(e)))
    demo_login(p, BASE, "owner")
    approved_posts = []

    def owner_routes(route):
        req = route.request
        if req.method == "POST" and req.url.rstrip("/").endswith("/approve") and "/api/tasks/" in req.url:
            tid = req.url.split("/api/tasks/")[1].split("/")[0]
            approved_posts.append(tid)
            return route.fulfill(status=200, content_type="application/json",
                                 body=json.dumps({"id": tid, "status": "todo", "approval_required": True,
                                                  "approval_status": "approved", "title": "approved (mocked)"}))
        return block(route)

    p.route("**/api/**", owner_routes)
    p.goto(BASE + "/my-work")
    settle(p)

    api = api_get(p, "/tasks?view=approvals")
    rows = api["body"] if api["status"] == 200 else []
    breaks = [t["id"] for t in rows if not t.get("approval_required") or t.get("approval_status") == "approved" or t.get("status") in TERMINAL]
    waiting = pending(rows)
    rec("api-approvals-rule", api["status"] == 200 and not breaks,
        f"{len(rows)} waiting on the server rule ({len(waiting)} pending, {len(rows) - len(waiting)} changes requested); rows breaking it: {breaks or 'none'}")

    seg = p.locator('[data-testid="work-view-approvals"]')
    badge = p.locator('[data-testid="work-view-approvals-count"]')
    order = p.evaluate("""() => [...document.querySelectorAll('[data-testid="work-view-segment"] button')].map(b => b.textContent.trim())""")
    dupes = p.locator('[data-testid="work-scope-approvals"]').count()
    rec("one-approvals-button-with-count", seg.count() == 1 and dupes == 0 and badge.count() == 1 and badge.inner_text().strip() == str(len(waiting)),
        f"segments: {order}; badge {badge.inner_text().strip() if badge.count() else None} / pending {len(waiting)}; duplicate button: {dupes}")

    seg.click()
    settle(p)
    rec("url-view-approvals", qs(p).get("view") == "approvals" and p.locator('[data-testid="approvals-hub"]').count() == 1, f"url {qs(p)}")
    ids = hub_cards(p)
    rec("tasks-tab-matches-server", sorted(ids) == sorted(t["id"] for t in waiting), f"cards {len(ids)} / pending from API {len(waiting)}")
    by_id = {t["id"]: t for t in waiting}
    created = [by_id[i].get("created_at") or "" for i in ids if i in by_id]
    rec("oldest-request-first", created == sorted(created), f"first {created[:1]} … last {created[-1:]}")
    tab = p.locator('[data-testid="approvals-sub-tasks"]')
    rec("tasks-tab-count", tab.count() == 1 and str(len(waiting)) in tab.inner_text(), tab.inner_text().replace("\n", " ") if tab.count() else "missing")

    target = ids[0] if ids else None
    if target:
        p.locator(f'[data-testid="approvals-hub"] [id="task-card-{target}"]').click()
        p.wait_for_timeout(1500)
        box = p.locator(f'[data-testid="approval-actions-{target}"]:visible')
        labels = box.evaluate("e => [...e.querySelectorAll('button')].map(b => b.textContent.trim())") if box.count() else []
        rec("drawer-approval-actions", box.count() == 1 and any("Approve" in l for l in labels), f"buttons: {labels}")
        p.screenshot(path=str(OUT / "owner_approval_drawer.png"))
        if box.count():
            p.locator(f'[data-testid="approve-{target}"]').click()
            p.wait_for_timeout(1500)
        rec("approve-click-posts", approved_posts == [target], f"POST /tasks/{{id}}/approve sent for: {approved_posts} (answered by the script)")
        p.keyboard.press("Escape")
        p.wait_for_timeout(600)

        p.goto(BASE + "/my-work")
        settle(p)
        p.goto(f"{BASE}/my-work?view=approvals&task={target}")
        settle(p, 3500)
        rec("notification-link-lands-in-approvals", qs(p).get("view") == "approvals"
            and p.locator('[data-testid="approvals-hub"]').count() == 1
            and p.locator(f'[data-testid="approval-actions-{target}"]:visible').count() == 1,
            f"url {qs(p)}; hub shown; drawer open on the task with its approval box")

    p.goto(BASE + "/inbox")
    settle(p, 4000)
    card = p.locator('[data-testid="desk-approvals"]')
    txt = card.inner_text().replace("\n", " ") if card.count() else ""
    rec("desk-card-agrees", card.count() == 1 and str(len(waiting)) in txt, f"Desk Task approvals card: '{txt[:90]}' · pending {len(waiting)}")
    rec("no-page-errors", not errors, errors[:3] or "none")
    p.unroute_all(behavior="ignoreErrors")
    ctx.close()

    # ---- Finance demo user: no task-approval access, named on nothing --------------
    ctx = b.new_context(viewport={"width": 1440, "height": 900})
    p = ctx.new_page()
    errors = []
    p.on("pageerror", lambda e: errors.append(str(e)))
    demo_login(p, BASE, "finance")
    p.route("**/api/**", block)
    p.goto(BASE + "/my-work")
    settle(p)
    api = api_get(p, "/tasks?view=approvals")
    me = me_of(p)
    perms = me.get("permissions") or []
    seg_n = p.locator('[data-testid="work-view-approvals"]').count()
    expect_seg = me.get("role") == "owner" or "approvals" in perms or "leave_approve" in perms
    rec("no-access-server-empty", api["status"] == 200 and api["body"] == [], f"API rows {len(api['body']) if api['status'] == 200 else api['status']}")
    rec("no-access-view-follows-access", (seg_n == 1) == expect_seg,
        f"Approvals button shown: {seg_n}; holds approvals/leave_approve: {expect_seg}")
    rec("no-page-errors-finance", not errors, errors[:3] or "none")
    p.unroute_all(behavior="ignoreErrors")
    ctx.close()

    # ---- Sales named as approver (list mocked) ----------------------------------------
    ctx = b.new_context(viewport={"width": 1440, "height": 900})
    p = ctx.new_page()
    errors = []
    p.on("pageerror", lambda e: errors.append(str(e)))
    demo_login(p, BASE, "sales")
    me = me_of(p)
    users = api_get(p, "/users")["body"]
    doer = next(u for u in users if u["id"] != me["id"] and u.get("role") not in ("owner", "sales"))
    fake = {
        "id": "fake-approval-1", "tenant_id": me.get("tenant_id"), "title": "ASK-28 check: buy 40 cones of yarn",
        "status": "blocked", "priority": "high", "task_type": "purchase",
        "approval_required": True, "approval_status": "pending", "approver_id": me["id"], "approver_name": me.get("name"),
        "created_by": doer["id"], "created_by_name": doer.get("name"),
        "assignee_id": doer["id"], "assignee_name": doer.get("name"), "assignee_role": doer.get("role"),
        "co_assignee_ids": [], "co_assignees": [], "updates": [], "attachments": [],
        "created_at": "2026-09-13T06:00:00+00:00", "updated_at": "2026-09-13T06:00:00+00:00",
    }
    posted = []

    def sales_routes(route):
        req = route.request
        url = req.url.split("?")[0]
        if req.method == "GET" and "/api/tasks" in req.url and "view=approvals" in req.url:
            return route.fulfill(status=200, content_type="application/json", body=json.dumps([fake]))
        if req.method == "GET" and url.endswith("/api/tasks/fake-approval-1"):
            return route.fulfill(status=200, content_type="application/json", body=json.dumps(fake))
        if req.method == "GET" and url.endswith("/api/tasks/fake-approval-1/activity"):
            return route.fulfill(status=200, content_type="application/json", body=json.dumps([]))
        if req.method == "POST" and url.endswith("/api/tasks/fake-approval-1/approve"):
            posted.append("approve")
            return route.fulfill(status=200, content_type="application/json", body=json.dumps({**fake, "status": "todo", "approval_status": "approved"}))
        return block(route)

    p.route("**/api/**", sales_routes)
    p.goto(BASE + "/my-work")
    settle(p)
    badge = p.locator('[data-testid="work-view-approvals-count"]')
    rec("named-approver-sees-view", p.locator('[data-testid="work-view-approvals"]').count() == 1 and badge.count() == 1 and badge.inner_text().strip() == "1",
        f"button {p.locator('[data-testid=work-view-approvals]').count()}, badge {badge.inner_text().strip() if badge.count() else None} (sales holds no approval access)")
    p.locator('[data-testid="work-view-approvals"]').click()
    settle(p)
    rec("named-approver-card-in-hub", hub_cards(p) == ["fake-approval-1"], f"hub cards: {hub_cards(p)}")
    p.locator('[data-testid="approvals-hub"] [id="task-card-fake-approval-1"]').click()
    p.wait_for_timeout(1500)
    box = p.locator('[data-testid="approval-actions-fake-approval-1"]:visible')
    rec("named-approver-can-act", box.count() == 1, "Approve · Request changes · Ask clarification shown to the named approver")
    p.screenshot(path=str(OUT / "named_approver_drawer.png"))
    if box.count():
        p.locator('[data-testid="approve-fake-approval-1"]').click()
        p.wait_for_timeout(1500)
    rec("named-approver-approve-posts", posted == ["approve"], f"POST sent: {posted} (answered by the script)")
    rec("no-page-errors-sales", not errors, errors[:3] or "none")
    p.unroute_all(behavior="ignoreErrors")
    ctx.close()

    # ---- Phone link -------------------------------------------------------------------
    VP = "phone"
    ctx = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    p = ctx.new_page()
    errors = []
    p.on("pageerror", lambda e: errors.append(str(e)))
    demo_login(p, BASE, "owner")
    p.route("**/api/**", block)
    p.goto(BASE + "/my-work?view=approvals")
    settle(p)
    overflow = p.evaluate("() => document.documentElement.scrollWidth - innerWidth")
    rec("phone-link-lands", len(hub_cards(p)) == len(waiting) and overflow <= 0, f"hub cards {len(hub_cards(p))} / {len(waiting)}; overflow {overflow}")
    rec("no-page-errors-phone", not errors, errors[:3] or "none")
    p.unroute_all(behavior="ignoreErrors")
    ctx.close()
    b.close()

(OUT / "results.json").write_text(json.dumps(results, indent=1), encoding="utf-8")
fails = [r for r in results if r["ok"] is False]
print(f"\n{sum(r['ok'] is True for r in results)} pass / {len(fails)} fail -> {OUT / 'results.json'}")
