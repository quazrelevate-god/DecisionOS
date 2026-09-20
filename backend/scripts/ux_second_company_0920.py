"""One founder, two companies — browser acceptance on a THROWAWAY database.

Run against the `backend-scratch-rbac` backend and the frontend on :5173:

    python scripts/ux_second_company_0920.py

RESTART THE BACKEND FIRST on a repeat run: register allows three workspaces per
network per hour (routers/auth.py) and one pass here creates two. The limiter
lives in the server's memory (services/rate_limit.py), so a restart clears it;
otherwise the second pass fails at "first-company-created" with a 429.

Yokesh, 2026-09-20: a founder may run more than one business. The mobile is
the person; the email is one per company. Checks, live:
  1. a first company is created the ordinary way (mobile asked BEFORE the email);
  2. signing up again with the same number shows what they already run;
  3. "Create another company" asks for no email and no password;
  4. the second company is real, and they land inside it;
  5. the profile menu lists both and switches between them;
  6. Mobile-OTP sign-in offers both workspaces.
"""
import json
import os
import pathlib
import re
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from playwright.sync_api import sync_playwright  # noqa: E402

BASE = os.environ.get("UX_BASE", "http://localhost:5173")
API = os.environ.get("UX_API", "http://localhost:8001/api")
OUT = pathlib.Path(__file__).resolve().parents[2] / ".audit-artifacts" / "second_company_0920"
OUT.mkdir(parents=True, exist_ok=True)
STAMP = str(int(time.time()))[-6:]
PHONE = f"9{STAMP}3{STAMP[-2:]}"[:10]
EMAIL = f"founder{STAMP}@sharma-{STAMP}.co"
ONE, TWO = f"Sharma Textiles {STAMP}", f"Nila Exports {STAMP}"
results = []


def rec(key, ok, detail=""):
    results.append({"check": key, "ok": ok, "detail": str(detail)[:160]})
    print(f"  [{'PASS' if ok is True else 'FAIL' if ok is False else 'INFO'}] {key}: {str(detail)[:160]}", flush=True)


def tid(p, t):
    return p.locator(f'[data-testid="{t}"]').first


def wait(p, t, timeout=30000):
    try:
        tid(p, t).wait_for(state="visible", timeout=timeout)
        return True
    except Exception:
        return False


def type_step(p, key, value):
    """Answer one wizard question."""
    assert wait(p, f"signup-input-{key}"), f"step {key} never appeared"
    tid(p, f"signup-input-{key}").fill(value)
    tid(p, "signup-basics-next").click()


def confirm_code(p):
    """The scratch backend auto-fills the texted code (DEV_OTP_IN_RESPONSE)."""
    assert wait(p, "signup-phone-code"), "the code panel never appeared"
    p.wait_for_timeout(1200)
    if tid(p, "signup-phone-confirm").is_enabled():
        tid(p, "signup-phone-confirm").click()


def whoami(p):
    """(workspace name, user id, the company's contact address) for this session."""
    return p.evaluate("""async (api) => {
      const r = await fetch(api + '/auth/me', {credentials: 'include'});
      if (!r.ok) return ['', '', ''];
      const d = await r.json();
      return [(d.tenant && d.tenant.name) || '', (d.user && d.user.id) || '',
              (d.tenant && d.tenant.support_email) || ''];
    }""", API)


def current_workspace(p):
    """The workspace this session is in. `tenant-name` lives INSIDE the profile
    menu, so it cannot answer this while the menu is shut."""
    return p.evaluate("""async (api) => {
      const r = await fetch(api + '/auth/me', {credentials: 'include',
        headers: {'Authorization': 'Bearer ' + (localStorage.getItem('token') || '')}});
      if (!r.ok) return '';
      const d = await r.json();
      return (d.tenant && d.tenant.name) || '';
    }""", API)


