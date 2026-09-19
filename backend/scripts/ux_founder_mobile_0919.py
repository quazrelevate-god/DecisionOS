"""The founder's mobile, from signup to Mobile OTP sign-in — browser acceptance
with REAL saves on a THROWAWAY database.

Run against the `backend-scratch-rbac` backend and the frontend on :5173:

    python scripts/ux_founder_mobile_0919.py

2026-09-19. The mobile used to be optional at signup, checked against nothing
stricter than "8 digits", and stored on trust — while it is also how the
founder signs in on the mobile app and how their WhatsApp messages are routed.
This walks the whole life of the number the way a founder meets it:

  1. the step refuses numbers that cannot be an Indian mobile,
  2. a real one is confirmed with a texted code (a wrong code is refused),
  3. closing the tab and coming back does not text them again,
  4. the workspace is created with the confirmed number on the owner,
  5. they sign out and back in with Mobile OTP,
  6. and with the same number in a second workspace, the sign-in page asks
     which one — instead of saying "OTP sent" when nothing was sent.

The scratch backend blanks every SMS gateway and returns the code in the
response (DEV_OTP_IN_RESPONSE=1), which the screens auto-fill. Nothing is
texted to anyone.
"""
import json
import os
import pathlib
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from playwright.sync_api import sync_playwright  # noqa: E402

BASE = os.environ.get("UX_BASE", "http://localhost:5173")
API = "http://localhost:8001/api"
OUT = pathlib.Path(__file__).resolve().parents[2] / ".audit-artifacts" / "founder_mobile"
OUT.mkdir(parents=True, exist_ok=True)
STAMP = int(time.time())
EMAIL = f"mobile.founder.{STAMP}@newcompany.co"
PASSWORD = "Scratch-6624"
COMPANY = f"Lakshmi Looms {STAMP}"
# A 6-9 series number unique to this run. The scratch backend texts nothing.
NORM = "98200" + str(STAMP)[-5:]
TYPED = f"{NORM[:5]} {NORM[5:]}"              # how a founder types it
SHOWN = f"+91 {NORM[:5]} {NORM[5:]}"          # how it is written back
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


def step_error(p):
    el = p.locator('[data-testid="signup-basics-error"]')
    return el.first.inner_text().strip() if el.count() else ""


def next_step(p, wait=900):
    p.locator('[data-testid="signup-basics-next"]').first.click()
    p.wait_for_timeout(wait)


def type_step(p, value, wait=900):
    p.locator('[data-testid="signup-basics"] input').first.fill(value)
    next_step(p, wait)


def boxes_value(p, testid):
    return "".join(p.locator(f'[data-testid="{testid}"] input').nth(i).input_value() for i in range(6))


def type_code(p, testid, code):
    first = p.locator(f'[data-testid="{testid}"] input').first
    first.click()
    for _ in range(6):
        p.keyboard.press("Backspace")
    first.click()
    p.keyboard.type(code, delay=40)


def _db():
    from dotenv import load_dotenv
    from pymongo import MongoClient
    load_dotenv(pathlib.Path(__file__).resolve().parents[1] / ".env")
    return MongoClient(os.environ["MONGO_URL"], serverSelectionTimeoutMS=15000)["dos_uicheck_rbac"]


