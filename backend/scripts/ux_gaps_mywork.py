"""Close the three open coverage gaps on My Work.

Each of these was left BLOCKED or N/A by ux_lifecycle_mywork.py. They are settled
here by reading the SERVER's truth (a direct API call from inside the signed-in
page) rather than the card, so MW-01's stale re-render cannot mask a result.

  Gap 1  progress % and the work trail actually persist
  Gap 2  a task assigned to a colleague reaches THAT colleague's My Work
         (keyed to the demo login's real user id, which the first attempt got wrong)
  Gap 3  bulk complete and bulk reassign, fired only at throwaway rows

WRITES TO THE DEV DB. Everything it makes is titled "[UXTEST] ..." and deleted at
the end, including on failure.

    .venv/Scripts/python.exe scripts/ux_gaps_mywork.py
"""
import json
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

from ux_login import demo_login

REPO = Path(__file__).resolve().parent.parent.parent
BASE = "http://localhost:3000"
API = "http://localhost:8001"
OUT = REPO / ".audit-artifacts" / "ux" / "my-work" / "gaps"
TAG = "[UXTEST]"

DEMO = {"owner": "owner@sharma.com", "sales": "sales@sharma.com",
        "production": "production@sharma.com", "finance": "finance@sharma.com"}

results = []


def rec(gap, step, ok, detail=""):
    status = "PASS" if ok is True else ("FAIL" if ok is False else "INFO")
    results.append({"gap": gap, "step": step, "status": status, "detail": detail})
    print(f"  {status:<4} [{gap}] {step}" + (f"  -- {detail}" if detail else ""))


# --------------------------------------------------------------------------
# Talk to the API as the signed-in user, from inside the page.
# --------------------------------------------------------------------------
APIJS = """
async ([method, path, body]) => {
  const be = %r;
  const tok = localStorage.getItem('token') || localStorage.getItem('dos_token') ||
    Object.keys(localStorage).filter(k=>/token/i.test(k)).map(k=>localStorage.getItem(k))[0];
  const h = {'Content-Type':'application/json'};
  if (tok) h['Authorization'] = 'Bearer ' + String(tok).replace(/^"|"$/g,'');
  const r = await fetch(be + path, {method, headers:h, credentials:'include',
                                    body: body ? JSON.stringify(body) : undefined});
  let data = null; try { data = await r.json(); } catch (e) {}
  return {status: r.status, data};
}
""" % API


def api(page, method, path, body=None):
    return page.evaluate(APIJS, [method, path, body])


def settle(p, timeout=20000):
    try:
        p.wait_for_function(
            """() => document.querySelectorAll('[class*="animate-pulse"]').length === 0""",
            timeout=timeout)
    except Exception:
        pass
    p.wait_for_timeout(450)


def login(page, role):
    demo_login(page, BASE, role)


def work(page):
    page.goto(f"{BASE}/my-work", wait_until="domcontentloaded")
    try:
        page.wait_for_load_state("networkidle", timeout=15000)
    except Exception:
        pass
    page.wait_for_timeout(1300)
    settle(page)


def L(page, tid):
    return page.locator(f'[data-testid="{tid}"]:visible').first


def has(page, tid):
    return page.locator(f'[data-testid="{tid}"]:visible').count() > 0


def find_card(page, needle):
    return page.evaluate("""(n) => {
        for (const e of document.querySelectorAll('[data-testid^="mywork-task-"]'))
          if ((e.innerText||'').includes(n))
            return e.getAttribute('data-testid').replace('mywork-task-','');
        return null; }""", needle)


def shot(page, name):
    OUT.mkdir(parents=True, exist_ok=True)
    try:
        page.screenshot(path=str(OUT / f"{name}.png"))
    except Exception:
        pass


def make_task(page, title, assignee_id):
    """Create through the real UI (that is the flow under test)."""
    L(page, "new-task-button").click()
    page.wait_for_timeout(900)
    page.locator('[data-testid="task-title-input"]:visible').fill(title)
    page.locator('[data-testid="task-member-select"]:visible').select_option(assignee_id)
    page.locator('[data-testid="task-create-submit"]:visible').click()
    try:
        page.locator('[data-testid="task-title-input"]').first.wait_for(
            state="hidden", timeout=8000)
    except Exception:
        page.keyboard.press("Escape")
    settle(page)
    work(page)
    return find_card(page, title)


