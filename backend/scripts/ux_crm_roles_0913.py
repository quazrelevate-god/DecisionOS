"""CRM pass, 2026-09-13 - the same approach as Team and Ops.

Owner (desktop 1440 + mobile 390): every card -> profile -> back, every profile
control, missing contact, forced failures and a slow list, scroll reach.
Sales / Production / Finance (desktop + mobile): nav, direct links, API refusal,
and links elsewhere in the app that would send them into CRM.
Every POST/PATCH/PUT/DELETE is aborted after sign-in.
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
OUT = pathlib.Path(__file__).resolve().parents[2] / ".audit-artifacts" / "crm_0913"
results = []

APIJS = """async ([path]) => {
  const tok = Object.keys(localStorage).filter(k=>/token/i.test(k)).map(k=>localStorage.getItem(k))[0];
  const h = {}; if (tok) h['Authorization'] = 'Bearer ' + String(tok).replace(/^"|"$/g,'');
  const r = await fetch('%s' + path, {headers: h}); let d=null; try { d = await r.json(); } catch(e) {}
  return {status: r.status, data: d}; }""" % API


def rec(key, vp, ok, detail=""):
    results.append({"check": key, "viewport": vp, "ok": ok, "detail": detail})
    tag = "PASS" if ok is True else "FAIL" if ok is False else "INFO"
    print(f"  [{tag}] {vp:<9} {key}: {detail}")


def api(p, path):
    return p.evaluate(APIJS, [path])


def first_contact_id(p):
    d = api(p, "/contacts")["data"]
    if isinstance(d, dict):
        d = d.get("items") or d.get("contacts") or d.get("data") or d.get("results") or []
    return d[0]["id"] if d else None


def toasts(p):
    return p.evaluate("()=>[...document.querySelectorAll('[data-sonner-toast]')].map(t=>t.textContent.trim())")


def main_text(p, n=160):
    return p.evaluate(r"(n)=>((document.querySelector('main')||document.body).innerText||'').replace(/\s+/g,' ').trim().slice(0,n)", n)


def wait_cards(p, t=12):
    for _ in range(t * 2):
        if p.locator('[data-testid^="crm-card-"]:visible').count():
            return True
        p.wait_for_timeout(500)
    return False


def wait_profile(p, t=14):
    for _ in range(t * 2):
        if p.locator('[data-testid="cp-header"]:visible, [data-testid="profile-header"]:visible').count():
            return True
        p.wait_for_timeout(500)
    return False


def layout(p):
    return p.evaluate("""() => { const els=[...document.querySelectorAll('main a, main button, main input, main select, main textarea')]
        .filter(e=>{const r=e.getBoundingClientRect(); return r.width>0&&r.height>0;});
      return {overflow: document.documentElement.scrollWidth-document.documentElement.clientWidth,
        small: els.filter(e=>{const r=e.getBoundingClientRect(); return r.height<24||r.width<24;})
          .map(e=>[(e.getAttribute('aria-label')||e.textContent||e.getAttribute('data-testid')||'').trim().slice(0,28), Math.round(e.getBoundingClientRect().width), Math.round(e.getBoundingClientRect().height)]).slice(0,12),
        crash: /something went wrong|cannot read properties/i.test(document.body.innerText)}; }""")


# ---------------------------------------------------------------- owner
def owner_pass(p, vp, mobile):
    p.goto(f"{BASE}/crm", wait_until="domcontentloaded")
    ok = wait_cards(p)
    cards = p.locator('[data-testid^="crm-card-"]:visible')
    ids = [cards.nth(i).get_attribute("data-testid")[9:] for i in range(cards.count())]
    lay = layout(p)
    rec("CRM list loads", vp, ok and not lay["crash"], f"{len(ids)} cards; overflow {lay['overflow']}px")
    p.screenshot(path=str(OUT / f"{vp}_list.png"))

    # scroll reach (desktop main is the scroller since 7d2fabe)
    p.evaluate("()=>{const m=document.querySelector('main'); if(m) m.scrollTo(0,m.scrollHeight); window.scrollTo(0,document.body.scrollHeight);}")
    p.wait_for_timeout(700)
    last = p.evaluate("()=>{const c=[...document.querySelectorAll('[data-testid^=\"crm-card-\"]')].filter(e=>e.getBoundingClientRect().width>0).pop(); if(!c) return null; const r=c.getBoundingClientRect(); return {bottom:Math.round(r.bottom), vh:innerHeight}}")
    rec("last contact card reachable by scrolling", vp, bool(last) and last["bottom"] <= last["vh"], f"{last}")

    # every card -> profile -> back
    opened, broken, back_ok = 0, [], 0
    for cid in ids:
        p.goto(f"{BASE}/crm", wait_until="domcontentloaded")
        wait_cards(p)
        c = p.locator(f'[data-testid="crm-card-{cid}"]:visible')
        if not c.count():
            broken.append((cid[:8], "card gone"))
            continue
        c.first.scroll_into_view_if_needed()
        c.first.click()
        wait_profile(p)
        head = p.locator('[data-testid="cp-header"]:visible, [data-testid="profile-header"]:visible').count()
        url = p.url.replace(BASE, "")
        if head and url == f"/contacts/{cid}" and not layout(p)["crash"]:
            opened += 1
        else:
            broken.append((cid[:8], url, main_text(p, 60)))
        back = p.locator('[data-testid="cp-back"]:visible, [data-testid="profile-back"]:visible')
        if back.count():
            back.first.click()
            p.wait_for_timeout(1500)
            if p.url.replace(BASE, "").startswith("/crm"):
                back_ok += 1
    rec("every card opens its profile", vp, opened == len(ids), f"{opened}/{len(ids)}; problems {broken}")
    rec("profile Back returns to the CRM list", vp, back_ok == len(ids), f"{back_ok}/{len(ids)}")

    # deep profile pass on the first contact with the most content
    cid = ids[0]
    p.goto(f"{BASE}/contacts/{cid}", wait_until="domcontentloaded")
    wait_profile(p)
    p.wait_for_timeout(800)
    p.screenshot(path=str(OUT / f"{vp}_profile.png"), full_page=True)
    lay = layout(p)
    rec("profile layout", vp, lay["overflow"] <= 1 and not lay["crash"], f"overflow {lay['overflow']}px; under-24px {lay['small']}")
    if mobile:
        toggles = p.locator('[data-testid^="cp-toggle-"]:visible')
        n = toggles.count()
        flipped = 0
        for i in range(n):
            t = toggles.nth(i)
            a = t.get_attribute("aria-expanded")
            t.click()
            p.wait_for_timeout(250)
            if t.get_attribute("aria-expanded") != a:
                flipped += 1
            t.click()
            p.wait_for_timeout(200)
        rec("every profile section toggles", vp, n > 0 and flipped == n, f"{flipped}/{n} changed aria-expanded")
        links = p.evaluate("()=>['cp-call','cp-email'].map(k=>{const e=document.querySelector('[data-testid=\"'+k+'\"]'); return [k, e? (e.getAttribute('href')||e.tagName) : null]})")
        rec("call / email actions", vp, all(v for _, v in links), json.dumps(links))
    else:
        tabs = p.locator('[data-testid^="rel-"]:visible')
        rec("relationship card renders", vp, p.locator('[data-testid="relationship-card"]').count() >= 1, f"rel-* elements {tabs.count()}")
        row_links = p.evaluate("()=>[...document.querySelectorAll('main a[href]')].filter(a=>a.getBoundingClientRect().width>0).map(a=>a.getAttribute('href')).filter(h=>h.startsWith('/'))")
        bad = []
        for h in sorted(set(row_links)):
            p.goto(f"{BASE}{h}", wait_until="domcontentloaded")
            p.wait_for_timeout(2200)
            txt = main_text(p, 80)
            if not txt or re.search(r"access denied|not found|isn't available|something went wrong", txt, re.I):
                bad.append((h, txt[:50]))
        rec("every link on the profile opens a real screen", vp, not bad, f"{len(set(row_links))} links; problems {bad}")
        p.goto(f"{BASE}/contacts/{cid}", wait_until="domcontentloaded")
        wait_profile(p)
        p.wait_for_timeout(800)
        save = p.locator('[data-testid="crm-activity-save"]:visible')
        if save.count():
            dis = save.is_disabled()
            before = toasts(p)
            if not dis:
                save.click()
                p.wait_for_timeout(1200)
            empty_toast = [t for t in toasts(p) if t not in before]
            rec("Log activity with no text is refused", vp, dis or bool(empty_toast), f"save disabled={dis}; toast {empty_toast}")
            kinds = p.locator('[data-testid="crm-activity-kind"]')
            opts = kinds.evaluate("s=>s.tagName==='SELECT'?[...s.options].map(o=>o.value):[...s.querySelectorAll('button')].map(b=>b.textContent.trim())") if kinds.count() else []
            p.locator('[data-testid="crm-activity-text"]').fill("Audit probe - not saved")
            before = toasts(p)
            save.click()
            p.wait_for_timeout(1800)
            new = [t for t in toasts(p) if t not in before]
            kept = p.locator('[data-testid="crm-activity-text"]').input_value()
            rec("Log activity with the write blocked reports failure and keeps the text", vp, bool(new) and kept != "",
                f"kinds {opts}; toast {new}; text kept '{kept}'")

    # missing contact
    p.goto(f"{BASE}/contacts/does-not-exist", wait_until="domcontentloaded")
    p.wait_for_timeout(5000)
    txt = main_text(p)
    cta = p.locator("main button:visible, main a:visible").filter(has_text=re.compile(r"back|crm|people|contacts", re.I))
    rec("missing contact explains itself with a way back", vp, bool(re.search(r"isn't available|not found|no longer|removed", txt, re.I)) and cta.count() > 0,
        f"'{txt}'; CTAs {[cta.nth(i).inner_text().strip() for i in range(cta.count())]}")
    p.screenshot(path=str(OUT / f"{vp}_missing_contact.png"))
    if cta.count():
        cta.first.click()
        p.wait_for_timeout(2000)
        rec("missing-contact CTA goes back to CRM", vp, p.url.replace(BASE, "").startswith("/crm"), p.url.replace(BASE, ""))


def failure_injection(b, vp, size, mobile):
    # 1) contact list request fails
    ctx = b.new_context(viewport=size, is_mobile=mobile, has_touch=mobile)
    p = ctx.new_page()
    demo_login(p, BASE, "owner")
    p.route(re.compile(r".*/api/contacts\?.*"), lambda r: r.abort())
    p.goto(f"{BASE}/crm", wait_until="domcontentloaded")
    p.wait_for_timeout(7000)
    txt = main_text(p, 220)
    cards = p.locator('[data-testid^="crm-card-"]:visible').count()
    says_error = bool(re.search(r"couldn't|could not|failed|went wrong|try again|unable", txt, re.I))
    says_empty = bool(re.search(r"no contacts|no customers|add your first|nothing here|no buyers|no people", txt, re.I))
    rec("contact list request fails -> page says so (not 'empty')", vp, says_error and not says_empty,
        f"cards {cards}; error wording={says_error}; empty-state wording={says_empty}; main '{txt}'; toasts {toasts(p)}")
    p.screenshot(path=str(OUT / f"{vp}_list_failed.png"))
    ctx.close()
    # 2) slow list
    ctx = b.new_context(viewport=size, is_mobile=mobile, has_touch=mobile)
    p = ctx.new_page()
    demo_login(p, BASE, "owner")

    def slow(route):
        p.wait_for_timeout(5000)
        route.continue_()
    p.route(re.compile(r".*/api/contacts\?.*"), slow)
    p.goto(f"{BASE}/crm", wait_until="domcontentloaded")
    p.wait_for_timeout(1800)
    loading = p.evaluate(r"()=>({pulse: document.querySelectorAll('.animate-pulse').length, busy: !!document.querySelector('[aria-busy=\"true\"]'), txt: ((document.querySelector('main')||document.body).innerText||'').replace(/\s+/g,' ').slice(0,160)})")
    empty_early = bool(re.search(r"no contacts|no customers|add your first|nothing here|no buyers", loading["txt"], re.I))
    rec("while contacts load, the page shows loading (not 'empty')", vp, (loading["pulse"] > 0 or loading["busy"] or re.search(r"loading", loading["txt"], re.I)) and not empty_early,
        json.dumps(loading))
    p.wait_for_timeout(5500)
    p.unroute_all(behavior="ignoreErrors")
    ctx.close()
    # 3) profile request fails
    ctx = b.new_context(viewport=size, is_mobile=mobile, has_touch=mobile)
    p = ctx.new_page()
    demo_login(p, BASE, "owner")
    cid = first_contact_id(p)
    p.route(re.compile(r".*/api/contacts/[^/]+/profile.*"), lambda r: r.abort())
    p.goto(f"{BASE}/contacts/{cid}", wait_until="domcontentloaded")
    p.wait_for_timeout(6000)
    txt = main_text(p)
    rec("profile request fails -> error state with a way back", vp,
        bool(re.search(r"isn't available|couldn't|not found|went wrong|try again", txt, re.I)), f"'{txt}'")
    ctx.close()


# ---------------------------------------------------------------- other roles
def role_pass(p, vp, role, mobile, sample_cid):
    me = api(p, "/auth/me")["data"] or {}
    perms = me.get("permissions")
    rec("signed-in role and permissions", vp, None, f"{me.get('name')} role={me.get('role')} people={'people' in (perms or [])} finance={'finance' in (perms or [])}")
    p.goto(f"{BASE}/my-work", wait_until="domcontentloaded")
    p.wait_for_timeout(3000)
    if mobile:
        more = p.locator('[data-testid="dock-more"]:visible')
        crm_in_more = None
        if more.count():
            more.first.click()
            p.wait_for_timeout(1200)
            crm_in_more = p.evaluate("()=>[...document.querySelectorAll('a[href=\"/crm\"], [href=\"/crm\"]')].filter(e=>e.getBoundingClientRect().width>0).length")
            p.keyboard.press("Escape")
            p.wait_for_timeout(500)
        rec("CRM hidden from the mobile More panel", vp, crm_in_more == 0, f"visible /crm links in More: {crm_in_more}")
    else:
        nav = p.locator('[data-testid="nav-crm"]:visible').count()
        rec("CRM hidden from the desktop nav", vp, nav == 0, f"nav-crm visible={nav}")

    for path in ("/crm", f"/contacts/{sample_cid}"):
        p.goto(f"{BASE}{path}", wait_until="domcontentloaded")
        p.wait_for_timeout(3500)
        denied = p.locator('[data-testid="access-denied"]:visible').count()
        rec(f"direct link {path.split('/')[1]} -> Access Denied", vp, denied == 1, f"'{main_text(p, 110)}'")
    p.screenshot(path=str(OUT / f"{vp}_access_denied.png"))
    home = p.locator('[data-testid="access-denied-home"]:visible')
    if home.count():
        home.click()
        p.wait_for_timeout(2000)
        rec("'Go to My Work' leaves the denied page", vp, p.url.replace(BASE, "").startswith("/my-work"), p.url.replace(BASE, ""))
    st = api(p, "/contacts")["status"]
    st2 = api(p, f"/contacts/{sample_cid}/profile")["status"]
    rec("server also refuses contacts to this role", vp, st == 403, f"GET /contacts {st}; GET /contacts/<id>/profile {st2}")

    # links elsewhere that send this role into CRM
    found = {}
    for path in ("/inbox", "/my-work", "/operating-score", "/finance", "/brain"):
        p.goto(f"{BASE}{path}", wait_until="domcontentloaded")
        p.wait_for_timeout(3500)
        hrefs = p.evaluate("()=>[...document.querySelectorAll('a[href]')].filter(a=>a.getBoundingClientRect().width>0).map(a=>a.getAttribute('href')).filter(h=>/^\\/(crm|contacts)/.test(h))")
        if hrefs:
            found[path] = sorted(set(hrefs))[:6]
    rec("no visible links elsewhere lead this role into CRM", vp, not found, json.dumps(found))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    errors = []
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        sample_cid = None
        for role, vp, size, mobile in (
            ("owner", "desk1440", {"width": 1440, "height": 900}, False),
            ("owner", "mob390", {"width": 390, "height": 844}, True),
        ):
            print(f"\n=== owner @ {vp} ===")
            ctx = b.new_context(viewport=size, is_mobile=mobile, has_touch=mobile)
            p = ctx.new_page()
            p.on("console", lambda m, vp=vp: m.type == "error" and errors.append((vp, m.text[:150])))
            p.on("pageerror", lambda e, vp=vp: errors.append((vp, "PAGEERROR " + str(e)[:150])))
            demo_login(p, BASE, "owner")
            blocked = []
            p.route("**/api/**", lambda r: (blocked.append(r.request.method + " " + re.sub(r"https?://[^/]+", "", r.request.url)), r.abort())
                    if r.request.method in ("POST", "PATCH", "PUT", "DELETE") else r.continue_())
            sample_cid = sample_cid or first_contact_id(p)
            owner_pass(p, vp, mobile)
            rec("writes blocked", vp, None, f"{len(blocked)}: {sorted(set(blocked))}")
            ctx.close()
            print(f"--- failure injection @ {vp} ---")
            failure_injection(b, vp, size, mobile)
        for role in ("sales", "production", "finance"):
            for vp, size, mobile in ((f"{role[:4]}-d", {"width": 1440, "height": 900}, False), (f"{role[:4]}-m", {"width": 390, "height": 844}, True)):
                print(f"\n=== {role} @ {vp} ===")
                ctx = b.new_context(viewport=size, is_mobile=mobile, has_touch=mobile)
                p = ctx.new_page()
                p.on("pageerror", lambda e, vp=vp: errors.append((vp, "PAGEERROR " + str(e)[:150])))
                demo_login(p, BASE, role)
                p.route("**/api/**", lambda r: r.abort() if r.request.method in ("POST", "PATCH", "PUT", "DELETE") else r.continue_())
                role_pass(p, vp, role, mobile, sample_cid)
                ctx.close()
        b.close()
    print("\n=== console / page errors ===")
    for e in sorted(set(errors)):
        print("  ", e)
    (OUT / "results.json").write_text(json.dumps({"results": results, "errors": sorted(set(errors))}, indent=2), encoding="utf-8")
    print(f"\n{sum(r['ok'] is True for r in results)} pass, {sum(r['ok'] is False for r in results)} fail, {sum(r['ok'] is None for r in results)} info")


if __name__ == "__main__":
    main()
