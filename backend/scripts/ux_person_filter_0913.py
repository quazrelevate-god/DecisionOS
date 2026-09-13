"""ASK-24 acceptance: My Work > All Tasks gets a Person filter and a complete
filter row (Department x Person x Priority x Status, combined counts, Clear,
URL-kept filters, phone filter sheet).

Desktop 1440x900 and phone 390x844, as owner; Sales checked for gating.
Expected numbers come from GET /api/tasks?mine=false, not from the page.
Read-only: every POST/PATCH/PUT/DELETE is aborted after sign-in.
"""
import json
import pathlib
import re
import sys
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from ux_login import demo_login  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

BASE = "http://localhost:3000"
API = "http://localhost:8001/api"
OUT = pathlib.Path(__file__).resolve().parents[2] / ".audit-artifacts" / "ask24_person_filter"
OUT.mkdir(parents=True, exist_ok=True)

results = []


def rec(key, vp, ok, detail):
    results.append({"check": key, "viewport": vp, "ok": ok, "detail": detail})
    print(f"  [{'PASS' if ok is True else 'FAIL' if ok is False else 'INFO'}] {vp:<8} {key}: {detail}", flush=True)


def settle(p, ms=2000):
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


def stable_cards(p, polls=3, ms=300, max_polls=30):
    """After a filter change, wait until the visible card count stops moving."""
    last, same = None, 0
    for _ in range(max_polls):
        n = cards(p)
        same = same + 1 if n == last else 0
        last = n
        if same >= polls:
            break
        p.wait_for_timeout(ms)
    return last


def block_writes(p):
    p.route("**/api/**", lambda r: r.abort()
            if r.request.method in ("POST", "PATCH", "PUT", "DELETE") else r.continue_())


TRUTH_JS = """async (api) => {
  const all = await (await fetch(api + '/tasks?mine=false', {credentials:'include'})).json();
  const now = new Date();
  const term = t => t.status === 'done' || t.status === 'cancelled';
  return all.map(t => ({
    id: t.id, a: t.assignee_id || null, role: t.assignee_role || null,
    term: term(t), od: !!(t.due_date && new Date(t.due_date) < now && !term(t)),
    tier: (t.priority === 'high' || t.priority === 'low') ? t.priority : 'medium',
    status: t.status, type: t.task_type,
  }));
}"""

USERS_JS = """async (api) => (await (await fetch(api + '/users', {credentials:'include'})).json())
  .map(u => ({id: u.id, name: u.name, email: u.email, role: u.role}))"""


def expect(rows, person="", priority="", status="", tab="all"):
    n = 0
    for t in rows:
        if (tab == "completed" or status == "completed") != t["term"]:
            continue
        if tab not in ("all", "completed") and t["type"] != tab:
            continue
        if status == "overdue" and not t["od"]:
            continue
        if status and status not in ("overdue", "completed") and t["status"] != status:
            continue
        if priority and t["tier"] != priority:
            continue
        if person == "unassigned":
            if t["a"] or t["role"]:
                continue
        elif person.startswith("role:"):
            if t["a"] or t["role"] != person[5:]:
                continue
        elif person and t["a"] != person:
            continue
        n += 1
    return n


def cards(p):
    return p.evaluate("""() => [...document.querySelectorAll('[id^="task-card-"]:not([id^="task-card-body-"])')]
      .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).length""")


def trig_text(p, name):
    loc = p.locator(f'[data-testid="work-filter-{name}"]')
    return loc.inner_text().replace("\n", " ").strip() if loc.count() else None


def trig_count(p, name):
    m = re.search(r"(\d+)\s*$", trig_text(p, name) or "")
    return int(m.group(1)) if m else None


def qs(p):
    return {k: v[0] for k, v in parse_qs(urlparse(p.url).query).items()}


def pick(p, name, key):
    p.locator(f'[data-testid="work-filter-{name}"]').click()
    p.wait_for_timeout(400)
    p.locator(f'[data-testid="work-filter-{name}-{key or "all"}"]').click()
    p.wait_for_timeout(800)
    stable_cards(p)


