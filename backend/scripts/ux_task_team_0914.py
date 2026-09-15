"""ASK-28 TK-03 acceptance: "My team" in My Work, desktop (1440x900).

The owner keeps All Tasks; anyone named as someone's Reporting Manager gets My
team — the work their direct reports are doing or helping on.

Real data, read-only: in the demo company Sunita Rao (finance@) is sai's
Reporting Manager, and sai holds real tasks. Every POST/PATCH/PUT/DELETE after
sign-in is aborted, so nothing is written.
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
OUT = pathlib.Path(__file__).resolve().parents[2] / ".audit-artifacts" / "ask28_team"
OUT.mkdir(parents=True, exist_ok=True)
results = []
TERMINAL = {"done", "cancelled"}


def rec(key, ok, detail):
    results.append({"check": key, "ok": ok, "detail": detail})
    print(f"  [{'PASS' if ok is True else 'FAIL' if ok is False else 'INFO'}] {key}: {detail}", flush=True)


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


def api_get(p, path):
    return p.evaluate("async ([api, path]) => { const r = await fetch(api + path, {credentials: 'include'}); let b = null; try { b = await r.json(); } catch (e) {} return {status: r.status, body: b}; }", [API, path])


def me_of(p):
    b = api_get(p, "/auth/me")["body"]
    return b.get("user") if isinstance(b.get("user"), dict) else b


def qs(p):
    return {k: v[0] for k, v in parse_qs(urlparse(p.url).query).items()}


def url_leaves_team(p, ms=8000):
    """A My team link opened by someone without reports should drop ?view=team."""
    for _ in range(ms // 250):
        if qs(p).get("view") != "team":
            return True
        p.wait_for_timeout(250)
    return False


def cards(p):
    return sorted(p.evaluate("""() => [...document.querySelectorAll('[id^="task-card-"]:not([id^="task-card-body-"])')]
      .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
      .map(e => e.id.replace('task-card-', ''))"""))


def segments(p):
    return p.evaluate("""() => [...document.querySelectorAll('[data-testid="work-view-segment"] button')].map(b => b.textContent.trim())""")


with sync_playwright() as pw:
    b = pw.chromium.launch()

    # ---- Manager: Sunita Rao (finance), sai reports to her ----------------------------
    ctx = b.new_context(viewport={"width": 1440, "height": 900})
    p = ctx.new_page()
    errors = []
    p.on("pageerror", lambda e: errors.append(str(e)))
    demo_login(p, BASE, "finance")
    # A made-up report task in ANOTHER department is added to the My team list
    # only after the real-data checks (state["fake"] stays None until then).
    state = {"fake": None}

    def manager_routes(route):
        req = route.request
        fake = state["fake"]
        path = req.url.split("?")[0].rstrip("/")
        if fake and req.method == "GET":
            if path.endswith(f"/api/tasks/{fake['id']}"):
                return route.fulfill(status=200, content_type="application/json", body=json.dumps(fake))
            if path.endswith(f"/api/tasks/{fake['id']}/activity"):
                return route.fulfill(status=200, content_type="application/json", body="[]")
            if path.endswith("/api/tasks") and "view=team" in req.url:
                resp = route.fetch()
                return route.fulfill(response=resp, body=json.dumps(resp.json() + [fake]))
        return block(route)

    p.route("**/api/**", manager_routes)
    p.goto(BASE + "/my-work")
    settle(p)
    me = me_of(p)
    users = api_get(p, "/users")["body"]
    reports = [u for u in users if u.get("reporting_manager_id") == me["id"]]
    report_ids = {u["id"] for u in reports}
    rec("manager-has-reports", len(reports) > 0, f"{me.get('name')} manages: {[u.get('name') for u in reports]}")

    api = api_get(p, "/tasks?view=team")
    rows = api["body"] if api["status"] == 200 else []
    breaks = [t["id"] for t in rows if not ({t.get("assignee_id"), *(t.get("co_assignee_ids") or [])} & report_ids)]
    rec("api-team-rule", api["status"] == 200 and len(rows) > 0 and not breaks,
        f"{len(rows)} tasks ({sum(1 for t in rows if t.get('status') not in TERMINAL)} open); rows with no report on them: {breaks or 'none'}")

    seg = p.locator('[data-testid="work-scope-team"]')
    rec("team-segment-shown", seg.count() == 1, f"segments: {segments(p)}")
    if seg.count():
        seg.click()
        settle(p)
    rec("url-view-team", qs(p).get("view") == "team" and seg.get_attribute("aria-pressed") == "true", f"url {qs(p)}")
    got = cards(p)
    api_ids = sorted(t["id"] for t in rows)
    open_ids = sorted(t["id"] for t in rows if t.get("status") not in TERMINAL)
    rec("cards-match-server", got in (api_ids, open_ids), f"cards {len(got)} / API {len(api_ids)} (open {len(open_ids)})")
    rec("ai-toggle-hidden", p.locator('[data-testid="ai-priority-toggle"]').count() == 0, "AI priority off on My team")
    p.screenshot(path=str(OUT / "manager_team.png"))

    person = p.locator('[data-testid="work-filter-person"]')
    items = []
    if person.count():
        person.click()
        p.wait_for_timeout(500)
        items = [x.strip() for x in p.locator('[data-testid^="work-filter-person-"]:visible').all_inner_texts()]
        p.keyboard.press("Escape")
        p.wait_for_timeout(400)
    rec("person-filter-lists-team", person.count() == 1 and "Me" not in items
        and any(u.get("name", "") in " ".join(items) for u in reports),
        f"options: {items[:8]}")

    p.reload()
    settle(p)
    rec("refresh-keeps-team", qs(p).get("view") == "team" and cards(p) == got, f"url {qs(p)}; cards {len(cards(p))}")

    target = next((t for t in rows if t.get("assignee_id") in report_ids and t.get("status") not in TERMINAL), rows[0] if rows else None)
    if target:
        tid = target["id"]
        one = api_get(p, f"/tasks/{tid}")
        act = api_get(p, f"/tasks/{tid}/activity")
        rec("manager-can-open-report-task", one["status"] == 200 and act["status"] == 200,
            f"GET /tasks/{{id}} {one['status']}, /activity {act['status']} for {target.get('assignee_name')}'s task")
        def drawer(task_id):
            p.locator(f'[id="task-card-{task_id}"]:visible').first.click()
            p.wait_for_timeout(1800)
            hint = p.locator(f'[data-testid="requester-hint-{task_id}"]:visible')
            complete = p.locator(f'[data-testid="complete-{task_id}"]:visible').count()
            trigger = p.locator(f'[data-testid="add-update-{task_id}"]:visible').first
            labels = []
            if trigger.count():
                trigger.click()
                p.wait_for_timeout(600)
                labels = p.evaluate("""() => [...document.querySelectorAll('button')]
                  .map(b => b.textContent.trim()).filter(t => ['Log note', 'Hand off', 'Escalate'].includes(t))""")
            return (hint.inner_text().strip() if hint.count() else None), complete, labels

        # sai's task sits in Finance, Sunita's own department: the existing rule
        # (_can_work_task: same role lane) already lets her work it, so the drawer
        # must offer the full controls there — being the manager takes nothing away.
        same_dept = target.get("assignee_role") == me.get("role")
        hint, complete, labels = drawer(tid)
        if same_dept:
            rec("manager-same-department-keeps-controls", hint is None and complete == 1 and "Hand off" in labels,
                f"task in {target.get('assignee_role')} (her department): hint {hint!r}; Complete {complete}; actions {labels}")
        else:
            rec("manager-same-department-keeps-controls", None, f"task in {target.get('assignee_role')}, not her department; skipped")
        p.keyboard.press("Escape")
        p.wait_for_timeout(500)

        # Made-up: the same report on a Production task Sunita has no lane on.
        state["fake"] = {**target, "id": "fake-team-1", "title": "TK-03 check: sai helping Production",
                         "assignee_role": "production", "created_by": None, "created_by_name": None,
                         "approver_id": None, "support_id": None, "status": "in_progress",
                         "approval_required": False, "updates": [], "attachments": [], "execution_plan": None}
        p.reload()
        settle(p)
        hint, complete, labels = drawer("fake-team-1")
        # Item 7 (plan 6.7, 2026-09-14): the manager runs a report's task — stage
        # and Complete — while hand-off stays with the people on it.
        rec("manager-other-department-runs-task", hint is None and complete == 1 and labels == ["Log note"],
            f"hint {hint!r}; Complete {complete}; actions {labels} (task made up: no report of hers works outside Finance)")
        p.screenshot(path=str(OUT / "manager_other_department_drawer.png"))
        p.keyboard.press("Escape")
        p.wait_for_timeout(500)
        state["fake"] = None

    p.locator('[data-testid="work-view-mywork"]').click()
    settle(p)
    p.goto(BASE + "/my-work")
    settle(p)
    rec("not-saved-as-default", qs(p).get("view") != "team" and p.locator('[data-testid="work-scope-team"]').get_attribute("aria-pressed") != "true",
        f"plain /my-work opens on My Tasks: url {qs(p)}")
    rec("no-page-errors-manager", not errors, errors[:3] or "none")
    p.unroute_all(behavior="ignoreErrors")
    ctx.close()

    # ---- Sales: nobody reports to them ----------------------------------------------------
    ctx = b.new_context(viewport={"width": 1440, "height": 900})
    p = ctx.new_page()
    errors = []
    p.on("pageerror", lambda e: errors.append(str(e)))
    demo_login(p, BASE, "sales")
    p.route("**/api/**", block)
    p.goto(BASE + "/my-work")
    settle(p)
    rec("no-reports-no-segment", p.locator('[data-testid="work-scope-team"]').count() == 0, f"segments: {segments(p)}")
    api = api_get(p, "/tasks?view=team")
    rec("no-reports-api-empty", api["status"] == 200 and api["body"] == [], f"API rows {len(api['body']) if api['status'] == 200 else api['status']}")
    p.goto(BASE + "/my-work?view=team")
    left = url_leaves_team(p)
    settle(p, 1000)
    mine_seg = p.locator('[data-testid="work-view-mywork"]')
    rec("no-reports-link-lands-on-my-tasks", left
        and mine_seg.count() == 1 and mine_seg.get_attribute("aria-pressed") == "true",
        f"url {qs(p)}; My Work segment pressed: {mine_seg.get_attribute('aria-pressed') if mine_seg.count() else None}; cards {len(cards(p))}")
    rec("no-page-errors-sales", not errors, errors[:3] or "none")
    p.unroute_all(behavior="ignoreErrors")
    ctx.close()

    # ---- Owner: All Tasks, no My team -----------------------------------------------------
    ctx = b.new_context(viewport={"width": 1440, "height": 900})
    p = ctx.new_page()
    errors = []
    p.on("pageerror", lambda e: errors.append(str(e)))
    demo_login(p, BASE, "owner")
    p.route("**/api/**", block)
    p.goto(BASE + "/my-work")
    settle(p)
    segs = segments(p)
    rec("owner-all-tasks-not-team", "All Tasks" in segs and p.locator('[data-testid="work-scope-team"]').count() == 0, f"segments: {segs}")
    p.goto(BASE + "/my-work?view=team")
    t0 = p.evaluate("() => performance.now()")
    left = url_leaves_team(p)
    took = int(p.evaluate("() => performance.now()") - t0)
    rec("owner-team-link-falls-back", left and p.locator('[data-testid="work-scope-mine"]').get_attribute("aria-pressed") == "true",
        f"url {qs(p)} after ~{took}ms; My Tasks pressed")
    rec("no-page-errors-owner", not errors, errors[:3] or "none")
    p.unroute_all(behavior="ignoreErrors")
    ctx.close()

    # ---- Access: someone who is not the manager can't open that task ---------------------
    ctx = b.new_context(viewport={"width": 1440, "height": 900})
    p = ctx.new_page()
    demo_login(p, BASE, "production")
    p.route("**/api/**", block)
    p.goto(BASE + "/my-work")
    settle(p, 1500)
    prod = me_of(p)
    if target and prod["id"] not in {target.get("assignee_id"), target.get("created_by"), target.get("approver_id"),
                                     target.get("support_id"), *(target.get("co_assignee_ids") or [])} \
            and target.get("assignee_role") != prod.get("role"):
        r = api_get(p, f"/tasks/{target['id']}")
        rec("non-manager-still-refused", r["status"] == 403, f"production user GET /tasks/{{id}} -> {r['status']}")
    else:
        rec("non-manager-still-refused", None, "production user is on that task; skipped")
    p.unroute_all(behavior="ignoreErrors")
    ctx.close()
    b.close()

(OUT / "results.json").write_text(json.dumps(results, indent=1), encoding="utf-8")
fails = [r for r in results if r["ok"] is False]
print(f"\n{sum(r['ok'] is True for r in results)} pass / {len(fails)} fail -> {OUT / 'results.json'}")
