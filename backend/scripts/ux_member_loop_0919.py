"""The member loop, clicked through — browser acceptance with REAL saves on a
THROWAWAY database.

Run against the `backend-scratch-rbac` backend and the frontend on :5173:

    python scripts/ux_member_loop_0919.py

2026-09-19. Yokesh: a manager or HR person adds each member on Team — name,
role, mobile — and the member makes the account their own. The model now:
members sign in with their mobile and a texted code; owners have an email and a
password as well. This walks it with two browsers, an owner's and a member's:

  1. Team › Add member has no password, an optional email, and a mobile that
     must be a real one; saving hands over the invite link.
  2. Before the link is used, the member's number alone opens nothing.
  3. The link signs them in, and their first screen confirms the mobile and
     asks them to check their details.
  4. After that, the mobile is all they need.
  5. Promoted to owner, their next sign-in asks for an email and a password
     (8+ characters, a letter and a number) before anything else — and then
     both ways in work.

SMS gateways are blanked on the scratch backend; codes come back in the
response (DEV_OTP_IN_RESPONSE=1) and the screens auto-fill them.
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
OUT = pathlib.Path(__file__).resolve().parents[2] / ".audit-artifacts" / "member_loop"
OUT.mkdir(parents=True, exist_ok=True)
STAMP = int(time.time())
TAIL = str(STAMP)[-5:]
OWNER_PHONE = f"98204{TAIL}"
MEMBER_PHONE = f"98205{TAIL}"
OWNER_EMAIL = f"hr.owner.{STAMP}@newcompany.co"
MEMBER_EMAIL = f"priya.{STAMP}@newcompany.co"
PASSWORD = "Scratch-5521"
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


def member():
    return _db().users.find_one({"phone_norm": MEMBER_PHONE}) or {}


def otp_sign_in(p, phone):
    p.goto(f"{BASE}/login", wait_until="domcontentloaded")
    wait_id(p, "login-tab-otp", 30000)
    p.locator('[data-testid="login-tab-otp"]').first.click()
    p.locator('[data-testid="otp-phone-input"]').first.fill(phone)
    p.locator('[data-testid="otp-submit-button"]').first.click()
    p.wait_for_timeout(2500)


with sync_playwright() as pw:
    b = pw.chromium.launch()
    errors = []

    # ---------------- the owner (HR/manager) ----------------
    octx = b.new_context(viewport={"width": 1440, "height": 950})
    o = octx.new_page()
    o.on("pageerror", lambda e: errors.append(str(e)))
    o.goto(f"{BASE}/login", wait_until="domcontentloaded")
    code = (api(o, "/signup/phone/send-code", "POST", {"phone": OWNER_PHONE})["body"] or {}).get("dev_otp")
    proof = (api(o, "/signup/phone/verify", "POST", {"phone": OWNER_PHONE, "code": code})["body"] or {}).get("phone_token")
    made = api(o, "/auth/register", "POST", {
        "company_name": f"Anand Textiles {STAMP}", "name": "Anand Kumar", "email": OWNER_EMAIL,
        "password": PASSWORD, "phone": OWNER_PHONE, "phone_token": proof, "industry": "Textiles"})
    rec("an-owner", made["status"] == 200, made["status"])

    # ---- 1. Team › Add member ----
    o.goto(f"{BASE}/team", wait_until="domcontentloaded")
    wait_id(o, "add-user-button", 30000)
    o.locator('[data-testid="add-user-button"]').first.click()
    wait_id(o, "member-dialog", 10000)
    dialog = o.locator('[data-testid="member-dialog"]').first
    rec("no-password-for-the-manager-to-choose",
        o.locator('[data-testid="member-password-input"]').count() == 0
        and o.locator('[data-testid="login-method-toggle"]').count() == 0, "the sign-in toggle is gone")
    rec("email-is-optional", "email (optional)" in dialog.inner_text().lower(), "labelled so")
    o.locator('[data-testid="member-name-input"]').first.fill("Priya Nair")
    o.locator('[data-testid="member-phone-input"]').first.fill("12345")
    rec("a-bad-number-is-flagged", wait_id(o, "member-phone-invalid", 3000), "under the field")
    o.locator('[data-testid="member-save-submit"]').first.click()
    o.wait_for_timeout(1500)
    rec("and-not-saved", _db().users.count_documents({"phone_norm": {"$in": ["12345", MEMBER_PHONE]}}) == 0,
        toasts(o)[-60:])
    o.locator('[data-testid="member-phone-input"]').first.fill(f"{MEMBER_PHONE[:5]} {MEMBER_PHONE[5:]}")
    o.wait_for_timeout(300)
    o.screenshot(path=str(OUT / "1_add_member.png"))
    o.locator('[data-testid="member-save-submit"]').first.click()
    rec("saving-hands-over-the-invite-link", wait_id(o, "invite-link-modal", 15000), "copy / WhatsApp")
    link = o.locator('[data-testid="invite-link-input"]').first.input_value() if o.locator('[data-testid="invite-link-input"]').count() else ""
    m = member()
    rec("stored-mobile-only-and-pending", m.get("passwordless") is True and "email" not in m
        and m.get("phone") == f"+91 {MEMBER_PHONE[:5]} {MEMBER_PHONE[5:]}", f"{m.get('phone')}, no email, no password")
    o.wait_for_timeout(600)
    o.screenshot(path=str(OUT / "2_invite_link.png"))

    # ---------------- the member ----------------
    mctx = b.new_context(viewport={"width": 1440, "height": 950})
    p = mctx.new_page()
    p.on("pageerror", lambda e: errors.append(str(e)))

    # ---- 2. before the link: the number alone opens nothing ----
    otp_sign_in(p, MEMBER_PHONE)
    err = p.locator('[data-testid="auth-error"]').first.inner_text() if p.locator('[data-testid="auth-error"]').count() else ""
    rec("number-alone-opens-nothing-yet", "invite link" in err and p.locator('[data-testid="otp-boxes"]').count() == 0, err[:80])
    p.screenshot(path=str(OUT / "3_invite_first.png"))

    # ---- 3. the link ----
    p.goto(link, wait_until="domcontentloaded")
    rec("the-link-texts-a-code", wait_id(p, "otp-boxes", 30000), "code boxes (auto-filled in dev)")
    p.wait_for_timeout(800)
    p.locator('[data-testid="otp-submit-button"]').first.click()
    rec("first-screen-welcomes-them", wait_id(p, "welcome-member-card", 30000), p.url)
    rec("and-says-the-mobile-is-confirmed", wait_id(p, "welcome-mobile-confirmed", 5000),
        p.locator('[data-testid="welcome-mobile-confirmed"]').first.inner_text()[:70] if p.locator('[data-testid="welcome-mobile-confirmed"]').count() else "")
    p.wait_for_timeout(700)
    p.screenshot(path=str(OUT / "4_welcome.png"))
    p.locator('[data-testid="welcome-title"]').first.fill("Sales Lead")
    p.locator('[data-testid="welcome-about"]').first.fill("Chennai dealers")
    p.locator('[data-testid="welcome-email"]').first.fill(MEMBER_EMAIL)
    t0 = time.time()
    p.locator('[data-testid="welcome-save"]').first.click()
    # Wait for the card to close, not a fixed time: the save can be slow while
    # the Desk behind it is loading.
    try:
        p.locator('[data-testid="welcome-member-card"]').first.wait_for(state="detached", timeout=60000)
    except Exception:
        pass
    rec("the-save-returns", p.locator('[data-testid="welcome-member-card"]').count() == 0,
        f"card closed after {round(time.time() - t0, 1)}s")
    m = member()
    rec("details-saved", m.get("title") == "Sales Lead" and m.get("about") == "Chennai dealers"
        and m.get("email") == MEMBER_EMAIL, f"{m.get('title')} / {m.get('email')}")
    rec("mobile-marked-confirmed", bool(m.get("phone_verified_at")), str(m.get("phone_verified_at"))[:25])
    rec("the-card-is-done-with", p.locator('[data-testid="welcome-member-card"]').count() == 0
        and not m.get("welcome_pending"), "not shown again")
    p.goto(f"{BASE}/settings?tab=account", wait_until="domcontentloaded")
    rec("settings-says-mobile-sign-in", wait_id(p, "password-mobile-only", 20000), "no password to keep")

    # ---- 4. after that, the mobile is all they need ----
    api(p, "/auth/logout", "POST")
    otp_sign_in(p, MEMBER_PHONE)
    rec("plain-mobile-otp-works-now", wait_id(p, "otp-boxes", 8000), "code boxes")
    p.wait_for_timeout(600)
    p.locator('[data-testid="otp-submit-button"]').first.click()
    p.wait_for_timeout(4000)
    me = api(p, "/auth/me")
    rec("signed-in-by-mobile", ((me["body"] or {}).get("user") or {}).get("name") == "Priya Nair", me["status"])

    # ---- 5. promoted to owner ----
    promoted = api(o, f"/users/{m.get('id')}", "PATCH", {"role": "owner"})
    rec("promoted", promoted["status"] == 200, promoted["status"])
    api(p, "/auth/logout", "POST")
    otp_sign_in(p, MEMBER_PHONE)
    p.wait_for_timeout(600)
    p.locator('[data-testid="otp-submit-button"]').first.click()
    rec("owners-are-asked-for-email-and-password", wait_id(p, "owner-credentials-gate", 30000), "before anything else")
    prefilled = p.locator('[data-testid="owner-credentials-email"]').first.input_value() if p.locator('[data-testid="owner-credentials-email"]').count() else ""
    rec("their-email-is-already-there", prefilled == MEMBER_EMAIL, prefilled)
    p.locator('[data-testid="owner-credentials-password"]').first.fill("123456")
    p.locator('[data-testid="owner-credentials-confirm"]').first.fill("123456")
    p.locator('[data-testid="owner-credentials-save"]').first.click()
    p.wait_for_timeout(1200)
    weak = p.locator('[data-testid="owner-credentials-error"]').first.inner_text() if p.locator('[data-testid="owner-credentials-error"]').count() else ""
    rec("a-weak-password-is-refused", "8 characters" in weak, weak)
    p.screenshot(path=str(OUT / "5_owner_credentials.png"))
    p.locator('[data-testid="owner-credentials-password"]').first.fill("Anand2026x")
    p.locator('[data-testid="owner-credentials-confirm"]').first.fill("Anand2026x")
    t0 = time.time()
    p.locator('[data-testid="owner-credentials-save"]').first.click()
    try:
        p.locator('[data-testid="owner-credentials-gate"]').first.wait_for(state="detached", timeout=60000)
    except Exception:
        pass
    rec("then-the-gate-lets-them-in", p.locator('[data-testid="owner-credentials-gate"]').count() == 0,
        f"after {round(time.time() - t0, 1)}s — {p.url}")
    api(p, "/auth/logout", "POST")
    by_pw = api(p, "/auth/login", "POST", {"email": MEMBER_EMAIL, "password": "Anand2026x"})
    rec("email-and-password-work", by_pw["status"] == 200, by_pw["status"])
    api(p, "/auth/logout", "POST")
    otp_sign_in(p, MEMBER_PHONE)
    rec("and-the-mobile-still-works", wait_id(p, "otp-boxes", 8000), "both ways in")

    rec("no-page-errors", errors == [], str(errors[:2]))
    octx.close()
    mctx.close()
    b.close()

pathlib.Path(OUT / "results.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
ok = sum(1 for r in results if r["ok"] is True)
bad = sum(1 for r in results if r["ok"] is False)
print(f"\n{ok} pass / {bad} fail -> {OUT / 'results.json'}")