def open_profile_menu(p):
    """The header's avatar block. A founder who has just created a workspace is
    behind the welcome overlay, so step into the app first."""
    p.goto(f"{BASE}/my-work", wait_until="domcontentloaded")
    # a freshly created workspace opens behind the welcome overlay
    if wait(p, "welcome-dismiss", 8000):
        p.locator('[data-testid="welcome-dismiss"]').first.click()
        p.wait_for_timeout(1200)
    if not wait(p, "rail-user-menu", 30000):
        p.screenshot(path=str(OUT / "x_no_header.png"))
        raise AssertionError(f"the header never arrived at {p.url}")
    p.locator('[data-testid="rail-user-menu"]').first.click()
    p.wait_for_timeout(900)


def build_and_enter(p):
    """Website -> manual industry -> interview -> build, the way
    ux_signup_0917.py already walks it."""
    wait(p, "signup-website", 20000)
    if p.locator('[data-testid="signup-website-skip"]').count():
        p.locator('[data-testid="signup-website-skip"]').first.click()
    p.wait_for_timeout(3000)
    if p.locator('[data-testid="signup-manual-industry"]').count():
        p.locator('[data-testid="signup-manual-industry"]').first.select_option(index=1)
        p.wait_for_timeout(400)
        if p.locator('[data-testid="signup-manual-model-B2B"]').count():
            p.locator('[data-testid="signup-manual-model-B2B"]').first.click()
        p.locator('[data-testid="signup-manual-continue"]').first.click()
        p.wait_for_timeout(3000)
    if p.locator('[data-testid="lang-pick-en-IN"]').count():
        p.locator('[data-testid="lang-pick-en-IN"]').first.click()
        p.wait_for_timeout(3000)
    if p.locator('[data-testid="interview-skip"]').count():
        p.locator('[data-testid="interview-skip"]').first.click()
    assert wait(p, "build-confirm-button", 120000), "the OS never arrived"
    p.locator('[data-testid="build-confirm-button"]').first.click()
    if wait(p, "signup-enter-button", 90000):
        p.locator('[data-testid="signup-enter-button"]').first.click()
        p.wait_for_timeout(6000)
        return True
    return False


