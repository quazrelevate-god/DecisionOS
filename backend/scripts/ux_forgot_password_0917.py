"""Forgetting your password, end to end — browser acceptance with REAL saves on
a THROWAWAY database.

Run against the `backend-scratch-rbac` backend:

    python scripts/ux_forgot_password_0917.py

The backend has had both halves since FIX-003-D; neither screen existed, so the
sign-in page had no link and the link in every reset email landed on a 404. This
walks the whole errand, the way a founder does, and then proves the password
really changed by signing in with the new one and failing with the old one.

The reset token is read from the database (the way the email would carry it),
because SMTP is blanked on the scratch backend — nothing is sent to anyone.
"""
import json
import os
import pathlib
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from playwright.sync_api import sync_playwright  # noqa: E402

BASE = "http://localhost:3000"
API = "http://localhost:8001/api"
OUT = pathlib.Path(__file__).resolve().parents[2] / ".audit-artifacts" / "forgot_password"
OUT.mkdir(parents=True, exist_ok=True)
STAMP = int(time.time())
EMAIL = f"forgetful.{STAMP}@newcompany.co"
OLD_PASSWORD = "Scratch-4821"
NEW_PASSWORD = "Scratch-9137"
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


def reset_token_for(email):
    """What the email would have carried. The scratch backend sends nothing."""
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
    os.environ.setdefault("DB_NAME", "dos_uicheck_rbac")
    from pymongo import MongoClient
    from dotenv import load_dotenv
    load_dotenv(pathlib.Path(__file__).resolve().parents[1] / ".env")
    db = MongoClient(os.environ["MONGO_URL"], serverSelectionTimeoutMS=15000)["dos_uicheck_rbac"]
    row = db.auth_email_tokens.find_one({"email": email, "kind": "password_reset"},
                                        sort=[("created_at", -1)])
    return (row or {}).get("token")


