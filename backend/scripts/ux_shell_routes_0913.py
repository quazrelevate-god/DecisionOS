"""Area A - app shell + routing, 2026-09-13.

1. Signed-out visitors on every protected route.
2. Role x route matrix: Owner, Sales, Production, Finance on every route and
   redirect - final URL, Access Denied, crash, blank / endless skeleton, and the
   GET statuses the page received (a page that opens but whose data 403s is the
   FN-07 pattern).
3. Desktop shell: every nav pill, bell + dropdown, global search, user menu,
   language switcher.
4. Mobile shell: dock, More panel (every tile), Dex button, bell.
Every POST/PATCH/PUT/DELETE is aborted after sign-in.
"""
import json
import pathlib
import re
import sys
from collections import Counter

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from ux_login import demo_login  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

BASE = "http://localhost:3000"
OUT = pathlib.Path(__file__).resolve().parents[2] / ".audit-artifacts" / "shell_0913"
results = []

PROTECTED = ["/inbox", "/my-work", "/journal", "/settings", "/notifications", "/workflows", "/crm",
             "/calendar", "/operating-score", "/coach", "/brain", "/dex", "/finance", "/team", "/people"]
REDIRECTS = {"/brief": "/inbox?scope=morning", "/leave": "/team", "/review": "/finance?tab=inbox", "/ingest": "/finance?tab=inbox",
             "/tasks": "/my-work", "/priorities": "/my-work", "/meetings": "/", "/ledger": "/finance", "/ask": "/brain",
             "/contacts": "/crm", "/inbox-legacy": "/inbox", "/dashboard": "/inbox?scope=morning", "/no-such-page": "/"}


def rec(key, vp, ok, detail=""):
    results.append({"check": key, "viewport": vp, "ok": ok, "detail": detail})
    tag = "PASS" if ok is True else "FAIL" if ok is False else "INFO"
    print(f"  [{tag}] {vp:<8} {key}: {detail}")


def main_text(p, n=140):
    return p.evaluate(r"(n)=>((document.querySelector('main')||document.body).innerText||'').replace(/\s+/g,' ').trim().slice(0,n)", n)


def path_of(p):
    return p.url.replace(BASE, "") or "/"


def visit(p, route, statuses, wait=6500):
    statuses.clear()
    p.goto(f"{BASE}{route}", wait_until="domcontentloaded")
    p.wait_for_timeout(wait)
    info = p.evaluate(r"""() => {
      const m = document.querySelector('main');
      const txt = ((m||document.body).innerText||'').replace(/\s+/g,' ').trim();
      return {denied: !!document.querySelector('[data-testid="access-denied"]'),
              crash: /something went wrong|cannot read properties|is not a function/i.test(document.body.innerText),
              skeleton: document.querySelectorAll('.animate-pulse, [aria-busy="true"]').length,
              loadingText: /(^|\s)loading(…|\.\.\.)?(\s|$)/i.test(txt) && txt.length < 400,
              refusal: /access|permission|not allowed|restricted|ask your owner/i.test(txt),
              txt: txt.slice(0, 120), hasMain: !!m};
    }""")
    codes = Counter(v for v in statuses.values())
    info["final"] = path_of(p)
    info["http"] = dict(codes)
    info["forbidden"] = sorted(k for k, v in statuses.items() if v == 403)[:6]
    info["server_errors"] = sorted(k for k, v in statuses.items() if v >= 500)[:6]
    return info


def signed_out(b):
    ctx = b.new_context(viewport={"width": 1440, "height": 900})
    p = ctx.new_page()
    leaks = []
    for r in PROTECTED:
        p.goto(f"{BASE}{r}", wait_until="domcontentloaded")
        p.wait_for_timeout(2500)
        if "/login" not in p.url:
            leaks.append((r, path_of(p), main_text(p, 60)))
    rec("signed-out visitor is sent to sign-in from every protected route", "anon", not leaks, f"{len(PROTECTED)} routes; not redirected: {leaks}")
    ctx.close()