def task_by_title(page, title):
    r = api(page, "GET", "/api/tasks?mine=false")
    for t in (r["data"] or []):
        if title in (t.get("title") or ""):
            return t
    return None


# ==========================================================================
# GAP 1 -- progress % and the work trail really persist
# ==========================================================================
def gap1(browser, me_id):
    g = "gap1-progress+trail"
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    p = ctx.new_page()
    login(p, "owner")
    work(p)
    title = f"{TAG} gap1 {time.strftime('%H%M%S')}"
    cid = make_task(p, title, me_id)
    if not cid:
        rec(g, "set up a task to measure", False, "card not found")
        ctx.close()
        return
    rec(g, "set up a task to measure", True)

    L(p, f"task-summary-{cid}").click()
    p.wait_for_timeout(1000)

    # --- progress ---
    # The progress dropdown is deliberately tucked inside a collapsed
    # "Set % manually" disclosure, so open that first -- it is hidden by
    # design, not missing.
    p.evaluate("""(id) => {
        const sel = document.querySelector(`[data-testid="progress-select-${id}"]`);
        const d = sel && sel.closest('details');
        if (d) d.open = true; }""", cid)
    p.wait_for_timeout(500)
    if has(p, f"progress-select-{cid}"):
        p.locator(f'[data-testid="progress-select-{cid}"]:visible').select_option("50")
        p.wait_for_timeout(2000)
        srv = api(p, "GET", f"/api/tasks/{cid}")["data"] or {}
        ui = p.evaluate("""(id)=>document.querySelector(
            `[data-testid="progress-select-${id}"]`)?.value""", cid)
        rec(g, "progress 50% is saved on the server", srv.get("progress") == 50,
            f"server progress={srv.get('progress')}")
        rec(g, "…and the card shows it without a reload", ui == "50",
            f"card still reads {ui!r} - same stale render as MW-01" if ui != "50" else "")
        work(p)
        L(p, f"task-summary-{cid}").click()
        p.wait_for_timeout(900)
        ui2 = p.evaluate("""(id)=>document.querySelector(
            `[data-testid="progress-select-${id}"]`)?.value""", cid)
        rec(g, "…and shows it after a reload", ui2 == "50", f"reads {ui2!r}")
    else:
        rec(g, "progress control is offered on the card", False, "progress-select absent")

    # --- work trail ---
    note = "UXTEST trail note from the gap audit"
    work(p)                                   # start from a clean card
    L(p, f"task-summary-{cid}").click()
    p.wait_for_timeout(1200)
    if has(p, f"add-update-{cid}"):
        L(p, f"add-update-{cid}").click()
        p.wait_for_timeout(1200)
        if not has(p, f"update-text-{cid}"):
            shot(p, "gap1-update-form-missing")
        if has(p, f"update-text-{cid}"):
            p.locator(f'[data-testid="update-text-{cid}"]:visible').fill(note)
            L(p, f"update-submit-{cid}").click()
            p.wait_for_timeout(2500)
            srv = api(p, "GET", f"/api/tasks/{cid}")["data"] or {}
            blob = json.dumps(srv)
            rec(g, "a logged update is saved on the server", note in blob,
                "update absent from the task record" if note not in blob else "")
            work(p)
            L(p, f"task-summary-{cid}").click()
            p.wait_for_timeout(1000)
            shown = p.evaluate("""(id)=>{const t=document.querySelector(
                `[data-testid="trail-list-${id}"]`); return t ? t.innerText : '';}""", cid)
            rec(g, "…and appears in the work trail after a reload", note in shown,
                f"trail shows {shown[:60]!r}")
            shot(p, "gap1-trail")
        else:
            rec(g, "the update form opens", False, "update-text never appeared")
    else:
        rec(g, "‘Add update’ is offered on the card", False, "add-update absent")
    ctx.close()


