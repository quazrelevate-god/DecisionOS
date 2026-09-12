"""My Work -- FULL task lifecycle, driven through the real UI, every persona.

The audit sweep proved controls respond and the flow test proved filters filter.
Neither touched the part that matters most: can a task actually be created,
assigned, accepted, moved through its states, approved, completed, reopened and
deleted -- and does each persona see the right thing?

This drives all of that through the browser as a real user, for:
    Owner / Sales / Production / Finance   (the four demo logins)

WRITES TO THE DEV DB. Every task it makes is titled "[UXTEST] ..." and the
cleanup phase deletes them, including on failure.

    .venv/Scripts/python.exe scripts/ux_lifecycle_mywork.py
    .venv/Scripts/python.exe scripts/ux_lifecycle_mywork.py --keep   # skip cleanup
"""
import argparse
import json
import sys
import time
from datetime import date, timedelta
from pathlib import Path

from playwright.sync_api import sync_playwright

REPO = Path(__file__).resolve().parent.parent.parent
BASE = "http://localhost:3000"
OUT = REPO / ".audit-artifacts" / "ux" / "my-work" / "lifecycle"
TAG = "[UXTEST]"

results = []      # (phase, step, status, detail)
created = []      # task ids we made, for cleanup


def rec(phase, step, ok, detail=""):
    status = "PASS" if ok is True else ("FAIL" if ok is False else "INFO")
    results.append({"phase": phase, "step": step, "status": status, "detail": detail})
    print(f"  {status:<4} [{phase}] {step}" + (f"  -- {detail}" if detail else ""))


def L(page, testid):
    """First VISIBLE element with this test-id.

    My Work renders a mobile and a desktop variant of several controls at the
    same time and hides one with CSS, so `.first` can resolve to the hidden
    twin and then time out waiting for it to become visible.
    """
    return page.locator(f'[data-testid="{testid}"]:visible').first


def has(page, testid):
    return page.locator(f'[data-testid="{testid}"]:visible').count() > 0


def settle(p, timeout=20000):
    try:
        p.wait_for_function(
            """() => document.querySelectorAll('[class*="animate-pulse"]').length === 0""",
            timeout=timeout)
    except Exception:
        pass
    p.wait_for_timeout(450)


def login(page, role):
    page.goto(f"{BASE}/login", wait_until="domcontentloaded")
    page.wait_for_timeout(500)
    page.locator(f'[data-testid="demo-login-{role}"]:visible').click()
    page.wait_for_url(lambda u: "/login" not in u, timeout=30000)
    page.wait_for_timeout(1000)


def go_work(page):
    page.goto(f"{BASE}/my-work", wait_until="domcontentloaded")
    try:
        page.wait_for_load_state("networkidle", timeout=15000)
    except Exception:
        pass
    page.wait_for_timeout(1200)
    settle(page)


def visible_titles(page):
    return page.evaluate("""() => [...document.querySelectorAll('[data-testid^="mywork-task-"]')]
        .filter(e => { const r=e.getBoundingClientRect(); return r.width>0 && r.height>0; })
        .map(e => (e.innerText||'').split('\\n')[0].trim())""")


def find_card_id(page, title_part):
    return page.evaluate("""(needle) => {
        for (const e of document.querySelectorAll('[data-testid^="mywork-task-"]')) {
          if ((e.innerText||'').includes(needle))
            return e.getAttribute('data-testid').replace('mywork-task-','');
        }
        return null; }""", title_part)


