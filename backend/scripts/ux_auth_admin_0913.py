"""Areas G + H, 2026-09-13: sign-in, sign-up, invite landing, admin portal.

Signed-out contexts with EVERY POST/PATCH/PUT/DELETE blocked from the first
request, so no login succeeds, no OTP or invite SMS is sent, no account or
tenant is created, and no admin session is opened. No password is typed.
"""
import json
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from ux_login import demo_login  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

BASE = "http://localhost:3000"
OUT = pathlib.Path(__file__).resolve().parents[2] / ".audit-artifacts" / "auth_0913"
results = []


def rec(key, vp, ok, detail=""):
    results.append({"check": key, "viewport": vp, "ok": ok, "detail": detail})
    tag = "PASS" if ok is True else "FAIL" if ok is False else "INFO"
    print(f"  [{tag}] {vp:<6} {key}: {detail}")


def path_of(p):
    return p.url.replace(BASE, "") or "/"


def body(p, n=220):
    return p.evaluate(r"(n)=>document.body.innerText.replace(/\s+/g,' ').trim().slice(0,n)", n)


def layout(p):
    return p.evaluate("""() => { const els=[...document.querySelectorAll('a, button, input:not([type=hidden]), select, textarea')]
        .filter(e=>{const r=e.getBoundingClientRect(); const s=getComputedStyle(e); return r.width>0&&r.height>0&&s.visibility!=='hidden';});
      return {overflow: document.documentElement.scrollWidth-document.documentElement.clientWidth,
        small: els.filter(e=>{const r=e.getBoundingClientRect(); return r.height<24||r.width<24;})
          .map(e=>[(e.getAttribute('aria-label')||e.textContent||e.getAttribute('placeholder')||e.getAttribute('data-testid')||'').trim().slice(0,24), Math.round(e.getBoundingClientRect().width), Math.round(e.getBoundingClientRect().height)]).slice(0,10),
        unlabelled: els.filter(e=>['INPUT','SELECT','TEXTAREA'].includes(e.tagName) && !(e.labels&&e.labels.length) && !e.getAttribute('aria-label') && !e.getAttribute('aria-labelledby'))
          .map(e=>e.getAttribute('data-testid')||e.getAttribute('placeholder')||e.name)}; }""")


def error_text(p):
    loc = p.locator('[data-testid="auth-error"]:visible, [data-testid="admin-login-error"]:visible')
    t = loc.first.inner_text().strip() if loc.count() else ""
    toasts = p.evaluate("()=>[...document.querySelectorAll('[data-sonner-toast]')].map(t=>t.textContent.trim())")
    return t, toasts