def menu_items(p, name):
    p.locator(f'[data-testid="work-filter-{name}"]').click()
    p.wait_for_timeout(400)
    items = p.evaluate("""() => [...document.querySelectorAll('[role=menu] [role=menuitem]')]
      .map(e => e.innerText.replace(/\\n/g, ' | '))""")
    p.keyboard.press("Escape")
    p.wait_for_timeout(300)
    return items


def phone_view(p, key):
    """Phone pass: pick a view from the view pill's sheet (was a My/All button pair)."""
    p.locator('[data-testid="work-mobile-view"]').click()
    p.locator(f'[data-testid="work-mobile-view-{key}"]').click()
    p.wait_for_timeout(500)


def ensure_ai_off(p, testid):
    b = p.locator(f'[data-testid="{testid}"]')
    if b.count() and b.first.get_attribute("aria-pressed") == "true":
        b.first.click()
        settle(p, 1200)


def owner_desktop(browser):
    VP = "desktop"
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    p = ctx.new_page()
    errors = []
    p.on("pageerror", lambda e: errors.append(str(e)))
    demo_login(p, BASE, "owner")
    block_writes(p)
    p.goto(BASE + "/my-work")
    settle(p)
    ensure_ai_off(p, "ai-priority-toggle")

    p.locator('[data-testid="work-scope-mine"]').click()
    settle(p, 1200)
    rec("my-tasks-hides-person", VP, p.locator('[data-testid="work-filter-person"]').count() == 0,
        f"filters on My Tasks: {[trig_text(p, n) for n in ('department', 'person', 'priority', 'status')]}")

    p.locator('[data-testid="work-scope-all"]').click()
    settle(p)
    rows = p.evaluate(TRUTH_JS, API)
    users = p.evaluate(USERS_JS, API)
    open_total = expect(rows)
    row = [trig_text(p, n) for n in ("department", "person", "status")]
    rec("all-tasks-filter-row", VP, all(row) and cards(p) == open_total,
        f"{row}; cards {cards(p)} / API open {open_total}")

    items = menu_items(p, "person")
    dup = [x for x in set(items) if items.count(x) > 1]
    rec("person-menu-distinct", VP, not dup, f"{len(items)} options; duplicates: {dup or 'none'}; first 8: {items[:8]}")
    status_items = menu_items(p, "status")
    rec("status-options-complete", VP,
        all(any(s in i for i in status_items) for s in ("Pending Approval", "Overdue", "Completed", "Not Started")),
        str(status_items))
    rec("no-priority-filter", VP, p.locator('[data-testid="work-filter-priority"]').count() == 0,
        "Priority dropdown removed (founder call 2026-09-13)")

    open_by = {}
    for t in rows:
        if t["a"] and not t["term"]:
            open_by[t["a"]] = open_by.get(t["a"], 0) + 1
    priya = next((u for u in users if u["name"] == "Priya Nair" and u["id"] in open_by), None) \
        or next(u for u in users if u["id"] in open_by)
    pid = priya["id"]

    pick(p, "person", pid)
    exp = expect(rows, person=pid)
    rec("person-narrows", VP, cards(p) == exp == trig_count(p, "person") and qs(p).get("person") == pid,
        f"{priya['name']}: cards {cards(p)}, trigger {trig_count(p, 'person')}, API {exp}, url person={qs(p).get('person') == pid}")
    pressed = p.locator('[data-testid="work-filter-person"]').get_attribute("aria-pressed")
    rec("active-filter-pressed", VP, pressed == "true" and p.locator('[data-testid="work-filters-clear"]').count() == 1,
        f"person aria-pressed={pressed}, Clear filters shown={p.locator('[data-testid=work-filters-clear]').count() == 1}")
    names_on_cards = p.evaluate("""(n) => [...document.querySelectorAll('[id^="task-card-"]:not([id^="task-card-body-"])')]
      .filter(c => [...c.querySelectorAll('span')].some(s => s.children.length <= 1 && s.innerText.trim() === n)).length""",
                                priya["name"])
    rec("card-name-line-hidden", VP, names_on_cards == 0, f"cards still showing the name line: {names_on_cards}")

    pick(p, "status", "overdue")
    exp = expect(rows, person=pid, status="overdue")
    dept_all = trig_count(p, "department")
    rec("person-x-overdue", VP, cards(p) == exp and dept_all == exp,
        f"cards {cards(p)}, API {exp}, Department 'All' count now {dept_all} (reflects other filters)")
    p.screenshot(path=str(OUT / "desktop_person_overdue.png"))

    p.reload()
    settle(p)
    rec("refresh-keeps-filters", VP,
        cards(p) == exp and qs(p).get("status") == "overdue" and qs(p).get("person") == pid,
        f"after reload: cards {cards(p)}, url {qs(p)}, row {[trig_text(p, n) for n in ('person', 'status')]}")

    p.goto(f"{BASE}/my-work?person={pid}&status=overdue&priority=high")
    settle(p)
    rec("stale-priority-link-ignored", VP, cards(p) == exp,
        f"?priority=high left in an old link: cards {cards(p)} = Priya x Overdue {exp} (not narrowed)")

    before = cards(p)
    p.locator('[data-testid="work-filters-clear"]').click()
    # The address clears at once and the list redraws about a second later
    # (traced on the merged glass page), so wait for the count to move first.
    for _ in range(30):
        if cards(p) != before:
            break
        p.wait_for_timeout(250)
    stable_cards(p)
    left = {k: v for k, v in qs(p).items() if k in ("person", "status", "priority", "filter")}
    rec("clear-filters", VP,
        cards(p) == open_total and not left and p.locator('[data-testid="work-filters-clear"]').count() == 0,
        f"cards {cards(p)} / {open_total}; url filters left {left}")

    pick(p, "person", "unassigned")
    exp = expect(rows, person="unassigned")
    rec("unassigned", VP, cards(p) == exp, f"cards {cards(p)}, API {exp}")
    role_opt = None
    p.locator('[data-testid="work-filter-person"]').click()
    p.wait_for_timeout(400)
    role_ids = p.evaluate("""() => [...document.querySelectorAll('[data-testid^="work-filter-person-role:"]')]
      .map(e => e.getAttribute('data-testid').replace('work-filter-person-', ''))""")
    p.keyboard.press("Escape")
    p.wait_for_timeout(300)
    if role_ids:
        role_opt = role_ids[0]
        pick(p, "person", role_opt)
        exp = expect(rows, person=role_opt)
        rec("team-queue", VP, cards(p) == exp, f"{role_opt}: cards {cards(p)}, API {exp}")
    else:
        rec("team-queue", VP, None, "no role-only tasks in this workspace")
    pick(p, "person", "")

    for key in ("blocked", "completed", "todo"):
        pick(p, "status", key)
        exp = expect(rows, status=key)
        rec(f"status-{key}", VP, cards(p) == exp == trig_count(p, "status"),
            f"cards {cards(p)}, trigger {trig_count(p, 'status')}, API {exp}")
    pick(p, "status", "")

    zero = None
    for uid, n in open_by.items():
        for st in ("review", "waiting", "in_progress", "blocked", "todo"):
            if expect(rows, person=uid, status=st) == 0:
                zero = (uid, st)
                break
        if zero:
            break
    if zero:
        p.goto(f"{BASE}/my-work?person={zero[0]}&status={zero[1]}")
        settle(p)
        empty = p.locator('[data-testid="mywork-empty-filtered"]')
        txt = empty.inner_text().replace("\n", " ") if empty.count() else None
        ok = bool(txt) and "No tasks match" in txt
        if empty.count():
            p.locator('[data-testid="mywork-empty-filtered-cta"]').click()
            p.wait_for_timeout(900)
            stable_cards(p)
        rec("no-match-empty-state", VP, ok and cards(p) == open_total,
            f"'{txt}'; after its Clear: cards {cards(p)} / {open_total}")

    p.locator('[data-testid="work-filter-person"]').click()
    p.wait_for_timeout(400)
    search = p.locator('[data-testid="work-filter-person-search"]')
    if search.count():
        needle = priya["name"].split()[0][:3].lower()
        search.fill(needle)
        p.wait_for_timeout(400)
        shown = p.evaluate("""() => [...document.querySelectorAll('[role=menu] [role=menuitem]')].map(e => e.innerText.split('\\n')[0])""")
        rec("person-search", VP, bool(shown) and all(needle in s.lower() or s == "All people" for s in shown),
            f"typed '{needle}' -> {shown}")
        p.screenshot(path=str(OUT / "desktop_person_search.png"))
    else:
        rec("person-search", VP, None, "8 or fewer people: no search box, by design")
    p.keyboard.press("Escape")

    p.goto(BASE + "/my-work?filter=overdue")
    settle(p)
    exp = expect(rows, status="overdue")
    rec("desk-overdue-link", VP,
        qs(p).get("status") == "overdue" and "filter" not in qs(p) and "Overdue" in (trig_text(p, "status") or "") and cards(p) == exp,
        f"url {qs(p)}, status trigger '{trig_text(p, 'status')}', cards {cards(p)} / API {exp}")

    other = next((t for t in rows if not t["term"] and t["a"] and t["a"] != pid), None)
    if other:
        p.goto(f"{BASE}/my-work?person={pid}&status=review&task={other['id']}")
        settle(p, 3000)
        # The filters are dropped once the linked task has loaded; give it time.
        for _ in range(30):
            if "person" not in qs(p) and p.locator(f'[id="task-card-{other["id"]}"]').count():
                break
            p.wait_for_timeout(300)
        vis = p.locator(f'[id="task-card-{other["id"]}"]').count()
        rec("deep-link-task-clears-filters", VP, vis == 1 and "person" not in qs(p),
            f"task card present={vis == 1}, url {qs(p)}")

    rec("no-page-errors", VP, not errors, errors[:3] or "none")
    p.unroute_all(behavior="ignoreErrors")
    ctx.close()
    return rows, users, pid, priya["name"]


