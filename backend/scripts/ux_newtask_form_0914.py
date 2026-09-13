"""ASK-29 acceptance: the simplified New Task form, desktop (1440x900), owner.

Nothing is written. Every POST/PATCH/PUT/DELETE after sign-in is aborted,
except POST /api/tasks, which is answered by this script with a fake task so
the form's success path runs and the exact payload it sends can be checked.
"""
import json
import pathlib
import sys
from datetime import date, timedelta

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from ux_login import demo_login  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

BASE = "http://localhost:3000"
OUT = pathlib.Path(__file__).resolve().parents[2] / ".audit-artifacts" / "ask29_newtask_form"
OUT.mkdir(parents=True, exist_ok=True)
results = []
sent = []


def rec(key, ok, detail):
    results.append({"check": key, "ok": ok, "detail": detail})
    print(f"  [{'PASS' if ok is True else 'FAIL' if ok is False else 'INFO'}] {key}: {detail}", flush=True)


def route(r):
    req = r.request
    if req.method == "POST" and req.url.split("?")[0].endswith("/api/tasks"):
        body = json.loads(req.post_data or "{}")
        sent.append(body)
        fake = {**body, "id": "fake-task-ask29", "status": "todo", "co_assignees": []}
        return r.fulfill(status=200, content_type="application/json", body=json.dumps(fake))
    if req.method in ("POST", "PATCH", "PUT", "DELETE"):
        return r.abort()
    return r.continue_()


def open_form(p):
    p.locator('[data-testid="new-task-button"]:visible').first.click()
    p.wait_for_timeout(600)
    return p.locator('[role="dialog"]')


