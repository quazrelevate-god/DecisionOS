"""Area B - Decision Desk (/inbox) and decision review (/decisions/:id), 2026-09-13.

Owner, Sales, Production, Finance at 1440 and 390, writes blocked (so no
decision is approved/rejected, no nudge or chase reaches a real person, no leave
is decided, no note is sent).
"""
import json
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from ux_login import demo_login  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

BASE = "http://localhost:3000"
API = "http://localhost:8001/api"
OUT = pathlib.Path(__file__).resolve().parents[2] / ".audit-artifacts" / "desk_0913"
results = []
APIJS = """async ([path]) => { const r = await fetch('%s' + path, {credentials: 'include'});
  let d = null; try { d = await r.json(); } catch (e) {} return {status: r.status, data: d}; }""" % API


def rec(key, vp, ok, detail=""):
    results.append({"check": key, "viewport": vp, "ok": ok, "detail": detail})
    tag = "PASS" if ok is True else "FAIL" if ok is False else "INFO"
    print(f"  [{tag}] {vp:<7} {key}: {detail}")


def api(p, path):
    return p.evaluate(APIJS, [path])


def toasts(p):
    return p.evaluate("()=>[...document.querySelectorAll('[data-sonner-toast]')].map(t=>t.textContent.trim())")


def new_toasts(p, before, ms=2500):
    for _ in range(ms // 250):
        n = [t for t in toasts(p) if t not in before]
        if n:
            return n
        p.wait_for_timeout(250)
    return []


def main_text(p, n=180):
    return p.evaluate(r"(n)=>((document.querySelector('main')||document.body).innerText||'').replace(/\s+/g,' ').trim().slice(0,n)", n)


def path_of(p):
    return p.url.replace(BASE, "") or "/"


def layout(p):
    return p.evaluate("""() => { const els=[...document.querySelectorAll('main a, main button, main input, main select, main textarea')]
        .filter(e=>{const r=e.getBoundingClientRect(); return r.width>0&&r.height>0;});
      return {overflow: document.documentElement.scrollWidth-document.documentElement.clientWidth,
        small: els.filter(e=>{const r=e.getBoundingClientRect(); return r.height<24||r.width<24;})
          .map(e=>[(e.getAttribute('aria-label')||e.textContent||e.getAttribute('data-testid')||'').trim().slice(0,26), Math.round(e.getBoundingClientRect().width), Math.round(e.getBoundingClientRect().height)]).slice(0,10),
        crash: /something went wrong|cannot read properties/i.test(document.body.innerText)}; }""")


def desk_pass(p, vp, role, mobile, blocked):
    p.goto(f"{BASE}/inbox", wait_until="domcontentloaded")
    p.wait_for_timeout(7000)
    denied = p.locator('[data-testid="access-denied"]').count()
    lay = layout(p)
    p.screenshot(path=str(OUT / f"{vp}_desk.png"))
    if denied:
        rec("Desk access", vp, None, "Access Denied for this role")
        return
    counts = {k: api(p, f"/desk?chip={k}") for k in ("needs_decision", "on_fire", "due_today", "important")}
    counters = next((c["data"].get("counters") for c in counts.values() if isinstance(c["data"], dict) and c["data"].get("counters")), {})
    cards = p.locator('[data-testid^="desk-card-"]:not([data-testid^="desk-card-action-"])')
    rec("Desk loads", vp, not lay["crash"], f"cards rendered {cards.count()}; API counters {counters}; http {[c['status'] for c in counts.values()]}; overflow {lay['overflow']}px")
    rec("Desk layout", vp, lay["overflow"] <= 1 and not lay["small"], f"under-24px {lay['small']}")

    # scope pills (owner only)
    pills = p.locator('[data-testid^="desk-scope-"]:visible').filter(has_not=p.locator("[data-testid^=desk-scope-pills]"))
    scope_btns = p.evaluate("()=>[...document.querySelectorAll('[data-testid^=\"desk-scope-\"]')].filter(e=>e.tagName==='BUTTON'&&e.getBoundingClientRect().width>0).map(e=>[e.getAttribute('data-testid'), e.innerText.trim(), e.getAttribute('aria-pressed')])")
    changed = []
    for tid, label, _ in scope_btns:
        before = p.evaluate("()=>(document.querySelector('[data-testid=\"desk-score\"]')||{}).innerText||''")
        p.locator(f'[data-testid="{tid}"]:visible').first.click()
        p.wait_for_timeout(900)
        after = p.evaluate("()=>(document.querySelector('[data-testid=\"desk-score\"]')||{}).innerText||''")
        changed.append((label, p.locator(f'[data-testid="{tid}"]').first.get_attribute("aria-pressed"), before[:12], after[:12]))
    rec("scope pills (Company / You)", vp, None if role != "owner" else bool(scope_btns), json.dumps(changed))

    # KPI tiles -> each routes to a page this role can open
    tiles = p.evaluate("()=>[...document.querySelectorAll('a[data-testid^=\"kpi-\"]')].filter(e=>e.getBoundingClientRect().width>0).map(e=>[e.getAttribute('data-testid'), e.getAttribute('href'), e.innerText.replace(/\\s+/g,' ').trim().slice(0,40)])")
    bad = []
    for tid, href, label in tiles:
        p.goto(f"{BASE}{href}", wait_until="domcontentloaded")
        p.wait_for_timeout(2500)
        if p.locator('[data-testid="access-denied"]').count() or layout(p)["crash"]:
            bad.append((tid, href, label))
    rec("every KPI tile opens a page this role can use", vp, not bad, f"{len(tiles)} tiles {[t[:2] for t in tiles]}; dead ends {bad}")

    # card actions (Review navigates; chase/nudge POST blocked -> no message sent)
    p.goto(f"{BASE}/inbox", wait_until="domcontentloaded")
    p.wait_for_timeout(6000)
    acts = p.evaluate("()=>[...document.querySelectorAll('[data-testid^=\"desk-card-action-\"]')].map(e=>[e.getAttribute('data-testid').slice(17), e.innerText.replace(/\\s+/g,' ').trim(), e.getBoundingClientRect().width>0])")
    verbs = {}
    for cid, verb, vis in acts:
        verbs.setdefault(verb, []).append(cid)
    rec("card actions present", vp, None, json.dumps({k: len(v) for k, v in verbs.items()}))
    for verb, ids in verbs.items():
        cid = ids[0]
        p.goto(f"{BASE}/inbox", wait_until="domcontentloaded")
        p.wait_for_timeout(6000)
        b = p.locator(f'[data-testid="desk-card-action-{cid}"]')
        if not b.count():
            continue
        b.first.scroll_into_view_if_needed()
        before, nb, url0 = toasts(p), len(blocked), path_of(p)
        b.first.click()
        p.wait_for_timeout(2500)
        t = new_toasts(p, before, 2000)
        sent = blocked[nb:]
        url1 = path_of(p)
        label = b.first.inner_text().strip() if b.count() and path_of(p) == url0 else ""
        if "Review" in verb:
            ok = url1.startswith("/decisions/")
        elif "Respond" in verb:
            ok = url1.startswith("/my-work")
        else:
            ok = bool(t) and label != "Done"
        rec(f"card action '{verb}'", vp, ok, f"-> {url1}; requests {sent}; toast {t}; label after '{label}'")


def review_pass(p, vp, role, mobile, blocked, decision_ids):
    pend = decision_ids.get("pending")
    if pend:
        p.goto(f"{BASE}/decisions/{pend}", wait_until="domcontentloaded")
        p.wait_for_timeout(5000)
        st = api(p, f"/decisions/{pend}")["status"]
        restricted = p.locator('[data-testid="decision-access-restricted"]').count()
        approve = p.locator('[data-testid="decision-approve"]:visible').count()
        lay = layout(p)
        p.screenshot(path=str(OUT / f"{vp}_review.png"), full_page=True)
        rec("pending decision opens as a page", vp, not lay["crash"],
            f"API {st}; restricted view={bool(restricted)}; Approve visible={bool(approve)}; overflow {lay['overflow']}px; under-24px {lay['small']}")
        if approve:
            # reject needs a second tap; approve does not
            r = p.locator('[data-testid="decision-reject"]:visible')
            nb = len(blocked)
            r.first.click()
            p.wait_for_timeout(700)
            warn = p.locator('[data-testid="decision-reject-warning"]:visible').count()
            first_sent = [x for x in blocked[nb:] if "reject" in x]
            rec("Reject asks for a second tap before sending", vp, warn == 1 and not first_sent, f"warning shown={bool(warn)}; sent on first tap={first_sent}")
            before, nb = toasts(p), len(blocked)
            r.first.click()
            t = new_toasts(p, before, 2500)
            rec("Confirm reject with the write blocked reports failure and stays", vp, bool(t) and path_of(p).startswith("/decisions/"), f"requests {blocked[nb:]}; toast {t}")
            before, nb = toasts(p), len(blocked)
            p.locator('[data-testid="decision-approve"]:visible').first.click()
            t = new_toasts(p, before, 2500)
            sent = [x for x in blocked[nb:] if "approve" in x]
            rec("Approve (write blocked): sends on first tap, reports failure", vp, None,
                f"sent on first tap={bool(sent)}; toast {t}; still on page={path_of(p).startswith('/decisions/')}")
        # note
        ni = p.locator('[data-testid="decision-note-input"]:visible')
        if ni.count():
            send = p.locator('[data-testid="decision-note-send"]:visible')
            rec("Send note disabled while empty", vp, send.first.is_disabled(), "")
            ni.first.fill("Audit probe - not sent")
            before, nb = toasts(p), len(blocked)
            send.first.click()
            t = new_toasts(p, before, 2500)
            rec("Send note with the write blocked reports failure and keeps the text", vp, bool(t) and ni.first.input_value() != "", f"requests {blocked[nb:]}; toast {t}")
            before = toasts(p)
            p.locator('[data-testid="decision-note-mic"]:visible').first.click()
            t = new_toasts(p, before, 1500)
            rec("note mic does something useful", vp, False if t and "Dex panel" in " ".join(t) else None, f"toast {t} - the mic does not record here")
        for sec in ("decision-timeline-section", "decision-note-section"):
            s = p.locator(f'[data-testid="{sec}"] > button:visible')
            if s.count():
                s.first.click()
                p.wait_for_timeout(300)
                s.first.click()
        close = p.locator('[data-testid="decision-close"]:visible')
        if close.count():
            close.first.click()
            p.wait_for_timeout(2000)
            rec("Close leaves the review", vp, not path_of(p).startswith("/decisions/"), f"-> {path_of(p)}")
        p.goto(f"{BASE}/decisions/{pend}", wait_until="domcontentloaded")
        p.wait_for_timeout(4000)
        p.keyboard.press("Escape")
        p.wait_for_timeout(800)
        rec("Escape does not throw away a review in progress (page variant)", vp, path_of(p).startswith("/decisions/"), f"-> {path_of(p)}")

    done_id = decision_ids.get("decided")
    if done_id:
        p.goto(f"{BASE}/decisions/{done_id}", wait_until="domcontentloaded")
        p.wait_for_timeout(4500)
        rec("a decided decision shows its outcome and no Approve/Reject", vp,
            p.locator('[data-testid="decision-approve"]:visible').count() == 0 and p.locator('[data-testid="decision-access-restricted"]').count() == 0,
            f"'{main_text(p, 100)}'")

    # unknown id - is there a way out?
    p.goto(f"{BASE}/decisions/does-not-exist", wait_until="domcontentloaded")
    p.wait_for_timeout(4500)
    st = api(p, "/decisions/does-not-exist")
    txt = main_text(p, 160) or p.evaluate(r"()=>document.body.innerText.replace(/\s+/g,' ').slice(0,160)")
    exits = p.evaluate("()=>{const d=document.querySelector('[data-testid=\"decision-dialog\"]'); if(!d) return null; return [...d.querySelectorAll('a,button')].filter(e=>e.getBoundingClientRect().width>0).map(e=>(e.getAttribute('aria-label')||e.innerText||'').trim().slice(0,20))}")
    p.keyboard.press("Escape")
    p.wait_for_timeout(700)
    still = path_of(p).startswith("/decisions/")
    p.mouse.click(8, 8)
    p.wait_for_timeout(700)
    rec("unknown decision explains itself and offers a way out", vp, bool(exits) and not re.search(r"don't have access", txt, re.I),
        f"API {st['status']} {st['data']}; text '{txt[:90]}'; controls in dialog {exits}; Escape leaves={not still}; outside tap leaves={not path_of(p).startswith('/decisions/')}")
    p.screenshot(path=str(OUT / f"{vp}_review_unknown.png"))


def leave_pass(p, vp, blocked):
    p.goto(f"{BASE}/inbox", wait_until="domcontentloaded")
    p.wait_for_timeout(6000)
    sec = p.locator('[data-testid="desk-leave-approvals"]')
    if not sec.count():
        rec("leave approvals on the Desk", vp, None, "section not rendered (no approver permission or none pending)")
        return
    sec.first.scroll_into_view_if_needed()
    btns = p.evaluate("()=>[...document.querySelectorAll('[data-testid=\"desk-leave-approvals\"] button')].filter(e=>e.getBoundingClientRect().width>0).map(e=>[e.getAttribute('data-testid'), e.innerText.trim().slice(0,20)])")
    rec("leave approval controls", vp, None, json.dumps(btns[:10]))
    for kind in ("approve", "reject", "info"):
        b = p.locator(f'[data-testid="desk-leave-approvals"] [data-testid^="leave-{kind}-"]:visible')
        if not b.count():
            continue
        before, nb = toasts(p), len(blocked)
        b.first.click()
        p.wait_for_timeout(900)
        confirm = p.locator('[data-testid="desk-leave-approvals"] [data-testid^="leave-confirm-"]:visible, [data-testid="desk-leave-approvals"] [data-testid^="leave-note-"]:visible').count()
        t = new_toasts(p, before, 1500)
        rec(f"leave {kind}", vp, None, f"requests {blocked[nb:]}; follow-up field/confirm shown={bool(confirm)}; toast {t}")
        p.goto(f"{BASE}/inbox", wait_until="domcontentloaded")
        p.wait_for_timeout(5000)


def failure_injection(b, vp, size, mobile):
    ctx = b.new_context(viewport=size, is_mobile=mobile, has_touch=mobile)
    p = ctx.new_page()
    demo_login(p, BASE, "owner")
    p.route(re.compile(r".*/api/desk\?chip=.*"), lambda r: r.abort())
    p.goto(f"{BASE}/inbox", wait_until="domcontentloaded")
    p.wait_for_timeout(7000)
    t = p.evaluate(r"()=>(document.querySelector('[data-testid=\"desk-band\"]')||document.querySelector('main')||document.body).innerText.replace(/\s+/g,' ').slice(0,300)")
    err = bool(re.search(r"couldn't|could not|failed|went wrong|try again", t, re.I))
    empty = bool(re.search(r"no decisions waiting|nothing on fire|nothing due today|nothing flagged|all clear", t, re.I))
    rec("desk board request fails -> page says so (not 'nothing waiting')", vp, err and not empty, f"error wording={err}; all-clear wording={empty}; '{t[:160]}'")
    p.screenshot(path=str(OUT / f"{vp}_desk_failed.png"))
    p.unroute_all(behavior="ignoreErrors")
    ctx.close()


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    errors = []
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        decision_ids = {}
        for role in ("owner", "sales", "production", "finance"):
            for vp, size, mobile in ((f"{role[:4]}-d", {"width": 1440, "height": 900}, False), (f"{role[:4]}-m", {"width": 390, "height": 844}, True)):
                print(f"\n=== {role} @ {vp} ===")
                ctx = b.new_context(viewport=size, is_mobile=mobile, has_touch=mobile)
                p = ctx.new_page()
                p.on("pageerror", lambda e, vp=vp: errors.append((vp, "PAGEERROR " + str(e)[:150])))
                blocked = []
                demo_login(p, BASE, role)
                p.route("**/api/**", lambda r: (blocked.append(r.request.method + " " + re.sub(r"https?://[^/]+", "", r.request.url)), r.abort())
                        if r.request.method in ("POST", "PATCH", "PUT", "DELETE") else r.continue_())
                if role == "owner" and not decision_ids:
                    ds = api(p, "/decisions")["data"] or []
                    ds = ds if isinstance(ds, list) else ds.get("items", [])
                    decision_ids["pending"] = next((d["id"] for d in ds if d.get("status") == "pending_approval"), None)
                    decision_ids["decided"] = next((d["id"] for d in ds if d.get("status") in ("approved", "rejected")), None)
                    print("  decisions:", decision_ids, "of", len(ds))
                desk_pass(p, vp, role, mobile, blocked)
                review_pass(p, vp, role, mobile, blocked, decision_ids)
                leave_pass(p, vp, blocked)
                rec("writes blocked", vp, None, f"{len(blocked)}: {sorted(set(blocked))[:10]}")
                p.unroute_all(behavior="ignoreErrors")
                ctx.close()
                if role == "owner":
                    failure_injection(b, vp, size, mobile)
        b.close()
    print("\n=== page errors ===")
    for e in sorted(set(errors)):
        print("  ", e)
    (OUT / "results.json").write_text(json.dumps({"results": results, "errors": sorted(set(errors))}, indent=2), encoding="utf-8")
    print(f"\n{sum(r['ok'] is True for r in results)} pass, {sum(r['ok'] is False for r in results)} fail, {sum(r['ok'] is None for r in results)} info")


if __name__ == "__main__":
    main()
