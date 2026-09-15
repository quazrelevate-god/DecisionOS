"""ASK-28 phone pass: My Work views and the New Task form on a phone (390x844).

  - One view pill for everyone, naming the view on screen and opening a sheet of
    the views this person has: My Tasks, Asked by me, My team (managers), All
    Tasks (owner), Approvals with its count (people who approve).
  - Picking a view changes the list and the address; Back returns.
  - New Task opens full-screen: nothing wider than the phone, the approval
    choice readable, Create reachable, and the payload it sends is right.
  - A task drawer opens full width without sideways scrolling.

Real data, read-only. Every POST/PATCH/PUT/DELETE after sign-in is aborted,
except POST /api/tasks, which is answered by this script (a fake task) so the
form's success path runs without writing.
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
OUT = pathlib.Path(__file__).resolve().parents[2] / ".audit-artifacts" / "ask28_phone"
OUT.mkdir(parents=True, exist_ok=True)
results = []
TERMINAL = {"done", "cancelled"}
PHONE = {"viewport": {"width": 390, "height": 844}, "is_mobile": True, "has_touch": True}
ROLE = "owner"


def rec(key, ok, detail):
    results.append({"check": key, "role": ROLE, "ok": ok, "detail": detail})
    print(f"  [{'PASS' if ok is True else 'FAIL' if ok is False else 'INFO'}] {ROLE:<8} {key}: {detail}", flush=True)


def api_get(p, path):
    return p.evaluate("async ([a, x]) => { const r = await fetch(a + x, {credentials: 'include'}); let b = null; try { b = await r.json(); } catch (e) {} return {status: r.status, body: b}; }", [API, path])


def qs(p):
    return {k: v[0] for k, v in parse_qs(urlparse(p.url).query).items()}


def cards(p):
    return p.evaluate("""() => [...document.querySelectorAll('[id^="task-card-"]:not([id^="task-card-body-"])')]
      .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).length""")


def overflow(p):
    return p.evaluate("() => document.documentElement.scrollWidth - innerWidth")


def settle(p, ms=2500):
    p.wait_for_timeout(ms)
    ready = '[id^="task-card-"]:visible, [data-testid="mywork-empty"], [data-testid="approvals-hub"]'
    for _ in range(24):
        if (p.locator(".animate-pulse:visible, .ds-skeleton:visible, [data-skeleton]:visible").count() == 0
                and p.locator(ready).count() > 0):
            break
        p.wait_for_timeout(500)


def stable_cards(p, polls=3, ms=300):
    last, same = None, 0
    for _ in range(40):
        n = cards(p)
        same = same + 1 if n == last else 0
        last = n
        if same >= polls:
            break
        p.wait_for_timeout(ms)
    return last


def pill_text(p):
    pill = p.locator('[data-testid="work-mobile-view"]:visible')
    return pill.first.inner_text().replace("\n", " ").strip() if pill.count() else None


def sheet_options(p):
    p.locator('[data-testid="work-mobile-view"]:visible').first.click()
    p.locator('[data-testid="work-mobile-view-sheet"]').wait_for(state="visible", timeout=5000)
    opts = p.evaluate("""() => [...document.querySelectorAll('[data-testid^="work-mobile-view-"][aria-pressed]')]
      .map(b => ({key: b.dataset.testid.replace('work-mobile-view-', ''), text: b.innerText.replace(/\\n/g, ' ').trim(),
                  on: b.getAttribute('aria-pressed') === 'true'}))""")
    return opts


def pick(p, key):
    """Open the sheet if it is closed, then choose a view."""
    if p.locator('[data-testid="work-mobile-view-sheet"]:visible').count() == 0:
        p.locator('[data-testid="work-mobile-view"]:visible').first.click()
        p.locator('[data-testid="work-mobile-view-sheet"]').wait_for(state="visible", timeout=5000)
    p.locator(f'[data-testid="work-mobile-view-{key}"]').click()
    p.wait_for_timeout(700)
    settle(p, 800)
    return stable_cards(p)


def session(b, role, route=None):
    ctx = b.new_context(**PHONE)
    p = ctx.new_page()
    errors = []
    p.on("pageerror", lambda e: errors.append(str(e)))
    demo_login(p, BASE, role)
    p.route("**/api/**", route or (lambda r: r.abort() if r.request.method in ("POST", "PATCH", "PUT", "DELETE") else r.continue_()))
    p.goto(BASE + "/my-work")
    settle(p)
    return ctx, p, errors


def open_count(rows):
    return sum(1 for t in rows if t.get("status") not in TERMINAL)


with sync_playwright() as pw:
    b = pw.chromium.launch()

    # ---- Owner --------------------------------------------------------------------
    ROLE = "owner"
    sent = []

    def owner_route(r):
        req = r.request
        if req.method == "POST" and req.url.split("?")[0].endswith("/api/tasks"):
            body = json.loads(req.post_data or "{}")
            sent.append(body)
            return r.fulfill(status=200, content_type="application/json",
                             body=json.dumps({**body, "id": "fake-phone-task", "status": "todo", "co_assignees": []}))
        if req.method in ("POST", "PATCH", "PUT", "DELETE"):
            return r.abort()
        return r.continue_()

    ctx, p, errors = session(b, "owner", owner_route)
    asked_rows = api_get(p, "/tasks?view=asked")["body"]
    all_rows = api_get(p, "/tasks?mine=false")["body"]
    appr = [t for t in api_get(p, "/tasks?view=approvals")["body"] if t.get("approval_status") == "pending" and t.get("status") not in TERMINAL]

    txt = pill_text(p)
    badge = p.locator('[data-testid="work-mobile-view-badge"]:visible')
    rec("pill-names-view-and-count", txt is not None and txt.startswith("My Tasks")
        and badge.count() == 1 and badge.first.inner_text().strip() == str(len(appr)),
        f"pill '{txt}'; badge {badge.first.inner_text().strip() if badge.count() else None} / approvals waiting {len(appr)}")
    rec("header-fits", overflow(p) <= 0, f"sideways overflow {overflow(p)}px")
    p.screenshot(path=str(OUT / "owner_header.png"))

    opts = sheet_options(p)
    keys = [o["key"] for o in opts]
    rec("owner-sheet-options", keys == ["mine", "asked", "all", "approvals"] and opts[0]["on"],
        f"{[o['text'] for o in opts]}; pressed {[o['key'] for o in opts if o['on']]}")
    p.screenshot(path=str(OUT / "owner_view_sheet.png"))

    n = pick(p, "asked")
    rec("pick-asked", qs(p).get("view") == "asked" and (pill_text(p) or "").startswith("Asked by me")
        and n == open_count(asked_rows) and p.locator('[data-testid="work-mobile-view-sheet"]:visible').count() == 0,
        f"url {qs(p)}; pill '{pill_text(p)}'; cards {n} / open {open_count(asked_rows)}; sheet closed")
    n = pick(p, "all")
    rec("pick-all", qs(p).get("view") == "all" and (pill_text(p) or "").startswith("All Tasks") and n == open_count(all_rows),
        f"url {qs(p)}; cards {n} / open {open_count(all_rows)}")
    pick(p, "approvals")
    hub = p.locator('[data-testid="approvals-hub"]').count()
    rec("pick-approvals", qs(p).get("view") == "approvals" and hub == 1 and (pill_text(p) or "").startswith("Approvals")
        and overflow(p) <= 0, f"url {qs(p)}; hub {hub}; pill '{pill_text(p)}'; overflow {overflow(p)}")
    p.go_back()
    p.wait_for_timeout(1500)
    rec("back-returns-to-previous-view", qs(p).get("view") == "all" and (pill_text(p) or "").startswith("All Tasks"),
        f"after Back: url {qs(p)}; pill '{pill_text(p)}'")

    # A task drawer on the phone.
    pick(p, "mine")
    first = p.locator('[id^="task-card-"]:not([id^="task-card-body-"]):visible').first
    if first.count():
        first.click()
        p.wait_for_timeout(1500)
        d = p.locator('[role="dialog"]:visible').first
        box = d.bounding_box() if d.count() else None
        inner = d.evaluate("e => e.scrollWidth - e.clientWidth") if d.count() else None
        # The glass drawer keeps a small margin on the phone by design; what
        # matters is that it sits inside the screen and never scrolls sideways.
        rec("drawer-fits-phone", box is not None and box["x"] >= 0 and box["x"] + box["width"] <= 390 + 1
            and box["width"] >= 340 and inner is not None and inner <= 0,
            f"drawer {box and round(box['x'])}..{box and round(box['x'] + box['width'])}px of 390; inner sideways overflow {inner}")
        p.screenshot(path=str(OUT / "owner_drawer.png"))
        p.keyboard.press("Escape")
        p.wait_for_timeout(700)

    # New Task, full screen.
    btn = p.locator('[data-testid="new-task-button"]:visible')
    rec("new-task-reachable", btn.count() >= 1, f"{btn.count()} visible New Task button(s)")
    if btn.count():
        btn.first.click()
        p.wait_for_timeout(900)
        dlg = p.locator('[role="dialog"]:visible').first
        box = dlg.bounding_box()
        wide = dlg.evaluate("""d => [...d.querySelectorAll('*')].filter(e => {
            const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > innerWidth + 1 || r.left < -1); })
            .map(e => (e.getAttribute('data-testid') || e.tagName) + ':' + Math.round(e.getBoundingClientRect().right)).slice(0, 6)""")
        rec("form-full-screen", box and box["width"] >= 385 and box["height"] >= 800 and not wide,
            f"form {round(box['width'])}x{round(box['height'])}; elements past the edge: {wide or 'none'}")
        dlg.locator('[data-testid="task-title-input"]').fill("Phone check: call the dyer")
        choice = dlg.locator('[data-testid="task-approval"]')
        choice.scroll_into_view_if_needed()
        cut = choice.evaluate("c => [...c.querySelectorAll('button')].filter(b => b.scrollWidth > b.clientWidth + 1).map(b => b.innerText)")
        dlg.locator('[data-testid="task-approval-close"]').click()
        rec("approval-choice-readable", not cut, f"labels cut off: {cut or 'none'}")
        p.screenshot(path=str(OUT / "form_approval_choice.png"))
        create = dlg.locator('[data-testid="task-create-submit"]')
        create.scroll_into_view_if_needed()
        cbox = create.bounding_box()
        rec("create-reachable", cbox is not None and cbox["y"] + cbox["height"] <= 844 and cbox["y"] >= 0,
            f"Create at y={cbox and round(cbox['y'])} (screen 844)")
        create.click()
        p.wait_for_timeout(1500)
        body = sent[-1] if sent else {}
        rec("form-payload", body.get("title") == "Phone check: call the dyer" and body.get("approval_stage") == "close"
            and p.locator('[role="dialog"]:visible').count() == 0,
            f"sent title {body.get('title')!r}, approval_stage {body.get('approval_stage')!r}; form closed (POST answered by the script)")
    rec("no-page-errors", not errors, errors[:3] or "none")
    p.unroute_all(behavior="ignoreErrors")
    ctx.close()

    # ---- Sales: no reports, no approvals -------------------------------------------------
    ROLE = "sales"
    ctx, p, errors = session(b, "sales")
    opts = sheet_options(p)
    rec("sales-sheet-options", [o["key"] for o in opts] == ["mine", "asked"], f"{[o['text'] for o in opts]}")
    n = pick(p, "asked")
    rows = api_get(p, "/tasks?view=asked")["body"]
    empty = p.locator('[data-testid="mywork-empty"]').count()
    rec("sales-asked", qs(p).get("view") == "asked" and n == open_count(rows) and (open_count(rows) > 0 or empty == 1),
        f"cards {n} / open {open_count(rows)}; empty state {empty}")
    rec("sales-no-badge", p.locator('[data-testid="work-mobile-view-badge"]').count() == 0, "no approvals count for someone who approves nothing")
    rec("no-page-errors", not errors, errors[:3] or "none")
    p.unroute_all(behavior="ignoreErrors")
    ctx.close()

    # ---- Finance: Sunita manages sai -> My team ---------------------------------------
    ROLE = "finance"
    ctx, p, errors = session(b, "finance")
    opts = sheet_options(p)
    rec("manager-sheet-has-my-team", [o["key"] for o in opts] == ["mine", "asked", "team"], f"{[o['text'] for o in opts]}")
    n = pick(p, "team")
    rows = api_get(p, "/tasks?view=team")["body"]
    rec("manager-my-team", qs(p).get("view") == "team" and (pill_text(p) or "").startswith("My team")
        and n == open_count(rows) and overflow(p) <= 0,
        f"cards {n} / open {open_count(rows)}; pill '{pill_text(p)}'; overflow {overflow(p)}")
    p.screenshot(path=str(OUT / "manager_my_team.png"))
    rec("no-page-errors", not errors, errors[:3] or "none")
    p.unroute_all(behavior="ignoreErrors")
    ctx.close()
    b.close()

(OUT / "results.json").write_text(json.dumps(results, indent=1), encoding="utf-8")
fails = [r for r in results if r["ok"] is False]
print(f"\n{sum(r['ok'] is True for r in results)} pass / {len(fails)} fail -> {OUT / 'results.json'}")
