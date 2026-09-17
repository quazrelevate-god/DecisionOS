"""Confirming your email, end to end — browser acceptance with REAL saves on
a THROWAWAY database.

Run against the `backend-scratch-rbac` backend:

    python scripts/ux_verify_email_0917.py

U7-24.10, the other half of the forgot-password find. Registration has emailed
{APP_BASE_URL}/verify-email?token=… since FIX-003-D and App.js had no such
route, so that link has always landed on a 404; POST
/auth/email/send-verification had no caller anywhere, and nothing in the app
read email_verified_at, so nobody was ever told the address was unconfirmed.

The token is read from the database (the way the email would carry it), because
SMTP is blanked on the scratch backend — nothing is sent to anyone.
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
OUT = pathlib.Path(__file__).resolve().parents[2] / ".audit-artifacts" / "verify_email"
OUT.mkdir(parents=True, exist_ok=True)
STAMP = int(time.time())
EMAIL = f"unconfirmed.{STAMP}@newcompany.co"
PASSWORD = "Scratch-7741"
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


def _db():
    from dotenv import load_dotenv
    from pymongo import MongoClient
    load_dotenv(pathlib.Path(__file__).resolve().parents[1] / ".env")
    os.environ.setdefault("DB_NAME", "dos_uicheck_rbac")
    return MongoClient(os.environ["MONGO_URL"], serverSelectionTimeoutMS=15000)["dos_uicheck_rbac"]


def verify_token_for(email):
    """What the welcome email would have carried: the live, unspent one."""
    row = _db().auth_email_tokens.find_one(
        {"email": email, "kind": "email_verify", "used_at": None},
        sort=[("created_at", -1)])
    return (row or {}).get("token")


def verified_at(email):
    return (_db().users.find_one({"email": email}) or {}).get("email_verified_at")


with sync_playwright() as pw:
    b = pw.chromium.launch()
    ctx = b.new_context(viewport={"width": 1440, "height": 950})
    p = ctx.new_page()
    errors = []
    p.on("pageerror", lambda e: errors.append(str(e)))

    # A workspace whose email nobody has confirmed yet.
    p.goto(f"{BASE}/login", wait_until="domcontentloaded")
    made = api(p, "/auth/register", "POST", {
        "company_name": f"Unconfirmed Traders {STAMP}", "name": "Priya Raman",
        "email": EMAIL, "password": PASSWORD, "industry": "Retail"})
    rec("a-new-workspace", made["status"] == 200, made["status"])
    rec("nothing-is-confirmed-yet", verified_at(EMAIL) in (None, ""), repr(verified_at(EMAIL)))

    token = verify_token_for(EMAIL)
    rec("registration-issued-a-link", bool(token), f"{(token or '')[:10]}… (three days, single use)")

    # ---- signed out, a half-copied link does not strand them ----
    api(p, "/auth/logout", "POST")
    p.goto(f"{BASE}/verify-email", wait_until="domcontentloaded")
    p.wait_for_timeout(2500)
    rec("half-a-link-says-so", wait_id(p, "verify-email-dead", 10000)
        and p.locator('[data-testid="verify-email-signin-first"]').count() > 0,
        "and says where a fresh one comes from")
    p.wait_for_timeout(900)
    p.screenshot(path=str(OUT / "1_dead_signed_out.png"))

    # ---- the real link, clicked from an inbox with nobody signed in ----
    p.goto(f"{BASE}/verify-email?token={token}", wait_until="domcontentloaded")
    rec("the-link-confirms-the-email", wait_id(p, "verify-email-done", 20000), p.url)
    note = p.locator('[data-testid="verify-email-done-note"]').first.inner_text()
    rec("it-names-the-address", EMAIL in note, note[:70])
    rec("and-the-account-is-marked", bool(verified_at(EMAIL)), str(verified_at(EMAIL))[:30])
    rec("signed-out-it-offers-sign-in",
        "Sign in" in p.locator('[data-testid="verify-email-continue"]').first.inner_text(),
        p.locator('[data-testid="verify-email-continue"]').first.inner_text())
    p.wait_for_timeout(900)
    p.screenshot(path=str(OUT / "2_confirmed.png"))

    # ---- the link is spent, and the second click is not a dead end ----
    again = api(p, f"/auth/email/verify/{token}")
    rec("the-link-is-single-use", again["status"] == 400, f"{again['status']} {str(again['body'])[:60]}")

    # ---- signed in, the same spent link knows the email is already done ----
    signed = api(p, "/auth/login", "POST", {"email": EMAIL, "password": PASSWORD})
    rec("sign-in-works", signed["status"] == 200, signed["status"])
    p.goto(f"{BASE}/verify-email?token={token}", wait_until="domcontentloaded")
    rec("a-spent-link-on-a-done-email-says-already-confirmed",
        wait_id(p, "verify-email-dead", 15000)
        and "Already confirmed" in p.locator('[data-testid="verify-email-dead"]').first.inner_text(),
        "not \"this link won't work\"")
    p.wait_for_timeout(900)
    p.screenshot(path=str(OUT / "3_already_confirmed.png"))

    # ---- signed in and NOT confirmed, a bad link offers a fresh one ----
    _db().users.update_one({"email": EMAIL}, {"$set": {"email_verified_at": None}})
    p.goto(f"{BASE}/verify-email?token=not-a-real-token", wait_until="domcontentloaded")
    rec("a-bad-link-offers-a-new-one", wait_id(p, "verify-email-resend", 15000),
        "\"Send me a new link\", right there on the page")
    p.locator('[data-testid="verify-email-resend"]').first.click()
    rec("and-sends-it", wait_id(p, "verify-email-resent", 20000), "to the address on the account")
    p.wait_for_timeout(900)
    p.screenshot(path=str(OUT / "3b_resent.png"))
    # put it back the way the next step expects
    _db().users.update_one({"email": EMAIL}, {"$set": {"email_verified_at": "2026-09-17T00:00:00+00:00"}})

    # ---- Settings says so, now that it is confirmed ----
    p.goto(f"{BASE}/settings?tab=account", wait_until="domcontentloaded")
    p.wait_for_timeout(4000)
    rec("settings-shows-confirmed", wait_id(p, "profile-email-verified", 15000),
        "a quiet line under the sign-in address")
    p.locator('[data-testid="profile-email-verified"]').first.scroll_into_view_if_needed()
    p.wait_for_timeout(600)
    p.screenshot(path=str(OUT / "4_settings_confirmed.png"))

    # ---- and for someone NOT confirmed, Settings offers the link ----
    _db().users.update_one({"email": EMAIL}, {"$set": {"email_verified_at": None}})
    p.goto(f"{BASE}/settings?tab=account", wait_until="domcontentloaded")
    p.wait_for_timeout(4000)
    rec("settings-says-not-confirmed", wait_id(p, "profile-email-unverified", 15000),
        "with a Send the link button")
    p.locator('[data-testid="profile-email-unverified"]').first.scroll_into_view_if_needed()
    p.wait_for_timeout(600)
    p.screenshot(path=str(OUT / "5_settings_unconfirmed.png"))

    p.locator('[data-testid="profile-email-verify-send"]').first.click()
    rec("settings-can-send-another", wait_id(p, "profile-email-verify-sent", 20000),
        "the re-send endpoint finally has a caller")
    fresh = verify_token_for(EMAIL)
    rec("a-fresh-link-exists", bool(fresh), f"{(fresh or '')[:10]}…")
    p.locator('[data-testid="profile-email-verify-sent"]').first.scroll_into_view_if_needed()
    p.wait_for_timeout(600)
    p.screenshot(path=str(OUT / "6_settings_sent.png"))

    # ---- and the fresh one works, from inside the app ----
    p.goto(f"{BASE}/verify-email?token={fresh}", wait_until="domcontentloaded")
    rec("the-fresh-link-confirms-it-too", wait_id(p, "verify-email-done", 20000)
        and bool(verified_at(EMAIL)), str(verified_at(EMAIL))[:30])
    rec("signed-in-it-offers-the-way-home",
        "DecisionOS" in p.locator('[data-testid="verify-email-continue"]').first.inner_text(),
        p.locator('[data-testid="verify-email-continue"]').first.inner_text())
    p.wait_for_timeout(900)
    p.screenshot(path=str(OUT / "7_confirmed_signed_in.png"))

    # ---- asking again when it is already done is not an error ----
    said = api(p, "/auth/email/send-verification", "POST")
    rec("asking-again-when-done-is-harmless",
        said["status"] == 200 and (said["body"] or {}).get("already_verified") is True,
        str(said["body"])[:60])

    rec("no-page-errors", errors == [], str(errors[:2]))
    ctx.close()
    b.close()

pathlib.Path(OUT / "results.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
ok = sum(1 for r in results if r["ok"] is True)
bad = sum(1 for r in results if r["ok"] is False)
print(f"\n{ok} pass / {bad} fail -> {OUT / 'results.json'}")
