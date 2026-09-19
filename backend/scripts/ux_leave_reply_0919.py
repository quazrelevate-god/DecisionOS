"""Answering the approver's question, and withdrawing leave — browser acceptance
with REAL saves on a THROWAWAY database.

Run against a scratch backend and the frontend (defaults: backend 8002,
frontend 5174):

    python scripts/ux_leave_reply_0919.py

Yokesh, 2026-09-19: "add the reply to info request and withdraw leave."

The Sales demo member on a phone, the Owner (their approver) on a desktop:
  1. the member asks for leave; the owner asks a question;
  2. the member sees the question on /leave with a box to answer it, answers,
     and the request goes back to Pending — the owner's Approvals card shows
     the question and the answer together;
  3. the member withdraws another request (with a reason): it turns Withdrawn,
     moves to History, leaves the owner's queue, and can no longer be approved;
  4. a rejected request and an approved one that has started offer no
     Withdraw at all.
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
OUT = pathlib.Path(__file__).resolve().parents[2] / ".audit-artifacts" / "leave_reply"
OUT.mkdir(parents=True, exist_ok=True)
results = []


def rec(key, ok, detail):
    results.append({"check": key, "ok": ok, "detail": detail})
    print(f"  [{'PASS' if ok is True else 'FAIL' if ok is False else 'INFO'}] {key}: {detail}", flush=True)


def api(p, path, method="GET", body=None):
    return p.evaluate(
        """async ([a, x, m, b]) => {
             const r = await fetch(a + x, {method: m, credentials: 'include',
               headers: b ? {'Content-Type': 'application/json'} : {}, body: b ? JSON.stringify(b) : undefined});
             let j = null; try { j = await r.json(); } catch (e) {}
             return {status: r.status, body: j}; }""", [API, path, method, body])


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


def lv(lid):
    return _db().leaves.find_one({"id": lid}, {"_id": 0}) or {}


with sync_playwright() as pw:
    b = pw.chromium.launch()
    errors = []
    mctx = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    m = mctx.new_page()
    m.on("pageerror", lambda e: errors.append(str(e)))
    demo_login(m, base=BASE, role="sales")
    octx = b.new_context(viewport={"width": 1440, "height": 950})
    o = octx.new_page()
    o.on("pageerror", lambda e: errors.append(str(e)))
    demo_login(o, base=BASE, role="owner")

    d1 = (date.today() + timedelta(days=9)).isoformat()
    d2 = (date.today() + timedelta(days=20)).isoformat()
    ask = api(m, "/leaves", "POST", {"leave_type": "earned", "from_date": d1, "to_date": d1, "day_portion": "full",
                                    "reason": "Sister's graduation"})
    q = ask["body"]["id"]
    other = api(m, "/leaves", "POST", {"leave_type": "casual", "from_date": d2, "to_date": d2, "day_portion": "full",
                                      "reason": "Travel"})["body"]["id"]
    rejected = api(m, "/leaves", "POST", {"leave_type": "casual", "from_date": d2, "to_date": d2, "day_portion": "full",
                                         "reason": "Long weekend"})["body"]["id"]
    started = api(m, "/leaves", "POST", {"leave_type": "sick", "from_date": d1, "to_date": d1, "day_portion": "full",
                                        "reason": "Fever"})["body"]["id"]
    asked = api(o, f"/leaves/{q}/request-info", "POST", {"note": "Who covers the Chennai dealers that day?"})
    api(o, f"/leaves/{rejected}/reject", "POST", {"note": "Month-end close"})
    api(o, f"/leaves/{started}/approve", "POST", {"note": ""})
    past = (date.today() - timedelta(days=1)).isoformat()
    _db().leaves.update_one({"id": started}, {"$set": {"from_date": past, "to_date": d1}})   # it has begun
    rec("setup", ask["status"] == 200 and asked["status"] == 200, "a question from the owner, one rejected, one begun")

    # ---- 2. the member answers on the phone ----
    m.goto(f"{BASE}/leave", wait_until="domcontentloaded")
    rec("the-question-shows", wait_id(m, f"leave-info-note-{q}", 30000),
        m.locator(f'[data-testid="leave-info-note-{q}"]').first.inner_text()[:70] if m.locator(f'[data-testid="leave-info-note-{q}"]').count() else "")
    rec("with-a-box-to-answer", wait_id(m, f"leave-reply-{q}", 5000), "on the requester's own card")
    m.locator(f'[data-testid="leave-reply-{q}"]').first.scroll_into_view_if_needed()
    m.screenshot(path=str(OUT / "1_phone_question.png"))
    m.locator(f'[data-testid="leave-reply-input-{q}"]').first.fill("Arun has them — we went through the list on Friday.")
    m.locator(f'[data-testid="leave-reply-send-{q}"]').first.click()
    m.wait_for_timeout(3000)
    row = lv(q)
    rec("the-answer-is-saved-and-it-goes-back-to-pending", row.get("status") == "pending"
        and row.get("reply_note", "").startswith("Arun has them"), f"{row.get('status')} / {row.get('reply_note', '')[:30]}")
    rec("the-box-goes-and-the-answer-stays", m.locator(f'[data-testid="leave-reply-{q}"]').count() == 0
        and wait_id(m, f"leave-reply-note-{q}", 5000), "Your answer, under the question")
    m.locator(f'[data-testid="leave-card-{q}"]').first.scroll_into_view_if_needed()
    m.screenshot(path=str(OUT / "2_phone_answered.png"))
    told = _db().notifications.find_one({"entity_id": q, "type": "approval", "message": {"$regex": "answered"}})
    rec("the-approver-is-told", bool(told), (told or {}).get("message", "")[:70])

    # the owner's Approvals shows the exchange
    o.goto(f"{BASE}/approvals", wait_until="domcontentloaded")
    o.wait_for_timeout(3000)
    leave_view = o.locator('[data-testid="approvals-sub-leave"]')
    if leave_view.count():
        leave_view.first.click()
        o.wait_for_timeout(2000)
    rec("owner-sees-question-and-answer", wait_id(o, f"leave-reply-note-{q}", 15000)
        and o.locator(f'[data-testid="leave-info-note-{q}"]').count() == 1, "together on the card, with Approve again")
    o.screenshot(path=str(OUT / "3_owner_sees_answer.png"))

    # ---- 3. the member withdraws the other one ----
    m.reload(wait_until="domcontentloaded")
    wait_id(m, f"leave-withdraw-{other}", 30000)
    m.locator(f'[data-testid="leave-withdraw-{other}"]').first.click()
    rec("withdraw-asks-first", wait_id(m, f"leave-withdraw-confirm-{other}", 5000), "with an optional reason")
    m.locator(f'[data-testid="leave-withdraw-note-{other}"]').first.fill("Trip cancelled")
    m.locator(f'[data-testid="leave-withdraw-confirm-{other}"]').first.scroll_into_view_if_needed()
    m.screenshot(path=str(OUT / "4_phone_withdraw_confirm.png"))
    m.locator(f'[data-testid="leave-withdraw-go-{other}"]').first.click()
    m.wait_for_timeout(3000)
    row = lv(other)
    rec("it-is-withdrawn-and-kept", row.get("status") == "cancelled" and row.get("withdrawn_note") == "Trip cancelled",
        f"{row.get('status')} / {row.get('withdrawn_note')}")
    rec("it-moves-to-history-marked-withdrawn",
        m.locator(f'[data-testid="leave-history"] [data-testid="leave-status-{other}"]').count() == 1
        and "Withdrawn" in m.locator(f'[data-testid="leave-status-{other}"]').first.inner_text(), "History")
    late = api(o, f"/leaves/{other}/approve", "POST", {"note": ""})
    rec("and-cannot-be-approved-now", late["status"] == 409, f"{late['status']} {str(late['body'])[:60]}")
    o.reload(wait_until="domcontentloaded")
    o.wait_for_timeout(3000)
    if leave_view.count():
        o.locator('[data-testid="approvals-sub-leave"]').first.click()
        o.wait_for_timeout(2000)
    rec("it-leaves-the-owners-queue", o.locator(f'[data-testid="leave-card-{other}"]').count() == 0, "")

    # ---- 4. no withdraw where it can't be ----
    rec("no-withdraw-on-a-rejected-request", m.locator(f'[data-testid="leave-withdraw-{rejected}"]').count() == 0, "")
    rec("no-withdraw-once-leave-has-started", m.locator(f'[data-testid="leave-withdraw-{started}"]').count() == 0, "")
    m.screenshot(path=str(OUT / "5_phone_after.png"), full_page=True)

    rec("no-page-errors", errors == [], str(errors[:2]))
    b.close()

pathlib.Path(OUT / "results.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
ok = sum(1 for r in results if r["ok"] is True)
bad = sum(1 for r in results if r["ok"] is False)
print(f"\n{ok} pass / {bad} fail -> {OUT / 'results.json'}")
