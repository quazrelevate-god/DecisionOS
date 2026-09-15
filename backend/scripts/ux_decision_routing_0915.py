"""ASK-32 decision flow Phase 2 — browser acceptance, with REAL saves in a THROWAWAY database.

Run against the `backend-scratch` backend after seeding it with
<scratchpad>/seed_scratch_ask32_p2.py (Priya reports to Sunita, who may approve decisions):

    python scripts/ux_decision_routing_0915.py <scratchpad>/seed_scratch_ask32_p2.json

Refuses to run unless the signed-in tenant carries the scratch marker.

  Priya (captured two, cannot decide)  Desk lists them as "Waiting on Sunita Rao", not counted;
                                        the popup shows who decides and no Approve / Reject.
  Sunita (the manager who decides)      told a decision is waiting; Desk counts it; popup says
                                        "Waiting on you" with Approve and Change who decides;
                                        approving tells Priya and the person the work went to.
  Owner                                 hands Priya's other decision from Sunita to themselves;
                                        the timeline says so and the owner can then decide it.
Desktop and phone for Priya's and Sunita's views.
"""
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from ux_login import demo_login  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

BASE = "http://localhost:3000"
API = "http://localhost:8001/api"
OUT = pathlib.Path(__file__).resolve().parents[2] / ".audit-artifacts" / "ask32_decision_routing"
OUT.mkdir(parents=True, exist_ok=True)
SEED = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
results = []
CTX = {"role": "", "vp": ""}


def rec(key, ok, detail):
    results.append({"check": key, "role": CTX["role"], "viewport": CTX["vp"], "ok": ok, "detail": detail})
    print(f"  [{'PASS' if ok is True else 'FAIL' if ok is False else 'INFO'}] {CTX['role']:<8} {CTX['vp']:<7} {key}: {detail}", flush=True)


def api(p, path, method="GET", body=None):
    return p.evaluate(
        """async ([a, x, m, b]) => {
             const r = await fetch(a + x, {method: m, credentials: 'include',
               headers: b ? {'Content-Type': 'application/json'} : {}, body: b ? JSON.stringify(b) : undefined});
             let j = null; try { j = await r.json(); } catch (e) {}
             return {status: r.status, body: j}; }""", [API, path, method, body])


def session(b, role, phone=False):
    CTX.update(role=role, vp="phone" if phone else "desktop")
    opts = ({"viewport": {"width": 390, "height": 844}, "is_mobile": True, "has_touch": True}
            if phone else {"viewport": {"width": 1440, "height": 900}})
    ctx = b.new_context(**opts)
    p = ctx.new_page()
    errors = []
    p.on("pageerror", lambda e: errors.append(str(e)))
    demo_login(p, BASE, role)
    me = api(p, "/auth/me")["body"] or {}
    if (me.get("tenant") or {}).get("ui_check_marker") != "ask32":
        print("ABORT: the signed-in tenant is not the scratch database — nothing was saved.")
        sys.exit(2)
    return ctx, p, errors


def text_of(p, testid):
    loc = p.locator(f'[data-testid="{testid}"]:visible')
    return loc.first.inner_text().strip() if loc.count() else None


def wait_text(p, text, timeout=12000):
    try:
        p.get_by_text(text, exact=False).first.wait_for(state="visible", timeout=timeout)
        return True
    except Exception:
        return False


def open_decision(p, did):
    p.goto(f"{BASE}/inbox?decision={did}")
    p.locator('[data-testid="decision-dialog"]').wait_for(state="visible", timeout=15000)
    p.locator('[data-testid="decision-summary-card"]').wait_for(state="visible", timeout=20000)
    p.wait_for_timeout(700)


def notes_for(p, entity_id):
    body = api(p, "/notifications")["body"]
    rows = body if isinstance(body, list) else (body or {}).get("items") or (body or {}).get("notifications") or []
    return [n.get("message") or n.get("title") or "" for n in rows if n.get("entity_id") == entity_id]


A, B, C = SEED["by_sales_a"], SEED["by_sales_b"], SEED["by_owner"]