def login_page(p, vp, blocked):
    p.goto(f"{BASE}/login", wait_until="domcontentloaded")
    p.wait_for_timeout(2500)
    lay = layout(p)
    p.screenshot(path=str(OUT / f"{vp}_login.png"))
    rec("login: layout", vp, lay["overflow"] <= 1 and not lay["small"], f"overflow {lay['overflow']}px; under-24px {lay['small']}; unlabelled fields {lay['unlabelled']}")
    rec("login: fields have labels", vp, not lay["unlabelled"], f"unlabelled {lay['unlabelled']}")
    # password tab, empty submit
    if p.locator('[data-testid="login-tab-password"]:visible').count():
        p.locator('[data-testid="login-tab-password"]').first.click()
    sub = p.locator('[data-testid="auth-submit-button"]:visible')
    if sub.count():
        nb = len(blocked)
        sub.first.click()
        p.wait_for_timeout(1200)
        invalid = p.evaluate("()=>[...document.querySelectorAll('input:invalid')].map(e=>e.getAttribute('data-testid'))")
        err, toasts = error_text(p)
        rec("login: empty submit is refused before sending", vp, (bool(invalid) or bool(err)) and not [x for x in blocked[nb:] if "/auth/login" in x],
            f"invalid fields {invalid}; error '{err}'; requests {blocked[nb:]}")
        p.locator('[data-testid="login-email-input"]').fill("not-an-email")
        sub.first.click()
        p.wait_for_timeout(800)
        invalid = p.evaluate("()=>[...document.querySelectorAll('input:invalid')].map(e=>e.getAttribute('data-testid'))")
        rec("login: malformed email is caught", vp, "login-email-input" in invalid, f"invalid {invalid}")
    # OTP tab
    otp = p.locator('[data-testid="login-tab-otp"]:visible')
    if otp.count():
        otp.first.click()
        p.wait_for_timeout(600)
        ph = p.locator('[data-testid="otp-phone-input"]:visible')
        s = p.locator('[data-testid="otp-submit-button"]:visible')
        nb = len(blocked)
        s.first.click()
        p.wait_for_timeout(1000)
        invalid = p.evaluate("()=>[...document.querySelectorAll('input:invalid')].map(e=>e.getAttribute('data-testid'))")
        sent_empty = [x for x in blocked[nb:] if "otp" in x]
        rec("login OTP: empty number is refused before sending", vp, not sent_empty, f"invalid {invalid}; requests {sent_empty}; error '{error_text(p)[0]}'")
        ph.first.fill("123")
        nb = len(blocked)
        s.first.click()
        p.wait_for_timeout(1500)
        sent_short = [x for x in blocked[nb:] if "otp" in x]
        err, toasts = error_text(p)
        rec("login OTP: a 3-digit number is refused before sending", vp, not sent_short, f"requests {sent_short}; error '{err}'; toasts {toasts}")
        ph.first.fill("9876543210")
        nb = len(blocked)
        s.first.click()
        p.wait_for_timeout(2000)
        err, toasts = error_text(p)
        rec("login OTP: a failed send (blocked, no SMS) is reported", vp, bool(err) or bool(toasts), f"requests {blocked[nb:]}; error '{err}'; toasts {toasts}")
        p.screenshot(path=str(OUT / f"{vp}_login_otp_failed.png"))
    # demo seats
    p.goto(f"{BASE}/login", wait_until="domcontentloaded")
    p.wait_for_timeout(2000)
    do = p.locator('[data-testid="demo-open"]:visible')
    if do.count():
        do.first.click()
        p.wait_for_timeout(900)
        seats = p.locator('[data-testid^="demo-login-"]:visible').count()
        dc = p.locator('[data-testid="demo-close"]:visible')
        closed = None
        if dc.count():
            dc.first.click()
            p.wait_for_timeout(700)
            closed = p.locator('[data-testid^="demo-login-"]:visible').count() == 0
        rec("login: demo seats open and close", vp, seats >= 4 and closed is not False, f"seats {seats}; close works={closed}")
        do.first.click()
        p.wait_for_timeout(700)
        nb = len(blocked)
        p.locator('[data-testid^="demo-login-"]:visible').first.click()
        p.wait_for_timeout(2000)
        err, toasts = error_text(p)
        rec("login: a failed demo sign-in (blocked) is reported", vp, bool(err) or bool(toasts), f"requests {blocked[nb:]}; error '{err}'; toasts {toasts}; still on {path_of(p)}")
    th = p.locator('[data-testid="login-theme-toggle"]:visible')
    if th.count():
        a = p.evaluate("()=>document.documentElement.className")
        th.first.click()
        p.wait_for_timeout(400)
        b = p.evaluate("()=>document.documentElement.className")
        th.first.click()
        rec("login: theme toggle", vp, a != b, f"'{a[:30]}' -> '{b[:30]}'")
    reg = p.locator('[data-testid="login-register-link"]:visible, [data-testid="toggle-auth-mode"]:visible')
    if reg.count():
        reg.first.click()
        p.wait_for_timeout(1800)
        rec("login: register link opens sign-up", vp, path_of(p).startswith("/signup"), path_of(p))
    p.goto(f"{BASE}/login?signup=1", wait_until="domcontentloaded")
    p.wait_for_timeout(1800)
    rec("login: legacy ?signup=1 goes to sign-up", vp, path_of(p).startswith("/signup"), path_of(p))


def invite(p, vp, blocked):
    p.goto(f"{BASE}/login?invite=not-a-real-token", wait_until="domcontentloaded")
    p.wait_for_timeout(3500)
    err, toasts = error_text(p)
    sent = [x for x in blocked if "/invite/" in x]
    rec("invite: a bad invite link says it is invalid or expired", vp, bool(re.search(r"invalid|expired|not found", err + " ".join(toasts), re.I)),
        f"error '{err}'; toasts {toasts}; start request sent={sent}; tab shown '{body(p, 80)}'")
    p.screenshot(path=str(OUT / f"{vp}_invite_bad.png"))


