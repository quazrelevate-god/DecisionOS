"""Ops gap pass, 2026-09-13 - the three items OPS_AUDIT_PLAN.md left unticked.

D2  view-as another person (?user=<id>) and its banner
E1  Ops as Sales / Production / Finance (self view)
F1  AI work coach (/coach) - read paths, refresh FAILURE path only
F2  Score with AI on a contact - FAILURE path only

Every POST/PATCH/PUT/DELETE is aborted after sign-in. That matters here: a real
coach refresh overwrites users.coach_summary and a real rescore overwrites the
contact's AI score, both via live model calls. Those runs need the founder's go.
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
OUT = pathlib.Path(__file__).resolve().parents[2] / ".audit-artifacts" / "ops_0913"
results = []

APIJS = """async ([path]) => {
  const tok = Object.keys(localStorage).filter(k=>/token/i.test(k)).map(k=>localStorage.getItem(k))[0];
  const h = {}; if (tok) h['Authorization'] = 'Bearer ' + String(tok).replace(/^"|"$/g,'');
  const r = await fetch('%s' + path, {headers: h, credentials: 'include'});
  let d = null; try { d = await r.json(); } catch (e) {}
  return {status: r.status, data: d};
}""" % API


def rec(key, vp, ok, detail=""):
    results.append({"check": key, "viewport": vp, "ok": ok, "detail": detail})
    tag = "PASS" if ok is True else "FAIL" if ok is False else "INFO"
    print(f"  [{tag}] {vp:<10} {key}: {detail}")


def api(p, path):
    return p.evaluate(APIJS, [path])


def settle(p, ms=3000):
    p.wait_for_timeout(ms)
    for _ in range(16):
        if p.locator('[data-testid="operating-skeleton"]').count() == 0 and p.locator(".animate-pulse:visible").count() == 0:
            return True
        p.wait_for_timeout(500)
    return False


def toasts(p):
    return p.evaluate("()=>[...document.querySelectorAll('[data-sonner-toast]')].map(t=>t.textContent.trim())")


def layout(p):
    return p.evaluate("""() => {
      const vw = innerWidth;
      const els = [...document.querySelectorAll('main a, main button, main input, main select')].filter(e => {
        const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
      const small = els.filter(e => { const r = e.getBoundingClientRect(); return r.height < 24 || r.width < 24; })
        .map(e => [(e.getAttribute('aria-label') || e.textContent || e.getAttribute('data-testid') || '').trim().slice(0, 30), Math.round(e.getBoundingClientRect().width), Math.round(e.getBoundingClientRect().height)]);
      return {overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
              small, crash: /something went wrong/i.test(document.body.innerText),
              coachLinks: [...document.querySelectorAll('a[href*="/coach"]')].map(a => a.getAttribute('href'))};
    }""")


def text_numbers(p, sel):
    loc = p.locator(sel)
    if not loc.count():
        return None
    return re.findall(r"\d+(?:\.\d+)?%?", loc.first.inner_text())


def owner_view_as(p, vp, ids, shots, mobile, store):
    p.goto(f"{BASE}/operating-score", wait_until="domcontentloaded")
    settle(p)
    emps = p.locator('[data-testid^="operating-emp-"]:visible')
    rec("company view lists employees", vp, emps.count() > 0, f"{emps.count()} employee links")
    target = p.locator(f'[data-testid="operating-emp-{ids["priya"]}"]:visible')
    if not target.count():
        target = emps.first
    tid = target.get_attribute("data-testid")[len("operating-emp-"):]
    target.scroll_into_view_if_needed()
    target.click()
    settle(p)
    url = p.url.replace(BASE, "")
    banner = p.locator('[data-testid="operating-view-as-banner"]:visible')
    btxt = banner.inner_text().replace("\n", " ") if banner.count() else ""
    self_stats = p.locator('[data-testid="operating-self-stats"]:visible').count()
    rec("employee card opens that person's Ops (view-as)", vp, url == f"/operating-score?user={tid}" and banner.count() == 1,
        f"url {url}; banner '{btxt}'; self stats visible={self_stats}")
    p.screenshot(path=str(shots / f"{vp}_view_as.png"))
    if banner.count():
        r = banner.bounding_box()
        back = banner.locator("a")
        br = back.bounding_box()
        rec("banner fits and 'Back to company' is a usable target", vp,
            r["x"] >= 0 and r["x"] + r["width"] <= p.viewport_size["width"] + 1 and br["height"] >= 24,
            f"banner {round(r['width'])}px wide; back link {round(br['width'])}x{round(br['height'])}")
    lay = layout(p)
    rec("view-as page layout", vp, lay["overflow"] <= 1 and not lay["crash"],
        f"overflow {lay['overflow']}px, under-24px {lay['small']}, coach links {lay['coachLinks']}")
    if tid == ids["priya"]:
        store[vp] = {"dom": text_numbers(p, '[data-testid="operating-self-stats"]'),
                     "api": api(p, f"/operating-score?user_id={tid}")["data"]}

    # leave via the banner link
    if banner.count():
        banner.locator("a").click()
        settle(p)
        rec("'Back to company' returns to the company view", vp,
            p.url.replace(BASE, "") == "/operating-score" and p.locator('[data-testid="operating-view-as-banner"]').count() == 0,
            f"url {p.url.replace(BASE, '')}")
    # browser back from a view-as page
    p.goto(f"{BASE}/operating-score", wait_until="domcontentloaded"); settle(p)
    p.goto(f"{BASE}/operating-score?user={tid}", wait_until="domcontentloaded"); settle(p)
    p.go_back(); settle(p)
    rec("browser Back from view-as lands on the company view", vp,
        p.locator('[data-testid="operating-view-as-banner"]').count() == 0 and p.locator('[data-testid="operating-employees"]').count() > 0,
        f"url {p.url.replace(BASE, '')}")
    # own id
    p.goto(f"{BASE}/operating-score?user={ids['owner']}", wait_until="domcontentloaded"); settle(p)
    rec("?user=<own id> shows the normal company view, no banner", vp,
        p.locator('[data-testid="operating-view-as-banner"]').count() == 0 and p.locator('[data-testid="operating-employees"]').count() > 0, "")
    # unknown id
    p.goto(f"{BASE}/operating-score?user=does-not-exist", wait_until="domcontentloaded")
    p.wait_for_timeout(9000)
    st = api(p, "/operating-score?user_id=does-not-exist")
    sk = p.locator('[data-testid="operating-skeleton"]').count()
    body = p.evaluate("()=>document.querySelector('main') ? document.querySelector('main').innerText.trim().slice(0,160) : ''")
    rec("unknown ?user= id tells the owner what happened", vp, sk == 0 and bool(body),
        f"API {st['status']} {st['data']}; after 9s skeleton still showing={bool(sk)}; main text '{body}'")
    p.screenshot(path=str(shots / f"{vp}_view_as_unknown.png"))


def self_view(p, vp, role, ids, shots, mobile, store):
    p.goto(f"{BASE}/operating-score", wait_until="domcontentloaded")
    ok = settle(p)
    api_self = api(p, "/operating-score")
    view = (api_self["data"] or {}).get("view")
    company = p.locator('[data-testid="operating-employees"]').count()
    banner = p.locator('[data-testid="operating-view-as-banner"]').count()
    stats = p.locator('[data-testid="operating-self-stats"]:visible').count()
    rec("non-owner gets the self view", vp, view == "self" and company == 0 and banner == 0 and stats == 1,
        f"API view={view}; leaderboard={company}; banner={banner}; self stats visible={stats}; loaded={ok}")
    p.screenshot(path=str(shots / f"{vp}_self.png"), full_page=False)
    sections = p.evaluate("""()=>['operating-self-stats','operating-self-open','operating-self-workflows','operating-self-peer','operating-formula-toggle','operating-inline-capture']
      .map(k=>[k, !!document.querySelector('[data-testid="'+k+'"]')])""")
    rec("self view sections", vp, None, json.dumps(sections))
    lay = layout(p)
    rec("self view layout", vp, lay["overflow"] <= 1 and not lay["crash"] and not lay["small"],
        f"overflow {lay['overflow']}px; under-24px {lay['small']}; coach links {lay['coachLinks']}")
    legs = [c.get("key") for c in ((api_self["data"] or {}).get("categories") or [])] if isinstance((api_self["data"] or {}).get("categories"), list) else list(((api_self["data"] or {}).get("categories") or {}).keys())
    rec("self view payload keys", vp, None, f"keys {sorted((api_self['data'] or {}).keys())}; categories {legs}")

    # every link on the page routes somewhere real
    hrefs = p.evaluate("()=>[...new Set([...document.querySelectorAll('main a[href]')].filter(a=>a.getBoundingClientRect().width>0).map(a=>a.getAttribute('href')))]")
    bad = []
    for h in hrefs:
        if not h.startswith("/"):
            continue
        p.goto(f"{BASE}{h}", wait_until="domcontentloaded")
        p.wait_for_timeout(2200)
        t = p.evaluate("()=>({u: location.pathname + location.search, txt: (document.querySelector('main')||document.body).innerText.trim().slice(0,80), nf: /not found|404|access denied|not allowed/i.test(document.body.innerText)})")
        if t["nf"] or not t["txt"] or "/login" in t["u"]:
            bad.append((h, t["u"], t["txt"][:50]))
    rec("every link on the self view opens a real screen", vp, not bad, f"{len(hrefs)} links {hrefs}; problems {bad}")

    # a toggle / button press on the self view
    ft = p.locator('[data-testid="operating-formula-toggle"]')
    if ft.count():
        p.goto(f"{BASE}/operating-score", wait_until="domcontentloaded"); settle(p)
        ft = p.locator('[data-testid="operating-formula-toggle"]:visible')
        if ft.count():
            ft.first.click(); p.wait_for_timeout(500)
            rec("'How is this scored' opens the formula panel", vp, p.locator('[data-testid="operating-formula-panel"]:visible').count() == 1, "")

    # compare with what the owner saw for this same person
    if role == "sales":
        dom = text_numbers(p, '[data-testid="operating-self-stats"]')
        key = "desk1440" if not mobile else "mob390"
        o = store.get(key)
        if o:
            sa, oa = api_self["data"] or {}, o["api"] or {}
            strip = lambda d: {k: v for k, v in d.items() if k not in ("view_as", "generated_at", "now", "view")}
            same_api = json.dumps(strip(sa), sort_keys=True, default=str) == json.dumps(strip(oa), sort_keys=True, default=str)
            rec("owner's view-as of Priya matches what Priya sees herself", vp, dom == o["dom"] and same_api,
                f"Priya's own stats {dom} vs owner view-as {o['dom']}; payload identical={same_api}")

    # non-owner trying to view someone else
    p.goto(f"{BASE}/operating-score?user={ids['owner']}", wait_until="domcontentloaded")
    p.wait_for_timeout(9000)
    st = api(p, f"/operating-score?user_id={ids['owner']}")
    sk = p.locator('[data-testid="operating-skeleton"]').count()
    body = p.evaluate("()=>document.querySelector('main') ? document.querySelector('main').innerText.trim().slice(0,160) : ''")
    rec("non-owner blocked from another person's Ops, and told so", vp, st["status"] == 403 and sk == 0 and bool(body),
        f"API {st['status']}; after 9s skeleton still showing={bool(sk)}; main text '{body}'")
    p.screenshot(path=str(shots / f"{vp}_self_forbidden.png"))


def coach(p, vp, role, ids, shots):
    p.goto(f"{BASE}/coach", wait_until="domcontentloaded")
    p.wait_for_timeout(3500)
    own = api(p, "/work-coach")
    h = p.locator("h1").first.inner_text() if p.locator("h1").count() else ""
    state = "summary" if p.locator('[data-testid="coach-summary"]').count() else "empty" if p.locator('[data-testid="coach-empty"]').count() else "other"
    rec("/coach renders your own coach", vp, own["status"] == 200 and state in ("summary", "empty"),
        f"API {own['status']} target {((own['data'] or {}).get('target') or {}).get('name')}; heading '{h}'; state {state}; "
        f"cached summary generated_at {(((own['data'] or {}).get('summary') or {}).get('generated_at'))}")
    lay = layout(p)
    rec("/coach layout", vp, lay["overflow"] <= 1 and not lay["crash"], f"overflow {lay['overflow']}px; under-24px {lay['small']}")
    p.screenshot(path=str(shots / f"{vp}_coach.png"))
    btn = p.locator('[data-testid="coach-refresh-btn"]:visible')
    if btn.count():
        label = btn.inner_text().strip()
        before = toasts(p)
        btn.click()
        p.wait_for_timeout(300)
        busy = btn.inner_text().strip()
        p.wait_for_timeout(2500)
        new = [t for t in toasts(p) if t not in before]
        rec("coach refresh FAILURE path (POST blocked, no model call)", vp,
            any("could not refresh" in t.lower() for t in new) and btn.inner_text().strip() == label,
            f"label '{label}' -> '{busy}' -> '{btn.inner_text().strip()}'; toasts {new}")

    if role == "owner":
        p.goto(f"{BASE}/coach?user={ids['priya']}", wait_until="domcontentloaded")
        p.wait_for_timeout(3500)
        eyebrow = p.evaluate("()=>{const h=document.querySelector('h1'); return h && h.previousElementSibling ? h.previousElementSibling.textContent : (h? h.parentElement.textContent.slice(0,80):'')}")
        rec("owner opens a teammate's coach", vp, "Priya" in (eyebrow or ""), f"header reads '{eyebrow}'")
        p.goto(f"{BASE}/coach?user=does-not-exist", wait_until="domcontentloaded")
        p.wait_for_timeout(3000)
        err = p.locator('[data-testid="coach-error"]')
        rec("unknown coach id shows an error, not a spinner", vp, err.count() == 1,
            f"error text '{err.inner_text().replace(chr(10), ' ') if err.count() else ''}'; page title '{p.locator('h1').first.inner_text() if p.locator('h1').count() else ''}'")
    else:
        p.goto(f"{BASE}/coach?user={ids['owner']}", wait_until="domcontentloaded")
        p.wait_for_timeout(3000)
        err = p.locator('[data-testid="coach-error"]')
        et = err.inner_text().replace("\n", " ") if err.count() else ""
        rec("non-owner blocked from someone else's coach, with a way back", vp, err.count() == 1 and "Not allowed" in et, f"'{et}'")
        link = err.locator('a[href="/coach"]')
        if link.count():
            link.click()
            p.wait_for_timeout(3000)
            rec("'View my coach' returns to your own coach", vp,
                p.url.replace(BASE, "") == "/coach" and p.locator('[data-testid="coach-error"]').count() == 0, f"url {p.url.replace(BASE, '')}")


def rescore(p, vp, shots):
    cs = api(p, "/contacts")
    items = cs["data"] if isinstance(cs["data"], list) else (cs["data"] or {}).get("items") or []
    if not items:
        rec("Score with AI - contact available", vp, None, f"/contacts {cs['status']} returned no list")
        return
    cid = items[0]["id"]
    p.goto(f"{BASE}/contacts/{cid}", wait_until="domcontentloaded")
    p.wait_for_timeout(4000)
    btns = p.locator('[data-testid="rescore-contact-btn"]:visible')
    rec("Score with AI button present on a contact", vp, btns.count() >= 1,
        f"contact '{items[0].get('name')}', visible rescore buttons {btns.count()} ({[btns.nth(i).inner_text().strip() for i in range(btns.count())]}), url {p.url.replace(BASE, '')}")
    p.screenshot(path=str(shots / f"{vp}_contact_rescore.png"))
    if btns.count():
        before = toasts(p)
        b = btns.first
        label = b.inner_text().strip()
        b.click()
        p.wait_for_timeout(300)
        busy = b.inner_text().strip() if b.count() else ""
        p.wait_for_timeout(2500)
        new = [t for t in toasts(p) if t not in before]
        rec("Score with AI FAILURE path (POST blocked, no model call)", vp, bool(new),
            f"label '{label}' -> '{busy}' -> '{b.inner_text().strip() if b.count() else ''}'; toasts {new}")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    errors = []
    store = {}
    ids = {}
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        plan = [
            ("owner", "desk1440", {"width": 1440, "height": 900}, False),
            ("owner", "mob390", {"width": 390, "height": 844}, True),
            ("sales", "sales-d", {"width": 1440, "height": 900}, False),
            ("sales", "sales-m", {"width": 390, "height": 844}, True),
            ("production", "prod-d", {"width": 1440, "height": 900}, False),
            ("production", "prod-m", {"width": 390, "height": 844}, True),
            ("finance", "fin-d", {"width": 1440, "height": 900}, False),
            ("finance", "fin-m", {"width": 390, "height": 844}, True),
        ]
        for role, vp, size, mobile in plan:
            print(f"\n=== {role} @ {vp} ===")
            ctx = b.new_context(viewport=size, is_mobile=mobile, has_touch=mobile)
            p = ctx.new_page()
            p.on("console", lambda m, vp=vp: m.type == "error" and errors.append((vp, m.text[:160])))
            p.on("pageerror", lambda e, vp=vp: errors.append((vp, "PAGEERROR " + str(e)[:160])))
            demo_login(p, BASE, role)
            blocked = []
            p.route("**/api/**", lambda r: (blocked.append(r.request.method + " " + re.sub(r"https?://[^/]+", "", r.request.url)), r.abort())
                    if r.request.method in ("POST", "PATCH", "PUT", "DELETE") else r.continue_())
            if not ids:
                us = api(p, "/users")["data"] or []
                ids["owner"] = next(u["id"] for u in us if u.get("role") == "owner")
                ids["priya"] = next((u["id"] for u in us if (u.get("email") or "") == "sales@sharma.com"), None)
                print("  ids:", ids)
            if role == "owner":
                owner_view_as(p, vp, ids, OUT, mobile, store)
                coach(p, vp, role, ids, OUT)
                rescore(p, vp, OUT)
            else:
                self_view(p, vp, role, ids, OUT, mobile, store)
                coach(p, vp, role, ids, OUT)
            rec("writes blocked", vp, None, f"{len(blocked)}: {sorted(set(blocked))}")
            ctx.close()
        b.close()
    print("\n=== console errors ===")
    for e in sorted(set(errors)):
        print("  ", e)
    (OUT / "results.json").write_text(json.dumps({"results": results, "errors": sorted(set(errors))}, indent=2), encoding="utf-8")
    print(f"\n{sum(r['ok'] is True for r in results)} pass, {sum(r['ok'] is False for r in results)} fail, {sum(r['ok'] is None for r in results)} info")


if __name__ == "__main__":
    main()