def matrix(p, role, vp, statuses):
    rows = {}
    for r in PROTECTED:
        i = visit(p, r, statuses)
        rows[r] = i
        problems = []
        if i["crash"]:
            problems.append("crash")
        if i["server_errors"]:
            problems.append(f"5xx {i['server_errors']}")
        if not i["denied"] and i["forbidden"] and not i["refusal"]:
            problems.append(f"opens but data 403s {i['forbidden']}")
        if not i["denied"] and (i["loadingText"] or (i["skeleton"] >= 3 and len(i["txt"]) < 60)):
            problems.append(f"still loading after 6.5s (skeleton {i['skeleton']}, text '{i['txt'][:50]}')")
        rec(f"{r}", vp, not problems,
            f"-> {i['final']} | {'ACCESS DENIED' if i['denied'] else 'opens'} | http {i['http']} | " + ("; ".join(problems) if problems else f"'{i['txt'][:60]}'"))
        if problems:
            p.screenshot(path=str(OUT / f"{vp}{r.replace('/', '_')}.png"))
    for r, want in REDIRECTS.items():
        p.goto(f"{BASE}{r}", wait_until="domcontentloaded")
        p.wait_for_timeout(2500)
        got = path_of(p)
        ok = got == want or (want == "/" and got in ("/", "/inbox", "/my-work", "/app"))
        rec(f"redirect {r}", vp, ok, f"-> {got} (expected {want})")
    return rows


def desktop_shell(p, role, vp):
    p.goto(f"{BASE}/my-work", wait_until="domcontentloaded")
    p.wait_for_timeout(3500)
    pills = p.evaluate("()=>[...document.querySelectorAll('header a[data-testid^=\"nav-\"], header [data-testid^=\"nav-\"]')].filter(e=>e.getBoundingClientRect().width>0).map(e=>[e.getAttribute('data-testid'), e.getAttribute('href')])")
    rec("nav pills shown", vp, None, json.dumps(pills))
    bad = []
    for tid, href in pills:
        if tid in ("nav-settings",):
            continue
        p.goto(f"{BASE}/my-work", wait_until="domcontentloaded")
        p.wait_for_timeout(2000)
        el = p.locator(f'[data-testid="{tid}"]:visible')
        if not el.count():
            continue
        el.first.click()
        p.wait_for_timeout(2500)
        cur = p.evaluate("(t)=>{const e=document.querySelector('[data-testid=\"'+t+'\"]'); return e ? e.getAttribute('aria-current') : null}", tid)
        denied = p.locator('[data-testid="access-denied"]').count()
        if (href and not path_of(p).startswith(href.split("?")[0])) or denied or cur != "page":
            bad.append((tid, href, path_of(p), f"aria-current={cur}", "DENIED" if denied else ""))
    rec("every nav pill routes to an open page and marks itself current", vp, not bad, f"problems {bad}")

    # bell
    p.goto(f"{BASE}/my-work", wait_until="domcontentloaded")
    p.wait_for_timeout(2500)
    bell = p.locator('[data-testid="notif-bell"]:visible')
    if bell.count():
        bell.first.click()
        p.wait_for_timeout(1200)
        dd = p.locator('[data-testid="notif-dropdown"]:visible').count()
        items = p.locator('[data-testid^="notif-item-"]:visible').count()
        va = p.locator('[data-testid="notif-view-all"]:visible')
        rec("bell opens the notification dropdown", vp, dd == 1, f"items {items}; count badge '{p.locator('[data-testid=\"notif-count\"]').first.inner_text() if p.locator('[data-testid=\"notif-count\"]').count() else ''}'")
        if va.count():
            va.first.click()
            p.wait_for_timeout(2000)
            rec("'View all' goes to /notifications", vp, path_of(p).startswith("/notifications"), path_of(p))
    # search
    p.goto(f"{BASE}/my-work", wait_until="domcontentloaded")
    p.wait_for_timeout(2500)
    p.locator('[data-testid="global-search-open"]').first.click()
    p.wait_for_timeout(700)
    opened = p.locator('[data-testid="global-search"]:visible').count()
    p.keyboard.press("Escape")
    p.wait_for_timeout(400)
    p.keyboard.press("Control+k")
    p.wait_for_timeout(700)
    kbd = p.locator('[data-testid="global-search"]:visible').count()
    if kbd or opened:
        if not kbd:
            p.locator('[data-testid="global-search-open"]').first.click()
            p.wait_for_timeout(600)
        p.locator('[data-testid="global-search"]').fill("overdue invoices")
        p.wait_for_timeout(500)
        go = p.locator('[data-testid="global-search-go"]:visible')
        if go.count():
            go.first.click()
            p.wait_for_timeout(2500)
    rec("global search opens (button + Ctrl+K) and hands the question to Dex", vp, bool(opened) and bool(kbd) and path_of(p).startswith("/brain?q="),
        f"button opens={bool(opened)}; Ctrl+K opens={bool(kbd)}; landed {path_of(p)}; denied={p.locator('[data-testid=access-denied]').count()}")
    # user menu
    p.goto(f"{BASE}/my-work", wait_until="domcontentloaded")
    p.wait_for_timeout(2500)
    p.locator('[data-testid="rail-user-menu"]').first.click()
    p.wait_for_timeout(800)
    who = p.locator('[data-testid="current-user"]').inner_text().replace("\n", " ") if p.locator('[data-testid="current-user"]').count() else ""
    ten = p.locator('[data-testid="tenant-name"]').inner_text() if p.locator('[data-testid="tenant-name"]').count() else ""
    st = p.locator('[data-testid="nav-settings"]:visible').count()
    rec("user menu shows identity, workspace, Settings only for the owner", vp, bool(who) and bool(ten) and (st == 1) == (role == "owner"),
        f"'{who}' / '{ten}'; Settings item {st}")
    p.keyboard.press("Escape")
    # language
    lang = p.locator('header button[aria-label*="anguage" i], header [data-testid*="lang" i]').first
    if lang.count():
        lang.click()
        p.wait_for_timeout(800)
        opts = p.locator('[data-testid^="lang-option-"]:visible').count()
        rec("language switcher opens with options (not switched)", vp, opts > 1, f"{opts} language options")
        p.keyboard.press("Escape")
    p.screenshot(path=str(OUT / f"{vp}_shell.png"))