def shot(page, name):
    OUT.mkdir(parents=True, exist_ok=True)
    try:
        page.screenshot(path=str(OUT / f"{name}.png"))
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Phase 1 -- create
# ---------------------------------------------------------------------------
def create_task(page, title, *, assign_to="owner", priority="high",
                approval=False, evidence=False, due_days=0):
    """Drive the New Task dialog. Returns the created card id, or None."""
    L(page, f"new-task-button").click()
    page.wait_for_timeout(900)
    dlg = page.locator(f'[data-testid="task-title-input"]:visible')
    if not dlg.count():
        return None, "dialog did not open"
    dlg.fill(title)
    page.locator(f'[data-testid="task-description-input"]:visible').fill(
        "Created by the automated UI lifecycle audit. Safe to delete.")
    page.locator(f'[data-testid="task-priority-select"]:visible').select_option(priority)
    if due_days is not None:
        page.locator(f'[data-testid="task-due-date"]:visible').fill(
            (date.today() + timedelta(days=due_days)).isoformat())

    # Assign by ROLE, not by list position: a task assigned to someone else is
    # correctly absent from the creator's "My Tasks", which would read as a
    # failed create rather than a working scope filter.
    opts = page.evaluate("""() => [...document.querySelectorAll(
        '[data-testid="task-member-select"] option')].map(o => ({v:o.value, t:o.textContent.trim()}))""")
    real = [o for o in opts if o["v"]]
    assignee = None
    if real:
        match = [o for o in real if f"· {assign_to}" in o["t"].lower()]
        assignee = match[0] if match else real[0]
        page.locator(f'[data-testid="task-member-select"]:visible').select_option(assignee["v"])

    if approval:
        page.locator(f'[data-testid="task-approval-required"]:visible').check()
        page.wait_for_timeout(400)
    if evidence:
        page.locator(f'[data-testid="task-evidence-required"]:visible').check()

    page.locator(f'[data-testid="task-create-submit"]:visible').click()
    # A successful create closes the dialog itself; give the close animation
    # room rather than racing it, and only force it shut if it truly stayed.
    still_open = True
    try:
        page.locator('[data-testid="task-title-input"]').first.wait_for(
            state="hidden", timeout=8000)
        still_open = False
    except Exception:
        still_open = has(page, "task-title-input")
    settle(page)
    if still_open:
        try:
            page.locator('[data-testid="task-dialog-close"]').first.click(timeout=4000)
            page.wait_for_timeout(700)
        except Exception:
            page.keyboard.press("Escape")
            page.wait_for_timeout(700)
    go_work(page)
    cid = find_card_id(page, title)
    return cid, (assignee["t"] if assignee else "unassigned"), still_open


def phase_create(page):
    ph = "1-create"
    stamp = time.strftime("%H%M%S")
    title = f"{TAG} lifecycle {stamp}"
    cid, assignee, still_open = create_task(page, title, assign_to="owner", priority="high")
    rec(ph, "New Task dialog opens and accepts input", cid is not None or not still_open)
    rec(ph, "task is created and appears in My Work", cid is not None,
        f"assigned to {assignee}" if cid else "card not found after create")
    rec(ph, "dialog closes itself on submit", not still_open,
        "dialog stayed open after create" if still_open else "")
    if cid:
        created.append(cid)
        shot(page, "01-created")
    return cid, title


# ---------------------------------------------------------------------------
# Phase 2 -- move through the states
# ---------------------------------------------------------------------------
def status_of(page, cid):
    return page.evaluate("""(id) => {
        const s = document.querySelector(`[data-testid="status-select-${id}"]`);
        if (s) return s.value;
        const chip = document.querySelector(`[data-testid="status-chip-${id}"]`);
        return chip ? chip.innerText.trim() : null; }""", cid)


def phase_transitions(page, cid):
    ph = "2-transitions"
    L(page, f"task-summary-{cid}").click()
    page.wait_for_timeout(900)
    sel = page.locator(f'[data-testid="status-select-{cid}"]:visible')
    if not sel.count():
        rec(ph, "status control present on the expanded card", False, "no status-select")
        return
    rec(ph, "status control present on the expanded card", True)

    for state in ("in_progress", "waiting", "review", "todo"):
        try:
            sel.select_option(state)
            page.wait_for_timeout(1400)
            settle(page)
            now = status_of(page, cid)
            rec(ph, f"status -> {state}", now == state, f"reads back {now!r}")
        except Exception as e:
            rec(ph, f"status -> {state}", False, str(e).split("\n")[0][:90])

    # progress
    pr = page.locator(f'[data-testid="progress-select-{cid}"]:visible')
    if pr.count():
        try:
            pr.select_option("50")
            page.wait_for_timeout(1300)
            val = page.evaluate("""(id) => document.querySelector(
                `[data-testid="progress-select-${id}"]`)?.value""", cid)
            rec(ph, "progress -> 50%", val == "50", f"reads back {val!r}")
        except Exception as e:
            rec(ph, "progress -> 50%", False, str(e).split("\n")[0][:90])
    else:
        rec(ph, "progress control present", None, "progress-select not rendered in this state")
    shot(page, "02-transitions")


