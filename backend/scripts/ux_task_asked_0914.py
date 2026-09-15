"""ASK-28 TK-01 acceptance: "Asked by me" on My Work, desktop first.

Owner and Sales at 1440x900, plus one phone link check at 390x844.
Every POST/PATCH/PUT/DELETE after sign-in is aborted, so nothing is written.
The one mocked call: for the "requester who isn't on the task" check, the
Asked-by-me list is answered with a fake task, because no non-owner in the
demo company has created a task for someone else and creating one would
write to the production database.
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
OUT = pathlib.Path(__file__).resolve().parents[2] / ".audit-artifacts" / "ask28_asked_by_me"
OUT.mkdir(parents=True, exist_ok=True)
results = []


VP = "desktop"


def rec(key, ok, detail):
    vp = VP
    results.append({"check": key, "viewport": vp, "ok": ok, "detail": detail})
    print(f"  [{'PASS' if ok is True else 'FAIL' if ok is False else 'INFO'}] {vp:<8} {key}: {detail}", flush=True)


def block(route):
    if route.request.method in ("POST", "PATCH", "PUT", "DELETE"):
        return route.abort()
    return route.continue_()


def settle(p, ms=2500):
    """Wait out loading: skeletons gone and something real on the page (the
    merged glass page takes a few seconds to draw its first cards)."""
    p.wait_for_timeout(ms)
    ready = ('[id^="task-card-"]:visible, [data-testid="mywork-empty"], [data-testid="mywork-empty-filtered"], '
             '[data-testid="approvals-hub"]')
    for _ in range(24):
        if (p.locator(".animate-pulse:visible, .ds-skeleton:visible, [data-skeleton]:visible").count() == 0
                and p.locator(ready).count() > 0):
            break
        p.wait_for_timeout(500)


def cards(p):
    return p.evaluate("""() => [...document.querySelectorAll('[id^="task-card-"]:not([id^="task-card-body-"])')]
      .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).length""")


def qs(p):
    return {k: v[0] for k, v in parse_qs(urlparse(p.url).query).items()}


def api_get(p, path):
    return p.evaluate("async ([api, path]) => { const r = await fetch(api + path, {credentials: 'include'}); return {status: r.status, body: await r.json()}; }", [API, path])


TERMINAL = {"done", "cancelled"}

with sync_playwright() as pw:
    b = pw.chromium.launch()

    # ---- Owner, desktop -----------------------------------------------------
    VP = "desktop"
    ctx = b.new_context(viewport={"width": 1440, "height": 900})
    p = ctx.new_page()
    errors = []
    p.on("pageerror", lambda e: errors.append(str(e)))
    me = demo_login(p, BASE, "owner")
    p.route("**/api/**", block)
    p.goto(BASE + "/my-work")
    settle(p)

    seg = p.locator('[data-testid="work-scope-asked"]')
    order = p.evaluate("""() => [...document.querySelectorAll('[data-testid="work-view-segment"] button')].map(b => b.textContent.trim())""")
    rec("switcher-has-asked", seg.count() == 1, f"segments: {order}")

    api = api_get(p, "/tasks?view=asked")
    rows = api["body"] if api["status"] == 200 else []
    me_body = api_get(p, "/auth/me")["body"]
    me_id = me_body.get("id") or (me_body.get("user") or {}).get("id")
    wrong = [t["id"] for t in rows if t.get("created_by") != me_id or t.get("assignee_id") == me_id or me_id in (t.get("co_assignee_ids") or [])]
    open_rows = [t for t in rows if t.get("status") not in TERMINAL]
    rec("api-asked-rule", api["status"] == 200 and not wrong,
        f"{len(rows)} tasks, {len(open_rows)} open; rows breaking the rule: {wrong or 'none'}")

    seg.click()
    settle(p)
    rec("list-matches-api", cards(p) == len(open_rows), f"cards {cards(p)} / open from API {len(open_rows)}")
    rec("url-view-asked", qs(p).get("view") == "asked", f"url {qs(p)}")
    rec("ai-toggle-hidden", p.locator('[data-testid="ai-priority-toggle"]').count() == 0, "AI priority button not shown on Asked by me")
    person = p.locator('[data-testid="work-filter-person"]')
    rec("person-filter-present", person.count() == 1, person.inner_text().replace("\n", " ") if person.count() else "missing")
    if person.count():
        # Open the menu ONCE: reading it, closing it and reopening at once
        # races Radix's close animation and finds a menu on its way out.
        person.click()
        p.locator('[role=menu] [role=menuitem]').first.wait_for(state="visible", timeout=5000)
        items = p.evaluate("() => [...document.querySelectorAll('[role=menu] [role=menuitem]')].map(e => e.innerText.split('\\n')[0])")
        rec("person-no-me-option", "Me" not in items and len(items) > 1, f"options: {items[:8]}")
        # Second menu item = the busiest person (the first is "All people").
        item = p.locator('[role=menu] [role=menuitem]').nth(1)
        tid = item.get_attribute("data-testid") or ""
        doer = tid.replace("work-filter-person-", "") if tid.startswith("work-filter-person-") else None
        if not doer or doer in ("unassigned", "all") or doer.startswith("role:"):
            p.keyboard.press("Escape")
            rec("person-filter-narrows", None, f"no person option to pick (second item testid: {tid!r})")
            doer = None
        if doer:
            item.click()
            p.wait_for_timeout(800)
            exp = sum(1 for t in open_rows if t.get("assignee_id") == doer or doer in (t.get("co_assignee_ids") or []))
            rec("person-filter-narrows", cards(p) == exp, f"cards {cards(p)} / API {exp}")
            p.locator('[data-testid="work-filters-clear"]').click()
            p.wait_for_timeout(600)
    status = p.locator('[data-testid="work-filter-status"]')
    status.click()
    p.wait_for_timeout(300)
    p.locator('[data-testid="work-filter-status-overdue"]').click()
    p.wait_for_timeout(700)
    rec("status-filter-works", "Overdue" in status.inner_text(), f"{status.inner_text().replace(chr(10), ' ')} · cards {cards(p)}")
    p.locator('[data-testid="work-filters-clear"]').click()
    p.wait_for_timeout(600)
    p.screenshot(path=str(OUT / "owner_asked_desktop.png"))

    p.reload()
    settle(p)
    rec("refresh-keeps-asked", qs(p).get("view") == "asked"
        and p.locator('[data-testid="work-scope-asked"]').get_attribute("aria-pressed") == "true"
        and cards(p) == len(open_rows), f"after reload: url {qs(p)}, cards {cards(p)}")

    p.locator('[data-testid="work-scope-mine"]').click()
    settle(p, 1500)
    # ASK-28 TK-04: every view writes its own ?view= now, so My Tasks is view=mine.
    rec("other-view-clears-url", qs(p).get("view") in (None, "mine"), f"url after My Tasks: {qs(p)}")
    p.locator('[data-testid="work-scope-asked"]').click()
    settle(p, 1500)
    p.goto(BASE + "/my-work")
    settle(p)
    rec("not-saved-as-default", p.locator('[data-testid="work-scope-asked"]').get_attribute("aria-pressed") != "true",
        "plain /my-work does not reopen on Asked by me")

    rec("no-page-errors", not errors, errors[:3] or "none")
    p.unroute_all(behavior="ignoreErrors")
    ctx.close()

    # ---- Sales, desktop: empty state -----------------------------------------
    ctx = b.new_context(viewport={"width": 1440, "height": 900})
    p = ctx.new_page()
    errors = []
    p.on("pageerror", lambda e: errors.append(str(e)))
    demo_login(p, BASE, "sales")
    p.route("**/api/**", block)
    p.goto(BASE + "/my-work?view=asked")
    settle(p)
    api = api_get(p, "/tasks?view=asked")
    empty = p.locator('[data-testid="mywork-empty"]')
    text = empty.inner_text().replace("\n", " ") if empty.count() else None
    rec("sales-asked-segment", p.locator('[data-testid="work-scope-asked"]').count() == 1, "non-owner sees Asked by me")
    rec("sales-empty-state", api["status"] == 200 and len(api["body"]) == 0 and text and "Nothing you've asked for is open" in text
        and "decisions are approved" not in text, f"API rows {len(api['body']) if api['status'] == 200 else api['status']}; '{text}'")
    p.screenshot(path=str(OUT / "sales_asked_empty.png"))
    rec("no-page-errors-sales", not errors, errors[:3] or "none")
    p.unroute_all(behavior="ignoreErrors")

    # ---- Requester who isn't on the task: note only (list mocked) ------------
    sales_body = api_get(p, "/auth/me")["body"]
    sales_me = sales_body.get("user") if isinstance(sales_body.get("user"), dict) else sales_body
    users = api_get(p, "/users")["body"]
    doer = next(u for u in users if u["id"] != sales_me["id"] and u.get("role") != "owner")
    fake = [{
        "id": "fake-asked-1", "tenant_id": sales_me.get("tenant_id"), "title": "ASK-28 check: send the sample swatches",
        "status": "todo", "priority": "medium", "task_type": "sales", "created_by": sales_me["id"],
        "created_by_name": sales_me.get("name"), "assignee_id": doer["id"], "assignee_name": doer.get("name"),
        "assignee_role": doer.get("role"), "co_assignee_ids": [], "co_assignees": [], "updates": [],
        "attachments": [], "created_at": "2026-09-14T06:00:00+00:00", "updated_at": "2026-09-14T06:00:00+00:00",
    }]

    def mocked(route):
        req = route.request
        if req.method == "GET" and "/api/tasks" in req.url and "view=asked" in req.url:
            return route.fulfill(status=200, content_type="application/json", body=json.dumps(fake))
        if req.method == "GET" and req.url.split("?")[0].endswith("/api/tasks/fake-asked-1"):
            return route.fulfill(status=200, content_type="application/json", body=json.dumps(fake[0]))
        return block(route)

    p.route("**/api/**", mocked)
    p.goto(BASE + "/my-work?view=asked")
    settle(p)
    p.locator('[id="task-card-fake-asked-1"]').click()
    p.wait_for_timeout(1200)
    trigger = p.locator('[data-testid="add-update-fake-asked-1"]:visible').first
    labels = []
    if trigger.count():
        trigger.click()
        p.wait_for_timeout(500)
        labels = p.evaluate("""() => [...document.querySelectorAll('[role=dialog] button')]
          .map(b => b.textContent.trim()).filter(t => ['Log note', 'Hand off', 'Escalate'].includes(t))""")
    rec("requester-note-only", labels == ["Log note"], f"update actions offered: {labels} (list mocked: no non-owner has created a task for someone else)")
    # Item 7 (plan 6.7, 2026-09-14): the person who asked runs the task — stage
    # and Complete are theirs too (hand-off stays with the people on it).
    shown = {k: p.locator(f'[data-testid="{k}-fake-asked-1"]:visible').count()
             for k in ("status-select", "complete")}
    hint = p.locator('[data-testid="requester-hint-fake-asked-1"]:visible')
    rec("requester-runs-the-task", all(shown.values()) and hint.count() == 0,
        f"stage and Complete shown: {shown}; follow-only hint: {hint.count()}")
    p.screenshot(path=str(OUT / "requester_note_only.png"))
    p.unroute_all(behavior="ignoreErrors")
    ctx.close()

    # ---- Phone link ------------------------------------------------------------
    VP = "phone"
    ctx = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    p = ctx.new_page()
    errors = []
    p.on("pageerror", lambda e: errors.append(str(e)))
    demo_login(p, BASE, "owner")
    p.route("**/api/**", block)
    p.goto(BASE + "/my-work?view=asked")
    settle(p)
    # Phone pass: one view pill names the view on screen (was a My Tasks | All Tasks pair).
    pill = p.locator('[data-testid="work-mobile-view"]')
    pill_txt = pill.inner_text().replace("\n", " ") if pill.count() else None
    overflow = p.evaluate("() => document.documentElement.scrollWidth - innerWidth")
    rec("phone-link-lands", cards(p) == len(open_rows) and bool(pill_txt) and "Asked by me" in pill_txt and overflow <= 0,
        f"cards {cards(p)} / {len(open_rows)}; view pill '{pill_txt}'; overflow {overflow}")
    rec("no-page-errors-phone", not errors, errors[:3] or "none")
    p.unroute_all(behavior="ignoreErrors")
    ctx.close()
    b.close()

(OUT / "results.json").write_text(json.dumps(results, indent=1), encoding="utf-8")
fails = [r for r in results if r["ok"] is False]
print(f"\n{sum(r['ok'] is True for r in results)} pass / {len(fails)} fail -> {OUT / 'results.json'}")
