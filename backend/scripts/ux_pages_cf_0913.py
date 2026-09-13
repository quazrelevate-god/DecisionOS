"""Areas C-F, 2026-09-13: Dex / Company Brain, CEO Journal, Calendar,
Notifications, Settings, People.

Owner, Sales, Production, Finance at 1440 and 390. Writes blocked, so no
question reaches the model, no document is uploaded or deleted, no
notification is marked read, no setting is saved.
"""
import json
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from ux_login import demo_login  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

BASE = "http://localhost:3000"
OUT = pathlib.Path(__file__).resolve().parents[2] / ".audit-artifacts" / "pages_cf_0913"
results = []


def rec(key, vp, ok, detail=""):
    results.append({"check": key, "viewport": vp, "ok": ok, "detail": detail})
    tag = "PASS" if ok is True else "FAIL" if ok is False else "INFO"
    print(f"  [{tag}] {vp:<7} {key}: {detail}")


def toasts(p):
    return p.evaluate("()=>[...document.querySelectorAll('[data-sonner-toast]')].map(t=>t.textContent.trim())")


def new_toasts(p, before, ms=2500):
    for _ in range(ms // 250):
        n = [t for t in toasts(p) if t not in before]
        if n:
            return n
        p.wait_for_timeout(250)
    return []


def text(p, n=200, sel="main"):
    return p.evaluate(r"([n,s])=>((document.querySelector(s)||document.body).innerText||'').replace(/\s+/g,' ').trim().slice(0,n)", [n, sel])


def path_of(p):
    return p.url.replace(BASE, "") or "/"


def dialogs(p):
    return p.locator('[role="dialog"][data-state="open"]').count()


def close_all(p):
    for _ in range(3):
        if not dialogs(p):
            return
        p.keyboard.press("Escape")
        p.wait_for_timeout(350)


def open_page(p, vp, route, statuses, name):
    statuses.clear()
    p.goto(f"{BASE}{route}", wait_until="domcontentloaded")
    p.wait_for_timeout(5500)
    info = p.evaluate("""() => { const els=[...document.querySelectorAll('main a, main button, main input:not([type=file]), main select, main textarea')]
        .filter(e=>{const r=e.getBoundingClientRect(); return r.width>0&&r.height>0;});
      return {denied: !!document.querySelector('[data-testid="access-denied"]'),
        crash: /something went wrong|cannot read properties|is not a function/i.test(document.body.innerText),
        overflow: document.documentElement.scrollWidth-document.documentElement.clientWidth,
        small: els.filter(e=>{const r=e.getBoundingClientRect(); return r.height<24||r.width<24;})
          .map(e=>[(e.getAttribute('aria-label')||e.textContent||e.getAttribute('data-testid')||'').trim().slice(0,24), Math.round(e.getBoundingClientRect().width), Math.round(e.getBoundingClientRect().height)]).slice(0,8)}; }""")
    forb = sorted(k for k, v in statuses.items() if v == 403)
    p.screenshot(path=str(OUT / f"{vp}_{name}.png"))
    if info["denied"]:
        rec(f"{name}: access", vp, None, "Access Denied")
        return False
    rec(f"{name}: loads", vp, not info["crash"] and info["overflow"] <= 1,
        f"overflow {info['overflow']}px; data refused {forb}; under-24px {info['small']}")
    return True


# ------------------------------------------------------------------ Brain
def brain(p, vp, role, mobile, blocked, statuses):
    if not open_page(p, vp, "/brain", statuses, "brain"):
        return
    empty = p.locator('[data-testid="brain-empty"]:visible').count()
    sugg = p.locator('[data-testid="ask-suggestion"]:visible')
    inp = p.locator('[data-testid="dex-stage-input"]:visible')
    rec("brain: composer and suggestions", vp, inp.count() == 1, f"empty state={bool(empty)}; suggestions {sugg.count()}")
    if inp.count():
        send = p.locator('[data-testid="dex-stage-send"]:visible')
        dis = send.first.is_disabled() if send.count() else None
        rec("brain: Send disabled while the question is empty", vp, dis is True, f"disabled={dis}")
        inp.first.fill("What is overdue this week?")
        before, nb = toasts(p), len(blocked)
        send.first.click()
        p.wait_for_timeout(3500)
        t = new_toasts(p, before, 2000)
        conv = text(p, 400, '[data-testid="brain-conversation"]')
        stuck = p.locator('[data-testid="brain-loading"]:visible, [data-testid="dex-stage-stop"]:visible').count()
        err_in_chat = bool(re.search(r"couldn't|could not|failed|went wrong|try again|unavailable", conv, re.I))
        rec("brain: a failed ask (POST blocked, no model call) is reported and not left spinning", vp,
            (bool(t) or err_in_chat) and not stuck, f"requests {blocked[nb:]}; toast {t}; error in chat={err_in_chat}; still busy={bool(stuck)}; chat '{conv[-120:]}'")
    clear = p.locator('[data-testid="brain-clear"]:visible')
    if clear.count():
        clear.first.click()
        p.wait_for_timeout(700)
        rec("brain: Clear resets the conversation", vp, p.locator('[data-testid^="chat-msg-"]:visible').count() == 0, "")
    mic = p.locator('[data-testid="dex-stage-mic"]:visible')
    if mic.count():
        before = toasts(p)
        mic.first.click()
        p.wait_for_timeout(1500)
        t = new_toasts(p, before, 1500)
        status = text(p, 120, '[data-testid="dex-stage-status"]')
        rec("brain: mic with no microphone permission explains itself", vp, bool(t) or bool(re.search(r"mic|permission|allow", status, re.I)), f"toast {t}; status '{status}'")
        stop = p.locator('[data-testid="dex-stage-stop"]:visible')
        if stop.count():
            stop.first.click()
    # deep link from global search
    nb = len(blocked)
    p.goto(f"{BASE}/brain?q=overdue%20invoices", wait_until="domcontentloaded")
    p.wait_for_timeout(4000)
    rec("brain: /brain?q= from global search asks the question", vp, any("/ask" in x for x in blocked[nb:]) or "overdue invoices" in text(p, 800),
        f"requests {blocked[nb:]}; question visible={'overdue invoices' in text(p, 800)}")

    # documents
    p.goto(f"{BASE}/brain", wait_until="domcontentloaded")
    p.wait_for_timeout(4000)
    tog = p.locator('[data-testid="brain-documents-toggle"]:visible')
    if not tog.count():
        rec("brain: documents toggle", vp, None, "not visible")
        return
    tog.first.click()
    p.wait_for_timeout(2500)
    cards = p.locator('[data-testid^="brain-doc-card-"]:visible')
    rec("brain: documents panel opens", vp, p.locator('[data-testid="brain-documents-panel"]:visible').count() == 1, f"{cards.count()} documents")
    s = p.locator('[data-testid="brain-doc-search"]:visible')
    if s.count():
        n0 = cards.count()
        s.first.fill("zzqq-no-match")
        p.wait_for_timeout(1500)
        n1 = p.locator('[data-testid^="brain-doc-card-"]:visible').count()
        empty_txt = text(p, 300, '[data-testid="brain-documents-panel"]')
        s.first.fill("")
        p.wait_for_timeout(1200)
        rec("brain: document search narrows and says when nothing matches", vp, n1 == 0 and bool(re.search(r"no (documents|match|results)|nothing", empty_txt, re.I)),
            f"{n0} -> {n1}; panel text '{empty_txt[-100:]}'")
    add = p.locator('[data-testid="brain-doc-add-btn"]:visible')
    rec("brain: Add document shown only to owner / team_manage", vp, (add.count() > 0) == (role == "owner"), f"add button {add.count()}")
    if add.count():
        add.first.click()
        p.wait_for_timeout(900)
        sub = p.locator('[data-testid="brain-doc-upload-submit"]:visible')
        before, nb = toasts(p), len(blocked)
        dis = sub.first.is_disabled() if sub.count() else None
        if sub.count() and not dis:
            sub.first.click()
        t = new_toasts(p, before, 1500)
        rec("brain: empty upload is refused before sending", vp, (dis or bool(t)) and not blocked[nb:], f"submit disabled={dis}; toast {t}; requests {blocked[nb:]}")
        x = p.locator('[data-testid="brain-doc-upload-close"]:visible')
        if x.count():
            x.first.click()
            p.wait_for_timeout(500)
        close_all(p)
    dl = p.locator('[data-testid^="brain-doc-delete-"]:visible')
    if dl.count():
        seen = []
        p.once("dialog", lambda d: (seen.append(d.message[:90]), d.dismiss()))
        nb = len(blocked)
        dl.first.click()
        p.wait_for_timeout(1200)
        rec("brain: deleting a document asks first (dismissed)", vp, bool(seen) and not blocked[nb:], f"confirm {seen}; requests {blocked[nb:]}")


# ------------------------------------------------------------------ Journal
def journal(p, vp, role, blocked, statuses):
    if not open_page(p, vp, "/journal", statuses, "journal"):
        return
    views = p.locator('[data-testid^="journal-view-"]:visible')
    vs = []
    for i in range(views.count()):
        v = views.nth(i)
        v.click()
        p.wait_for_timeout(700)
        vs.append((v.get_attribute("data-testid")[13:], v.get_attribute("aria-pressed")))
    rec("journal: views switch", vp, bool(vs), json.dumps(vs))
    lab = p.locator('[data-testid="journal-month-label"]:visible')
    if lab.count():
        l0 = lab.first.inner_text()
        p.locator('[data-testid="journal-week-prev"]:visible').first.click()
        p.wait_for_timeout(700)
        l1 = lab.first.inner_text()
        p.locator('[data-testid="journal-week-next"]:visible').first.click()
        p.wait_for_timeout(700)
        cells = p.locator('[data-testid^="journal-day-cell-"]:visible')
        if cells.count():
            cells.first.click()
            p.wait_for_timeout(700)
        rec("journal: week navigation and day selection", vp, True, f"'{l0}' -> prev '{l1}'; day cells {cells.count()}; selected '{text(p, 80, '[data-testid=journal-selected-day]')}'")
    si = p.locator('[data-testid="journal-search-input"]:visible')
    if si.count():
        si.first.fill("zzqq-no-match")
        p.locator('[data-testid="journal-search-btn"]:visible').first.click()
        p.wait_for_timeout(2500)
        rec("journal: search with no match says so", vp, bool(re.search(r"no (entries|results|decisions|match)|nothing", text(p, 900), re.I)), f"'{text(p, 900)[-140:]}'")
        si.first.fill("")
        p.locator('[data-testid="journal-search-btn"]:visible').first.click()
        p.wait_for_timeout(2500)
    d = p.locator('[data-testid^="journal-decision-"]:visible')
    if d.count():
        d.first.click()
        p.wait_for_timeout(2000)
        tl = p.locator('[data-testid="timeline-dialog"]:visible').count()
        ev = p.locator('[data-testid^="timeline-event-"]:visible').count()
        rec("journal: a decision opens its timeline", vp, tl == 1 or path_of(p).startswith("/decisions/"), f"timeline dialog={tl}; events {ev}; url {path_of(p)}")
        close_all(p)
    se = p.locator('[data-testid="journal-show-earlier"]:visible')
    if se.count():
        n0 = p.locator('[data-testid^="journal-day-"]:visible').count()
        se.first.click()
        p.wait_for_timeout(2000)
        rec("journal: Show earlier loads more", vp, p.locator('[data-testid^="journal-day-"]:visible').count() >= n0, f"{n0} -> {p.locator('[data-testid^=\"journal-day-\"]:visible').count()}")


# ------------------------------------------------------------------ Calendar
def calendar(p, vp, blocked, statuses):
    if not open_page(p, vp, "/calendar", statuses, "calendar"):
        return
    modes = p.locator('[data-testid^="cal-mode-"]:visible')
    ms = []
    for i in range(modes.count()):
        m = modes.nth(i)
        m.click()
        p.wait_for_timeout(700)
        ms.append((m.get_attribute("data-testid")[9:], m.get_attribute("aria-pressed") or m.get_attribute("aria-selected")))
    rec("calendar: modes switch", vp, bool(ms), json.dumps(ms))
    lab = p.locator('[data-testid="cal-month-label"]:visible')
    if lab.count():
        l0 = lab.first.inner_text()
        p.locator('[data-testid="cal-week-next"]:visible').first.click()
        p.wait_for_timeout(700)
        l1 = lab.first.inner_text()
        p.locator('[data-testid="cal-week-prev"]:visible').first.click()
        p.wait_for_timeout(700)
        rec("calendar: week navigation", vp, True, f"'{l0}' -> next '{l1}' -> back '{lab.first.inner_text()}'")
    filters = p.locator('[data-testid^="cal-filter-"]:visible')
    fs = {}
    for i in range(filters.count()):
        f = filters.nth(i)
        k = f.get_attribute("data-testid")[11:]
        n0 = p.locator('[data-testid^="cal-event-"]:visible').count()
        f.click()
        p.wait_for_timeout(600)
        fs[k] = (n0, p.locator('[data-testid^="cal-event-"]:visible').count(), f.get_attribute("aria-pressed"))
        f.click()
        p.wait_for_timeout(500)
    rec("calendar: filters change the events shown", vp, bool(fs) and any(a != b for a, b, _ in fs.values()), json.dumps(fs))
    ev = p.locator('[data-testid^="cal-event-"]:visible')
    if ev.count():
        href = ev.first.get_attribute("href")
        ev.first.click()
        p.wait_for_timeout(2500)
        denied = p.locator('[data-testid="access-denied"]').count()
        rec("calendar: an event opens its source", vp, path_of(p) != "/calendar" and not denied, f"href {href}; -> {path_of(p)}; denied={bool(denied)}")


# ------------------------------------------------------------------ Notifications
def notifications(p, vp, blocked, statuses):
    if not open_page(p, vp, "/notifications", statuses, "notifications"):
        return
    items = p.locator('[data-testid^="notification-"]:visible')
    unread = p.locator('[data-testid^="notif-unread-dot-"]:visible').count()
    rec("notifications: list", vp, items.count() > 0, f"{items.count()} shown; unread dots {unread}")
    mar = p.locator('[data-testid="mark-all-read"]:visible')
    if mar.count():
        before, nb = toasts(p), len(blocked)
        mar.first.click()
        p.wait_for_timeout(2000)
        t = new_toasts(p, before, 1500)
        after_dots = p.locator('[data-testid^="notif-unread-dot-"]:visible').count()
        rec("notifications: Mark all read with the write blocked", vp, bool(t) or after_dots == unread,
            f"requests {blocked[nb:]}; toast {t}; unread dots {unread} -> {after_dots} (dots cleared with no save = misleading)")
    rd = p.locator('[data-testid^="read-"]:visible')
    if rd.count():
        before, nb = toasts(p), len(blocked)
        rd.first.click()
        p.wait_for_timeout(1500)
        rec("notifications: mark one read (write blocked)", vp, None, f"requests {blocked[nb:]}; toast {new_toasts(p, before, 1200)}")
    p.goto(f"{BASE}/notifications", wait_until="domcontentloaded")
    p.wait_for_timeout(4000)
    items = p.locator('[data-testid^="notification-"]:visible')
    bad = []
    for i in range(min(items.count(), 6)):
        p.goto(f"{BASE}/notifications", wait_until="domcontentloaded")
        p.wait_for_timeout(3500)
        it = p.locator('[data-testid^="notification-"]:visible').nth(i)
        label = it.inner_text().replace("\n", " ")[:40]
        it.click()
        p.wait_for_timeout(2500)
        denied = p.locator('[data-testid="access-denied"]').count()
        restricted = p.locator('[data-testid="decision-access-restricted"]').count()
        if denied or restricted or path_of(p) == "/notifications":
            bad.append((label, path_of(p), "DENIED" if denied else "", "RESTRICTED" if restricted else "", "no navigation" if path_of(p) == "/notifications" else ""))
    rec("notifications: each opens something the user can see", vp, not bad, f"problems {bad}")
    sa = p.locator('[data-testid="notifications-show-all"]:visible')
    if sa.count():
        p.goto(f"{BASE}/notifications", wait_until="domcontentloaded")
        p.wait_for_timeout(3500)
        n0 = p.locator('[data-testid^="notification-"]:visible').count()
        p.locator('[data-testid="notifications-show-all"]:visible').first.click()
        p.wait_for_timeout(1200)
        rec("notifications: Show all", vp, p.locator('[data-testid^="notification-"]:visible').count() >= n0, f"{n0} -> {p.locator('[data-testid^=\"notification-\"]:visible').count()}")


# ------------------------------------------------------------------ Settings
def settings(p, vp, role, blocked, statuses):
    if not open_page(p, vp, "/settings", statuses, "settings"):
        return
    tabs = p.locator('[data-testid^="settings-tab-"]:visible')
    rec("settings: owner gets tabs, others get Profile + Security", vp,
        (tabs.count() > 0) == (role == "owner"), f"tabs {tabs.count()}; cards {p.evaluate('()=>[...document.querySelectorAll(\"[data-testid$=-card]\")].filter(e=>e.getBoundingClientRect().width>0).map(e=>e.getAttribute(\"data-testid\"))')}")
    visited = []
    for i in range(tabs.count()):
        t = p.locator('[data-testid^="settings-tab-"]:visible').nth(i)
        k = t.get_attribute("data-testid")[13:]
        t.click()
        p.wait_for_timeout(1200)
        crash = p.evaluate("()=>/something went wrong|cannot read properties/i.test(document.body.innerText)")
        visited.append((k, "tab=" + k in p.url, p.locator(f'[data-testid="settings-panel-{k}"]:visible').count(), "CRASH" if crash else ""))
        p.screenshot(path=str(OUT / f"{vp}_settings_{k}.png"))
    if visited:
        rec("settings: every tab opens and deep-links", vp, all(u and pn and not c for _, u, pn, c in visited), json.dumps(visited))
    for i in range(tabs.count()):
        p.locator('[data-testid^="settings-tab-"]:visible').nth(i).click()
        p.wait_for_timeout(800)
        save = p.locator('main button:visible').filter(has_text=re.compile(r"^\s*save", re.I))
        if save.count():
            before, nb = toasts(p), len(blocked)
            dis = save.first.is_disabled()
            if not dis:
                save.first.click()
            t = new_toasts(p, before, 2500)
            rec(f"settings: Save on '{p.locator('[data-testid^=settings-tab-]:visible').nth(i).inner_text()}' with the write blocked", vp,
                dis or bool(t), f"disabled={dis}; requests {blocked[nb:]}; toast {t}")
    th = p.locator('[data-testid="settings-theme-toggle"]:visible')
    if th.count():
        before = p.evaluate("()=>document.documentElement.className + '|' + (document.documentElement.getAttribute('data-theme')||'')")
        th.first.click()
        p.wait_for_timeout(600)
        after = p.evaluate("()=>document.documentElement.className + '|' + (document.documentElement.getAttribute('data-theme')||'')")
        th.first.click()
        rec("settings: theme toggle changes the theme (and back)", vp, before != after, f"{before[:40]} -> {after[:40]}")


# ------------------------------------------------------------------ People
def people(p, vp, role, statuses):
    if not open_page(p, vp, "/people", statuses, "people"):
        return
    tabs = p.locator('[data-testid^="people-tab-"]:visible')
    out = []
    for i in range(tabs.count()):
        statuses.clear()
        t = p.locator('[data-testid^="people-tab-"]:visible').nth(i)
        k = t.get_attribute("data-testid")[11:]
        t.click()
        p.wait_for_timeout(2500)
        body = text(p, 400)
        out.append({"tab": k, "refused": sorted(x for x, v in statuses.items() if v == 403),
                    "banner": text(p, 140, '[data-testid="people-view-mode-banner"]'),
                    "empty_wording": bool(re.search(r"no (customers|vendors|suppliers|contacts|people|employees)|nothing", body, re.I)),
                    "refusal_wording": bool(re.search(r"access|permission|not allowed|ask", body, re.I))})
    rec("people: tabs", vp, None, json.dumps(out))
    misleading = [o["tab"] for o in out if o["empty_wording"] and not o["refusal_wording"]]
    rec("people: a tab whose data is refused does not claim to be empty", vp, not misleading, f"misleading tabs {misleading}")


def failure_injection(b, vp, size, mobile):
    for name, route, pattern in (("journal", "/journal", r".*/api/journal.*"), ("calendar", "/calendar", r".*/api/calendar.*"),
                                 ("notifications", "/notifications", r".*/api/notifications(\?.*)?$"), ("people", "/people", r".*/api/users(\?.*)?$")):
        ctx = b.new_context(viewport=size, is_mobile=mobile, has_touch=mobile)
        p = ctx.new_page()
        demo_login(p, BASE, "owner")
        p.route(re.compile(pattern), lambda r: r.abort())
        p.goto(f"{BASE}{route}", wait_until="domcontentloaded")
        p.wait_for_timeout(6000)
        t = text(p, 300)
        err = bool(re.search(r"couldn't|could not|failed|went wrong|try again|unable", t, re.I))
        empty = bool(re.search(r"no (notifications|events|entries|decisions|people|employees|members)|nothing|all caught up|quiet", t, re.I))
        loading = bool(re.search(r"loading", t, re.I)) or p.locator(".animate-pulse:visible").count() > 2
        rec(f"{name}: request fails -> page says so", vp, err and not empty, f"error wording={err}; empty wording={empty}; loading={loading}; '{t[:150]}'")
        p.screenshot(path=str(OUT / f"{vp}_{name}_failed.png"))
        p.unroute_all(behavior="ignoreErrors")
        ctx.close()


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    errors = []
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        for role in ("owner", "sales", "production", "finance"):
            for vp, size, mobile in ((f"{role[:4]}-d", {"width": 1440, "height": 900}, False), (f"{role[:4]}-m", {"width": 390, "height": 844}, True)):
                print(f"\n=== {role} @ {vp} ===")
                ctx = b.new_context(viewport=size, is_mobile=mobile, has_touch=mobile)
                p = ctx.new_page()
                statuses, blocked = {}, []
                p.on("response", lambda r, s=statuses: "/api/" in r.url and r.request.method == "GET" and s.__setitem__(re.sub(r"https?://[^/]+/api", "", r.url.split("?")[0]), r.status))
                p.on("pageerror", lambda e, vp=vp: errors.append((vp, "PAGEERROR " + str(e)[:150])))
                demo_login(p, BASE, role)
                p.route("**/api/**", lambda r: (blocked.append(r.request.method + " " + re.sub(r"https?://[^/]+", "", r.request.url)), r.abort())
                        if r.request.method in ("POST", "PATCH", "PUT", "DELETE") else r.continue_())
                for fn in (lambda: brain(p, vp, role, mobile, blocked, statuses), lambda: journal(p, vp, role, blocked, statuses),
                           lambda: calendar(p, vp, blocked, statuses), lambda: notifications(p, vp, blocked, statuses),
                           lambda: settings(p, vp, role, blocked, statuses), lambda: people(p, vp, role, statuses)):
                    try:
                        fn()
                    except Exception as e:  # keep going; record the harness error
                        rec("harness error", vp, None, str(e)[:200])
                        close_all(p)
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