with sync_playwright() as pw:
    b = pw.chromium.launch()

    # ---------------- Priya: raised them, cannot decide ----------------
    for phone in (False, True):
        ctx, p, errors = session(b, "sales", phone=phone)
        if not phone:
            rec("routed-to-manager", SEED["by_sales_a_route"] == [SEED["fin_id"], "manager"]
                and SEED["by_owner_route"] == [SEED["owner_id"], "captured"], f"Priya's -> {SEED['by_sales_a_route']}; owner's -> {SEED['by_owner_route']}")
        desk = api(p, "/desk?chip=needs_decision")["body"] or {}
        card = next((c for c in desk.get("cards") or [] if c["id"] == A), None)
        rec("desk-lists-own-decision-waiting-on-manager", bool(card) and card["cta"] == "follow"
            and f"Waiting on {SEED['fin_name']}" in card["context_line"], (card or {}).get("context_line"))
        rec("desk-does-not-count-it", (desk.get("counters") or {}).get("needs_decision") == 0, desk.get("counters"))
        p.goto(BASE + "/inbox")
        p.wait_for_timeout(3500)
        rec("desk-shows-waiting-on", wait_text(p, f"Waiting on {SEED['fin_name']}", 8000), "card line rendered")
        p.screenshot(path=str(OUT / f"sales_{CTX['vp']}_desk.png"))
        open_decision(p, A)
        waiting = text_of(p, "decision-waiting-card")
        rec("popup-says-who-decides-no-buttons", bool(waiting) and f"Waiting on {SEED['fin_name']}" in waiting
            and p.locator('[data-testid="decision-approve"]:visible').count() == 0
            and p.locator('[data-testid="decision-change-approver"]:visible').count() == 0, waiting)
        p.screenshot(path=str(OUT / f"sales_{CTX['vp']}_popup.png"))
        refused = api(p, f"/decisions/{A}/approve", "POST")
        rec("server-refuses-capturer", refused["status"] == 403, f"{refused['status']} {(refused['body'] or {}).get('detail')}")
        rec("no-page-errors", not errors, errors[:3] or "none")
        ctx.close()

    # ---------------- Sunita: the manager who decides ----------------
    ctx, p, errors = session(b, "finance")
    told = notes_for(p, A)
    rec("manager-told-decision-waiting", any("Decision waiting for you" in m for m in told), told[:2])
    desk = api(p, "/desk?chip=needs_decision")["body"] or {}
    card = next((c for c in desk.get("cards") or [] if c["id"] == A), None)
    rec("manager-desk-counts-it", bool(card) and card["cta"] == "review" and (desk.get("counters") or {}).get("needs_decision", 0) >= 2,
        f"{(card or {}).get('context_line')}; counter {(desk.get('counters') or {}).get('needs_decision')}")
    open_decision(p, A)
    rec("manager-popup-waiting-on-you", text_of(p, "decision-waiting-on") == "Waiting on you"
        and p.locator('[data-testid="decision-approve"]:visible').count() == 1
        and p.locator('[data-testid="decision-change-approver"]:visible').count() == 1, text_of(p, "decision-waiting-on"))
    p.screenshot(path=str(OUT / "finance_desktop_popup.png"))
    p.locator('[data-testid="decision-approve"]').click()
    rec("manager-approves", wait_text(p, "Approved — 1 task created"), "toast")
    p.wait_for_timeout(1500)
    rec("no-page-errors", not errors, errors[:3] or "none")
    ctx.close()

    # Priya and the person the work went to hear about it.
    ctx, p, errors = session(b, "sales")
    told = notes_for(p, A)
    rec("capturer-told-approved", any("approved your decision" in m for m in told), told[:2])
    ctx.close()
    ctx, p, errors = session(b, "production")
    d = None
    task_notes = []
    body = api(p, "/notifications")["body"]
    rows = body if isinstance(body, list) else (body or {}).get("items") or (body or {}).get("notifications") or []
    task_notes = [n.get("message") for n in rows if "Update the Kapoor price list" in (n.get("message") or "")]
    rec("assignee-told-work-assigned", any("Work assigned to you" in (m or "") for m in task_notes), task_notes[:2])
    ctx.close()

    # ---------------- Owner: hand Priya's other decision to themselves ----------------
    ctx, p, errors = session(b, "owner")
    open_decision(p, B)
    rec("owner-sees-who-it-waits-on", text_of(p, "decision-waiting-on") == f"Waiting on {SEED['fin_name']}", text_of(p, "decision-waiting-on"))
    p.locator('[data-testid="decision-change-approver"]').click()
    p.locator('[data-testid="decision-approver-select"]').click()
    opt = p.locator(f'[data-testid="decision-approver-select-option-{SEED["owner_id"]}"]')
    opt.wait_for(state="visible", timeout=10000)
    options = [o.inner_text() for o in p.locator('[data-testid^="decision-approver-select-option-"]').all()]
    rec("picker-lists-only-people-who-can-decide", SEED["fin_name"] not in " ".join(options) and any(SEED["owner_name"] in o for o in options)
        and SEED["ops_name"] not in " ".join(options) and SEED["sales_name"] not in " ".join(options), options)
    opt.click()
    rec("change-toast", wait_text(p, f"Sent to {SEED['owner_name']} to decide"), "toast")
    p.wait_for_timeout(1500)
    dd = api(p, f"/decisions/{B}")["body"] or {}
    rec("change-saved-with-timeline", dd.get("approver_id") == SEED["owner_id"] and dd.get("approver_route") == "changed"
        and any(e.get("label") == f"Sent to {SEED['owner_name']} to decide" for e in dd.get("timeline") or []),
        f"approver {dd.get('approver_name')}; route {dd.get('approver_route')}")
    open_decision(p, B)
    rec("owner-now-waiting-on-you", text_of(p, "decision-waiting-on") == "Waiting on you", text_of(p, "decision-waiting-on"))
    p.screenshot(path=str(OUT / "owner_desktop_changed.png"))
    rec("no-page-errors", not errors, errors[:3] or "none")
    ctx.close()

    # Sunita can no longer decide the one handed away.
    ctx, p, errors = session(b, "finance", phone=True)
    refused = api(p, f"/decisions/{B}/approve", "POST")
    rec("previous-approver-refused-after-handover", refused["status"] == 403, f"{refused['status']} {(refused['body'] or {}).get('detail')}")
    # Once handed on, it is no longer theirs to open: a decision opens for owners,
    # the person who raised it, the person it waits on and the people on its tasks.
    p.goto(f"{BASE}/inbox?decision={B}")
    p.locator('[data-testid="decision-dialog"]').wait_for(state="visible", timeout=15000)
    restricted = False
    try:
        p.locator('[data-testid="decision-access-restricted"]').wait_for(state="visible", timeout=15000)
        restricted = True
    except Exception:
        pass
    rec("previous-approver-no-longer-has-it", restricted, "Access restricted" if restricted else "popup still opens")
    p.screenshot(path=str(OUT / "finance_phone_handed_over.png"))
    rec("no-page-errors", not errors, errors[:3] or "none")
    ctx.close()
    b.close()

(OUT / "results.json").write_text(json.dumps(results, indent=1, ensure_ascii=False), encoding="utf-8")
fails = [r for r in results if r["ok"] is False]
print(f"\n{sum(r['ok'] is True for r in results)} pass / {len(fails)} fail -> {OUT / 'results.json'}")
