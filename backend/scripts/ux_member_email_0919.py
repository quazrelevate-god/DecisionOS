"""A member's email on Team — browser acceptance with REAL saves on a
THROWAWAY database.

Run against the `backend-scratch-rbac` backend and the frontend on :5173:

    python scripts/ux_member_email_0919.py

2026-09-19, the Add member form check. Members sign in by mobile, so their
email is contact detail. Five things were in the way:

  1. a manager could enter an email when adding someone but not fix it later;
  2. nobody could remove a member's email;
  3. a bad email was only caught by the server after Save;
  4. a member without an email got an empty "Email" box on their profile;
  5. a stale comment still said the email was how members sign in.

This walks 1-4 as a manager (Manage team, not an owner). The owner's side —
an email someone signs in with stays the owner's call — is in
tests/test_member_loop.py.
"""
import json
import os
import pathlib
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from playwright.sync_api import sync_playwright  # noqa: E402
from ux_team_nav import reveal_member  # noqa: E402

BASE = os.environ.get("UX_BASE", "http://localhost:5173")
API = "http://localhost:8001/api"
OUT = pathlib.Path(__file__).resolve().parents[2] / ".audit-artifacts" / "member_email"
OUT.mkdir(parents=True, exist_ok=True)
STAMP = int(time.time())
T = str(STAMP)[-5:]
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
    return MongoClient(os.environ["MONGO_URL"], serverSelectionTimeoutMS=15000)["dos_uicheck_rbac"]


def open_profile(p, uid):
    p.goto(f"{BASE}/team", wait_until="domcontentloaded")
    wait_id(p, "team-tree", 30000)
    p.wait_for_timeout(1500)
    if not reveal_member(p, uid):
        return False
    p.locator(f'[data-testid="team-member-{uid}"]').first.click()
    return wait_id(p, f"profile-dialog-{uid}")


with sync_playwright() as pw:
    b = pw.chromium.launch()
    errors = []
    octx = b.new_context(viewport={"width": 1440, "height": 950})
    o = octx.new_page()
    o.on("pageerror", lambda e: errors.append(str(e)))
    o.goto(f"{BASE}/login", wait_until="domcontentloaded")
    op = f"98211{T}"
    c = (api(o, "/signup/phone/send-code", "POST", {"phone": op})["body"] or {}).get("dev_otp")
    tok = (api(o, "/signup/phone/verify", "POST", {"phone": op, "code": c})["body"] or {}).get("phone_token")
    made = api(o, "/auth/register", "POST", {"company_name": f"Email Co {STAMP}", "name": "Owner Email",
                                             "email": f"owner.{STAMP}@emailco.in", "password": "Email2026x",
                                             "phone": op, "phone_token": tok, "industry": "Retail"})
    tenant = ((made["body"] or {}).get("tenant") or {}).get("id")
    role_key = (_db().tenants.find_one({"id": tenant}) or {}).get("roles", [{}])[0].get("key")
    # a manager: Manage team, not an owner
    mp = f"98212{T}"
    mgr = api(o, "/users", "POST", {"name": "Mani Manager", "role": role_key, "phone": mp, "follow_role": False,
                                    "permissions": ["team_manage", "inbox", "tasks"]})
    member = api(o, "/users", "POST", {"name": "Ravi Das", "role": role_key, "phone": f"98213{T}"})
    rec("a-manager-and-a-member-without-email", mgr["status"] == 200 and member["status"] == 200, "")
    ravi = (member["body"] or {}).get("id")

    mctx = b.new_context(viewport={"width": 1440, "height": 950})
    p = mctx.new_page()
    p.on("pageerror", lambda e: errors.append(str(e)))
    p.goto(f"{BASE}/login", wait_until="domcontentloaded")
    inv = (mgr["body"] or {}).get("invite_token")
    st = api(p, f"/auth/invite/{inv}/start", "POST")
    api(p, "/auth/otp/verify", "POST", {"phone": mp, "code": (st["body"] or {}).get("dev_otp"), "invite_token": inv})
    api(p, "/auth/welcome/done", "POST")

    # ---- 4. no email: the profile says so ----
    rec("profile-opens", open_profile(p, ravi), "Ravi's profile, as the manager")
    rec("no-email-says-not-added", p.locator('[data-testid="contact-row-empty"]').count() > 0
        and "Not added" in p.locator(f'[data-testid="profile-dialog-{ravi}"]').first.inner_text(),
        "instead of an empty box")
    p.screenshot(path=str(OUT / "1_not_added.png"))

    # ---- 1. the manager's edit form: email editable ----
    p.locator(f'[data-testid="edit-access-{ravi}"]').first.click()
    rec("edit-opens", wait_id(p, "member-dialog", 10000), "")
    box = p.locator('[data-testid="member-email-input"]').first
    rec("manager-can-edit-a-members-email", box.is_enabled(), "the box is open to them")

    # ---- 3. a bad email is flagged before Save ----
    box.fill("ravi@")
    rec("bad-email-flagged-under-the-field", wait_id(p, "member-email-invalid", 3000), "before pressing Save")
    p.screenshot(path=str(OUT / "2_bad_email.png"))
    p.locator('[data-testid="member-save-submit"]').first.click()
    p.wait_for_timeout(1500)
    rec("and-not-saved", "email" not in (_db().users.find_one({"id": ravi}) or {}), "")

    box.fill(f"Ravi.{STAMP}@EmailCo.in")
    p.locator('[data-testid="member-save-submit"]').first.click()
    p.wait_for_timeout(3000)
    row = _db().users.find_one({"id": ravi}) or {}
    rec("manager-saves-the-email", row.get("email") == f"ravi.{STAMP}@emailco.in", row.get("email"))

    # ---- 2. and can remove it ----
    rec("profile-reopens", open_profile(p, ravi), "")
    p.locator(f'[data-testid="edit-access-{ravi}"]').first.click()
    wait_id(p, "member-dialog", 10000)
    p.locator('[data-testid="member-email-input"]').first.fill("")
    p.locator('[data-testid="member-save-submit"]').first.click()
    p.wait_for_timeout(3000)
    row = _db().users.find_one({"id": ravi}) or {}
    rec("manager-removes-the-email", "email" not in row, "gone, not an empty string")

    rec("no-page-errors", errors == [], str(errors[:2]))
    b.close()

pathlib.Path(OUT / "results.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
ok = sum(1 for r in results if r["ok"] is True)
bad = sum(1 for r in results if r["ok"] is False)
print(f"\n{ok} pass / {bad} fail -> {OUT / 'results.json'}")