def owner_phone(browser, rows, pid, pname):
    VP = "phone"
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    p = ctx.new_page()
    errors = []
    p.on("pageerror", lambda e: errors.append(str(e)))
    demo_login(p, BASE, "owner")
    block_writes(p)
    p.goto(BASE + "/my-work")
    settle(p)
    ensure_ai_off(p, "work-mobile-priority")
    phone_view(p, "all")
    settle(p)
    open_total = expect(rows)

    p.locator('[data-testid="work-mobile-category"]').click()
    p.wait_for_timeout(700)
    sheet = p.locator('[data-testid="work-mobile-filter-sheet"]')
    groups = [g for g in ("department", "person", "priority", "status")
              if p.locator(f'[data-testid="work-sheet-{g}"]').count()]
    box = sheet.bounding_box() if sheet.count() else None
    rec("sheet-opens-with-three-filters", VP, groups == ["department", "person", "status"] and box and box["y"] >= 0,
        f"groups {groups}; sheet box {box and {k: round(v) for k, v in box.items()}}")
    chip_labels = p.evaluate("""() => [...document.querySelectorAll('[data-testid="work-sheet-person"] button')].map(b => b.innerText.replace(/\\n/g,' '))""")
    base_labels = [re.sub(r"\s+\d+$", "", x) for x in chip_labels]
    dup = [x for x in set(base_labels) if base_labels.count(x) > 1]
    rec("sheet-person-chips-distinct", VP, not dup, f"{len(chip_labels)} chips; duplicates: {dup or 'none'}")

    p.locator(f'[data-testid="work-sheet-person-{pid}"]').click()
    p.wait_for_timeout(500)
    p.locator('[data-testid="work-sheet-status-overdue"]').click()
    p.wait_for_timeout(600)
    exp = expect(rows, person=pid, status="overdue")
    done = p.locator('[data-testid="work-sheet-done"]')
    reach = p.evaluate("""() => ['work-sheet-done','work-sheet-clear'].map(id => {
      const b = document.querySelector('[data-testid="'+id+'"]'); const r = b.getBoundingClientRect();
      const h = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2);
      return {id, h: Math.round(r.height), inView: r.bottom <= innerHeight && r.top >= 0, reachable: !!h && b.contains(h)};
    })""")
    rec("sheet-buttons-reachable", VP, all(x["inView"] and x["reachable"] and x["h"] >= 44 for x in reach), str(reach))
    p.screenshot(path=str(OUT / "phone_sheet.png"))
    done_txt = done.inner_text()
    done.click()
    p.wait_for_timeout(900)
    cap = p.locator('[data-testid="work-mobile-filter-caption"]')
    cap_txt = cap.inner_text().replace("\n", " ") if cap.count() else None
    rec("phone-person-x-overdue", VP,
        cards(p) == exp and f"Show {exp} " in done_txt + " " and cap_txt and pname in cap_txt and "Overdue" in cap_txt,
        f"'{done_txt}', cards {cards(p)}, API {exp}, caption '{cap_txt}'")
    overflow = p.evaluate("() => document.documentElement.scrollWidth - innerWidth")
    rec("no-horizontal-overflow", VP, overflow <= 0, f"scrollWidth - innerWidth = {overflow}")
    p.screenshot(path=str(OUT / "phone_filtered.png"))

    p.locator('[data-testid="work-mobile-filter-clear"]').click()
    p.wait_for_timeout(900)
    stable_cards(p)
    rec("phone-caption-clear", VP,
        cards(p) == open_total and p.locator('[data-testid="work-mobile-filter-caption"]').count() == 0,
        f"cards {cards(p)} / {open_total}")

    p.goto(BASE + "/my-work?status=overdue")
    settle(p)
    cap = p.locator('[data-testid="work-mobile-filter-caption"]')
    rec("phone-status-visible-without-ai", VP, cap.count() == 1 and "Overdue" in cap.inner_text(),
        f"caption {cap.inner_text() if cap.count() else None}")

    phone_view(p, "mine")
    settle(p, 1200)
    p.locator('[data-testid="work-mobile-category"]').click()
    p.wait_for_timeout(700)
    rec("phone-my-tasks-no-person", VP, p.locator('[data-testid="work-sheet-person"]').count() == 0
        and p.locator('[data-testid="work-sheet-status"]').count() == 1, "sheet on My Tasks")
    p.keyboard.press("Escape")

    rec("no-page-errors", VP, not errors, errors[:3] or "none")
    p.unroute_all(behavior="ignoreErrors")
    ctx.close()