with sync_playwright() as pw:
    b = pw.chromium.launch()
    ctx = b.new_context(viewport={"width": 1440, "height": 950})
    p = ctx.new_page()
    errors = []
    p.on("pageerror", lambda e: errors.append(str(e)))

    p.goto(f"{BASE}/signup", wait_until="domcontentloaded")
    rec("signup-opens", wait_id(p, "signup-basics", 60000), p.url)
    type_step(p, COMPANY)
    type_step(p, "Lakshmi Narayanan")
    type_step(p, EMAIL, 3500)
    type_step(p, PASSWORD)

    # ---- 1. the step refuses numbers that cannot be an Indian mobile ----
    label = p.locator('[data-testid="signup-basics-next"]').first.inner_text()
    rec("mobile-is-not-optional", "Skip" not in label, f'button reads "{label.strip()}"')
    box = p.locator('[data-testid="signup-input-phone"]').first
    for bad, why in (("", "empty"), ("12345678", "the old 8-digit rule"),
                     ("5820012345", "not a 6-9 mobile"), ("+1 415 555 0100", "a US number")):
        box.fill(bad)
        next_step(p, 800)
        rec(f"refuses-{why.replace(' ', '-')}", "10-digit Indian mobile" in step_error(p)
            and p.locator('[data-testid="signup-phone-code"]').count() == 0,
            step_error(p) or "no error — it would have gone through")
    p.screenshot(path=str(OUT / "1_refused.png"))

    # ---- 2. a real one is confirmed with a texted code ----
    box.fill(TYPED)
    p.wait_for_timeout(300)
    label = p.locator('[data-testid="signup-basics-next"]').first.inner_text()
    rec("says-it-will-text", "Text me a code" in label, label.strip())
    next_step(p, 2500)
    rec("code-screen-opens", wait_id(p, "signup-phone-code", 10000), "the six boxes")
    to = p.locator('[data-testid="signup-phone-code-to"]').first.inner_text() if p.locator('[data-testid="signup-phone-code-to"]').count() else ""
    rec("names-the-number", to == SHOWN, to)
    dev_code = boxes_value(p, "signup-phone-code-boxes")
    rec("a-code-was-issued", len(dev_code) == 6 and dev_code.isdigit(), f"{dev_code[:2]}•••• (dev: auto-filled, nothing texted)")
    p.wait_for_timeout(700)
    p.screenshot(path=str(OUT / "2_code.png"))

    wrong = "000000" if dev_code != "000000" else "111111"
    type_code(p, "signup-phone-code-boxes", wrong)
    p.wait_for_timeout(2500)
    rec("wrong-code-refused", "Incorrect" in step_error(p)
        and p.locator('[data-testid="signup-phone-code"]').count() > 0,
        step_error(p) or "no error")
    p.screenshot(path=str(OUT / "3_wrong_code.png"))

    type_code(p, "signup-phone-code-boxes", dev_code)
    p.wait_for_timeout(3000)
    rec("right-code-moves-on", p.locator('[data-testid="signup-team-size-chips"]').count() > 0,
        "on to team size, with no extra click")

    # ---- 3. closing the tab and coming back does not text them again ----
    p.goto(f"{BASE}/signup", wait_until="domcontentloaded")
    rec("resumes", wait_id(p, "signup-resumed-note", 30000), "welcome back")
    type_step(p, PASSWORD, 1200)
    rec("mobile-kept-and-confirmed", wait_id(p, "signup-phone-confirmed", 8000)
        and p.locator('[data-testid="signup-input-phone"]').first.input_value() == SHOWN,
        p.locator('[data-testid="signup-input-phone"]').first.input_value()
        if p.locator('[data-testid="signup-input-phone"]').count() else "")
    label = p.locator('[data-testid="signup-basics-next"]').first.inner_text()
    rec("no-second-text", "Continue" in label, label.strip())
    p.wait_for_timeout(500)
    p.screenshot(path=str(OUT / "4_resumed_confirmed.png"))
    next_step(p, 1500)
    rec("straight-on", p.locator('[data-testid="signup-phone-code"]').count() == 0
        and p.locator('[data-testid="signup-team-size-chips"]').count() > 0, "team size, no code screen")

    # ---- 4. the workspace is created with the confirmed number ----
    p.locator('[data-testid^="team-size-"]').first.click()
    p.wait_for_timeout(2000)
    if wait_id(p, "signup-website", 15000) and p.locator('[data-testid="signup-website-skip"]').count():
        p.locator('[data-testid="signup-website-skip"]').first.click()
        p.wait_for_timeout(3000)
    if p.locator('[data-testid="signup-manual-industry"]').count():
        p.locator('[data-testid="signup-manual-industry"]').first.select_option(index=1)
        p.wait_for_timeout(400)
        if p.locator('[data-testid="signup-manual-model-B2B"]').count():
            p.locator('[data-testid="signup-manual-model-B2B"]').first.click()
        p.locator('[data-testid="signup-manual-continue"]').first.click()
        p.wait_for_timeout(3000)
    if p.locator('[data-testid="interview-skip"]').count():
        p.locator('[data-testid="interview-skip"]').first.click()
    rec("blueprint-ready", wait_id(p, "build-confirm-button", 120000), "the OS is built")
    p.locator('[data-testid="build-confirm-button"]').first.click()
    rec("workspace-created", wait_id(p, "signup-enter-button", 60000),
        p.locator('[data-testid="build-error"]').first.inner_text() if p.locator('[data-testid="build-error"]').count() else "the reveal")
    owner = _db().users.find_one({"email": EMAIL}) or {}
    rec("owner-has-the-number", owner.get("phone") == SHOWN and owner.get("phone_norm") == NORM,
        f"{owner.get('phone')} / {owner.get('phone_norm')}")
    rec("and-it-is-marked-confirmed", bool(owner.get("phone_verified_at")), str(owner.get("phone_verified_at"))[:25])
    first_tenant = owner.get("tenant_id")

    # ---- 5. out, and back in with Mobile OTP ----
    api(p, "/auth/logout", "POST")
    p.goto(f"{BASE}/login", wait_until="domcontentloaded")
    wait_id(p, "login-tab-otp", 30000)
    p.locator('[data-testid="login-tab-otp"]').first.click()
    p.locator('[data-testid="otp-phone-input"]').first.fill(SHOWN)
    p.locator('[data-testid="otp-submit-button"]').first.click()
    rec("sign-in-texts-a-code", wait_id(p, "otp-boxes", 15000), "code boxes shown")
    p.wait_for_timeout(800)
    p.locator('[data-testid="otp-submit-button"]').first.click()
    p.wait_for_timeout(5000)
    me = api(p, "/auth/me")
    rec("signed-in-by-mobile", me["status"] == 200
        and ((me["body"] or {}).get("user") or {}).get("email") == EMAIL,
        f"{me['status']} as {((me['body'] or {}).get('user') or {}).get('name')} — {p.url}")
    p.screenshot(path=str(OUT / "5_in_by_mobile.png"))

    # ---- 6. the same number in a second workspace: the page asks which ----
    # Made through the same endpoints the wizard uses: confirm, then register.
    api(p, "/auth/logout", "POST")
    sent = api(p, "/signup/phone/send-code", "POST", {"phone": SHOWN})
    code2 = (sent["body"] or {}).get("dev_otp", "")
    proof = api(p, "/signup/phone/verify", "POST", {"phone": SHOWN, "code": code2})
    second = api(p, "/auth/register", "POST", {
        "company_name": f"Lakshmi Consulting {STAMP}", "name": "Lakshmi Narayanan",
        "email": f"mobile.second.{STAMP}@newcompany.co", "password": PASSWORD,
        "phone": TYPED, "phone_token": (proof["body"] or {}).get("phone_token"), "industry": "Consulting"})
    rec("second-workspace-same-number", second["status"] == 200, f"{second['status']} {str(second['body'])[:80] if second['status'] != 200 else ''}")
    second_tenant = ((second["body"] or {}).get("tenant") or {}).get("id")
    api(p, "/auth/logout", "POST")

    p.goto(f"{BASE}/login", wait_until="domcontentloaded")
    wait_id(p, "login-tab-otp", 30000)
    p.locator('[data-testid="login-tab-otp"]').first.click()
    p.locator('[data-testid="otp-phone-input"]').first.fill(TYPED)
    p.locator('[data-testid="otp-submit-button"]').first.click()
    asked = wait_id(p, "otp-workspace-picker", 15000)
    rec("asks-which-workspace", asked and p.locator('[data-testid="otp-boxes"]').count() == 0,
        "a choice, not a code box waiting for a text that never comes")
    rec("the-choices-are-the-buttons", p.locator('[data-testid="otp-submit-button"]').count() == 0,
        "no Send OTP beside them to ask the same question again")
    options = p.locator('[data-testid^="otp-workspace-"]:not([data-testid="otp-workspace-picker"])')
    rec("lists-both", options.count() == 2, [options.nth(i).inner_text().split("\n")[0] for i in range(options.count())])
    p.wait_for_timeout(500)
    p.screenshot(path=str(OUT / "6_which_workspace.png"))
    if second_tenant and p.locator(f'[data-testid="otp-workspace-{second_tenant}"]').count():
        p.locator(f'[data-testid="otp-workspace-{second_tenant}"]').first.click()
    rec("then-texts-a-code", wait_id(p, "otp-boxes", 15000), "for the one chosen")
    p.wait_for_timeout(800)
    p.locator('[data-testid="otp-submit-button"]').first.click()
    p.wait_for_timeout(5000)
    me2 = api(p, "/auth/me")
    rec("signed-into-the-chosen-one", ((me2["body"] or {}).get("tenant") or {}).get("id") == second_tenant
        and second_tenant != first_tenant,
        ((me2["body"] or {}).get("tenant") or {}).get("name"))

    rec("no-page-errors", errors == [], str(errors[:2]))
    ctx.close()
    b.close()

pathlib.Path(OUT / "results.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
ok = sum(1 for r in results if r["ok"] is True)
bad = sum(1 for r in results if r["ok"] is False)
print(f"\n{ok} pass / {bad} fail -> {OUT / 'results.json'}")
