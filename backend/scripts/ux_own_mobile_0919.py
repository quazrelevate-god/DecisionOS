"""Changing your own mobile in Settings — browser acceptance with REAL saves on
a THROWAWAY database.

Run against the `backend-scratch-rbac` backend and the frontend on :5173:

    python scripts/ux_own_mobile_0919.py

2026-09-19, U7-24.14. Settings › Your Profile used to save a new mobile after
one check (nobody else in the workspace has it). The number is a sign-in and a
WhatsApp route, so a slip locked you out of Mobile OTP and gave the stranger
who owns the mistyped number a sign-in as you; a 5-digit "number" saved too.
Now the new number is texted a code and saved only with it.

The scratch backend blanks every SMS gateway and returns the code in the
response (DEV_OTP_IN_RESPONSE=1), which the screen auto-fills.
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
OUT = pathlib.Path(__file__).resolve().parents[2] / ".audit-artifacts" / "own_mobile"
OUT.mkdir(parents=True, exist_ok=True)
STAMP = int(time.time())
TAIL = str(STAMP)[-5:]
OLD = f"98201{TAIL}"          # the number they signed up with
NEW = f"98202{TAIL}"          # the one they move to
COLLEAGUE = f"98203{TAIL}"    # a teammate's
EMAIL = f"owner.mobile.{STAMP}@newcompany.co"
PASSWORD = "Scratch-3318"
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


def toasts(p):
    return " | ".join(t.strip() for t in p.locator("[data-sonner-toast]").all_inner_texts())


def _db():
    from dotenv import load_dotenv
    from pymongo import MongoClient
    load_dotenv(pathlib.Path(__file__).resolve().parents[1] / ".env")
    return MongoClient(os.environ["MONGO_URL"], serverSelectionTimeoutMS=15000)["dos_uicheck_rbac"]


def mine():
    return _db().users.find_one({"email": EMAIL}) or {}


def open_profile(p):
    p.goto(f"{BASE}/settings?tab=account", wait_until="domcontentloaded")
    wait_id(p, "profile-phone-input", 30000)
    p.wait_for_timeout(1500)
    p.locator('[data-testid="profile-phone-input"]').first.scroll_into_view_if_needed()


def type_phone(p, value):
    box = p.locator('[data-testid="profile-phone-input"]').first
    box.fill(value)
    p.wait_for_timeout(400)


def save(p, wait=2500):
    p.locator('[data-testid="profile-save"]').first.click()
    p.wait_for_timeout(wait)


with sync_playwright() as pw:
    b = pw.chromium.launch()
    ctx = b.new_context(viewport={"width": 1440, "height": 950})
    p = ctx.new_page()
    errors = []
    p.on("pageerror", lambda e: errors.append(str(e)))

    # An owner who signed up the way signup works now: the mobile confirmed.
    p.goto(f"{BASE}/login", wait_until="domcontentloaded")
    code = (api(p, "/signup/phone/send-code", "POST", {"phone": OLD})["body"] or {}).get("dev_otp")
    proof = (api(p, "/signup/phone/verify", "POST", {"phone": OLD, "code": code})["body"] or {}).get("phone_token")
    made = api(p, "/auth/register", "POST", {
        "company_name": f"Meenakshi Mills {STAMP}", "name": "Meenakshi Sundaram", "email": EMAIL,
        "password": PASSWORD, "phone": OLD, "phone_token": proof, "industry": "Textiles"})
    rec("an-owner-with-a-confirmed-mobile", made["status"] == 200 and mine().get("phone_norm") == OLD,
        f"{made['status']} {mine().get('phone')}")
    teammate = api(p, "/users", "POST", {"name": "Priya", "email": f"priya.{STAMP}@newcompany.co",
                                          "role": "sales", "phone": COLLEAGUE})
    rec("a-teammate-with-their-own-number", teammate["status"] == 200, teammate["status"])

    open_profile(p)

    # ---- a number that cannot be a mobile ----
    type_phone(p, "12345")
    rec("says-it-is-not-a-mobile", wait_id(p, "profile-phone-invalid", 3000), "under the field, before saving")
    save(p)
    rec("and-will-not-save-it", mine().get("phone_norm") == OLD and "10-digit" in toasts(p),
        f"stored {mine().get('phone_norm')} — {toasts(p)[:60]}")

    # ---- a colleague's number: refused before anything is texted ----
    type_phone(p, COLLEAGUE)
    p.locator('[data-testid="profile-phone-send-code"]').first.click()
    p.wait_for_timeout(2500)
    rec("a-colleagues-number-is-refused", "Priya" in toasts(p)
        and p.locator('[data-testid="profile-phone-code-boxes"]').count() == 0, toasts(p)[:80])

    # ---- a real new number: nothing saves until its code is in ----
    type_phone(p, f"{NEW[:5]} {NEW[5:]}")
    rec("offers-to-text-the-new-number", wait_id(p, "profile-phone-send-code", 3000),
        p.locator('[data-testid="profile-phone-send-code"]').first.inner_text())
    p.screenshot(path=str(OUT / "1_new_number.png"))
    save(p)
    rec("save-without-a-code-does-nothing", mine().get("phone_norm") == OLD,
        f"still {mine().get('phone')} — {toasts(p)[-70:]}")

    p.locator('[data-testid="profile-phone-send-code"]').first.click()
    rec("the-code-boxes-appear", wait_id(p, "profile-phone-code-boxes", 8000), "code texted to the new number")
    p.wait_for_timeout(800)
    p.locator('[data-testid="profile-phone-confirm"]').first.scroll_into_view_if_needed()
    p.screenshot(path=str(OUT / "2_code.png"))
    save(p, 3500)
    after = mine()
    rec("the-new-number-is-saved", after.get("phone_norm") == NEW and after.get("phone") == f"+91 {NEW[:5]} {NEW[5:]}",
        f"{after.get('phone')} / {after.get('phone_norm')}")
    rec("and-marked-confirmed", bool(after.get("phone_verified_at")), str(after.get("phone_verified_at"))[:25])
    rec("the-panel-closes", p.locator('[data-testid="profile-phone-confirm"]').count() == 0,
        "the saved number is the current one now")
    p.screenshot(path=str(OUT / "3_saved.png"))

    # ---- saving the form again, number untouched: no code asked for ----
    p.locator('[data-testid="profile-title-input"]').first.fill("Founder")
    save(p)
    rec("other-edits-need-no-code", mine().get("title") == "Founder", "job title saved with the number riding along")

    # ---- and the new number is the one that signs in ----
    api(p, "/auth/logout", "POST")
    old_try = api(p, "/auth/otp/request", "POST", {"phone": OLD})
    rec("the-old-number-no-longer-signs-in", old_try["status"] == 404, f"{old_try['status']} {str(old_try['body'])[:60]}")
    p.goto(f"{BASE}/login", wait_until="domcontentloaded")
    wait_id(p, "login-tab-otp", 30000)
    p.locator('[data-testid="login-tab-otp"]').first.click()
    p.locator('[data-testid="otp-phone-input"]').first.fill(NEW)
    p.locator('[data-testid="otp-submit-button"]').first.click()
    wait_id(p, "otp-boxes", 15000)
    p.wait_for_timeout(800)
    p.locator('[data-testid="otp-submit-button"]').first.click()
    p.wait_for_timeout(5000)
    me = api(p, "/auth/me")
    rec("the-new-number-signs-in", ((me["body"] or {}).get("user") or {}).get("email") == EMAIL,
        f"{me['status']} as {((me['body'] or {}).get('user') or {}).get('name')}")

    rec("no-page-errors", errors == [], str(errors[:2]))
    ctx.close()
    b.close()

pathlib.Path(OUT / "results.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
ok = sum(1 for r in results if r["ok"] is True)
bad = sum(1 for r in results if r["ok"] is False)
print(f"\n{ok} pass / {bad} fail -> {OUT / 'results.json'}")
