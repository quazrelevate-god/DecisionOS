"""ASK-28 TK-04 acceptance: links always land — desktop (1440x900) + one phone check.

A task link (?task=<id>, or the older ?focus=task:<id>) opens that task's
drawer whatever view the person is on, including a task that is not in the
list on screen; closing it takes the link out of the address; a task that no
longer exists and one the person may not open each say so; the chosen view
lives in ?view= and survives refresh, Back and Forward.

Real data, read-only: Sunita Rao (finance@) manages sai, whose tasks are not
in her own My Tasks. Every POST/PATCH/PUT/DELETE after sign-in is aborted.
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
OUT = pathlib.Path(__file__).resolve().parents[2] / ".audit-artifacts" / "ask28_links"
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


def api_get(p, path):
    return p.evaluate("async ([a, x]) => { const r = await fetch(a + x, {credentials: 'include'}); let b = null; try { b = await r.json(); } catch (e) {} return {status: r.status, body: b}; }", [API, path])


def me_of(p):
    b = api_get(p, "/auth/me")["body"]
    return b.get("user") if isinstance(b.get("user"), dict) else b


def qs(p):
    return {k: v[0] for k, v in parse_qs(urlparse(p.url).query).items()}


def pressed(p):
    return p.evaluate("""() => [...document.querySelectorAll('[data-testid="work-view-segment"] button')]
      .filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.textContent.trim().replace(/\\d+$/, ''))""")


def drawer_title(p, wait_ms=6000):
    for _ in range(wait_ms // 250):
        d = p.locator('[role="dialog"]:visible')
        if d.count():
            h = d.first.locator("h2")
            return h.first.inner_text().strip() if h.count() else "(no title)"
        p.wait_for_timeout(250)
    return None


def wait_for(p, fn, ms=6000):
    for _ in range(ms // 250):
        if fn():
            return True
        p.wait_for_timeout(250)
    return False


def settle(p, ms=2500):
    """Wait out loading: skeletons gone (including [data-skeleton], which the
    task list's skeleton cards use) and something real on the page."""
    p.wait_for_timeout(ms)
    ready = ('[id^="task-card-"]:visible, [data-testid="mywork-empty"], [data-testid="mywork-empty-filtered"], '
             '[data-testid="approvals-hub"], [data-testid="workflows-hub"]')
    for _ in range(24):
        if (p.locator(".animate-pulse:visible, .ds-skeleton:visible, [data-skeleton]:visible").count() == 0
                and p.locator(ready).count() > 0):
            break
        p.wait_for_timeout(500)


def session(b, role, **ctx_kw):
    ctx = b.new_context(**({"viewport": {"width": 1440, "height": 900}} | ctx_kw))
    p = ctx.new_page()
    errors = []
    p.on("pageerror", lambda e: errors.append(str(e)))
    demo_login(p, BASE, role)
    p.route("**/api/**", block)
    p.goto(BASE + "/my-work")
    settle(p)
    return ctx, p, errors


def close(ctx, p):
    p.unroute_all(behavior="ignoreErrors")
    ctx.close()


with sync_playwright() as pw:
    b = pw.chromium.launch()

    # ---- Manager (finance): tasks outside her own list -----------------------------------
    ctx, p, errors = session(b, "finance")
    mine = {t["id"] for t in api_get(p, "/tasks?mine=true")["body"]}
    team = api_get(p, "/tasks?view=team")["body"]
    outside = next(t for t in team if t["id"] not in mine and t.get("status") not in TERMINAL)
    done = next((t for t in team if t["id"] not in mine and t.get("status") == "done"), None)
    rec("setup", bool(outside), f"sai task outside Sunita's My Tasks: '{outside['title'][:40]}'; finished one: {bool(done)}")

    p.goto(f"{BASE}/my-work?task={outside['id']}")
    title = drawer_title(p)
    card_sel = f'[id="task-card-{outside["id"]}"]:visible'
    rec("link-opens-task-not-in-list", title == outside["title"].strip(),
        f"drawer '{title}'; view pressed {pressed(p)}; card for it in the list: {p.locator(card_sel).count()}")
    p.screenshot(path=str(OUT / "manager_link_drawer.png"))
    p.keyboard.press("Escape")
    left = wait_for(p, lambda: "task" not in qs(p))
    rec("closing-clears-link", left and p.locator('[role="dialog"]:visible').count() == 0, f"url after closing: {qs(p)}")
    p.reload()
    settle(p)
    rec("refresh-after-close-stays-closed", p.locator('[role="dialog"]:visible').count() == 0, f"url {qs(p)}")

    if done:
        p.goto(f"{BASE}/my-work?task={done['id']}")
        title = drawer_title(p)
        rec("link-opens-finished-task", title == done["title"].strip(), f"drawer '{title}'")
        p.keyboard.press("Escape")
        p.wait_for_timeout(600)
    else:
        rec("link-opens-finished-task", None, "no finished task outside her list")

    p.goto(BASE + "/my-work")
    settle(p)
    p.evaluate("(id) => { window.history.pushState({}, '', '/my-work?task=' + id); window.dispatchEvent(new PopStateEvent('popstate')); }", outside["id"])
    title = drawer_title(p)
    rec("link-while-already-on-my-work", title == outside["title"].strip(), f"drawer '{title}' (as when a notification is clicked from My Work)")
    p.keyboard.press("Escape")
    p.wait_for_timeout(600)

    p.goto(f"{BASE}/my-work?focus=task:{outside['id']}")
    title = drawer_title(p)
    rec("focus-task-link-opens", title == outside["title"].strip(), f"?focus=task:<id> (Brief / phone links) -> drawer '{title}'")
    p.keyboard.press("Escape")
    wait_for(p, lambda: "focus" not in qs(p))
    rec("focus-link-cleared-on-close", "focus" not in qs(p), f"url {qs(p)}")

    p.goto(f"{BASE}/my-work?view=team&task={outside['id']}")
    title = drawer_title(p)
    rec("link-inside-my-team-uses-the-card", title == outside["title"].strip() and "My team" in pressed(p)
        and p.locator('[data-testid="focus-task-standalone"]').count() == 0,
        f"drawer '{title}'; pressed {pressed(p)}; drawn from the card in the list (no stand-in)")
    p.keyboard.press("Escape")
    p.wait_for_timeout(600)
    rec("no-page-errors-manager", not errors, errors[:3] or "none")
    close(ctx, p)

    # ---- Owner: missing task, views in the address -----------------------------------------
    ctx, p, errors = session(b, "owner")
    me = me_of(p)
    other = next(t for t in api_get(p, "/tasks?mine=false")["body"]
                 if t.get("assignee_id") and t["assignee_id"] != me["id"] and t.get("status") not in TERMINAL)
    p.goto(f"{BASE}/my-work?task={other['id']}")
    title = drawer_title(p)
    rec("owner-link-still-opens", title == other["title"].strip(), f"drawer '{title}'")
    p.keyboard.press("Escape")
    p.wait_for_timeout(600)

    p.goto(f"{BASE}/my-work?task=00000000-0000-0000-0000-000000000000")
    banner = p.locator('[data-testid="access-restricted-banner"]')
    wait_for(p, lambda: banner.count() == 1)
    rec("missing-task-says-so", banner.count() == 1 and banner.get_attribute("data-reason") == "missing"
        and "no longer exists" in banner.inner_text(), banner.inner_text().replace("\n", " ")[:100] if banner.count() else "no banner")
    if banner.count():
        p.locator('[data-testid="access-restricted-dismiss"]').click()
        p.wait_for_timeout(700)
    rec("dismiss-clears-message-and-link", banner.count() == 0 and "task" not in qs(p), f"url {qs(p)}")

    p.goto(BASE + "/my-work")
    settle(p)
    p.locator('[data-testid="work-view-workflows"]').click()
    p.wait_for_timeout(1200)
    rec("workflows-in-address", qs(p).get("view") == "workflows", f"url {qs(p)}")
    p.reload()
    settle(p)
    rec("workflows-survives-refresh", "Workflows" in pressed(p), f"pressed after refresh {pressed(p)}")

    p.goto(BASE + "/my-work?view=mine")
    settle(p)
    p.locator('[data-testid="work-scope-asked"]').click()
    p.wait_for_timeout(1000)
    p.locator('[data-testid="work-scope-all"]').click()
    p.wait_for_timeout(1000)
    trail = [(qs(p).get("view"), pressed(p))]
    p.go_back()
    p.wait_for_timeout(1500)
    trail.append((qs(p).get("view"), pressed(p)))
    back1 = qs(p).get("view") == "asked" and "Asked by me" in pressed(p)
    p.go_back()
    p.wait_for_timeout(1500)
    trail.append((qs(p).get("view"), pressed(p)))
    back2 = qs(p).get("view") == "mine" and "My Tasks" in pressed(p)
    p.go_forward()
    p.wait_for_timeout(1500)
    trail.append((qs(p).get("view"), pressed(p)))
    fwd = qs(p).get("view") == "asked" and "Asked by me" in pressed(p)
    rec("back-and-forward-move-between-views", trail[0][0] == "all" and back1 and back2 and fwd,
        f"All -> Back {trail[1]} -> Back {trail[2]} -> Forward {trail[3]}")
    p.goto(BASE + "/my-work?view=all")
    wait_for(p, lambda: "All Tasks" in pressed(p), ms=10000)
    rec("all-tasks-link", "All Tasks" in pressed(p), f"?view=all -> pressed {pressed(p)}")
    p.goto(BASE + "/my-work?view=approvals")
    # The merged glass page takes a few seconds to draw the switcher; wait for
    # it rather than reading a half-drawn header.
    wait_for(p, lambda: "Approvals" in pressed(p) and p.locator('[data-testid="approvals-hub"]').count() == 1, ms=10000)
    rec("approvals-link", "Approvals" in pressed(p) and p.locator('[data-testid="approvals-hub"]').count() == 1, f"pressed {pressed(p)}")
    rec("no-page-errors-owner", not errors, errors[:3] or "none")
    close(ctx, p)

    # ---- Production: a task they may not open -----------------------------------------------
    ctx, p, errors = session(b, "production")
    status = api_get(p, f"/tasks/{outside['id']}")["status"]
    p.goto(f"{BASE}/my-work?task={outside['id']}")
    banner = p.locator('[data-testid="access-restricted-banner"]')
    wait_for(p, lambda: banner.count() == 1)
    rec("no-access-says-so", status == 403 and banner.count() == 1 and banner.get_attribute("data-reason") == "denied"
        and p.locator('[role="dialog"]:visible').count() == 0,
        f"API {status}; banner: {banner.inner_text().replace(chr(10), ' ')[:90] if banner.count() else None}; no drawer")
    p.screenshot(path=str(OUT / "no_access_banner.png"))
    rec("no-page-errors-production", not errors, errors[:3] or "none")
    close(ctx, p)

    # ---- Phone --------------------------------------------------------------------------------
    VP = "phone"
    ctx, p, errors = session(b, "finance", viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    p.goto(f"{BASE}/my-work?task={outside['id']}")
    title = drawer_title(p)
    overflow = p.evaluate("() => document.documentElement.scrollWidth - innerWidth")
    rec("phone-link-opens-task-not-in-list", title == outside["title"].strip() and overflow <= 0, f"drawer '{title}'; overflow {overflow}")
    p.screenshot(path=str(OUT / "phone_link_drawer.png"))
    rec("no-page-errors-phone", not errors, errors[:3] or "none")
    close(ctx, p)
    b.close()

(OUT / "results.json").write_text(json.dumps(results, indent=1), encoding="utf-8")
fails = [r for r in results if r["ok"] is False]
print(f"\n{sum(r['ok'] is True for r in results)} pass / {len(fails)} fail -> {OUT / 'results.json'}")
