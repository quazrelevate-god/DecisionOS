"""Leave, from a phone and from My Work — browser acceptance with REAL saves on
a THROWAWAY database.

Run against a scratch backend and the frontend (defaults: backend 8002,
frontend 5174 — the ports this was checked on while another session held
8001/5173):

    python scripts/ux_leave_0919.py

Yokesh, 2026-09-19: "in the mobile PWA, Leave redirects to the Team section.
It has to go to the leave section, where we can raise a leave request, and it
has to show the leave history. Don't add a leave approval section — that's in
Approvals. On desktop, in My Work, just add a Request leave button."

ASK-6 (2026-09-12) had retired /leave and pointed the phone's Leave tile at
/team, so a phone had no way to ask for time off at all.

As a regular team member (the Sales demo seat):
  phone — More › Leave opens /leave; request leave; report an absence; both
          show in the page with the right sections and counts; no approvals
          and no settings on the page;
  desktop — My Work has Request Leave beside New task, and it files a request.
"""
import json
import os
import pathlib
import sys
from datetime import date, timedelta

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from playwright.sync_api import sync_playwright  # noqa: E402
from ux_login import demo_login  # noqa: E402

BASE = os.environ.get("UX_BASE", "http://localhost:5174")
API = os.environ.get("UX_API", "http://localhost:8002/api")
DB_NAME = os.environ.get("UX_DB", "dos_uicheck_leave")
OUT = pathlib.Path(__file__).resolve().parents[2] / ".audit-artifacts" / "leave"
OUT.mkdir(parents=True, exist_ok=True)
results = []


def rec(key, ok, detail):
    results.append({"check": key, "ok": ok, "detail": detail})
    print(f"  [{'PASS' if ok is True else 'FAIL' if ok is False else 'INFO'}] {key}: {detail}", flush=True)


def wait_id(p, testid, timeout=20000):
    try:
        p.locator(f'[data-testid="{testid}"]').first.wait_for(state="visible", timeout=timeout)
        return True
    except Exception:
        return False


def _db():
    from dotenv import load_dotenv
    from pymongo import MongoClient
    load_dotenv(pathlib.Path(__file__).resolve().parents[1] / ".env")
    return MongoClient(os.environ["MONGO_URL"], serverSelectionTimeoutMS=15000)[DB_NAME]


def my_leaves(email):
    u = _db().users.find_one({"email": email}) or {}
    return list(_db().leaves.find({"user_id": u.get("id")}, {"_id": 0}))