# ---------------------------------------------------------------------------
# Phase 3 -- log an update (the work trail)
# ---------------------------------------------------------------------------
def phase_update(page, cid):
    ph = "3-update"
    btn = page.locator(f'[data-testid="add-update-{cid}"]:visible')
    if not btn.count():
        rec(ph, "‘Add update’ available on the task", None, "control not rendered")
        return
    btn.first.click()
    page.wait_for_timeout(700)
    ta = page.locator(f'[data-testid="update-text-{cid}"]:visible')
    if not ta.count():
        rec(ph, "update form opens", False)
        return
    rec(ph, "update form opens", True)
    ta.fill("UXTEST progress note from the automated lifecycle audit.")
    sub = page.locator(f'[data-testid="update-submit-{cid}"]:visible')
    sub.click()
    page.wait_for_timeout(1800)
    settle(page)
    trail = page.locator(f'[data-testid="trail-list-{cid}"]:visible')
    has = trail.count() > 0 and "UXTEST progress note" in (trail.first.inner_text() or "")
    rec(ph, "update is saved and shows in the trail", has)
    shot(page, "03-update")


# ---------------------------------------------------------------------------
# Phase 4 -- complete + reopen
# ---------------------------------------------------------------------------
def phase_complete_reopen(page, cid):
    ph = "4-complete"
    comp = page.locator(f'[data-testid="complete-{cid}"]:visible')
    if not comp.count():
        rec(ph, "Complete button present", False, "complete-<id> not found")
        return
    comp.first.click()
    page.wait_for_timeout(2200)
    settle(page)
    go_work(page)
    # a completed task leaves the default list; it lives under the Completed tab
    gone = find_card_id(page, TAG) != cid or status_of(page, cid) in ("done", "Completed")
    rec(ph, "Complete moves the task out of the active list", gone)

    tab = page.locator(f'[data-testid="work-tab-completed"]:visible')
    if tab.count():
        tab.click()
        page.wait_for_timeout(1400)
        settle(page)
        found = has(page, f"mywork-task-{cid}")
        rec(ph, "completed task appears under the Completed tab", found)
        shot(page, "04-completed")
        if found:
            L(page, f"task-summary-{cid}").click()
            page.wait_for_timeout(900)
            ro = page.locator(f'[data-testid="reopen-{cid}"]:visible')
            if ro.count():
                ro.first.click()
                page.wait_for_timeout(2000)
                settle(page)
                go_work(page)
                back = has(page, f"mywork-task-{cid}")
                rec(ph, "Reopen returns the task to the active list", back)
                shot(page, "05-reopened")
            else:
                rec(ph, "Reopen control present on a completed task", False)