with sync_playwright() as pw:
    b = pw.chromium.launch()
    ctx = b.new_context(viewport={"width": 1440, "height": 950})
    p = ctx.new_page()
    errors, api_errors = [], []
    p.on("pageerror", lambda e: errors.append(str(e)[:200]))
    p.on("response", lambda r: api_errors.append(f"{r.status} {r.request.method} {r.url.split('/api')[-1][:60]}")
         if "/api/" in r.url and r.status >= 500 else None)

    # 1 · the first company, the ordinary way
    p.goto(f"{BASE}/signup", wait_until="domcontentloaded")
    type_step(p, "company_name", ONE)
    type_step(p, "name", "Rajesh Sharma")
    asked_phone_third = wait(p, "signup-input-phone", 10000)
    rec("mobile-is-asked-before-the-email", asked_phone_third, "third question")
    tid(p, "signup-input-phone").fill(PHONE)
    tid(p, "signup-basics-next").click()
    confirm_code(p)
    type_step(p, "email", EMAIL)
    type_step(p, "password", "Textiles-4821")
    assert wait(p, "signup-team-size-chips"), "team size never appeared"
    tid(p, "team-size-11-50").click()
    landed_one = build_and_enter(p)
    rec("first-company-created", landed_one and ONE in current_workspace(p), p.url)
    p.screenshot(path=str(OUT / "1_first_company.png"))

    # 2 · sign up again with the same number
    ctx2 = b.new_context(viewport={"width": 1440, "height": 950})
    p2 = ctx2.new_page()
    p2.on("pageerror", lambda e: errors.append(str(e)[:200]))
    p2.goto(f"{BASE}/signup", wait_until="domcontentloaded")
    type_step(p2, "company_name", TWO)
    type_step(p2, "name", "Rajesh Sharma")
    tid(p2, "signup-input-phone").fill(PHONE)
    tid(p2, "signup-basics-next").click()
    confirm_code(p2)
    shown = wait(p2, "signup-existing-workspaces", 20000)
    rec("the-number-says-what-it-already-runs", shown, ONE)
    if shown:
        rec("the-company-is-named", ONE in tid(p2, "signup-existing-workspaces").inner_text(),
            tid(p2, "signup-existing-workspaces").inner_text()[:80].replace("\n", " · "))
    p2.screenshot(path=str(OUT / "2_existing_companies.png"))

    # 3 · create another: no email, no password
    tid(p2, "signup-create-another").click()
    asked_again = wait(p2, "signup-input-email", 4000) or wait(p2, "signup-input-password", 1000)
    rec("no-second-sign-in-email-or-password-is-asked", not asked_again, "no second account")
    # instead: the company's own contact address, and it may be the SAME one
    asked_support = wait(p2, "signup-input-support_email", 10000)
    rec("the-company-address-is-asked-instead", asked_support, "support and receipts")
    if asked_support:
        tid(p2, "signup-input-support_email").fill(EMAIL)   # the address company one uses
        tid(p2, "signup-basics-next").click()
    assert wait(p2, "signup-team-size-chips", 15000), "team size never appeared"
    tid(p2, "team-size-11-50").click()
    entered = build_and_enter(p2)
    name_two, id_two, support_two = whoami(p2) if entered else ("", "", "")
    rec("second-company-created-and-entered", entered and TWO in name_two, name_two)
    rec("the-shared-address-is-kept-on-the-company", support_two == EMAIL.lower(), support_two)
    gate = p2.locator('[data-testid="owner-credentials-gate"]').count()
    rec("no-credentials-gate-in-the-second-company", gate == 0, f"{gate} gate(s)")
    p2.screenshot(path=str(OUT / "3_second_company.png"))

    # 4 · the profile menu lists both, and switches
    open_profile_menu(p2)
    switcher = wait(p2, "workspace-switcher", 8000)
    rec("the-profile-menu-lists-the-other-company", switcher, "")
    p2.screenshot(path=str(OUT / "4_switcher.png"))
    if switcher:
        row = p2.locator('[data-testid^="switch-workspace-"]').first
        rec("and-offers-add-a-company", tid(p2, "add-company").is_visible(), "")
        row.click()
        p2.wait_for_timeout(9000)
        now, id_now, _sup = whoami(p2)
        rec("switching-lands-in-the-other-company", ONE in now, now)
        # the whole identity moves: that company knows this founder as its own row
        rec("and-hands-over-that-companys-own-identity", bool(id_now) and id_now != id_two,
            f"{id_two[:8]}… -> {id_now[:8]}…")
        p2.screenshot(path=str(OUT / "5_switched.png"))

    # 5 · signing in by mobile offers both
    p3 = b.new_context(viewport={"width": 1440, "height": 950}).new_page()
    p3.on("pageerror", lambda e: errors.append(str(e)[:200]))
    p3.goto(f"{BASE}/login", wait_until="domcontentloaded")
    tid(p3, "login-tab-otp").click()
    tid(p3, "otp-phone-input").fill(PHONE)
    tid(p3, "otp-submit-button").click()
    picker = wait(p3, "otp-workspace-picker", 20000)
    names = tid(p3, "otp-workspace-picker").inner_text() if picker else ""
    rec("mobile-sign-in-offers-both-workspaces", picker and ONE in names and TWO in names,
        names.replace("\n", " · ")[:120])
    p3.screenshot(path=str(OUT / "6_signin_picker.png"))

    rec("no-page-errors", errors == [], str(errors[:2]))
    rec("no-server-errors", api_errors == [], str(api_errors[:3]))
    b.close()

(OUT / "results.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
ok = sum(1 for r in results if r["ok"] is True)
bad = sum(1 for r in results if r["ok"] is False)
print(f"\n{ok} pass / {bad} fail -> {OUT / 'results.json'}")