with sync_playwright() as pw:
    b = pw.chromium.launch()
    errors = []
    who = "sales@sharma.com"
    before = len(my_leaves(who))

    # ------------------------------------------------ phone
    mctx = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    m = mctx.new_page()
    m.on("pageerror", lambda e: errors.append(str(e)))
    demo_login(m, base=BASE, role="sales")
    m.goto(f"{BASE}/inbox", wait_until="domcontentloaded")
    m.wait_for_timeout(3000)
    # More › Leave, the way a person gets there
    wait_id(m, "dock-more", 20000)
    m.locator('[data-testid="dock-more"]').first.click()
    has_tile = wait_id(m, "allapps-tile-leave", 10000)   # the panel animates open
    rec("more-menu-has-a-leave-tile", has_tile, "in the phone's More menu")
    m.screenshot(path=str(OUT / "0_more_menu.png"))
    if has_tile:
        m.locator('[data-testid="allapps-tile-leave"]').first.click()
    else:
        m.goto(f"{BASE}/leave", wait_until="domcontentloaded")
    rec("leave-opens-the-leave-page-not-team", wait_id(m, "leave-page", 20000) and "/leave" in m.url, m.url)
    m.wait_for_timeout(1500)
    page_text = m.locator('[data-testid="leave-page"]').first.inner_text()
    rec("no-approvals-or-settings-here", m.locator('[data-testid="leave-tab-approvals"]').count() == 0
        and m.locator('[data-testid="leave-settings-toggle"]').count() == 0, "approving lives in Approvals")
    m.screenshot(path=str(OUT / "1_phone_leave_empty.png"))

    # request leave
    start = (date.today() + timedelta(days=7)).isoformat()
    end = (date.today() + timedelta(days=8)).isoformat()
    m.locator('[data-testid="request-leave-button"]').first.click()
    wait_id(m, "leave-submit", 8000)
    m.locator('[data-testid="leave-from-date"]').first.fill(start)
    m.locator('[data-testid="leave-to-date"]').first.fill(end)
    m.locator('[data-testid="leave-reason-input"]').first.fill("Cousin's wedding in Madurai")
    m.screenshot(path=str(OUT / "2_phone_request_form.png"))
    m.locator('[data-testid="leave-submit"]').first.click()
    m.wait_for_timeout(3000)
    after = my_leaves(who)
    new = [lv for lv in after if lv.get("from_date") == start and lv.get("reason", "").startswith("Cousin")]
    rec("request-is-saved", len(after) == before + 1 and bool(new), f"{len(after) - before} new, {new[0]['status'] if new else '-'}")
    lid = new[0]["id"] if new else ""
    rec("it-shows-under-coming-up", m.locator(f'[data-testid="leave-upcoming"] [data-testid="leave-card-{lid}"]').count() == 1,
        "with its dates and status")

    # report an absence
    m.locator('[data-testid="report-absence-button"]').first.click()
    wait_id(m, "absence-submit", 8000)
    m.locator('[data-testid="absence-submit"]').first.click()
    m.wait_for_timeout(3000)
    rec("absence-is-saved", len(my_leaves(who)) == before + 2, "today, marked as an emergency")
    waiting = m.locator('[data-testid="leave-summary-waiting"]').first.inner_text().split()[0]
    rec("summary-counts-what-waits", waiting == str(sum(1 for lv in my_leaves(who) if lv["status"] in ("pending", "info_requested"))),
        f"Waiting shows {waiting}")

    # a decided request drops into History
    if lid:
        _db().leaves.update_one({"id": lid}, {"$set": {"status": "rejected", "from_date": "2026-01-05", "to_date": "2026-01-05"}})
        m.reload(wait_until="domcontentloaded")
        wait_id(m, "leave-page", 20000)
        m.wait_for_timeout(2000)
        rec("decided-and-past-requests-sit-in-history",
            m.locator(f'[data-testid="leave-history"] [data-testid="leave-card-{lid}"]').count() == 1, "History")
    m.screenshot(path=str(OUT / "3_phone_leave_history.png"), full_page=True)

    # a notification about it opens it here, highlighted
    m.goto(f"{BASE}/leave?leave={lid}", wait_until="domcontentloaded")
    wait_id(m, "leave-page", 20000)
    m.wait_for_timeout(1500)
    card = m.locator(f'[data-testid="leave-card-{lid}"]').first
    rec("a-link-to-a-request-highlights-it", "ring-2" in (card.get_attribute("class") or ""), "?leave=<id>")

    # ------------------------------------------------ desktop, My Work
    dctx = b.new_context(viewport={"width": 1440, "height": 950})
    d = dctx.new_page()
    d.on("pageerror", lambda e: errors.append(str(e)))
    demo_login(d, base=BASE, role="sales")
    d.goto(f"{BASE}/my-work", wait_until="domcontentloaded")
    rec("my-work-has-request-leave", wait_id(d, "request-leave-button", 30000), "beside New task")
    d.wait_for_timeout(800)
    d.screenshot(path=str(OUT / "4_desktop_mywork.png"))
    count0 = len(my_leaves(who))
    d.locator('[data-testid="request-leave-button"]').first.click()
    wait_id(d, "leave-submit", 8000)
    s2 = (date.today() + timedelta(days=14)).isoformat()
    d.locator('[data-testid="leave-from-date"]').first.fill(s2)
    d.locator('[data-testid="leave-to-date"]').first.fill(s2)
    d.locator('[data-testid="leave-reason-input"]').first.fill("Bank work")
    d.screenshot(path=str(OUT / "5_desktop_form.png"))
    d.locator('[data-testid="leave-submit"]').first.click()
    d.wait_for_timeout(3000)
    rec("my-work-files-the-request", len(my_leaves(who)) == count0 + 1, "same form, same save")
    rec("and-stays-on-my-work", "/my-work" in d.url, d.url)

    rec("no-page-errors", errors == [], str(errors[:2]))
    b.close()

pathlib.Path(OUT / "results.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
ok = sum(1 for r in results if r["ok"] is True)
bad = sum(1 for r in results if r["ok"] is False)
print(f"\n{ok} pass / {bad} fail -> {OUT / 'results.json'}")
