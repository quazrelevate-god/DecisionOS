"""LIVE AI runs, 2026-09-13 - approved by the founder in chat.

Only these writes are let through to the server; every other POST/PATCH/PUT/
DELETE is still aborted:
  POST /api/ask                          Dex answers (owner, sales)
  POST /api/work-coach/refresh           coach review for a TEST_ account only
  POST /api/contacts/<test contact>/rescore
  POST /api/ledger/ai/expenses/refresh   Finance AI analysis (cache overwrite)
  POST /api/ledger/ask                   Finance question
  POST /api/ingest/document              extraction of testdata/1.png (left in
                                         review - NOT committed to the books)
Each run records latency, the full output, the UI state and a screenshot, and
compares figures with the API's own data where one exists.
"""
import json
import pathlib
import re
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from ux_login import demo_login  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

BASE = "http://localhost:3000"
API = "http://localhost:8001/api"
ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / ".audit-artifacts" / "ai_live_0913"
BILL = ROOT / "testdata" / "1.png"
runs = []
ALLOW = [r"/api/ask$", r"/api/work-coach/refresh", r"/api/contacts/[^/]+/rescore$",
         r"/api/ledger/ai/expenses/refresh$", r"/api/ledger/ask$", r"/api/ingest/document$"]

APIJS = """async ([path]) => { const r = await fetch('%s' + path, {credentials:'include'});
  let d=null; try { d = await r.json(); } catch(e) {} return {status: r.status, data: d}; }""" % API


def api(p, path):
    return p.evaluate(APIJS, [path])


def text(p, sel, n=4000):
    loc = p.locator(sel)
    return loc.first.inner_text().strip() if loc.count() else ""


def toasts(p):
    return p.evaluate("()=>[...document.querySelectorAll('[data-sonner-toast]')].map(t=>t.textContent.trim())")


def guard(p, allowed_log, blocked_log):
    def handler(route):
        req = route.request
        if req.method not in ("POST", "PATCH", "PUT", "DELETE"):
            return route.continue_()
        url = req.url.split("?")[0]
        if req.method == "POST" and any(re.search(a, url) for a in ALLOW):
            allowed_log.append(req.method + " " + url.split("/api")[1])
            return route.continue_()
        blocked_log.append(req.method + " " + url.split("/api")[1])
        return route.abort()
    p.route("**/api/**", handler)


def record(name, **kw):
    runs.append({"run": name, **kw})
    short = {k: (v if not isinstance(v, str) or len(v) < 220 else v[:220] + "...") for k, v in kw.items()}
    print(f"\n### {name}\n" + json.dumps(short, indent=1, ensure_ascii=False))


def wait_until(p, fn, timeout=120):
    t0 = time.time()
    while time.time() - t0 < timeout:
        if fn():
            return round(time.time() - t0, 1)
        p.wait_for_timeout(500)
    return None