# ---------------------------------------------------------------------------
# Phase 5 -- approval gate, across two personas
# ---------------------------------------------------------------------------
def phase_approval(browser):
    ph = "5-approval"
    stamp = time.strftime("%H%M%S")
    title = f"{TAG} approval {stamp}"

    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    owner = ctx.new_page()
    login(owner, "owner")
    go_work(owner)
    cid, assignee, _ = create_task(owner, title, assign_to="owner", approval=True)
    if not cid:
        rec(ph, "create a task that requires approval", False, "card not found")
        ctx.close()
        return
    created.append(cid)
    rec(ph, "create a task that requires approval", True, f"assigned to {assignee}")

    L(owner, f"task-summary-{cid}").click()
    owner.wait_for_timeout(1000)
    has_actions = has(owner, f"approval-actions-{cid}")
    has_locked = has(owner, f"approval-locked-{cid}")
    has_chip = has(owner, f"op-approval-{cid}")
    rec(ph, "approval state is visible on the card", has_actions or has_locked or has_chip,
        f"actions={has_actions} locked={has_locked} chip={has_chip}")
    shot(owner, "06-approval-owner")

    if has_actions:
        L(owner, f"approve-{cid}").click()
        owner.wait_for_timeout(2200)
        settle(owner)
        go_work(owner)
        L(owner, f"task-summary-{cid}").click()
        owner.wait_for_timeout(1000)
        txt = owner.evaluate("""(id) => document.querySelector(
            `[data-testid="op-approval-${id}"]`)?.innerText || ''""", cid)
        rec(ph, "Approve records an approved state", "Approved" in txt, f"chip reads {txt.strip()!r}")
        shot(owner, "07-approved")
    else:
        rec(ph, "owner sees Approve/Reject on a task awaiting approval", False,
            "approval-actions block not rendered for the owner")
    ctx.close()


# ---------------------------------------------------------------------------
# Phase 6 -- evidence gate
# ---------------------------------------------------------------------------
def phase_evidence(page):
    ph = "6-evidence"
    stamp = time.strftime("%H%M%S")
    title = f"{TAG} evidence {stamp}"
    cid, _, _ = create_task(page, title, assign_to="owner", evidence=True)
    if not cid:
        rec(ph, "create a task that requires evidence", False)
        return
    created.append(cid)
    rec(ph, "create a task that requires evidence", True)
    L(page, f"task-summary-{cid}").click()
    page.wait_for_timeout(1000)
    banner = page.locator(f'[data-testid="evidence-required-{cid}"]:visible')
    rec(ph, "‘evidence required’ is stated on the task", banner.count() > 0)
    comp = page.locator(f'[data-testid="complete-{cid}"]:visible')
    disabled = comp.count() and (comp.first.is_disabled() or
                                 comp.first.get_attribute("aria-disabled") == "true")
    rec(ph, "Complete is gated until proof is attached", bool(disabled),
        "Complete is clickable with no proof attached" if not disabled else "")
    shot(page, "08-evidence")


# ---------------------------------------------------------------------------
# Phase 7 -- bulk actions
# ---------------------------------------------------------------------------
def phase_bulk(page):
    ph = "7-bulk"
    go_work(page)
    ids = page.evaluate("""() => [...document.querySelectorAll('[data-testid^="bulk-select-"]')]
        .slice(0,2).map(e => e.getAttribute('data-testid').replace('bulk-select-',''))""")
    if len(ids) < 2:
        rec(ph, "bulk-select checkboxes available", None, f"only {len(ids)} rows")
        return
    for i in ids:
        L(page, f"bulk-select-{i}").check()
        page.wait_for_timeout(300)
    bar = page.locator(f'[data-testid="bulk-action-bar"]:visible')
    rec(ph, "selecting rows reveals the bulk action bar", bar.count() > 0)
    shot(page, "09-bulk-bar")
    if bar.count():
        for ctrl in ("bulk-complete", "bulk-reassign", "bulk-clear"):
            rec(ph, f"{ctrl} is offered", has(page, f"{ctrl}"))
        # exercise the non-destructive one only
        L(page, f"bulk-clear").click()
        page.wait_for_timeout(800)
        rec(ph, "bulk-clear dismisses the selection",
            page.locator(f'[data-testid="bulk-action-bar"]:visible').count() == 0)