def signup(p, vp, blocked):
    p.goto(f"{BASE}/signup", wait_until="domcontentloaded")
    p.wait_for_timeout(3000)
    lay = layout(p)
    p.screenshot(path=str(OUT / f"{vp}_signup.png"))
    rec("signup: layout", vp, lay["overflow"] <= 1 and not lay["small"], f"overflow {lay['overflow']}px; under-24px {lay['small']}")
    rec("signup: fields have labels", vp, not lay["unlabelled"], f"unlabelled {lay['unlabelled']}")
    btn = p.locator("button:visible").filter(has_text=re.compile(r"continue|next|get started|create|start", re.I))
    if btn.count():
        nb = len(blocked)
        dis = btn.first.is_disabled()
        if not dis:
            btn.first.click()
        p.wait_for_timeout(1500)
        invalid = p.evaluate("()=>[...document.querySelectorAll('input:invalid')].map(e=>e.getAttribute('data-testid')||e.name||e.placeholder)")
        rec("signup: empty Basics is refused before anything is created", vp, (dis or bool(invalid) or bool(error_text(p)[0] or error_text(p)[1])) and not blocked[nb:],
            f"button '{btn.first.inner_text().strip()}' disabled={dis}; invalid {invalid}; requests {blocked[nb:]}; still phase text '{body(p, 90)}'")
    si = p.locator('[data-testid="signup-signin-link"]:visible')
    if si.count():
        si.first.click()
        p.wait_for_timeout(1800)
        rec("signup: Sign in link", vp, path_of(p).startswith("/login"), path_of(p))


def admin(p, vp, blocked):
    p.goto(f"{BASE}/admin", wait_until="domcontentloaded")
    p.wait_for_timeout(3000)
    scr = p.locator('[data-testid="admin-login-screen"]:visible').count()
    portal = p.locator('[data-testid="admin-portal"]:visible').count()
    lay = layout(p)
    p.screenshot(path=str(OUT / f"{vp}_admin.png"))
    rec("admin: signed-out visitor gets the admin sign-in, not the portal", vp, scr == 1 and portal == 0, f"login screen={scr}; portal={portal}; overflow {lay['overflow']}px; unlabelled {lay['unlabelled']}")
    s = p.locator('[data-testid="admin-login-submit"]:visible')
    if s.count():
        nb = len(blocked)
        s.first.click()
        p.wait_for_timeout(1000)
        invalid = p.evaluate("()=>[...document.querySelectorAll('input:invalid')].map(e=>e.getAttribute('data-testid'))")
        rec("admin: empty sign-in is refused before sending", vp, not [x for x in blocked[nb:] if "/admin/login" in x], f"invalid {invalid}; requests {blocked[nb:]}")
    p.goto(f"{BASE}/admin/tenants", wait_until="domcontentloaded")
    p.wait_for_timeout(2500)
    rec("admin: a deep link while signed out still shows the admin sign-in", vp, p.locator('[data-testid="admin-login-screen"]:visible').count() == 1, path_of(p))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    errors = []
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        for vp, size, mobile in (("desk", {"width": 1440, "height": 900}, False), ("mob", {"width": 390, "height": 844}, True)):
            print(f"\n=== signed out @ {vp} ===")
            ctx = b.new_context(viewport=size, is_mobile=mobile, has_touch=mobile)
            p = ctx.new_page()
            blocked = []
            p.on("pageerror", lambda e, vp=vp: errors.append((vp, "PAGEERROR " + str(e)[:150])))
            p.route("**/api/**", lambda r: (blocked.append(r.request.method + " " + re.sub(r"https?://[^/]+", "", r.request.url)), r.abort())
                    if r.request.method in ("POST", "PATCH", "PUT", "DELETE") else r.continue_())
            for fn in (login_page, invite, signup, admin):
                try:
                    fn(p, vp, blocked)
                except Exception as e:
                    rec("harness error", vp, None, f"{fn.__name__}: {str(e)[:180]}")
            rec("writes blocked", vp, None, f"{len(blocked)}: {sorted(set(blocked))}")
            ctx.close()
            # signed-in tenant user on /login and /admin
            print(f"\n=== signed-in owner @ {vp} ===")
            ctx = b.new_context(viewport=size, is_mobile=mobile, has_touch=mobile)
            p = ctx.new_page()
            demo_login(p, BASE, "owner")
            p.route("**/api/**", lambda r: r.abort() if r.request.method in ("POST", "PATCH", "PUT", "DELETE") else r.continue_())
            p.goto(f"{BASE}/login", wait_until="domcontentloaded")
            p.wait_for_timeout(3000)
            rec("a signed-in user opening /login is taken into the app", vp, not path_of(p).startswith("/login"), f"-> {path_of(p)}; '{body(p, 60)}'")
            p.goto(f"{BASE}/admin", wait_until="domcontentloaded")
            p.wait_for_timeout(3000)
            st = p.evaluate("async()=>{const r=await fetch('http://localhost:8001/api/admin/me',{credentials:'include'}); return r.status}")
            rec("a tenant owner is not let into the admin portal", vp, p.locator('[data-testid="admin-portal"]:visible').count() == 0,
                f"admin portal={p.locator('[data-testid=\"admin-portal\"]:visible').count()}; admin login screen={p.locator('[data-testid=\"admin-login-screen\"]:visible').count()}; GET /admin/me {st}")
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
