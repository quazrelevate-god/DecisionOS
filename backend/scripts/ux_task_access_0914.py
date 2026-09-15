"""ASK-28 TK-08 acceptance (plan 6.6): task access, role by view — desktop
(1440x900) and phone (390x844) for owner, sales, production and finance
(Sunita Rao, who manages sai).

Per role:
  - no refused requests (403) while My Work loads;
  - /auth/me carries the permissions the server applies; nobody but the owner
    holds "Assign tasks to anyone" or "See all tasks" (finance included — founder
    call 2026-09-14);
  - All Tasks only for the owner (desktop switcher, phone view sheet, ?view=all);
  - New Task offers exactly the people and teams the rule allows (self, own
    team, direct reports; everyone for the owner) — helpers too.
Plus: a MOCKED grant of both new permissions to sales opens All Tasks and the
full Assign to list (the screens follow /auth/me; the server rule itself is
real-save tested in tests/test_task_management_e2e.py), and the member dialog
on Team lists the two new toggles, off by default.

Real data, read-only: every POST/PATCH/PUT/DELETE after sign-in is aborted.
"""
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from ux_login import demo_login  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

BASE = "http://localhost:3000"
API = "http://localhost:8001/api"
OUT = pathlib.Path(__file__).resolve().parents[2] / ".audit-artifacts" / "ask28_access"
OUT.mkdir(parents=True, exist_ok=True)
results = []
VP = "desktop"
ROLE = "owner"
NEW_PERMS = ("tasks_assign_any", "tasks_view_all")


def rec(key, ok, detail):
    results.append({"check": key, "role": ROLE, "viewport": VP, "ok": ok, "detail": detail})
    print(f"  [{'PASS' if ok is True else 'FAIL' if ok is False else 'INFO'}] {ROLE:<10} {VP:<7} {key}: {detail}", flush=True)


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


def segments(p):
    return p.evaluate("""() => [...document.querySelectorAll('[data-testid="work-view-segment"] button')]
      .map(b => b.textContent.trim().replace(/\\d+$/, ''))""")


def glass_options(p, testid):
    p.locator(f'[data-testid="{testid}"]:visible').first.click()
    p.locator('[role="option"]').first.wait_for(state="visible", timeout=5000)
    opts = p.evaluate("""(tid) => [...document.querySelectorAll('[role="option"]')]
      .map(o => (o.getAttribute('data-testid') || '').replace(tid + '-option-', ''))""", testid)
    p.keyboard.press("Escape")
    p.wait_for_timeout(300)
    return opts


def expected_people(me, users, perms):
    if me.get("role") == "owner" or "tasks_assign_any" in perms:
        return {u["id"] for u in users}
    return {u["id"] for u in users
            if u["id"] == me["id"] or (u.get("role") and u.get("role") == me.get("role"))
            or u.get("reporting_manager_id") == me["id"]}


def expected_teams(me, tenant_roles, perms):
    keys = {r["key"] for r in tenant_roles if r.get("key") and r["key"] != "owner"}
    if me.get("role") == "owner" or "tasks_assign_any" in perms:
        return keys
    return {me.get("role")} & keys


def open_new_task(p):
    p.locator('[data-testid="new-task-button"]:visible').first.click()
    p.locator('[data-testid="task-assign-select"]:visible').first.wait_for(state="visible", timeout=8000)


