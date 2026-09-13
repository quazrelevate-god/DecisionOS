"""ASK-28 TK-07 acceptance (plan Phase 3): stages and the Waiting on flag —
desktop (1440x900) + a phone check.

  - Cards and the drawer show stages (To do / Doing / Done), never the old
    status words; the status picker offers To do and Doing.
  - The Status filter: To do, Doing, Waiting on someone, Needs approval, Overdue,
    Due today, Done — counts match the server's tasks; old ?status=blocked links
    land on Needs approval.
  - Waiting on: pick "Waiting on someone…", type a supplier, Save -> the drawer
    box and the card flag say who and how long; Stop waiting ends it.

Real data, read-only. Every POST/PATCH/PUT/DELETE after sign-in is aborted. The
waiting journey runs on one made-up task added to the list and opened by link;
its PATCHes are answered by the script, which keeps the made-up task's state.
"""
import copy
import json
import pathlib
import sys
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from ux_login import demo_login  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

BASE = "http://localhost:3000"
API = "http://localhost:8001/api"
OUT = pathlib.Path(__file__).resolve().parents[2] / ".audit-artifacts" / "ask28_stages"
OUT.mkdir(parents=True, exist_ok=True)
results = []
VP = "desktop"
TERMINAL = {"done", "cancelled"}
OLD_WORDS = ("Not Started", "In Progress", "Under Review", "Pending Approval")
STAGE = {"todo": ("todo", "blocked"), "in_progress": ("in_progress", "waiting", "review")}


def rec(key, ok, detail):
    results.append({"check": key, "viewport": VP, "ok": ok, "detail": detail})
    print(f"  [{'PASS' if ok is True else 'FAIL' if ok is False else 'INFO'}] {VP:<8} {key}: {detail}", flush=True)


def api_get(p, path):
    return p.evaluate("async ([a, x]) => { const r = await fetch(a + x, {credentials: 'include'}); let b = null; try { b = await r.json(); } catch (e) {} return {status: r.status, body: b}; }", [API, path])


def qs(p):
    return {k: v[0] for k, v in parse_qs(urlparse(p.url).query).items()}


def cards(p):
    return p.evaluate("""() => [...document.querySelectorAll('[id^="task-card-"]:not([id^="task-card-body-"])')]
      .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).length""")