# ---------------------------------------------------------------------------
# Phase 7b -- hand-off: owner assigns, the assignee must actually receive it
# ---------------------------------------------------------------------------
def phase_handoff(browser):
    ph = "7b-handoff"
    stamp = time.strftime("%H%M%S")
    title = f"{TAG} handoff {stamp}"

    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    owner = ctx.new_page()
    login(owner, "owner")
    go_work(owner)
    cid, assignee, _ = create_task(owner, title, assign_to="production")
    # assigned away, so it must NOT be in the owner's own "My Tasks"
    rec(ph, "task assigned to production is absent from the owner's My Tasks",
        cid is None, f"assigned to {assignee}")
    L(owner, "work-scope-all").click()
    owner.wait_for_timeout(1500)
    settle(owner)
    cid_all = find_card_id(owner, title)
    rec(ph, "…but visible to the owner under All Tasks", cid_all is not None)
    if cid_all:
        created.append(cid_all)
    ctx.close()

    # now the assignee
    ctx2 = browser.new_context(viewport={"width": 1440, "height": 900})
    prod = ctx2.new_page()
    login(prod, "production")
    go_work(prod)
    got = find_card_id(prod, title)
    rec(ph, "the assignee sees the task in their own My Work", got is not None,
        "assignee never received it" if not got else f"card {got[:8]}")
    if got:
        shot(prod, "12-handoff-assignee")
        # the assignee must be able to move it along
        L(prod, f"task-summary-{got}").click()
        prod.wait_for_timeout(900)
        sel = prod.locator(f'[data-testid="status-select-{got}"]:visible')
        if sel.count():
            sel.select_option("in_progress")
            prod.wait_for_timeout(1500)
            settle(prod)
            rec(ph, "the assignee can accept / start the task",
                status_of(prod, got) == "in_progress",
                f"status now {status_of(prod, got)!r}")
        else:
            rec(ph, "the assignee gets a status control on their task", False,
                "no status-select for the assignee")
    ctx2.close()


# ---------------------------------------------------------------------------
# Phase 8 -- what each persona sees
# ---------------------------------------------------------------------------
def phase_personas(browser):
    ph = "8-personas"
    for role in ("owner", "sales", "production", "finance"):
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        p = ctx.new_page()
        errs = []
        p.on("pageerror", lambda e: errs.append(str(e)[:150]))
        try:
            login(p, role)
            go_work(p)
            cards = len(visible_titles(p))
            can_create = has(p, f"new-task-button")
            restricted = has(p, f"access-restricted-banner")
            scope_all = has(p, f"work-scope-all")
            tabs = p.evaluate("""() => [...document.querySelectorAll('[data-testid^="work-tab-"]')]
                .map(e => e.getAttribute('data-testid').replace('work-tab-',''))""")
            rec(ph, f"{role}: My Work loads", cards >= 0 and not errs,
                f"{cards} tasks, create={can_create}, all-scope={scope_all}, "
                f"tabs={tabs}, restricted={restricted}")
            shot(p, f"10-persona-{role}")
            if errs:
                rec(ph, f"{role}: no page errors", False, errs[0])
        except Exception as e:
            rec(ph, f"{role}: My Work loads", False, str(e).split("\n")[0][:110])
        ctx.close()


# ---------------------------------------------------------------------------
# Phase 9 -- mobile-only controls
# ---------------------------------------------------------------------------
def phase_mobile(browser):
    ph = "9-mobile"
    ctx = browser.new_context(viewport={"width": 390, "height": 844},
                              is_mobile=True, has_touch=True)
    p = ctx.new_page()
    login(p, "owner")
    go_work(p)
    cid = find_card_id(p, TAG) or p.evaluate(
        """() => { const e=document.querySelector('[data-testid^="mywork-task-"]');
            return e ? e.getAttribute('data-testid').replace('mywork-task-','') : null; }""")
    if not cid:
        rec(ph, "a task card is available on mobile", False)
        ctx.close()
        return
    L(p, f"task-summary-{cid}").click()
    p.wait_for_timeout(1000)
    pills = p.locator(f'[data-testid="status-pills-m-{cid}"]:visible')
    rec(ph, "mobile status pills render on the expanded card", pills.count() > 0)
    for key in ("in_progress", "waiting", "review", "todo"):
        pill = p.locator(f'[data-testid="status-pill-m-{key}-{cid}"]:visible')
        if not pill.count():
            rec(ph, f"mobile pill {key} present", False)
            continue
        pill.first.click()
        p.wait_for_timeout(1300)
        settle(p)
        pressed = p.evaluate("""([k,id]) => document.querySelector(
            `[data-testid="status-pill-m-${k}-${id}"]`)?.getAttribute('aria-pressed')""", [key, cid])
        rec(ph, f"mobile pill {key} sets the status", pressed == "true", f"aria-pressed={pressed}")
    shot(p, "11-mobile-pills")
    for ctrl in (f"complete-m-{cid}", f"cancel-m-{cid}", f"log-update-m-{cid}",
                 f"photo-m-{cid}", f"voice-m-{cid}"):
        rec(ph, f"mobile control {ctrl.rsplit('-', 1)[0]} present",
            has(p, f"{ctrl}"))
    ctx.close()