def dex(p, vp, question, tag):
    p.goto(f"{BASE}/brain", wait_until="domcontentloaded")
    p.wait_for_timeout(4000)
    n0 = p.locator('[data-testid^="chat-msg-"]').count()
    p.locator('[data-testid="dex-stage-input"]').first.fill(question)
    t0 = time.time()
    send = p.locator('[data-testid="dex-stage-send"]:visible')
    if send.count():
        send.first.click()
    else:
        p.locator('[data-testid="dex-stage-input"]').first.press("Enter")
    secs = wait_until(p, lambda: p.locator('[data-testid^="chat-msg-"]').count() >= n0 + 2
                      and p.locator('[data-testid="brain-loading"]:visible').count() == 0)
    msgs = p.locator('[data-testid^="chat-msg-"]')
    answer = msgs.nth(msgs.count() - 1).inner_text().strip() if msgs.count() else ""
    p.screenshot(path=str(OUT / f"{tag}_{vp}.png"), full_page=True)
    return secs, answer


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as pw:
        b = pw.chromium.launch()

        # ---------------- OWNER desktop ----------------
        ctx = b.new_context(viewport={"width": 1440, "height": 900})
        p = ctx.new_page()
        allowed, blocked, errors = [], [], []
        p.on("pageerror", lambda e: errors.append(str(e)[:150]))
        demo_login(p, BASE, "owner")
        guard(p, allowed, blocked)

        summ = (api(p, "/ledger/summary")["data"] or {}).get("totals", {})
        payables = api(p, "/payables")["data"] or {}
        users = api(p, "/users")["data"] or []
        contacts = api(p, "/contacts")["data"] or []
        contacts = contacts if isinstance(contacts, list) else contacts.get("items", [])
        truth = {"revenue_outstanding": summ.get("revenue_outstanding"), "expense_outstanding": summ.get("outstanding"),
                 "revenue_billed": summ.get("revenue_billed"), "net_profit": summ.get("net_profit")}
        open_bills = (payables.get("open_invoices") if isinstance(payables, dict) else None) or []
        by_vendor = {}
        for inv in open_bills:
            v = inv.get("contact_name") or inv.get("vendor_name") or "?"
            by_vendor[v] = by_vendor.get(v, 0) + float(inv.get("amount") or 0) - float(inv.get("amount_paid") or 0)
        truth["top_payable_vendor"] = max(by_vendor.items(), key=lambda kv: kv[1]) if by_vendor else None
        print("GROUND TRUTH:", json.dumps(truth, ensure_ascii=False))

        # 1. Dex - owner
        for q, tag in (("What needs my attention today?", "dex_attention"),
                       ("How much do customers owe us in total, and who owes the most?", "dex_receivables")):
            secs, ans = dex(p, "desk", q, tag)
            record(f"Dex (owner, desktop): {q}", seconds=secs, answer=ans, truth=truth if "owe" in q else None)

        # 2. global search hand-off
        p.goto(f"{BASE}/brain?q=" + "Which%20tasks%20are%20overdue%3F", wait_until="domcontentloaded")
        secs = wait_until(p, lambda: p.locator('[data-testid^="chat-msg-"]').count() >= 2 and p.locator('[data-testid="brain-loading"]:visible').count() == 0)
        msgs = p.locator('[data-testid^="chat-msg-"]')
        record("Dex via global search (?q=)", seconds=secs, answer=msgs.nth(msgs.count() - 1).inner_text().strip() if msgs.count() else "")

        # 3. coach refresh for a TEST_ account
        test_user = next((u for u in users if (u.get("name") or "").startswith("TEST") and u.get("role") != "owner"), None)
        if test_user:
            p.goto(f"{BASE}/coach?user={test_user['id']}", wait_until="domcontentloaded")
            p.wait_for_timeout(4000)
            stats = text(p, "main", 600)
            before = toasts(p)
            p.locator('[data-testid="coach-refresh-btn"]').first.click()
            secs = wait_until(p, lambda: p.locator('[data-testid="coach-summary"]').count() > 0 and "Analyzing" not in text(p, '[data-testid="coach-refresh-btn"]'), 150)
            p.wait_for_timeout(800)
            record("Coach refresh (TEST account)", target=test_user["name"], seconds=secs,
                   toasts=[t for t in toasts(p) if t not in before], page_stats=stats,
                   summary=text(p, '[data-testid="coach-summary"]'))
            p.screenshot(path=str(OUT / "coach_refresh_desk.png"), full_page=True)

        # 4. rescore a test contact
        tc = next((c for c in contacts if re.search(r"test|smoke|e2e", c.get("name") or "", re.I)), None)
        if tc:
            p.goto(f"{BASE}/contacts/{tc['id']}", wait_until="domcontentloaded")
            wait_until(p, lambda: p.locator('[data-testid="profile-header"]:visible').count() > 0, 20)
            p.wait_for_timeout(1500)
            before_card = text(p, '[data-testid="relationship-card"]')
            before = toasts(p)
            p.locator('[data-testid="rescore-contact-btn"]:visible').first.click()
            secs = wait_until(p, lambda: any("scored" in t.lower() or "could not" in t.lower() for t in toasts(p) if t not in before), 120)
            p.wait_for_timeout(2500)
            record("Score with AI (test contact)", target=tc["name"], seconds=secs,
                   toasts=[t for t in toasts(p) if t not in before], before=before_card, after=text(p, '[data-testid="relationship-card"]'))
            p.screenshot(path=str(OUT / "rescore_desk.png"), full_page=True)

        # 5. finance AI refresh + ask
        p.goto(f"{BASE}/finance", wait_until="domcontentloaded")
        p.wait_for_timeout(4000)
        p.locator('[data-testid="ledger-tab-expenses"]').first.click()
        p.wait_for_timeout(3000)
        before_panel = text(p, '[data-testid="ai-panel-expenses"]')
        before = toasts(p)
        p.locator('[data-testid="ai-refresh-expenses"]').first.click()
        secs = wait_until(p, lambda: any(t not in before for t in toasts(p)), 150)
        p.wait_for_timeout(1500)
        record("Finance AI refresh (expenses)", seconds=secs, toasts=[t for t in toasts(p) if t not in before],
               before=before_panel, after=text(p, '[data-testid="ai-panel-expenses"]'), truth=truth)
        q = "Which supplier do we owe the most right now, and how much?"
        p.locator('[data-testid="ai-ask-input-expenses"]').first.fill(q)
        p.locator('[data-testid="ai-ask-btn-expenses"]').first.click()
        secs = wait_until(p, lambda: p.locator('[data-testid="ai-answer-expenses"]').count() > 0 or any("busy" in t.lower() for t in toasts(p)), 150)
        record("Finance Ask", question=q, seconds=secs, answer=text(p, '[data-testid="ai-answer-expenses"]'),
               toasts=toasts(p), truth={"top_payable_vendor": truth["top_payable_vendor"], "expense_outstanding": truth["expense_outstanding"]})
        p.screenshot(path=str(OUT / "finance_ai_desk.png"), full_page=True)

        # 6. extraction of a real GST bill
        p.goto(f"{BASE}/finance", wait_until="domcontentloaded")
        p.wait_for_timeout(4000)
        ing = {}
        p.on("response", lambda r: "/ingest/document" in r.url and r.request.method == "POST" and ing.update(status=r.status))
        before = toasts(p)
        p.locator('[data-testid="finance-hero-doc"] input[type=file]').set_input_files(str(BILL))
        secs = wait_until(p, lambda: p.locator('[data-testid="ingest-review-panel"]').count() > 0 or any("fail" in t.lower() for t in toasts(p) if t not in before), 180)
        p.wait_for_timeout(1500)
        panel = text(p, '[data-testid="ingest-review-panel"]', 3000)
        record("Extraction of testdata/1.png (Sleek Bill invoice X33, total Rs 27,625)", seconds=secs, http=ing.get("status"),
               toasts=[t for t in toasts(p) if t not in before], review_panel=panel,
               expected="vendor Service TEST 123 / Lang Brothers (GSTIN 17ABGSP1111P1Z1) -> Noble Steels; invoice X33; "
                        "date 24 Feb 2018; due 1 Mar 2018; 3 items + shipping; total 27,625 incl. GST")
        p.screenshot(path=str(OUT / "extraction_desk.png"), full_page=True)
        latest = api(p, "/ingest")["data"] or []
        latest = latest if isinstance(latest, list) else latest.get("items", [])
        if latest:
            record("Extraction record left in review (not committed)", ingestion_id=latest[0].get("id"), status=latest[0].get("status"), filename=latest[0].get("filename"))

        record("owner desktop write log", allowed=allowed, blocked=blocked, page_errors=errors)
        p.unroute_all(behavior="ignoreErrors")
        ctx.close()

        # ---------------- OWNER mobile: Dex rendering ----------------
        ctx = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
        p = ctx.new_page()
        allowed, blocked = [], []
        demo_login(p, BASE, "owner")
        guard(p, allowed, blocked)
        secs, ans = dex(p, "mob", "Summarise today's decisions waiting on me in three bullets.", "dex_mobile")
        lay = p.evaluate("()=>({overflow: document.documentElement.scrollWidth-document.documentElement.clientWidth})")
        record("Dex (owner, mobile)", seconds=secs, answer=ans, layout=lay, allowed=allowed, blocked=blocked)
        p.unroute_all(behavior="ignoreErrors")
        ctx.close()

        # ---------------- SALES: does Dex respect permissions? ----------------
        ctx = b.new_context(viewport={"width": 1440, "height": 900})
        p = ctx.new_page()
        allowed, blocked = [], []
        demo_login(p, BASE, "sales")
        guard(p, allowed, blocked)
        refused = {k: api(p, k)["status"] for k in ("/ledger/summary", "/invoices", "/contacts")}
        for q, tag in (("How much do customers owe us in total, and who owes the most?", "dex_sales_receivables"),
                       ("What is our net profit and total spend?", "dex_sales_profit")):
            secs, ans = dex(p, "desk", q, tag)
            record(f"Dex (SALES - no finance/people permission): {q}", seconds=secs, answer=ans,
                   api_refuses_this_role=refused, truth=truth)
        record("sales write log", allowed=allowed, blocked=blocked)
        p.unroute_all(behavior="ignoreErrors")
        ctx.close()
        b.close()

    (OUT / "runs.json").write_text(json.dumps(runs, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nwrote {OUT / 'runs.json'}")


if __name__ == "__main__":
    main()
