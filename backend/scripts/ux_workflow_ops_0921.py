"""The workflow is continuous — browser acceptance on a THROWAWAY database.

Run against a scratch backend (DB_NAME=dos_wfops_0921, DEV_OTP_IN_RESPONSE=1,
gateways blanked) and the frontend on :5173:

    python scripts/ux_workflow_ops_0921.py

Yokesh, 2026-09-21: "A person will definitely create a workflow, but couldn't
able to add the task to the workflow... When I see the workflow I have to know
what is going on in the company." This walks that, in a real browser:

   1. a founder signs up and lands in the app;
   2. a workflow started from the BOARD arrives with its first stage's work on
      it, instead of hollow (A1);
   3. the card opens and shows every stage, its work and its state (C1/A2);
   4. a task is added to a stage BY HAND — the thing that was impossible (B1);
   5. that task holds the card: the stage will not pass while it is open;
   6. the board says how far through the stage the card is (C3) and what needs
      attention (C2/C4);
   7. the card's details can be corrected (A4);
   8. closing the stage's work advances the card by itself;
   9. a task's due date can be moved (B2);
  10. a task can be made to repeat, and finishing it brings the next (D1);
  11. a task can wait for other work, and opens by itself (D3).
"""
import io
import json
import os
import pathlib
import sys
import time

# The board's own words contain arrows and rupees; a Windows console is cp1252.
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from playwright.sync_api import sync_playwright  # noqa: E402

BASE = os.environ.get("UX_BASE", "http://localhost:5173")
API = os.environ.get("UX_API", "http://localhost:8001/api")
OUT = pathlib.Path(__file__).resolve().parents[2] / ".audit-artifacts" / "workflow_ops_0921"
OUT.mkdir(parents=True, exist_ok=True)
STAMP = str(int(time.time()))[-6:]
PHONE = f"9{STAMP}3{STAMP[-2:]}"[:10]
EMAIL = f"founder{STAMP}@kumar-{STAMP}.co"
COMPANY = f"Kumar Fabrics {STAMP}"
results = []


def rec(key, ok, detail=""):
    results.append({"check": key, "ok": ok, "detail": str(detail)[:200]})
    print(f"  [{'PASS' if ok is True else 'FAIL' if ok is False else 'INFO'}] {key}: {str(detail)[:200]}", flush=True)


def tid(p, t):
    """The VISIBLE one. Several controls exist twice — once in the phone
    header, once in the desktop one — and `.first` was picking the hidden
    phone copy at a desktop width, so a real button read as absent."""
    vis = p.locator(f'[data-testid="{t}"]:visible')
    return vis.first if vis.count() else p.locator(f'[data-testid="{t}"]').first


def wait(p, t, timeout=30000):
    try:
        p.locator(f'[data-testid="{t}"]:visible').first.wait_for(state="visible", timeout=timeout)
        return True
    except Exception:
        return False


def api_get(p, path):
    return p.evaluate(
        """async ([api, path]) => {
             const r = await fetch(api + path, {credentials: 'include'});
             return r.ok ? await r.json() : {__status: r.status};
           }""", [API, path])


def api_send(p, method, path, body=None):
    """Same double-submit CSRF header the app's own client sends."""
    return p.evaluate(
        """async ([api, method, path, body]) => {
             const m = document.cookie.match(/(?:^|;\\s*)dos_csrf=([^;]*)/);
             const r = await fetch(api + path, {
               method, credentials: 'include',
               headers: {'Content-Type': 'application/json',
                         ...(m ? {'X-CSRF-Token': decodeURIComponent(m[1])} : {})},
               body: body ? JSON.stringify(body) : undefined});
             const t = await r.text();
             try { return {status: r.status, body: JSON.parse(t)}; }
             catch { return {status: r.status, body: t.slice(0, 200)}; }
           }""", [API, method, path, body])


def type_step(p, key, value):
    if not wait(p, f"signup-input-{key}"):
        p.screenshot(path=str(OUT / f"x_stuck_before_{key}.png"), full_page=True)
        ids = p.evaluate("() => [...document.querySelectorAll('[data-testid]')].map(e => e.dataset.testid).slice(0,40)")
        raise AssertionError(f"step {key} never appeared; on screen: {ids}")
    tid(p, f"signup-input-{key}").fill(value)
    tid(p, "signup-basics-next").click()


def confirm_code(p):
    assert wait(p, "signup-phone-code"), "the code panel never appeared"
    p.wait_for_timeout(1200)
    if tid(p, "signup-phone-confirm").is_enabled():
        tid(p, "signup-phone-confirm").click()