with sync_playwright() as pw:
    b = pw.chromium.launch()
    ctx = b.new_context(viewport={"width": 1440, "height": 900})
    p = ctx.new_page()
    errors = []
    p.on("pageerror", lambda e: errors.append(str(e)))
    demo_login(p, BASE, "owner")
    p.route("**/api/**", route)
    p.goto(BASE + "/my-work")
    p.wait_for_timeout(4000)

    dlg = open_form(p)
    labels = dlg.evaluate("""d => [...d.querySelectorAll('label, [id$="-label"]')]
      .filter(e => e.getBoundingClientRect().width > 0).map(e => e.textContent.trim()).filter(Boolean)""")
    gone = [x for x in ("Operational category", "Supporting employee", "…or assign by team/role") if any(x in l for l in labels)]
    rec("quick-part-fields", not gone and any("Department" in l for l in labels) and any("Assign to" in l for l in labels),
        f"visible labels before More: {labels}; removed still present: {gone or 'none'}")
    more_hidden = dlg.locator('[data-testid="task-more"]').count() == 0
    rec("more-collapsed-by-default", more_hidden, "priority, helpers, approval, proof, files hidden until More options")
    p.screenshot(path=str(OUT / "form_quick.png"))

    dlg.locator('[data-testid="task-create-submit"]').click()
    p.wait_for_timeout(400)
    err = dlg.locator('[data-testid="task-title-error"]')
    rec("title-required-inline", err.count() == 1 and not sent, f"inline error: {err.inner_text() if err.count() else None}; nothing sent")

    dlg.locator('[data-testid="task-title-input"]').fill("ASK-29 check: call Krishna Garments")
    rec("title-error-clears", dlg.locator('[data-testid="task-title-error"]').count() == 0, "error disappears on typing")

    depts = dlg.locator('[data-testid="task-type-select"] option').evaluate_all("os => os.map(o => [o.value, o.textContent.trim()])")
    sales = next((v for v, t in depts if v == "sales"), depts[0][0])
    dlg.locator('[data-testid="task-type-select"]').select_option(sales)

    opts = dlg.locator('[data-testid="task-assign-select"] option').evaluate_all(
        "os => os.map(o => ({v: o.value, t: o.textContent.trim(), g: o.parentElement.label || ''}))")
    people = [o for o in opts if o["v"].startswith("u:")]
    teams = [o for o in opts if o["v"].startswith("r:")]
    rec("assign-to-people-and-teams", len(people) > 1 and len(teams) >= 1,
        f"{len(people)} people, teams: {[o['t'] for o in teams]}")

    dlg.locator('[data-testid="task-assign-select"]').select_option(teams[0]["v"])
    hint = dlg.locator('[data-testid="task-team-hint"]')
    rec("team-hint", hint.count() == 1, hint.inner_text() if hint.count() else "no hint")

    doer = next(o for o in people if not o["t"].startswith("Me"))
    dlg.locator('[data-testid="task-assign-select"]').select_option(doer["v"])

    dlg.locator('[data-testid="task-due-tomorrow"]').click()
    summ = dlg.locator('[data-testid="task-due-summary"]')
    rec("due-preset-tomorrow", summ.count() == 1 and dlg.locator('[data-testid="task-due-tomorrow"]').get_attribute("aria-pressed") == "true",
        summ.inner_text() if summ.count() else "no summary")

    dlg.locator('[data-testid="task-more-toggle"]').click()
    p.wait_for_timeout(300)
    more = dlg.locator('[data-testid="task-more"]')
    rec("more-opens", more.count() == 1 and dlg.locator('[data-testid="task-more-toggle"]').get_attribute("aria-expanded") == "true",
        "More options expanded")
    dlg.locator('[data-testid="task-priority-high"]').click()
    helper = next(o for o in people if o["v"] != doer["v"])
    dlg.locator('[data-testid="task-co-assignee-select"]').select_option(helper["v"][2:])
    dlg.locator('[data-testid="task-due-time"]').fill("16:30")
    dlg.locator('[data-testid="task-approval-close"]').click()
    approver_opts = dlg.locator('[data-testid="task-approver-select"] option').count()
    dlg.locator('[data-testid="task-evidence-required"]').check()
    p.screenshot(path=str(OUT / "form_more.png"))

    dlg.locator('[data-testid="task-more-toggle"]').click()
    p.wait_for_timeout(200)
    cnt = dlg.locator('[data-testid="task-more-count"]')
    rec("closed-more-says-what-is-set", cnt.count() == 1, cnt.inner_text() if cnt.count() else "no count")

    dlg.locator('[data-testid="task-create-submit"]').click()
    p.wait_for_timeout(1500)
    body = sent[-1] if sent else {}
    tomorrow = (date.today() + timedelta(days=1)).isoformat()
    expect = {
        "title": "ASK-29 check: call Krishna Garments", "task_type": sales,
        "assignee_id": doer["v"][2:], "assignee_role": None, "co_assignee_ids": [helper["v"][2:]],
        "priority": "high", "due_date": tomorrow, "due_time": "16:30",
        "approval_required": True, "approval_stage": "close", "approver_id": None, "evidence_required": True,
    }
    diff = {k: (body.get(k), v) for k, v in expect.items() if body.get(k) != v}
    rec("payload", bool(body) and not diff, f"mismatches: {diff or 'none'}; approver options: {approver_opts}")
    rec("no-removed-fields-sent", "op_category" not in body and "support_id" not in body, f"keys sent: {sorted(body.keys())}")
    closed = p.locator('[role="dialog"]').count() == 0
    rec("closes-after-create", closed, "dialog closed and success toast path ran")

    dlg = open_form(p)
    fresh = dlg.locator('[data-testid="task-title-input"]').input_value() == "" and dlg.locator('[data-testid="task-more"]').count() == 0
    rec("reopens-clean", fresh, "empty title, More collapsed")
    dlg.locator('[data-testid="task-title-input"]').fill("Team routing check")
    dlg.locator('[data-testid="task-assign-select"]').select_option(teams[0]["v"])
    dlg.locator('[data-testid="task-due-today"]').click()
    dlg.locator('[data-testid="task-create-submit"]').click()
    p.wait_for_timeout(1200)
    b2 = sent[-1] if len(sent) > 1 else {}
    rec("team-payload", b2.get("assignee_id") is None and b2.get("assignee_role") == teams[0]["v"][2:]
        and b2.get("co_assignee_ids") == [] and b2.get("due_date") == date.today().isoformat() and b2.get("due_time") is None,
        {k: b2.get(k) for k in ("assignee_id", "assignee_role", "co_assignee_ids", "due_date", "due_time")})

    overdue_today = p.evaluate("""() => {
      const cards = [...document.querySelectorAll('[id^="task-card-"]:not([id^="task-card-body-"])')];
      return cards.length;
    }""")
    rec("my-work-still-renders", overdue_today > 0, f"{overdue_today} cards after creating")
    rec("no-page-errors", not errors, errors[:3] or "none")
    p.unroute_all(behavior="ignoreErrors")
    ctx.close()
    b.close()

(OUT / "results.json").write_text(json.dumps(results, indent=1), encoding="utf-8")
fails = [r for r in results if r["ok"] is False]
print(f"\n{sum(r['ok'] is True for r in results)} pass / {len(fails)} fail -> {OUT / 'results.json'}")
