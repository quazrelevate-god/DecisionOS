"""Finance pass, 2026-09-13 - the same approach as Team, Ops and CRM.

Roles: Owner, Finance, Sales, Production - each at 1440 and 390.
Every tab; capture uploads; add dialogs; delete confirmation; match buttons;
AI refresh + ask; revenue filters; mobile quick actions; forced load failures.
Every POST/PATCH/PUT/DELETE is aborted after sign-in, so nothing is created,
deleted, extracted or sent to a model.
"""
import base64
import json
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from ux_login import demo_login  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

BASE = "http://localhost:3000"
OUT = pathlib.Path(__file__).resolve().parents[2] / ".audit-artifacts" / "finance_0913"
results = []
TABS = ["overview", "revenue", "expenses", "assets", "inventory", "inbox"]
PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")


def rec(key, vp, ok, detail=""):
    results.append({"check": key, "viewport": vp, "ok": ok, "detail": detail})
    tag = "PASS" if ok is True else "FAIL" if ok is False else "INFO"
    print(f"  [{tag}] {vp:<9} {key}: {detail}")


def toasts(p):
    return p.evaluate("()=>[...document.querySelectorAll('[data-sonner-toast]')].map(t=>t.textContent.trim())")


def new_toasts(p, before, wait=2500):
    for _ in range(wait // 250):
        n = [t for t in toasts(p) if t not in before]
        if n:
            return n
        p.wait_for_timeout(250)
    return []


def main_text(p, n=200):
    return p.evaluate(r"(n)=>((document.querySelector('main')||document.body).innerText||'').replace(/\s+/g,' ').trim().slice(0,n)", n)


def dialogs(p):
    return p.locator('[role="dialog"][data-state="open"]').count()


def close_all(p):
    for _ in range(3):
        if not dialogs(p):
            return
        p.keyboard.press("Escape")
        p.wait_for_timeout(400)


def layout(p):
    return p.evaluate("""() => { const els=[...document.querySelectorAll('main a, main button, main input:not([type=file]), main select, main label[data-testid]')]
        .filter(e=>{const r=e.getBoundingClientRect(); return r.width>0&&r.height>0;});
      return {overflow: document.documentElement.scrollWidth-document.documentElement.clientWidth,
        small: els.filter(e=>{const r=e.getBoundingClientRect(); return r.height<24||r.width<24;})
          .map(e=>[(e.getAttribute('aria-label')||e.textContent||e.getAttribute('data-testid')||'').trim().slice(0,26), Math.round(e.getBoundingClientRect().width), Math.round(e.getBoundingClientRect().height)]).slice(0,10),
        crash: /something went wrong|cannot read properties/i.test(document.body.innerText)}; }""")


def goto_tab(p, key, mobile):
    sel = f'[data-testid="ledger-tab-mobile-{key}"]:visible' if mobile else f'[data-testid="ledger-tab-{key}"]:visible'
    t = p.locator(sel)
    if not t.count():
        return False
    t.first.scroll_into_view_if_needed()
    t.first.click()
    p.wait_for_timeout(1800)
    return True


def role_pass(p, vp, role, mobile, statuses):
    p.goto(f"{BASE}/my-work", wait_until="domcontentloaded")
    p.wait_for_timeout(2500)
    nav = p.locator('[data-testid="dock-money"]:visible' if mobile else '[data-testid="nav-ledger"]:visible').count()
    statuses.clear()
    p.goto(f"{BASE}/finance", wait_until="domcontentloaded")
    p.wait_for_timeout(6000)
    denied = p.locator('[data-testid="access-denied"]:visible').count()
    api = {k: v for k, v in statuses.items() if re.search(r"/(ledger/summary|expenses|revenue|assets|inventory|payables|captures/pending-count)", k)}
    txt = main_text(p, 240)
    kpis = p.locator('[data-testid="ledger-kpis"]:visible, [data-testid="ledger-overview-mobile"]:visible, [data-testid="ledger-overview"]:visible').count()
    lay = layout(p)
    p.screenshot(path=str(OUT / f"{vp}_overview.png"))
    refused = [k for k, v in api.items() if v == 403]
    rec("Finance entry and what the server allows", vp, None,
        f"nav/dock Money visible={nav}; access-denied={denied}; API {json.dumps(api)}; overview blocks {kpis}")
    if refused and not denied:
        explains = bool(re.search(r"access|permission|not allowed|ask your owner|restricted", txt, re.I))
        rec("role refused by the ledger API is told why (not shown an empty Finance)", vp, explains,
            f"{len(refused)} ledger calls 403; page text '{txt}'")
    else:
        rec("overview renders for a role with ledger access", vp, kpis > 0 and not lay["crash"], f"overview blocks {kpis}; overflow {lay['overflow']}px")
    rec("overview layout", vp, lay["overflow"] <= 1 and not lay["crash"], f"overflow {lay['overflow']}px; under-24px {lay['small']}")

    tabs = {}
    for key in TABS:
        if not goto_tab(p, key, mobile):
            tabs[key] = "no tab"
            continue
        t = main_text(p, 400)
        l = layout(p)
        tabs[key] = {"crash": l["crash"], "overflow": l["overflow"],
                     "empty_wording": bool(re.search(r"no (expenses|assets|inventory|invoices|revenue|income|items)|nothing (here|yet)|add your first|get started", t, re.I)),
                     "error_wording": bool(re.search(r"couldn't|could not|failed|access|permission|went wrong", t, re.I))}
        p.screenshot(path=str(OUT / f"{vp}_tab_{key}.png"))
    bad = {k: v for k, v in tabs.items() if isinstance(v, dict) and (v["crash"] or v["overflow"] > 1)}
    rec("every tab opens without crashing or overflowing", vp, not bad and all(v != "no tab" for v in tabs.values()), json.dumps(tabs))
    if refused:
        misleading = [k for k, v in tabs.items() if isinstance(v, dict) and v["empty_wording"] and not v["error_wording"]]
        rec("refused role's tabs do not claim the books are empty", vp, not misleading, f"tabs showing an 'empty' message instead of a refusal: {misleading}")


def manager_pass(p, vp, mobile, blocked, dialogs_seen):
    p.goto(f"{BASE}/finance", wait_until="domcontentloaded")
    p.wait_for_timeout(5000)

    # --- capture uploads (POST blocked -> no extraction, no model call) ---
    tmp = OUT / "probe.png"
    tmp.write_bytes(PNG)
    csv = OUT / "probe.csv"
    csv.write_text("date,description,amount\n2026-09-01,Audit probe,1\n", encoding="utf-8")
    suffix = "-m" if mobile else ""
    for tid, f in ((f"finance-hero-doc{suffix}", tmp), (f"finance-hero-photo{suffix}", tmp), (f"finance-hero-csv{suffix}", csv)):
        lab = p.locator(f'[data-testid="{tid}"]:visible')
        if not lab.count():
            rec(f"capture {tid}", vp, False, "not visible")
            continue
        text = lab.first.inner_text().replace("\n", " ").strip()
        before = toasts(p)
        n_before = len(blocked)
        lab.first.locator('input[type=file]').set_input_files(str(f))
        t = new_toasts(p, before, 4000)
        p.wait_for_timeout(600)
        still = p.locator("text=Extracting…").count()
        sent = [x for x in blocked[n_before:] if "/ingest/" in x]
        rec(f"capture '{text}' with the upload blocked reports failure and recovers", vp, bool(t) and not still,
            f"request {sent}; toast {t}; 'Extracting…' still showing={bool(still)}")
    if mobile:
        csv_label = p.locator('[data-testid="finance-hero-csv-m"]').inner_text().replace("\n", " ")
        accept = p.locator('[data-testid="finance-hero-csv-m"] input').get_attribute("accept")
        rec("mobile CSV tile label matches what it does", vp, "export" not in csv_label.lower(),
            f"label '{csv_label}' on a file INPUT (accept {accept}) that POSTs to /ingest/csv")
        add = p.locator('[data-testid="ledger-add-expense"]:visible')
        if add.count():
            add.first.click()
            p.wait_for_timeout(1200)
            opened = dialogs(p)
            rec("mobile 'Add expense' tile opens the add-expense form", vp, opened >= 1,
                f"dialogs open after tap: {opened}; tab now '{main_text(p, 60)}'")
            close_all(p)

    # --- add dialogs per tab ---
    for tab, btn, save in (("revenue", "add-income-btn", "income-save"), ("expenses", "add-expense-btn", "expense-save"),
                           ("assets", "add-asset-btn", "asset-save"), ("inventory", "add-inventory-btn", "inv-save")):
        goto_tab(p, tab, mobile)
        b = p.locator(f'[data-testid="{btn}"]:visible')
        if not b.count():
            rec(f"{tab}: add button", vp, None if mobile else False, "not visible at this width")
            continue
        b.first.click()
        p.wait_for_timeout(900)
        if not dialogs(p):
            rec(f"{tab}: add dialog opens", vp, False, "")
            continue
        s = p.locator(f'[data-testid="{save}"]:visible')
        before, nb = toasts(p), len(blocked)
        dis = s.is_disabled() if s.count() else None
        if s.count() and not dis:
            s.first.click()
        t = new_toasts(p, before, 1500)
        sent_empty = [x for x in blocked[nb:] if not x.startswith("GET")]
        rec(f"{tab}: empty form is refused before sending", vp, (dis or bool(t)) and not sent_empty,
            f"save disabled={dis}; toast {t}; requests sent {sent_empty}")
        # fill the obvious fields and try again
        for fid, val in (("income-title", "Audit probe"), ("income-amount", "1"), ("expense-title", "Audit probe"), ("expense-amount", "1"),
                         ("asset-name", "Audit probe"), ("asset-amount", "1"), ("inv-item", "Audit probe"), ("inv-qty", "1"), ("inv-cost", "1")):
            loc = p.locator(f'[role="dialog"] [data-testid="{fid}"]:visible')
            if loc.count():
                try:
                    loc.first.fill(val)
                except Exception:
                    pass
        before, nb = toasts(p), len(blocked)
        if s.count() and not s.is_disabled():
            s.first.click()
        t = new_toasts(p, before, 3000)
        rec(f"{tab}: save with the write blocked reports failure, form stays", vp, bool(t) and dialogs(p) >= 1,
            f"requests {[x for x in blocked[nb:]]}; toast {t}; dialog open={dialogs(p)}")
        close_all(p)

    # --- delete: is there a confirmation? ---
    for tab, prefix in (("expenses", "expense-delete-"), ("revenue", "revenue-invoice-delete-"), ("revenue", "revenue-payment-delete-")):
        goto_tab(p, tab, mobile)
        d = p.locator(f'[data-testid^="{prefix}"]:visible')
        if not d.count():
            rec(f"{tab}: delete control ({prefix})", vp, None, "none visible")
            continue
        nb, nd = len(blocked), len(dialogs_seen)
        before = toasts(p)
        d.first.click()
        p.wait_for_timeout(1500)
        confirm_ui = dialogs(p) > 0 or p.locator('[role="alertdialog"]').count() > 0 or len(dialogs_seen) > nd
        sent = [x for x in blocked[nb:] if x.startswith("DELETE")]
        rec(f"{tab}: delete ({prefix[:-1]}) asks before removing a money record", vp, confirm_ui and not sent,
            f"confirmation shown={confirm_ui}; DELETE sent immediately={sent}; toast {new_toasts(p, before, 800)}")
        close_all(p)

    # --- match / standalone ---
    goto_tab(p, "revenue", mobile)
    for pref in ("match-btn-", "standalone-btn-"):
        m = p.locator(f'[data-testid^="{pref}"]:visible')
        if m.count():
            before, nb = toasts(p), len(blocked)
            m.first.click()
            p.wait_for_timeout(1500)
            rec(f"revenue: {pref[:-1]} pressed", vp, None, f"requests {blocked[nb:]}; dialogs {dialogs(p)}; toast {new_toasts(p, before, 1500)}")
            close_all(p)

    # --- revenue filters + sort ---
    filters = p.locator('[data-testid^="revenue-filter-"]:visible')
    fl = {}
    for i in range(filters.count()):
        f = filters.nth(i)
        k = f.get_attribute("data-testid")[15:]
        f.click()
        p.wait_for_timeout(500)
        fl[k] = p.locator('[data-testid^="revenue-invoice-delete-"]:visible').count()
    rec("revenue status filters each narrow the invoice list", vp, bool(fl), f"visible invoices per filter {fl}")

    # --- AI panel refresh + ask (POST blocked) ---
    goto_tab(p, "expenses", mobile)
    r = p.locator('[data-testid="ai-refresh-expenses"]:visible')
    if r.count():
        before = toasts(p)
        r.first.click()
        t = new_toasts(p, before, 3000)
        rec("AI analysis Refresh failure is reported", vp, bool(t) and not r.first.is_disabled(), f"toast {t}")
    a = p.locator('[data-testid="ai-ask-input-expenses"]:visible')
    if a.count():
        a.first.fill("Audit probe question")
        before = toasts(p)
        p.locator('[data-testid="ai-ask-btn-expenses"]:visible').first.click()
        t = new_toasts(p, before, 3000)
        rec("AI Ask failure is reported and the question kept", vp, bool(t) and a.first.input_value() != "", f"toast {t}; input '{a.first.input_value()}'")

    if mobile:
        goto_tab(p, "overview", mobile)
        for tid in ("ledger-mobile-viewall", "finance-hero-inbox-m"):
            v = p.locator(f'[data-testid="{tid}"]:visible')
            if v.count():
                before_url = p.url
                v.first.click()
                p.wait_for_timeout(1500)
                rec(f"mobile {tid} does something", vp, p.url != before_url or "inbox" in main_text(p, 400).lower() or dialogs(p) > 0,
                    f"url {p.url.replace(BASE, '')}; text '{main_text(p, 70)}'")
                p.goto(f"{BASE}/finance", wait_until="domcontentloaded")
                p.wait_for_timeout(3500)


def failure_injection(b, vp, size, mobile):
    for label, pattern, tab in (("summary", r".*/api/ledger/summary.*", "overview"), ("expenses", r".*/api/expenses(\?.*)?$", "expenses")):
        ctx = b.new_context(viewport=size, is_mobile=mobile, has_touch=mobile)
        p = ctx.new_page()
        demo_login(p, BASE, "owner")
        p.route(re.compile(pattern), lambda r: r.abort())
        p.goto(f"{BASE}/finance", wait_until="domcontentloaded")
        p.wait_for_timeout(5000)
        if tab != "overview":
            goto_tab(p, tab, mobile)
        t = main_text(p, 260)
        err = bool(re.search(r"couldn't|could not|failed|went wrong|try again|unable", t, re.I))
        empty = bool(re.search(r"no expenses|nothing (here|yet)|add your first|get started", t, re.I))
        rec(f"{label} request fails -> page says so", vp, err and not empty, f"error wording={err}; empty wording={empty}; '{t}'")
        p.screenshot(path=str(OUT / f"{vp}_{label}_failed.png"))
        p.unroute_all(behavior="ignoreErrors")
        ctx.close()


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    errors = []
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        for role in ("owner", "finance", "sales", "production"):
            for vp, size, mobile in ((f"{role[:4]}-d", {"width": 1440, "height": 900}, False), (f"{role[:4]}-m", {"width": 390, "height": 844}, True)):
                print(f"\n=== {role} @ {vp} ===")
                ctx = b.new_context(viewport=size, is_mobile=mobile, has_touch=mobile)
                p = ctx.new_page()
                p.on("pageerror", lambda e, vp=vp: errors.append((vp, "PAGEERROR " + str(e)[:150])))
                statuses, blocked, dialogs_seen = {}, [], []
                p.on("response", lambda r: "/api/" in r.url and r.request.method == "GET" and statuses.__setitem__(re.sub(r"https?://[^/]+/api", "", r.url.split("?")[0]), r.status))
                p.on("dialog", lambda d: (dialogs_seen.append(d.message[:80]), d.dismiss()))
                demo_login(p, BASE, role)
                p.route("**/api/**", lambda r: (blocked.append(r.request.method + " " + re.sub(r"https?://[^/]+", "", r.request.url)), r.abort())
                        if r.request.method in ("POST", "PATCH", "PUT", "DELETE") else r.continue_())
                role_pass(p, vp, role, mobile, statuses)
                if role in ("owner", "finance"):
                    manager_pass(p, vp, mobile, blocked, dialogs_seen)
                rec("writes blocked", vp, None, f"{len(blocked)}: {sorted(set(blocked))[:12]}")
                p.unroute_all(behavior="ignoreErrors")
                ctx.close()
                if role == "owner":
                    print(f"--- failure injection @ {vp} ---")
                    failure_injection(b, vp, size, mobile)
        b.close()
    print("\n=== page errors ===")
    for e in sorted(set(errors)):
        print("  ", e)
    (OUT / "results.json").write_text(json.dumps({"results": results, "errors": sorted(set(errors))}, indent=2), encoding="utf-8")
    print(f"\n{sum(r['ok'] is True for r in results)} pass, {sum(r['ok'] is False for r in results)} fail, {sum(r['ok'] is None for r in results)} info")


if __name__ == "__main__":
    main()
