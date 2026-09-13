"""ASK-28 TK-05 acceptance: the approval moment — before work starts, or before
it's marked done — desktop (1440x900).

Nothing is written. Every POST/PATCH/PUT/DELETE after sign-in is aborted. The
tasks in the doer and approver checks are made up by this script and added to
the lists the page reads (no demo task carries approval before closing, and
making one would write to the production database); Complete and Approve are
answered by the script, so the click paths run without touching data.
The server rule is checked read-only against the real approvals feed.
"""
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from ux_login import demo_login  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

BASE = "http://localhost:3000"
API = "http://localhost:8001/api"
OUT = pathlib.Path(__file__).resolve().parents[2] / ".audit-artifacts" / "ask28_approval_stage"
OUT.mkdir(parents=True, exist_ok=True)
results = []
TERMINAL = {"done", "cancelled"}


def rec(key, ok, detail):
    results.append({"check": key, "ok": ok, "detail": detail})
    print(f"  [{'PASS' if ok is True else 'FAIL' if ok is False else 'INFO'}] {key}: {detail}", flush=True)


def settle(p, ms=2500):
    p.wait_for_timeout(ms)
    for _ in range(16):
        if p.locator(".animate-pulse:visible, .ds-skeleton:visible").count() == 0:
            break
        p.wait_for_timeout(500)


def api_get(p, path):
    return p.evaluate("async ([api, path]) => { const r = await fetch(api + path, {credentials: 'include'}); return {status: r.status, body: await r.json()}; }", [API, path])


def me_of(p):
    b = api_get(p, "/auth/me")["body"]
    return b.get("user") if isinstance(b.get("user"), dict) else b


def toasts(p):
    return " | ".join(t.strip() for t in p.locator("[data-sonner-toast]").all_inner_texts())


def fake_task(tid, me, owner, **kw):
    base = {
        "id": tid, "tenant_id": me.get("tenant_id"), "title": f"TK-05 check: {tid}",
        "status": "in_progress", "priority": "medium", "task_type": "sales", "progress": 40,
        "approval_required": True, "approval_stage": "close", "approval_status": None,
        "approver_id": owner["id"], "approver_name": owner.get("name"),
        "created_by": owner["id"], "created_by_name": owner.get("name"),
        "assignee_id": me["id"], "assignee_name": me.get("name"), "assignee_role": me.get("role"),
        "co_assignee_ids": [], "co_assignees": [], "updates": [], "attachments": [],
        "created_at": "2026-09-14T04:00:00+00:00", "updated_at": "2026-09-14T04:00:00+00:00",
    }
    base.update(kw)
    return base


def serve_fakes(fakes, answers):
    """Route handler: add the fake tasks to every task list, answer their detail
    reads, hand Complete/Approve to `answers`, and abort every other write."""
    by_id = {f["id"]: f for f in fakes}

    def handler(route):
        req = route.request
        path = req.url.split("?")[0].rstrip("/")
        if "/api/tasks/" in path:
            rest = path.split("/api/tasks/")[1].split("/")
            tid = rest[0]
            if tid in by_id:
                if req.method == "GET" and len(rest) == 1:
                    return route.fulfill(status=200, content_type="application/json", body=json.dumps(by_id[tid]))
                if req.method == "GET":
                    return route.fulfill(status=200, content_type="application/json", body=json.dumps([]))
                key = (req.method, rest[1] if len(rest) > 1 else "")
                if key in answers:
                    body = json.loads(req.post_data or "{}")
                    return route.fulfill(status=200, content_type="application/json",
                                         body=json.dumps(answers[key](by_id[tid], body)))
        if req.method in ("POST", "PATCH", "PUT", "DELETE"):
            return route.abort()
        if req.method == "GET" and path.endswith("/api/tasks"):
            resp = route.fetch()
            try:
                rows = resp.json()
            except Exception:
                return route.fulfill(response=resp)
            if isinstance(rows, list):
                if "view=approvals" in req.url:
                    rows = [f for f in fakes if f.get("_in_approvals")]
                elif "view=asked" not in req.url:
                    rows = rows + [f for f in fakes if not f.get("_in_approvals")]
                return route.fulfill(response=resp, body=json.dumps(rows))
            return route.fulfill(response=resp)
        return route.continue_()

    return handler