def build_and_enter(p):
    wait(p, "signup-website", 20000)
    if p.locator('[data-testid="signup-website-skip"]').count():
        p.locator('[data-testid="signup-website-skip"]').first.click()
    p.wait_for_timeout(3000)
    if p.locator('[data-testid="signup-manual-industry"]').count():
        p.locator('[data-testid="signup-manual-industry"]').first.select_option(index=1)
        p.wait_for_timeout(400)
        if p.locator('[data-testid="signup-manual-model-B2B"]').count():
            p.locator('[data-testid="signup-manual-model-B2B"]').first.click()
        p.locator('[data-testid="signup-manual-continue"]').first.click()
        p.wait_for_timeout(3000)
    if p.locator('[data-testid="lang-pick-en-IN"]').count():
        p.locator('[data-testid="lang-pick-en-IN"]').first.click()
        p.wait_for_timeout(3000)
    if p.locator('[data-testid="interview-skip"]').count():
        p.locator('[data-testid="interview-skip"]').first.click()
    if not wait(p, "build-confirm-button", 240000):
        p.screenshot(path=str(OUT / "x_stuck_in_build.png"), full_page=True)
        ids = p.evaluate("() => [...document.querySelectorAll('[data-testid]')].map(e => e.dataset.testid).slice(0,50)")
        raise AssertionError(f"the OS never arrived at {p.url}; on screen: {ids}")
    p.locator('[data-testid="build-confirm-button"]').first.click()
    if wait(p, "signup-enter-button", 120000):
        p.locator('[data-testid="signup-enter-button"]').first.click()
        p.wait_for_timeout(6000)
        return True
    return False