# ==========================================================================
# GAP 2 -- the hand-off actually reaches the assignee
# ==========================================================================
def gap2(browser, users_by_email):
    g = "gap2-handoff"
    target = users_by_email.get(DEMO["production"])
    if not target:
        rec(g, "resolve the Production demo login to a real user", False,
            f"no user with email {DEMO['production']}")
        return
    rec(g, "resolve the Production demo login to a real user", True,
        f"{target.get('name')} ({target.get('role')}) id={target['id'][:8]}")

    title = f"{TAG} gap2 {time.strftime('%H%M%S')}"
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    owner = ctx.new_page()
    login(owner, "owner")
    work(owner)
    make_task(owner, title, target["id"])
    srv = task_by_title(owner, title)
    rec(g, "owner creates a task assigned to that exact person", srv is not None,
        f"assignee_id={(srv or {}).get('assignee_id','')[:8]}")
    if not srv:
        ctx.close()
        return
    right_person = srv.get("assignee_id") == target["id"]
    rec(g, "the task records the intended assignee", right_person,
        f"stored {srv.get('assignee_id','')[:8]} vs intended {target['id'][:8]}")
    tid = srv["id"]
    ctx.close()

    # --- now as that person ---
    ctx2 = browser.new_context(viewport={"width": 1440, "height": 900})
    p = ctx2.new_page()
    login(p, "production")
    who = api(p, "GET", "/api/auth/me")["data"] or {}
    me = (who.get("user") or who).get("id")
    rec(g, "the Production demo login is the same user the task was assigned to",
        me == target["id"], f"logged in as {str(me)[:8]}, assigned to {target['id'][:8]}")

    work(p)
    seen = find_card(p, title)
    rec(g, "the assignee sees the task in their own My Work", seen is not None,
        "task never reached the assignee's list" if not seen else f"card {seen[:8]}")
    shot(p, "gap2-assignee")

    if seen:
        L(p, f"task-summary-{seen}").click()
        p.wait_for_timeout(1000)
        if has(p, f"status-select-{seen}"):
            p.locator(f'[data-testid="status-select-{seen}"]:visible').select_option("in_progress")
            p.wait_for_timeout(2200)
            after = api(p, "GET", f"/api/tasks/{seen}")["data"] or {}
            rec(g, "the assignee can accept the task (move it to In Progress)",
                after.get("status") == "in_progress",
                f"server status={after.get('status')}")
        else:
            rec(g, "the assignee gets a status control on their own task", False,
                "no status-select rendered for the assignee")
        if has(p, f"complete-{seen}") or has(p, f"complete-m-{seen}"):
            rec(g, "the assignee can complete their own task", True, "Complete offered")
        else:
            rec(g, "the assignee can complete their own task", False, "no Complete control")
    ctx2.close()


# ==========================================================================
# GAP 3 -- bulk complete + bulk reassign, on throwaway rows only
# ==========================================================================
def gap3(browser, me_id, users_by_email):
    g = "gap3-bulk"
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    p = ctx.new_page()
    login(p, "owner")
    work(p)

    stamp = time.strftime("%H%M%S")
    titles = [f"{TAG} gap3-bulk-a {stamp}", f"{TAG} gap3-bulk-b {stamp}"]
    ids = []
    for t in titles:
        cid = make_task(p, t, me_id)
        if cid:
            ids.append(cid)
    if len(ids) < 2:
        rec(g, "set up two throwaway tasks", False, f"only made {len(ids)}")
        ctx.close()
        return
    rec(g, "set up two throwaway tasks", True, ", ".join(i[:8] for i in ids))

    # ---- bulk COMPLETE ----
    for i in ids:
        p.locator(f'[data-testid="bulk-select-{i}"]:visible').first.check()
        p.wait_for_timeout(300)
    rec(g, "selecting the two rows reveals the bulk bar", has(p, "bulk-action-bar"))
    shot(p, "gap3-bulk-selected")
    if has(p, "bulk-complete"):
        L(p, "bulk-complete").click()
        p.wait_for_timeout(3000)
        settle(p)
        states = {i: (api(p, "GET", f"/api/tasks/{i}")["data"] or {}).get("status") for i in ids}
        rec(g, "bulk complete marks every selected task done",
            all(v == "done" for v in states.values()), str(states))
        rec(g, "the bulk bar clears itself afterwards", not has(p, "bulk-action-bar"))
    else:
        rec(g, "bulk complete is offered", False)

    # ---- bulk REASSIGN (fresh pair) ----
    titles2 = [f"{TAG} gap3-re-a {stamp}", f"{TAG} gap3-re-b {stamp}"]
    ids2 = []
    work(p)
    for t in titles2:
        cid = make_task(p, t, me_id)
        if cid:
            ids2.append(cid)
    target = users_by_email.get(DEMO["sales"])
    if len(ids2) < 2 or not target:
        rec(g, "set up two tasks to reassign", False,
            f"made {len(ids2)}, target={bool(target)}")
        ctx.close()
        return
    for i in ids2:
        p.locator(f'[data-testid="bulk-select-{i}"]:visible').first.check()
        p.wait_for_timeout(300)
    if has(p, "bulk-reassign"):
        L(p, "bulk-reassign").click()
        p.wait_for_timeout(1200)
        opened = has(p, "bulk-reassign-dialog")
        rec(g, "bulk reassign opens its target picker", opened)
        shot(p, "gap3-reassign-dialog")
        if opened:
            # pick the sales user in whatever select/option the dialog offers
            done = p.evaluate("""(uid) => {
                const dlg = document.querySelector('[data-testid="bulk-reassign-dialog"]');
                if (!dlg) return 'no-dialog';
                const sel = dlg.querySelector('select');
                if (sel) { sel.value = uid;
                  sel.dispatchEvent(new Event('change', {bubbles:true})); return 'select'; }
                return 'no-select'; }""", target["id"])
            p.wait_for_timeout(600)
            # confirm button inside the dialog
            btn = p.evaluate("""() => {
                const dlg = document.querySelector('[data-testid="bulk-reassign-dialog"]');
                if (!dlg) return null;
                const b = [...dlg.querySelectorAll('button')].find(x =>
                  /reassign|assign|confirm|save|apply/i.test(x.innerText||''));
                if (b) { b.setAttribute('data-ux-confirm','1'); return (b.innerText||'').trim(); }
                return null; }""")
            if btn:
                p.locator('[data-ux-confirm="1"]').first.click()
                p.wait_for_timeout(3000)
                settle(p)
                who = {i: (api(p, "GET", f"/api/tasks/{i}")["data"] or {}).get("assignee_id")
                       for i in ids2}
                ok = all(v == target["id"] for v in who.values())
                rec(g, "bulk reassign moves every selected task to the new owner", ok,
                    f"target={target['id'][:8]} got=" +
                    ", ".join(str(v)[:8] for v in who.values()))
            else:
                rec(g, "the reassign dialog offers a confirm action", False,
                    f"picker interaction returned {done!r}; no confirm button found")
    else:
        rec(g, "bulk reassign is offered", False)
    ctx.close()