with sync_playwright() as pw:
    b = pw.chromium.launch()
    ctx = b.new_context(viewport={"width": 1440, "height": 950})
    p = ctx.new_page()
    errors = []
    p.on("pageerror", lambda e: errors.append(str(e)))

    # A workspace to forget the password of.
    p.goto(f"{BASE}/login", wait_until="domcontentloaded")
    made = api(p, "/auth/register", "POST", {
        "company_name": f"Forgetful Foods {STAMP}", "name": "Ravi Kumar",
        "email": EMAIL, "password": OLD_PASSWORD, "industry": "Food Processing"})
    rec("a-workspace-to-forget", made["status"] == 200, made["status"])

    # ---- the link is where a person looks for it ----
    p.goto(f"{BASE}/login", wait_until="domcontentloaded")
    p.wait_for_timeout(2500)
    rec("link-on-the-sign-in-page", p.locator('[data-testid="login-forgot-password"]').count() > 0,
        "under the password field")
    p.locator('[data-testid="login-forgot-password"]').first.click()
    rec("opens-the-request-screen", wait_id(p, "forgot-password"), p.url)
    p.wait_for_timeout(900)   # the card fades in; shoot what a person sees
    p.screenshot(path=str(OUT / "1_forgot.png"))

    # ---- it checks the address before asking the server ----
    p.locator('[data-testid="forgot-password-email"]').first.fill("not-an-email")
    p.locator('[data-testid="forgot-password-submit"]').first.click()
    p.wait_for_timeout(700)
    rec("bad-address-refused", p.locator('[data-testid="forgot-password-error"]').count() > 0,
        p.locator('[data-testid="forgot-password-error"]').first.inner_text()
        if p.locator('[data-testid="forgot-password-error"]').count() else "")

    # ---- an address nobody has gets the SAME answer (no enumeration) ----
    p.locator('[data-testid="forgot-password-email"]').first.fill(f"nobody.{STAMP}@nowhere.co")
    p.locator('[data-testid="forgot-password-submit"]').first.click()
    unknown_said = wait_id(p, "forgot-password-sent", 15000) and \
        p.locator('[data-testid="forgot-password-sent-note"]').first.inner_text()
    rec("unknown-address-says-the-same", bool(unknown_said) and "If an account exists" in unknown_said,
        (unknown_said or "")[:80])

    # ---- the real one ----
    p.locator('[data-testid="forgot-password-again"]').first.click()
    p.wait_for_timeout(600)
    p.locator('[data-testid="forgot-password-email"]').first.fill(EMAIL)
    p.locator('[data-testid="forgot-password-submit"]').first.click()
    rec("link-requested", wait_id(p, "forgot-password-sent", 15000), "same answer, and a token issued")
    p.wait_for_timeout(900)
    p.screenshot(path=str(OUT / "2_sent.png"))

    token = reset_token_for(EMAIL)
    rec("a-token-was-issued", bool(token), f"{(token or '')[:10]}… (one hour, single use)")

    # ---- a link with no token does not strand them ----
    p.goto(f"{BASE}/reset-password", wait_until="domcontentloaded")
    p.wait_for_timeout(2000)
    rec("half-a-link-offers-a-new-one", wait_id(p, "reset-password-dead", 10000)
        and p.locator('[data-testid="reset-password-new-link"]').count() > 0,
        "\"Send me a new link\" instead of a dead end")

    # ---- the real link ----
    p.goto(f"{BASE}/reset-password?token={token}", wait_until="domcontentloaded")
    rec("the-link-opens-the-form", wait_id(p, "reset-password", 15000), "set a new password")
    p.wait_for_timeout(900)
    p.screenshot(path=str(OUT / "3_reset.png"))

    p.locator('[data-testid="reset-password-input"]').first.fill("123")
    p.locator('[data-testid="reset-password-confirm"]').first.fill("123")
    p.locator('[data-testid="reset-password-submit"]').first.click()
    p.wait_for_timeout(700)
    rec("short-password-refused", p.locator('[data-testid="reset-password-error"]').count() > 0,
        p.locator('[data-testid="reset-password-error"]').first.inner_text()
        if p.locator('[data-testid="reset-password-error"]').count() else "")

    p.locator('[data-testid="reset-password-input"]').first.fill(NEW_PASSWORD)
    p.locator('[data-testid="reset-password-confirm"]').first.fill("something-else")
    p.locator('[data-testid="reset-password-submit"]').first.click()
    p.wait_for_timeout(700)
    rec("mismatch-refused", p.locator('[data-testid="reset-password-error"]').count() > 0
        and "match" in p.locator('[data-testid="reset-password-error"]').first.inner_text().lower(),
        "the two fields have to agree")

    p.locator('[data-testid="reset-password-confirm"]').first.fill(NEW_PASSWORD)
    p.locator('[data-testid="reset-password-submit"]').first.click()
    p.wait_for_timeout(4000)
    rec("lands-back-on-sign-in", "/login" in p.url, p.url)
    p.wait_for_timeout(900)
    p.screenshot(path=str(OUT / "4_back_to_login.png"))

    # ---- and the password really changed ----
    old = api(p, "/auth/login", "POST", {"email": EMAIL, "password": OLD_PASSWORD})
    rec("the-old-password-stops-working", old["status"] == 401, old["status"])
    new = api(p, "/auth/login", "POST", {"email": EMAIL, "password": NEW_PASSWORD})
    rec("the-new-password-works", new["status"] == 200
        and (new["body"] or {}).get("user", {}).get("email") == EMAIL, new["status"])

    # ---- the link is spent ----
    again = api(p, "/auth/password/reset", "POST", {"token": token, "new_password": "Scratch-0000"})
    rec("the-link-is-single-use", again["status"] == 400, f"{again['status']} {str(again['body'])[:60]}")
    p.goto(f"{BASE}/reset-password?token={token}", wait_until="domcontentloaded")
    p.wait_for_timeout(1500)
    p.locator('[data-testid="reset-password-input"]').first.fill(NEW_PASSWORD)
    p.locator('[data-testid="reset-password-confirm"]').first.fill(NEW_PASSWORD)
    p.locator('[data-testid="reset-password-submit"]').first.click()
    p.wait_for_timeout(2500)
    rec("a-spent-link-says-so", wait_id(p, "reset-password-dead", 8000)
        and p.locator('[data-testid="reset-password-new-link"]').count() > 0,
        "and offers a new one")
    p.wait_for_timeout(900)
    p.screenshot(path=str(OUT / "5_spent.png"))

    rec("no-page-errors", errors == [], str(errors[:2]))
    ctx.close()
    b.close()

pathlib.Path(OUT / "results.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
ok = sum(1 for r in results if r["ok"] is True)
bad = sum(1 for r in results if r["ok"] is False)
print(f"\n{ok} pass / {bad} fail -> {OUT / 'results.json'}")