def check_new_task(p, me, users, tenant_roles, perms, label=""):
    open_new_task(p)
    opts = glass_options(p, "task-assign-select")
    people = {o[2:] for o in opts if o.startswith("u:")}
    teams = {o[2:] for o in opts if o.startswith("r:")}
    exp_people = expected_people(me, users, perms)
    exp_teams = expected_teams(me, tenant_roles, perms)
    rec(f"new-task-assign-list{label}", people == exp_people and teams == exp_teams,
        f"people {len(people)}/{len(exp_people)} expected, extra {sorted(people - exp_people)[:3]}, missing {sorted(exp_people - people)[:3]}; "
        f"teams {sorted(teams)} vs {sorted(exp_teams)}")
    # Helpers, once a doer (themselves) is chosen: the same people minus the doer.
    p.locator('[data-testid="task-assign-select"]:visible').first.click()
    p.locator(f'[data-testid="task-assign-select-option-u:{me["id"]}"]').click()
    p.wait_for_timeout(400)
    helpers = set(glass_options(p, "task-co-assignee-select")) if p.locator('[data-testid="task-co-assignee-select"]:visible').count() else set()
    rec(f"new-task-helper-list{label}", helpers == exp_people - {me["id"]},
        f"helpers {len(helpers)} / expected {len(exp_people - {me['id']})}; extra {sorted(helpers - exp_people)[:3]}")
    p.locator('[data-testid="task-dialog-close"]').first.click()
    p.wait_for_timeout(500)
    return people


def session(b, role, phone=False, me_patch=None):
    ctx = b.new_context(**({"viewport": {"width": 390, "height": 844}, "is_mobile": True, "has_touch": True} if phone
                           else {"viewport": {"width": 1440, "height": 900}}))
    p = ctx.new_page()
    errors, refused = [], []
    p.on("pageerror", lambda e: errors.append(str(e)))
    demo_login(p, BASE, role)
    p.on("response", lambda r: refused.append(f"{r.status} {r.request.method} {r.url.split('/api')[-1][:60]}")
         if "/api/" in r.url and r.status == 403 else None)

    def route(r):
        req = r.request
        if req.method in ("POST", "PATCH", "PUT", "DELETE"):
            return r.abort()
        if me_patch and req.url.split("?")[0].endswith("/api/auth/me"):
            resp = r.fetch()
            body = resp.json()
            body["user"] = me_patch(body["user"])
            return r.fulfill(response=resp, body=json.dumps(body))
        return r.continue_()

    p.route("**/api/**", route)
    p.goto(BASE + "/my-work")
    settle(p)
    return ctx, p, errors, refused