# ==========================================================================
def cleanup(browser):
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    p = ctx.new_page()
    login(p, "owner")
    rows = (api(p, "GET", "/api/tasks?mine=false")["data"] or [])
    mine = [t for t in rows if TAG in (t.get("title") or "")]
    gone = 0
    for t in mine:
        r = api(p, "DELETE", f"/api/tasks/{t['id']}")
        gone += 1 if r["status"] in (200, 204) else 0
    left = [t["title"] for t in (api(p, "GET", "/api/tasks?mine=false")["data"] or [])
            if TAG in (t.get("title") or "")]
    rec("cleanup", "every UXTEST task removed", not left,
        f"deleted {gone} of {len(mine)}" + (f"; left {left}" if left else ""))
    ctx.close()


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        try:
            # who is who -- resolve the demo logins to real user records ONCE
            ctx = browser.new_context(viewport={"width": 1440, "height": 900})
            p0 = ctx.new_page()
            login(p0, "owner")
            users = api(p0, "GET", "/api/users")["data"] or []
            by_email = {u.get("email"): u for u in users if u.get("email")}
            who = api(p0, "GET", "/api/auth/me")["data"] or {}
            me_id = (who.get("user") or who).get("id")
            print(f"\nresolved {len(by_email)} users; owner id={str(me_id)[:8]}")
            for r, e in DEMO.items():
                u = by_email.get(e)
                print(f"   {r:<11} {e:<26} -> "
                      f"{(u or {}).get('name','NOT FOUND')} / {(u or {}).get('role','')}")
            ctx.close()

            print("\n=== GAP 1: progress % and the work trail ===")
            gap1(browser, me_id)
            print("\n=== GAP 2: owner -> assignee hand-off ===")
            gap2(browser, by_email)
            print("\n=== GAP 3: bulk complete + bulk reassign ===")
            gap3(browser, me_id, by_email)
        finally:
            print("\n=== cleanup ===")
            try:
                cleanup(browser)
            except Exception as e:
                rec("cleanup", "cleanup ran", False, str(e)[:120])
            browser.close()

    (OUT / "gaps.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
    p_ = sum(1 for r in results if r["status"] == "PASS")
    f_ = [r for r in results if r["status"] == "FAIL"]
    print(f"\n=== {p_} passed, {len(f_)} failed ===")
    for r in f_:
        print(f"  FAIL [{r['gap']}] {r['step']}  {r['detail']}")
    print(f"\nreport: {(OUT / 'gaps.json').relative_to(REPO)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