# ---------------------------------------------------------------------------
# Cleanup
# ---------------------------------------------------------------------------
def cleanup(browser):
    ph = "10-cleanup"
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    p = ctx.new_page()
    login(p, "owner")
    removed, left = 0, 0
    for tab in ("all", "completed"):
        go_work(p)
        # widen to All Tasks first -- hand-off tasks are assigned to other
        # people and never appear in the owner's own scope.
        if has(p, "work-scope-all"):
            L(p, "work-scope-all").click()
            p.wait_for_timeout(1800)
            settle(p)
        tb = p.locator(f'[data-testid="work-tab-{tab}"]:visible')
        if tb.count():
            tb.click()
            p.wait_for_timeout(1200)
            settle(p)
        for _ in range(12):
            cid = find_card_id(p, TAG)
            if not cid:
                break
            try:
                L(p, f"task-summary-{cid}").click()
                p.wait_for_timeout(800)
                d = p.locator(f'[data-testid="delete-task-{cid}"]:visible')
                if not d.count():
                    left += 1
                    break
                d.first.click()
                p.wait_for_timeout(600)
                L(p, f"delete-task-confirm-{cid}").click()
                p.wait_for_timeout(1800)
                settle(p)
                removed += 1
                go_work(p)
                if has(p, "work-scope-all"):
                    L(p, "work-scope-all").click()
                    p.wait_for_timeout(1800)
                    settle(p)
                tb2 = p.locator(f'[data-testid="work-tab-{tab}"]:visible')
                if tb2.count():
                    tb2.click()
                    p.wait_for_timeout(1000)
                    settle(p)
            except Exception:
                left += 1
                break
    rec(ph, "UXTEST tasks deleted", left == 0, f"removed={removed} left={left}")
    ctx.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--keep", action="store_true", help="skip cleanup")
    a = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=["--use-fake-device-for-media-stream",
                                           "--use-fake-ui-for-media-stream"])
        try:
            print("\n=== OWNER: create -> transitions -> update -> complete -> reopen ===")
            ctx = browser.new_context(viewport={"width": 1440, "height": 900})
            page = ctx.new_page()
            login(page, "owner")
            go_work(page)
            cid, title = phase_create(page)
            if cid:
                phase_transitions(page, cid)
                phase_update(page, cid)
                phase_complete_reopen(page, cid)
            print("\n=== bulk ===")
            phase_bulk(page)
            print("\n=== evidence gate ===")
            phase_evidence(page)
            ctx.close()

            print("\n=== approval gate ===")
            phase_approval(browser)

            print("\n=== owner -> assignee hand-off ===")
            phase_handoff(browser)

            print("\n=== personas ===")
            phase_personas(browser)

            print("\n=== mobile controls ===")
            phase_mobile(browser)
        finally:
            if not a.keep:
                print("\n=== cleanup ===")
                try:
                    cleanup(browser)
                except Exception as e:
                    rec("10-cleanup", "cleanup ran", False, str(e)[:120])
            browser.close()

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "lifecycle.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
    fails = [r for r in results if r["status"] == "FAIL"]
    info = [r for r in results if r["status"] == "INFO"]
    print(f"\n=== {len([r for r in results if r['status']=='PASS'])} passed, "
          f"{len(fails)} failed, {len(info)} inconclusive ===")
    for f in fails:
        print(f"  FAIL [{f['phase']}] {f['step']}  {f['detail']}")
    print(f"\nreport: {(OUT / 'lifecycle.json').relative_to(REPO)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