def open_card(p, tid):
    p.locator(f'[id="task-card-{tid}"]:visible').first.click()
    p.wait_for_timeout(1500)


def close_drawer(p):
    p.keyboard.press("Escape")
    p.wait_for_timeout(700)


with sync_playwright() as pw:
    b = pw.chromium.launch()

    # ---- 1. The New Task form: three choices ----------------------------------------
    ctx = b.new_context(viewport={"width": 1440, "height": 900})
    p = ctx.new_page()
    errors = []
    p.on("pageerror", lambda e: errors.append(str(e)))
    demo_login(p, BASE, "owner")
    owner = me_of(p)
    p.route("**/api/**", lambda r: r.abort() if r.request.method in ("POST", "PATCH", "PUT", "DELETE") else r.continue_())
    p.goto(BASE + "/my-work")
    settle(p)

    # Read-only: every row of the real approvals feed obeys the stage rule.
    api = api_get(p, "/tasks?view=approvals")
    rows = api["body"] if api["status"] == 200 else []

    def waits(t):
        if not t.get("approval_required") or t.get("status") in TERMINAL:
            return False
        if t.get("approval_stage") == "close":
            return t.get("approval_status") == "pending"
        return t.get("approval_status") != "approved"
    breaks = [t["id"] for t in rows if not waits(t)]
    stages = {s: sum(1 for t in rows if (t.get("approval_stage") or "start") == s) for s in ("start", "close")}
    rec("api-approvals-stage-rule", api["status"] == 200 and not breaks,
        f"{len(rows)} rows (before start {stages['start']}, before done {stages['close']}); breaking the rule: {breaks or 'none'}")

    p.locator('[data-testid="new-task-button"]:visible').first.click()
    p.wait_for_timeout(600)
    dlg = p.locator('[role="dialog"]')
    dlg.locator('[data-testid="task-more-toggle"]').click()
    p.wait_for_timeout(300)
    choices = dlg.locator('[data-testid="task-approval"] button').all_inner_texts()
    pressed = dlg.locator('[data-testid="task-approval-none"]').get_attribute("aria-pressed")
    rec("form-three-choices", choices == ["No", "Before work starts", "Before it's marked done"] and pressed == "true",
        f"choices {choices}; No selected by default: {pressed}")
    rec("form-no-approver-when-no", dlg.locator('[data-testid="task-approver-wrap"]').count() == 0,
        "approver picker hidden while No is chosen")
    hints = {}
    for key in ("start", "close", "none"):
        dlg.locator(f'[data-testid="task-approval-{key}"]').click()
        p.wait_for_timeout(150)
        hints[key] = (dlg.locator('[data-testid="task-approval-hint"]').inner_text().strip(),
                      dlg.locator('[data-testid="task-approver-wrap"]').count())
        if key == "close":
            p.screenshot(path=str(OUT / "form_close_choice.png"))
    rec("form-hint-and-approver-follow-choice",
        hints["start"][1] == 1 and hints["close"][1] == 1 and hints["none"][1] == 0
        and "locked" in hints["start"][0] and "Complete" in hints["close"][0],
        f"start: '{hints['start'][0]}' · close: '{hints['close'][0]}' · approver shown start/close/no: "
        f"{hints['start'][1]}/{hints['close'][1]}/{hints['none'][1]}")
    overflow = dlg.evaluate("d => [...d.querySelectorAll('[data-testid=\"task-approval\"] button')].some(b => b.scrollWidth > b.clientWidth + 1)")
    rec("form-choice-labels-fit", not overflow, "no choice label is cut off")
    rec("no-page-errors-form", not errors, errors[:3] or "none")
    p.unroute_all(behavior="ignoreErrors")
    ctx.close()

    # ---- 2. The doer (sales) on tasks that need approval ----------------------------------
    ctx = b.new_context(viewport={"width": 1440, "height": 900})
    p = ctx.new_page()
    errors = []
    p.on("pageerror", lambda e: errors.append(str(e)))
    demo_login(p, BASE, "sales")
    me = me_of(p)
    working = fake_task("tk05-working", me, owner)
    waiting = fake_task("tk05-waiting", me, owner, status="review", approval_status="pending", progress=100)
    sent_back = fake_task("tk05-sent-back", me, owner, approval_status="rejected",
                          rejection_reason="Photo of the delivery is blurry")
    locked = fake_task("tk05-locked", me, owner, approval_stage="start", status="blocked",
                       approval_status="pending", progress=0)
    patches = []

    def answer_patch(t, body):
        patches.append(body)
        return {**t, "status": "review", "approval_status": "pending", "progress": 100}

    p.route("**/api/**", serve_fakes([working, waiting, sent_back, locked], {("PATCH", ""): answer_patch}))
    p.goto(BASE + "/my-work")
    settle(p, 3500)

    def pill(tid):
        el = p.locator(f'[data-testid="approval-pill-{tid}"]:visible')
        return (el.first.get_attribute("data-stage"), el.first.inner_text().strip()) if el.count() else None

    pills = {t["id"]: pill(t["id"]) for t in (working, waiting, sent_back, locked)}
    rec("card-pills-say-which-approval",
        pills["tk05-working"] == ("close", "Needs approval to close")
        and pills["tk05-waiting"] == ("close", "Approval to close")
        and pills["tk05-sent-back"] == ("close", "Needs approval to close")
        and pills["tk05-locked"] == ("start", "Approval to start"),
        f"{pills}")
    p.screenshot(path=str(OUT / "doer_cards.png"))

    open_card(p, "tk05-working")
    complete = p.locator('[data-testid="complete-tk05-working"]:visible')
    rec("before-done-work-is-open", complete.count() == 1
        and p.locator('[data-testid="approval-locked-tk05-working"]:visible').count() == 0,
        "Complete offered, no lock banner while the work is being done")
    if complete.count():
        complete.click()
        p.wait_for_timeout(1200)
    rec("complete-sends-for-approval", patches == [{"status": "done"}] and "Sent for approval" in toasts(p),
        f"PATCH bodies {patches}; toast: '{toasts(p)[:90]}' (server answer played by the script)")
    close_drawer(p)

    open_card(p, "tk05-waiting")
    banner = p.locator('[data-testid="approval-signoff-tk05-waiting"]:visible')
    rec("waiting-banner-and-no-complete", banner.count() == 1
        and p.locator('[data-testid="complete-tk05-waiting"]:visible').count() == 0
        and p.locator('[data-testid="approval-actions-tk05-waiting"]:visible').count() == 0,
        banner.inner_text().replace("\n", " ")[:120] if banner.count() else "no banner")
    p.screenshot(path=str(OUT / "doer_waiting_drawer.png"))
    close_drawer(p)

    open_card(p, "tk05-sent-back")
    changes = p.locator('[data-testid="approval-changes-tk05-sent-back"]:visible')
    rec("sent-back-shows-reason", changes.count() == 1 and "blurry" in changes.inner_text()
        and p.locator('[data-testid="complete-tk05-sent-back"]:visible').count() == 1,
        changes.inner_text().replace("\n", " ")[:120] if changes.count() else "no banner")
    close_drawer(p)

    open_card(p, "tk05-locked")
    rec("before-start-still-locks", p.locator('[data-testid="approval-locked-tk05-locked"]:visible').count() == 1
        and p.locator('[data-testid="complete-tk05-locked"]:visible').count() == 0,
        "lock banner shown, no Complete, for approval before work starts")
    close_drawer(p)
    rec("no-page-errors-doer", not errors, errors[:3] or "none")
    p.unroute_all(behavior="ignoreErrors")
    ctx.close()

    # ---- 3. The approver (owner) in Approvals ---------------------------------------------
    ctx = b.new_context(viewport={"width": 1440, "height": 900})
    p = ctx.new_page()
    errors = []
    p.on("pageerror", lambda e: errors.append(str(e)))
    demo_login(p, BASE, "owner")
    users = api_get(p, "/users")["body"]
    doer = next(u for u in users if u["id"] != owner["id"] and u.get("role") != "owner")
    to_start = fake_task("tk05-appr-start", doer, owner, approval_stage="start", status="blocked",
                         approval_status="pending", progress=0, created_at="2026-09-14T03:00:00+00:00", _in_approvals=True)
    to_close = fake_task("tk05-appr-close", doer, owner, status="review", approval_status="pending",
                         progress=100, created_at="2026-09-14T05:00:00+00:00", _in_approvals=True)
    approved = []

    def answer_approve(t, body):
        approved.append(t["id"])
        closing = t.get("approval_stage") == "close"
        return {**t, "status": "done" if closing else "todo", "approval_status": "approved", "progress": 100 if closing else t["progress"]}

    p.route("**/api/**", serve_fakes([to_start, to_close], {("POST", "approve"): answer_approve}))
    p.goto(BASE + "/my-work?view=approvals")
    settle(p, 3500)
    hub = p.evaluate("""() => [...document.querySelectorAll('[data-testid="approvals-hub"] [id^="task-card-"]:not([id^="task-card-body-"])')]
      .filter(e => e.getBoundingClientRect().width > 0).map(e => e.id.replace('task-card-', ''))""")
    hub_pills = {tid: p.locator(f'[data-testid="approvals-hub"] [data-testid="approval-pill-{tid}"]').first.inner_text().strip()
                 if p.locator(f'[data-testid="approvals-hub"] [data-testid="approval-pill-{tid}"]').count() else None
                 for tid in ("tk05-appr-start", "tk05-appr-close")}
    rec("approvals-hub-holds-both-moments", hub == ["tk05-appr-start", "tk05-appr-close"]
        and hub_pills == {"tk05-appr-start": "Approval to start", "tk05-appr-close": "Approval to close"},
        f"cards {hub}; pills {hub_pills}")
    badge = p.locator('[data-testid="work-view-approvals-count"]')
    rec("approvals-count-includes-both", badge.count() == 1 and badge.inner_text().strip() == "2",
        f"badge {badge.inner_text().strip() if badge.count() else None}")
    p.screenshot(path=str(OUT / "approver_hub.png"))

    open_card(p, "tk05-appr-close")
    box = p.locator('[data-testid="approval-actions-tk05-appr-close"]:visible')
    rec("approver-box-before-done", box.count() == 1 and box.get_attribute("data-stage") == "close"
        and "marked this task complete" in box.inner_text(),
        box.inner_text().replace("\n", " ")[:120] if box.count() else "no box")
    p.screenshot(path=str(OUT / "approver_close_drawer.png"))
    if box.count():
        p.locator('[data-testid="approve-tk05-appr-close"]').click()
        p.wait_for_timeout(1200)
    rec("approve-closes", approved == ["tk05-appr-close"] and "task closed" in toasts(p),
        f"POST approve for {approved}; toast '{toasts(p)[:90]}' (answered by the script)")
    close_drawer(p)

    open_card(p, "tk05-appr-start")
    box = p.locator('[data-testid="approval-actions-tk05-appr-start"]:visible')
    rec("approver-box-before-start", box.count() == 1 and box.get_attribute("data-stage") == "start"
        and "before" in box.inner_text() and "start work" in box.inner_text(),
        box.inner_text().replace("\n", " ")[:120] if box.count() else "no box")
    close_drawer(p)
    rec("no-page-errors-approver", not errors, errors[:3] or "none")
    p.unroute_all(behavior="ignoreErrors")
    ctx.close()
    b.close()

(OUT / "results.json").write_text(json.dumps(results, indent=1), encoding="utf-8")
fails = [r for r in results if r["ok"] is False]
print(f"\n{sum(r['ok'] is True for r in results)} pass / {len(fails)} fail -> {OUT / 'results.json'}")