def wait_for(p, fn, ms=8000):
    for _ in range(ms // 250):
        if fn():
            return True
        p.wait_for_timeout(250)
    return False


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


def settle(p, ms=2500):
    p.wait_for_timeout(ms)
    ready = '[id^="task-card-"]:visible, [data-testid="mywork-empty"], [data-testid="mywork-empty-filtered"]'
    for _ in range(24):
        if (p.locator(".animate-pulse:visible, .ds-skeleton:visible, [data-skeleton]:visible").count() == 0
                and p.locator(ready).count() > 0):
            break
        p.wait_for_timeout(500)
    stable_cards(p)


def expect(rows, status):
    n = 0
    for t in rows:
        term = t.get("status") in TERMINAL
        if (status == "completed") != term:
            continue
        if status in STAGE and t.get("status") not in STAGE[status]:
            continue
        if status == "waiting" and t.get("status") != "waiting":
            continue
        if status == "approval" and not (t.get("status") == "blocked" or (t.get("approval_required") and t.get("approval_status") == "pending")):
            continue
        n += 1
    return n


def toasts(p):
    return " | ".join(x.strip() for x in p.locator("[data-sonner-toast]").all_inner_texts())


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
    colleague = next(u for u in users if u["id"] != me["id"] and u.get("role") == "finance")

    state = {"fake": None}
    patches = []

    def route(r):
        req = r.request
        path = req.url.split("?")[0].rstrip("/")
        fake = state["fake"]
        if fake and path.endswith(f"/api/tasks/{fake['id']}"):
            if req.method == "GET":
                return r.fulfill(status=200, content_type="application/json", body=json.dumps(fake))
            if req.method == "PATCH":
                body = json.loads(req.post_data or "{}")
                patches.append(body)
                if "waiting_on" in body:
                    spec = body["waiting_on"] or {}
                    if spec:
                        member = next((u for u in users if u["id"] == spec.get("user_id")), None)
                        fake.update(status="waiting", waiting_on={
                            "user_id": member["id"] if member else None,
                            "name": member["name"] if member else spec.get("name"),
                            "since": datetime.now(timezone.utc).isoformat(), "set_by": me["id"]})
                    else:
                        fake.update(status="in_progress", waiting_on=None)
                elif "status" in body:
                    fake.update(status=body["status"], waiting_on=None if body["status"] != "waiting" else fake.get("waiting_on"))
                return r.fulfill(status=200, content_type="application/json", body=json.dumps(fake))
        if fake and req.method == "GET" and path.endswith(f"/api/tasks/{fake['id']}/activity"):
            return r.fulfill(status=200, content_type="application/json", body="[]")
        if fake and req.method == "GET" and path.endswith("/api/tasks") and "view=" not in req.url:
            resp = r.fetch()
            rows = resp.json()
            return r.fulfill(response=resp, body=json.dumps([t for t in rows if t["id"] != fake["id"]] + [copy.deepcopy(fake)]))
        if req.method in ("POST", "PATCH", "PUT", "DELETE"):
            return r.abort()
        return r.continue_()

    p.route("**/api/**", route)
    p.goto(BASE + "/my-work?view=all")
    settle(p)
    rows = api_get(p, "/tasks?mine=false")["body"]

    # ---- Stage words on the cards -----------------------------------------------------
    chips = p.evaluate("""() => [...document.querySelectorAll('[data-testid^="status-chip-"]')]
      .filter(e => e.getBoundingClientRect().width > 0).map(e => e.innerText.trim())""")
    old = sorted({c for c in chips if any(w in c for w in OLD_WORDS)})
    rec("cards-show-stages", bool(chips) and not old and set(chips) <= {"To do", "Doing", "Done", "Cancelled"},
        f"{len(chips)} chips, labels {sorted(set(chips))}; old words left: {old or 'none'}")

    # ---- Status filter -----------------------------------------------------------------
    p.locator('[data-testid="work-filter-status"]').click()
    p.wait_for_timeout(500)
    items = [x.split("\n")[0].strip() for x in p.locator('[role=menu] [role=menuitem]').all_inner_texts()]
    p.keyboard.press("Escape")
    p.wait_for_timeout(400)
    rec("filter-options", items[:8] == ["All statuses", "To do", "Doing", "Waiting on someone", "Needs approval", "Overdue", "Due today", "Done"],
        f"{items}")
    counts = {}
    for key in ("todo", "in_progress", "approval"):
        p.locator('[data-testid="work-filter-status"]').click()
        p.wait_for_timeout(400)
        p.locator(f'[data-testid="work-filter-status-{key}"]').click()
        p.wait_for_timeout(900)
        counts[key] = (stable_cards(p), expect(rows, key))
    rec("filter-counts-match-server", all(a == e for a, e in counts.values()),
        f"cards/API: {counts}")
    p.goto(BASE + "/my-work?view=all&status=blocked")
    settle(p)
    trig = p.locator('[data-testid="work-filter-status"]').inner_text().replace("\n", " ")
    rec("old-link-lands-on-needs-approval", "Needs approval" in trig and cards(p) == expect(rows, "approval"),
        f"?status=blocked -> '{trig}', cards {cards(p)} / {expect(rows, 'approval')}")

    # ---- Waiting on (made-up task) ----------------------------------------------------------
    base = next(t for t in rows if t.get("status") == "in_progress" and not t.get("approval_required")) \
        if any(t.get("status") == "in_progress" and not t.get("approval_required") for t in rows) else rows[0]
    state["fake"] = {**copy.deepcopy(base), "id": "fake-waiting", "title": "TK-07 check: dye the sample lot",
                     "status": "in_progress", "approval_required": False, "approval_status": None,
                     "assignee_id": me["id"], "assignee_name": me.get("name"), "co_assignee_ids": [], "co_assignees": [],
                     "waiting_on": None, "execution_plan": None, "updates": [], "attachments": [], "due_date": None}
    p.goto(BASE + "/my-work?view=all&task=fake-waiting")
    wait_for(p, lambda: p.locator('[data-testid="task-waiting-start-fake-waiting"]:visible').count() > 0, ms=12000)
    sel_opts = []
    if p.locator('[data-testid="status-select-fake-waiting"]:visible').count():
        p.locator('[data-testid="status-select-fake-waiting"]:visible').click()
        p.wait_for_timeout(400)
        sel_opts = [x.strip() for x in p.locator('[role="option"]').all_inner_texts()]
        p.keyboard.press("Escape")
        p.wait_for_timeout(300)
    rec("status-picker-two-stages", sel_opts == ["To do", "Doing"], f"options {sel_opts}")

    p.locator('[data-testid="task-waiting-start-fake-waiting"]:visible').click()
    p.locator('[data-testid="task-waiting-name-fake-waiting"]:visible').fill("Kumar Fabrics (supplier)")
    p.locator('[data-testid="task-waiting-save-fake-waiting"]:visible').click()
    wait_for(p, lambda: p.locator('[data-testid="task-waiting-fake-waiting"]:visible').count() > 0)
    box = p.locator('[data-testid="task-waiting-fake-waiting"]:visible')
    box_txt = box.first.inner_text().replace("\n", " ") if box.count() else None
    rec("waiting-on-a-supplier", patches[-1:] == [{"waiting_on": {"name": "Kumar Fabrics (supplier)"}}]
        and bool(box_txt) and "Waiting on Kumar Fabrics (supplier)" in box_txt and "today" in box_txt,
        f"PATCH {patches[-1:]}; box '{box_txt}' (answered by the script)")
    p.screenshot(path=str(OUT / "drawer_waiting.png"))
    chip = p.locator('[data-testid="status-chip-fake-waiting"]')
    p.keyboard.press("Escape")
    p.wait_for_timeout(1200)
    pill = p.locator('[data-testid="waiting-pill-fake-waiting"]:visible')
    rec("card-flag-and-stage", pill.count() == 1 and "Waiting on Kumar Fabrics" in pill.inner_text()
        and chip.count() and chip.first.inner_text().strip() == "Doing",
        f"card pill '{pill.inner_text().strip() if pill.count() else None}', chip '{chip.first.inner_text().strip() if chip.count() else None}'")
    p.locator('[data-testid="work-filter-status"]').click()
    p.wait_for_timeout(400)
    p.locator('[data-testid="work-filter-status-waiting"]').click()
    p.wait_for_timeout(900)
    n = stable_cards(p)
    rec("filter-waiting-on-someone", n == expect(rows, "waiting") + 1,
        f"cards {n} = stored waiting {expect(rows, 'waiting')} + the made-up one")
    p.screenshot(path=str(OUT / "filter_waiting.png"))

    # Waiting on a colleague, then Stop waiting.
    p.goto(BASE + "/my-work?view=all&task=fake-waiting")
    wait_for(p, lambda: p.locator('[data-testid="task-waiting-stop-fake-waiting"]:visible').count() > 0, ms=12000)
    p.locator('[data-testid="task-waiting-stop-fake-waiting"]:visible').click()
    wait_for(p, lambda: p.locator('[data-testid="task-waiting-start-fake-waiting"]:visible').count() > 0)
    rec("stop-waiting", patches[-1] == {"waiting_on": {}} and p.locator('[data-testid="task-waiting-fake-waiting"]:visible').count() == 0,
        f"PATCH {patches[-1]}; box gone, back to Doing")
    p.locator('[data-testid="task-waiting-start-fake-waiting"]:visible').click()
    p.locator('[data-testid="task-waiting-person-fake-waiting"]:visible').click()
    p.locator(f'[data-testid="task-waiting-person-fake-waiting-option-{colleague["id"]}"]').click()
    p.wait_for_timeout(300)
    p.locator('[data-testid="task-waiting-save-fake-waiting"]:visible').click()
    wait_for(p, lambda: p.locator('[data-testid="task-waiting-fake-waiting"]:visible').count() > 0)
    box_txt = p.locator('[data-testid="task-waiting-fake-waiting"]:visible').first.inner_text().replace("\n", " ") \
        if p.locator('[data-testid="task-waiting-fake-waiting"]:visible').count() else None
    rec("waiting-on-a-colleague", patches[-1] == {"waiting_on": {"user_id": colleague["id"]}}
        and bool(box_txt) and f"Waiting on {colleague['name']}" in box_txt,
        f"PATCH {patches[-1]}; box '{box_txt}'")
    # Choosing Doing in the picker ends the wait too (it sends status in_progress).
    rec("no-page-errors", not errors, errors[:3] or "none")
    p.unroute_all(behavior="ignoreErrors")
    ctx.close()

    # ---- Phone ------------------------------------------------------------------------------
    VP = "phone"
    ctx = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    p = ctx.new_page()
    errors = []
    p.on("pageerror", lambda e: errors.append(str(e)))
    demo_login(p, BASE, "owner")
    state["fake"]["status"] = "waiting"
    state["fake"]["waiting_on"] = {"user_id": None, "name": "Kumar Fabrics (supplier)",
                                   "since": (datetime.now(timezone.utc) - timedelta(days=3)).isoformat(), "set_by": me["id"]}
    p.route("**/api/**", route)
    p.goto(BASE + "/my-work?view=all&task=fake-waiting")
    wait_for(p, lambda: p.locator('[data-testid="task-waiting-fake-waiting"]:visible').count() > 0, ms=12000)
    pills = p.evaluate("""() => [...document.querySelectorAll('[data-testid^="status-pill-m-"]')]
      .filter(e => e.getBoundingClientRect().width > 0).map(e => e.innerText.trim() + (e.getAttribute('aria-pressed') === 'true' ? '*' : ''))""")
    box_txt = p.locator('[data-testid="task-waiting-fake-waiting"]:visible').first.inner_text().replace("\n", " ") \
        if p.locator('[data-testid="task-waiting-fake-waiting"]:visible').count() else None
    over = p.evaluate("() => document.documentElement.scrollWidth - innerWidth")
    rec("phone-stages-and-waiting", pills == ["To do", "Doing*"] and bool(box_txt) and "3 days" in box_txt and over <= 0,
        f"pills {pills}; box '{box_txt}'; overflow {over}")
    p.screenshot(path=str(OUT / "phone_waiting.png"))
    rec("no-page-errors", not errors, errors[:3] or "none")
    p.unroute_all(behavior="ignoreErrors")
    ctx.close()
    b.close()

(OUT / "results.json").write_text(json.dumps(results, indent=1), encoding="utf-8")
fails = [r for r in results if r["ok"] is False]
print(f"\n{sum(r['ok'] is True for r in results)} pass / {len(fails)} fail -> {OUT / 'results.json'}")