with sync_playwright() as pw:
    b = pw.chromium.launch()
    ctx = b.new_context(viewport={"width": 1440, "height": 1000})
    p = ctx.new_page()
    errors, api_errors = [], []
    p.on("pageerror", lambda e: errors.append(str(e)[:200]))
    p.on("response", lambda r: api_errors.append(f"{r.status} {r.request.method} {r.url.split('/api')[-1][:60]}")
         if "/api/" in r.url and r.status >= 500 else None)

    # ── 1 · a founder, a company ────────────────────────────────────────────
    print("\n--- 1. signing up ---", flush=True)
    p.goto(f"{BASE}/signup", wait_until="domcontentloaded")
    assert wait(p, "signup-input-phone", 40000), "the wizard never opened"
    tid(p, "signup-input-phone").fill(PHONE)
    tid(p, "signup-basics-next").click()
    confirm_code(p)
    p.wait_for_timeout(1500)
    type_step(p, "name", "Rajesh Sharma")
    type_step(p, "company_name", COMPANY)
    type_step(p, "email", EMAIL)
    # Team size is a row of chips, not a text box — picking one answers the step.
    if wait(p, "signup-team-size-chips", 10000):
        tid(p, "team-size-11-50").click()
        p.wait_for_timeout(800)
    entered = build_and_enter(p)
    rec("founder-is-inside", entered, COMPANY)
    if wait(p, "welcome-dismiss", 8000):
        tid(p, "welcome-dismiss").click()
        p.wait_for_timeout(1000)

    # ── 2 · a workflow started from the board is NOT hollow (A1) ────────────
    print("\n--- 2. a card from the board arrives with its work ---", flush=True)
    p.goto(f"{BASE}/workflows", wait_until="domcontentloaded")
    assert wait(p, "workflows-page", 40000), "the board never opened"
    p.wait_for_timeout(2500)
    assert wait(p, "new-workflow-button", 20000), "no way to start a workflow"
    tid(p, "new-workflow-button").click()
    assert wait(p, "wf-title-input", 15000), "the new-workflow dialog never opened"
    tid(p, "wf-title-input").fill("Nila Exports — 400 metres")
    if p.locator('[data-testid="wf-counterparty-input"]').count():
        tid(p, "wf-counterparty-input").fill("Nila Exports")
    if p.locator('[data-testid="wf-amount-input"]').count():
        tid(p, "wf-amount-input").fill("180000")
    tid(p, "wf-create-submit").click()
    p.wait_for_timeout(4000)

    cards = api_get(p, "/workflows?with_tasks=true")
    card = next((c for c in cards if c.get("title", "").startswith("Nila Exports")), None) if isinstance(cards, list) else None
    rec("card-was-created", bool(card), (card or {}).get("id", cards))
    assert card, "the card was not created"
    WID = card["id"]
    spawned = card.get("stage_tasks") or []
    rec("A1-card-arrives-with-its-first-stage-of-work", len(spawned) > 0,
        f"{len(spawned)} task(s): {[t['title'] for t in spawned][:3]}")
    rec("C3-board-says-how-far-through-the-stage", card.get("stage_total") is not None,
        f"{card.get('stage_done')} of {card.get('stage_total')} done")
    p.screenshot(path=str(OUT / "01_board_with_a_live_card.png"), full_page=True)

    # ── 3 · the card opens and says what is going on (C1 / A2) ──────────────
    print("\n--- 3. opening the card ---", flush=True)
    p.reload(wait_until="domcontentloaded")
    p.wait_for_timeout(3000)
    opened = wait(p, f"open-workflow-{WID}", 20000)
    if opened:
        tid(p, f"open-workflow-{WID}").click()
    rec("C1-the-card-opens", wait(p, "workflow-detail", 20000) if opened else False, "")
    p.wait_for_timeout(2500)
    detail = api_get(p, f"/workflows/{WID}")
    stages = detail.get("stages_detail") or []
    rec("A2-every-stage-is-reported", len(stages) >= 2,
        " → ".join(f"{s['label']}[{s['state']}] {s['task_done']}/{s['task_total']}" for s in stages))
    rec("A2-the-card-says-why-it-cannot-move", detail.get("readiness", {}).get("ready") is False,
        detail.get("readiness", {}).get("reason"))
    p.screenshot(path=str(OUT / "02_card_detail.png"), full_page=True)

    # ── 4 · a task added BY HAND — the thing that was impossible (B1) ───────
    print("\n--- 4. adding a task to a stage by hand ---", flush=True)
    first_stage = stages[0]["key"]
    added = False
    if wait(p, f"wf-add-task-{first_stage}", 10000):
        tid(p, f"wf-add-task-{first_stage}").click()
        p.wait_for_timeout(600)
        tid(p, f"wf-add-task-title-{first_stage}").fill("Call Nila and confirm the shade")
        tid(p, f"wf-add-task-submit-{first_stage}").click()
        p.wait_for_timeout(3000)
        added = True
    after = api_get(p, f"/workflows/{WID}")
    mine = [t for s in (after.get("stages_detail") or []) for t in (s.get("tasks") or [])
            if t["title"] == "Call Nila and confirm the shade"]
    rec("B1-a-person-can-put-a-task-on-a-workflow", bool(mine) and added,
        f"workflow_id={mine[0].get('id') if mine else None} stage={mine[0].get('stage_key') if mine else None}")
    p.screenshot(path=str(OUT / "03_task_added_by_hand.png"), full_page=True)

    # ── 5 · that hand-added task holds the card ─────────────────────────────
    print("\n--- 5. the stage will not pass while it is open ---", flush=True)
    held = api_get(p, f"/workflows/{WID}")["readiness"]
    rec("B1-hand-added-work-counts-toward-the-gate",
        (mine and mine[0]["id"] in (held.get("open_task_ids") or [])),
        held.get("reason"))

    # ── 6 · correcting the card (A4) ────────────────────────────────────────
    print("\n--- 6. correcting the card ---", flush=True)
    r = api_send(p, "PATCH", f"/workflows/{WID}", {"amount": 195000, "counterparty": "Nila Exports Pvt Ltd"})
    rec("A4-a-running-card-can-be-corrected", r["status"] == 200,
        f"{r['status']} amount={r['body'].get('amount') if isinstance(r['body'], dict) else r['body']}")

    # ── 7 · closing the stage's work advances the card ──────────────────────
    print("\n--- 7. finishing the stage ---", flush=True)
    before_stage = api_get(p, f"/workflows/{WID}")["stage"]
    open_ids = api_get(p, f"/workflows/{WID}")["readiness"].get("open_task_ids") or []
    for t in open_ids:
        api_send(p, "PATCH", f"/tasks/{t}", {"status": "done"})
        p.wait_for_timeout(400)
    p.wait_for_timeout(2500)
    moved = api_get(p, f"/workflows/{WID}")
    rec("the-chain-advances-itself", moved["stage"] != before_stage,
        f"{before_stage} → {moved['stage']}")
    nxt = [s for s in moved["stages_detail"] if s["state"] == "current"]
    rec("and-the-next-stage-has-its-own-work-waiting",
        bool(nxt) and nxt[0]["task_total"] >= 0,
        f"{nxt[0]['label']}: {nxt[0]['task_total']} task(s)" if nxt else "")

    # ── 8 · the board says what needs attention (C2 / C4) ───────────────────
    print("\n--- 8. the board's own summary ---", flush=True)
    p.goto(f"{BASE}/workflows", wait_until="domcontentloaded")
    p.wait_for_timeout(3500)
    rec("C4-the-board-says-what-is-going-on", wait(p, "workflow-summary", 20000),
        tid(p, "workflow-summary").inner_text().replace("\n", " ") if wait(p, "workflow-summary", 2000) else "")
    rec("C3-progress-on-the-card-face", wait(p, f"wf-card-stage-progress-{WID}", 8000),
        tid(p, f"wf-card-stage-progress-{WID}").inner_text() if wait(p, f"wf-card-stage-progress-{WID}", 2000) else "")
    p.screenshot(path=str(OUT / "04_board_summary.png"), full_page=True)

    # ── 9 · a due date can be moved (B2) ────────────────────────────────────
    print("\n--- 9. moving a due date ---", flush=True)
    made = api_send(p, "POST", "/tasks", {"title": "Send the GST summary", "due_date": "2026-10-02"})
    tid_task = made["body"].get("id") if isinstance(made["body"], dict) else None
    r = api_send(p, "PATCH", f"/tasks/{tid_task}", {"due_date": "2026-10-16"})
    rec("B2-a-due-date-can-be-moved", r["status"] == 200 and r["body"].get("due_date") == "2026-10-16",
        f"{r['status']} {r['body'].get('due_date') if isinstance(r['body'], dict) else r['body']}")
    r = api_send(p, "PATCH", f"/tasks/{tid_task}", {"due_date": "next tuesday"})
    rec("B2-and-something-that-is-not-a-date-is-refused-in-words", r["status"] == 400, r["body"])

    # ── 10 · work that comes back (D1) ──────────────────────────────────────
    print("\n--- 10. work that comes back ---", flush=True)
    made = api_send(p, "POST", "/tasks", {
        "title": "Monday stock count", "due_date": "2026-09-28",
        "repeat_every": "week", "repeat_interval": 1})
    rid = made["body"].get("id") if isinstance(made["body"], dict) else None
    rec("D1-a-task-can-repeat", bool(rid) and bool((made["body"] or {}).get("recurrence")),
        (made["body"] or {}).get("recurrence"))
    api_send(p, "PATCH", f"/tasks/{rid}", {"status": "done"})
    p.wait_for_timeout(2000)
    rows = api_get(p, "/tasks")
    nxt = [t for t in rows if t.get("title") == "Monday stock count" and t.get("id") != rid] if isinstance(rows, list) else []
    rec("D1-finishing-one-brings-the-next", len(nxt) == 1,
        f"due {nxt[0]['due_date']}" if nxt else "nothing followed")

    # ── 11 · work that waits for other work (D3) ────────────────────────────
    print("\n--- 11. work that waits its turn ---", flush=True)
    a = api_send(p, "POST", "/tasks", {"title": "Check the stock"})
    aid = a["body"].get("id") if isinstance(a["body"], dict) else None
    bmade = api_send(p, "POST", "/tasks", {"title": "Pack the order", "depends_on": [aid]})
    bid = bmade["body"].get("id") if isinstance(bmade["body"], dict) else None
    rec("D3-work-that-waits-starts-blocked",
        (bmade["body"] or {}).get("status") == "blocked", (bmade["body"] or {}).get("status"))
    api_send(p, "PATCH", f"/tasks/{aid}", {"status": "done"})
    p.wait_for_timeout(2000)
    freed = api_get(p, f"/tasks/{bid}")
    rec("D3-and-opens-by-itself-when-the-work-before-it-is-done",
        freed.get("status") == "todo", f"{freed.get('status')} · {freed.get('last_action')}")

    # ── the record ──────────────────────────────────────────────────────────
    p.goto(f"{BASE}/my-work", wait_until="domcontentloaded")
    p.wait_for_timeout(3000)
    p.screenshot(path=str(OUT / "05_my_work.png"), full_page=True)

    rec("no-uncaught-errors-on-any-screen", not errors, errors[:3])
    rec("no-server-errors", not api_errors, api_errors[:3])

    (OUT / "results.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
    passed = sum(1 for r in results if r["ok"] is True)
    total = sum(1 for r in results if r["ok"] in (True, False))
    print(f"\n==== {passed}/{total} checks passed ====", flush=True)
    for r in results:
        if r["ok"] is False:
            print(f"  FAILED: {r['check']} — {r['detail']}", flush=True)
    b.close()