def mobile_shell(p, role, vp):
    p.goto(f"{BASE}/my-work", wait_until="domcontentloaded")
    p.wait_for_timeout(3500)
    dock = p.evaluate("()=>[...document.querySelectorAll('[data-testid=\"floating-dock\"] a, [data-testid=\"floating-dock\"] button')].filter(e=>e.getBoundingClientRect().width>0).map(e=>[e.getAttribute('data-testid'), e.getAttribute('href'), Math.round(e.getBoundingClientRect().width), Math.round(e.getBoundingClientRect().height)])")
    rec("dock items", vp, all(w >= 24 and h >= 24 for _, _, w, h in dock), json.dumps(dock))
    bad = []
    for tid, href, *_ in dock:
        if not href or not tid:
            continue
        p.goto(f"{BASE}/my-work", wait_until="domcontentloaded")
        p.wait_for_timeout(2000)
        p.locator(f'[data-testid="{tid}"]:visible').first.click()
        p.wait_for_timeout(2300)
        if not path_of(p).startswith(href.split("?")[0]) or p.locator('[data-testid="access-denied"]').count():
            bad.append((tid, href, path_of(p)))
    rec("every dock item routes to an open page", vp, not bad, f"problems {bad}")

    p.goto(f"{BASE}/my-work", wait_until="domcontentloaded")
    p.wait_for_timeout(2500)
    more = p.locator('[data-testid="dock-more"]:visible')
    tiles = []
    if more.count():
        more.first.click()
        p.wait_for_timeout(1300)
        tiles = p.evaluate("()=>[...document.querySelectorAll('[data-testid=\"allapps-panel\"] [data-testid^=\"allapps-tile-\"]')].filter(e=>e.getBoundingClientRect().width>0).map(e=>[e.getAttribute('data-testid').slice(13), e.getAttribute('href'), e.innerText.replace(/\\s+/g,' ').trim().slice(0,30)])")
        p.screenshot(path=str(OUT / f"{vp}_more_panel.png"))
    rec("More panel tiles", vp, len(tiles) > 0, json.dumps(tiles))
    bad = []
    for key, href, label in tiles:
        p.goto(f"{BASE}/my-work", wait_until="domcontentloaded")
        p.wait_for_timeout(2000)
        p.locator('[data-testid="dock-more"]:visible').first.click()
        p.wait_for_timeout(1100)
        t = p.locator(f'[data-testid="allapps-panel"] [data-testid="allapps-tile-{key}"]:visible')
        if not t.count():
            bad.append((key, "tile gone"))
            continue
        before = path_of(p)
        t.first.click()
        p.wait_for_timeout(2600)
        denied = p.locator('[data-testid="access-denied"]').count()
        crash = p.evaluate("()=>/something went wrong|cannot read properties/i.test(document.body.innerText)")
        panel_still = p.locator('[data-testid="allapps-panel"]:visible').count()
        if denied or crash or (path_of(p) == before and panel_still):
            bad.append((key, label, path_of(p), "DENIED" if denied else "", "CRASH" if crash else "", "no change" if path_of(p) == before and panel_still else ""))
    rec("every More tile opens a page this role can use", vp, not bad, f"{len(tiles)} tiles; problems {bad}")

    p.goto(f"{BASE}/my-work", wait_until="domcontentloaded")
    p.wait_for_timeout(2500)
    fab = p.locator('[data-testid="dex-fab"]:visible')
    if fab.count():
        r = fab.first.bounding_box()
        fab.first.click()
        p.wait_for_timeout(1200)
        opened = p.locator('[data-testid^="dex-pick-"]:visible, [data-testid="dex-sheet"]:visible').count()
        rec("Dex button opens its picker / sheet", vp, opened > 0, f"fab {round(r['width'])}x{round(r['height'])}; opened {opened}")
        p.keyboard.press("Escape")
    bell = p.locator('[data-testid="notif-bell"]:visible, a[href="/notifications"]:visible')
    if bell.count():
        bell.first.click()
        p.wait_for_timeout(2000)
        rec("mobile bell reaches notifications", vp, path_of(p).startswith("/notifications") or p.locator('[data-testid="notif-dropdown"]:visible').count() > 0, path_of(p))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    errors = []
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        print("\n=== signed out ===")
        signed_out(b)
        for role in ("owner", "sales", "production", "finance"):
            for vp, size, mobile in ((f"{role[:4]}-d", {"width": 1440, "height": 900}, False), (f"{role[:4]}-m", {"width": 390, "height": 844}, True)):
                print(f"\n=== {role} @ {vp} ===")
                ctx = b.new_context(viewport=size, is_mobile=mobile, has_touch=mobile)
                p = ctx.new_page()
                statuses = {}
                p.on("response", lambda r, s=statuses: "/api/" in r.url and r.request.method == "GET" and s.__setitem__(re.sub(r"https?://[^/]+/api", "", r.url.split("?")[0]), r.status))
                p.on("pageerror", lambda e, vp=vp: errors.append((vp, "PAGEERROR " + str(e)[:150])))
                demo_login(p, BASE, role)
                p.route("**/api/**", lambda r: r.abort() if r.request.method in ("POST", "PATCH", "PUT", "DELETE") else r.continue_())
                if not mobile:
                    matrix(p, role, vp, statuses)
                    desktop_shell(p, role, vp)
                else:
                    mobile_shell(p, role, vp)
                p.unroute_all(behavior="ignoreErrors")
                ctx.close()
        b.close()
    print("\n=== page errors ===")
    for e in sorted(set(errors)):
        print("  ", e)
    (OUT / "results.json").write_text(json.dumps({"results": results, "errors": sorted(set(errors))}, indent=2), encoding="utf-8")
    print(f"\n{sum(r['ok'] is True for r in results)} pass, {sum(r['ok'] is False for r in results)} fail, {sum(r['ok'] is None for r in results)} info")


if __name__ == "__main__":
    main()