def sales(browser):
    for VP, vp, mobile in (("desktop", {"width": 1440, "height": 900}, False), ("phone", {"width": 390, "height": 844}, True)):
        ctx = browser.new_context(viewport=vp, is_mobile=mobile, has_touch=mobile)
        p = ctx.new_page()
        demo_login(p, BASE, "sales")
        block_writes(p)
        p.goto(BASE + "/my-work?person=anyone")
        settle(p)
        if mobile:
            p.locator('[data-testid="work-mobile-category"]').click()
            p.wait_for_timeout(700)
            ok = p.locator('[data-testid="work-sheet-person"]').count() == 0 and p.locator('[data-testid="work-sheet-status"]').count() == 1
            detail = "sheet has Status, no Person"
        else:
            ok = p.locator('[data-testid="work-filter-person"]').count() == 0 and p.locator('[data-testid="work-filter-status"]').count() == 1
            detail = str([trig_text(p, n) for n in ("department", "person", "priority", "status")])
        own = cards(p)
        rec("sales-no-person-filter", VP, ok and own > 0 or ok, f"{detail}; ?person=anyone ignored, {own} own cards shown")
        p.unroute_all(behavior="ignoreErrors")
        ctx.close()


with sync_playwright() as pw:
    browser = pw.chromium.launch()
    print("== owner desktop", flush=True)
    rows, users, pid, pname = owner_desktop(browser)
    print("== owner phone", flush=True)
    owner_phone(browser, rows, pid, pname)
    print("== sales", flush=True)
    sales(browser)
    browser.close()

(OUT / "results.json").write_text(json.dumps(results, indent=1), encoding="utf-8")
fails = [r for r in results if r["ok"] is False]
print(f"\n{sum(r['ok'] is True for r in results)} pass / {len(fails)} fail / "
      f"{sum(r['ok'] is None for r in results)} info  -> {OUT / 'results.json'}")