with sync_playwright() as pw:
    b = pw.chromium.launch()

    for ROLE in ("owner", "sales", "production", "finance"):
        # ---- Desktop -------------------------------------------------------------------
        VP = "desktop"
        ctx, p, errors, refused = session(b, ROLE)
        body = api_get(p, "/auth/me")["body"]
        me, tenant = body["user"], body["tenant"]
        perms = me.get("effective_permissions")
        users = api_get(p, "/users")["body"]
        is_owner = me.get("role") == "owner"
        rec("me-carries-effective-permissions", isinstance(perms, list) and "tasks" in perms,
            f"{len(perms or [])} permissions; new ones held: {[k for k in NEW_PERMS if k in (perms or [])]}")
        rec("new-permissions-owner-only", all((k in perms) == is_owner for k in NEW_PERMS),
            "owner holds both" if is_owner else "neither held (off by default)")
        segs = segments(p)
        reports = [u for u in users if u.get("reporting_manager_id") == me["id"]]
        rec("all-tasks-only-for-owner", ("All Tasks" in segs) == is_owner and (("My team" in segs) == bool(reports and not is_owner)),
            f"segments {segs}; reports {len(reports)}")
        if not is_owner:
            p.goto(BASE + "/my-work?view=all")
            settle(p)
            rec("all-tasks-link-refused-gently", "All Tasks" not in segments(p) and p.locator('[data-testid="work-scope-all"]').count() == 0,
                f"?view=all -> segments {segments(p)} (lands on their own tasks)")
            p.goto(BASE + "/my-work")
            settle(p)
        check_new_task(p, me, users, tenant.get("roles") or [], perms)
        rec("no-refused-requests", not refused, refused[:4] or "none")
        rec("no-page-errors", not errors, errors[:3] or "none")
        if ROLE == "sales":
            p.screenshot(path=str(OUT / "sales_new_task.png"))
        p.unroute_all(behavior="ignoreErrors")
        ctx.close()

        # ---- Phone ----------------------------------------------------------------------
        VP = "phone"
        ctx, p, errors, refused = session(b, ROLE, phone=True)
        p.locator('[data-testid="work-mobile-view"]:visible').first.click()
        p.locator('[data-testid="work-mobile-view-sheet"]').wait_for(state="visible", timeout=6000)
        keys = p.evaluate("""() => [...document.querySelectorAll('[data-testid^="work-mobile-view-"][aria-pressed]')]
          .map(b => b.dataset.testid.replace('work-mobile-view-', ''))""")
        p.keyboard.press("Escape")
        over = p.evaluate("() => document.documentElement.scrollWidth - innerWidth")
        rec("phone-views", ("all" in keys) == is_owner and (("team" in keys) == bool(reports and not is_owner)) and over <= 0,
            f"view sheet {keys}; overflow {over}")
        rec("no-refused-requests", not refused, refused[:4] or "none")
        rec("no-page-errors", not errors, errors[:3] or "none")
        p.unroute_all(behavior="ignoreErrors")
        ctx.close()

    # ---- Sales with both new permissions (MOCKED on /auth/me) -----------------------------
    ROLE, VP = "sales+grant", "desktop"

    def grant(u):
        return {**u, "effective_permissions": sorted(set(u.get("effective_permissions") or []) | set(NEW_PERMS))}

    ctx, p, errors, refused = session(b, "sales", me_patch=grant)
    body = api_get(p, "/auth/me")["body"]
    me, tenant = body["user"], body["tenant"]
    users = api_get(p, "/users")["body"]
    segs = segments(p)
    rec("grant-see-all-opens-all-tasks", "All Tasks" in segs, f"segments {segs} (mocked /auth/me)")
    if p.locator('[data-testid="work-scope-all"]').count():
        with p.expect_request(lambda r: "/api/tasks" in r.url and "mine=false" in r.url, timeout=8000):
            p.locator('[data-testid="work-scope-all"]').click()
        rec("grant-all-tasks-asks-for-everything", True, "switching to All Tasks requested /tasks?mine=false")
    check_new_task(p, me, users, tenant.get("roles") or [], me["effective_permissions"], label="-with-assign-any")
    rec("no-page-errors", not errors, errors[:3] or "none")
    p.unroute_all(behavior="ignoreErrors")
    ctx.close()

    # ---- Team: the two toggles in the member dialog --------------------------------------
    ROLE, VP = "owner", "desktop"
    ctx = b.new_context(viewport={"width": 1440, "height": 900})
    p = ctx.new_page()
    demo_login(p, BASE, "owner")
    p.route("**/api/**", lambda r: r.abort() if r.request.method in ("POST", "PATCH", "PUT", "DELETE") else r.continue_())
    p.goto(BASE + "/team")
    p.wait_for_timeout(3500)
    btn = p.locator('[data-testid="add-user-button"]:visible')
    if btn.count():
        btn.first.click()
        p.locator('[data-testid="member-dialog"]').wait_for(state="visible", timeout=8000)
        toggles = {k: p.locator(f'[data-testid="perm-{k}"]') for k in NEW_PERMS}
        labels = {k: (t.inner_text().strip() if t.count() else None) for k, t in toggles.items()}
        pressed = {k: (t.get_attribute("aria-pressed") if t.count() else None) for k, t in toggles.items()}
        rec("team-dialog-new-toggles", labels == {"tasks_assign_any": "Assign tasks to anyone", "tasks_view_all": "See all tasks"}
            and pressed == {"tasks_assign_any": "false", "tasks_view_all": "false"},
            f"labels {labels}; on by default {pressed}")
        p.screenshot(path=str(OUT / "team_member_dialog.png"))
        p.locator('[data-testid="member-cancel"]').click()
    else:
        rec("team-dialog-new-toggles", False, "Add user button not found on /team")
    p.unroute_all(behavior="ignoreErrors")
    ctx.close()
    b.close()

(OUT / "results.json").write_text(json.dumps(results, indent=1), encoding="utf-8")
fails = [r for r in results if r["ok"] is False]
print(f"\n{sum(r['ok'] is True for r in results)} pass / {len(fails)} fail -> {OUT / 'results.json'}")
