"""An invited member can actually get in — browser acceptance with REAL saves in a
THROWAWAY database.

Run against the `backend-scratch-rbac` backend, which blanks the SMS gateway and
sets DEV_OTP_IN_RESPONSE=1, so nothing is texted to anyone and the code comes back
in the response for the invitee's device to fill
after seeding it with <scratchpad>/seed_scratch_rbac.py:

    python scripts/ux_invite_accept_0916.py <scratchpad>/seed_scratch_rbac.json

Refuses to run unless the signed-in tenant carries the scratch marker "rbac".

A member is created as a `pending` membership row, and until 2026-09-16 nothing
moved that row to active — so the invitee came off the OTP screen with a session
and was thrown out of the app on their very next request. This walks the whole
thing in the browser:

  Owner (desktop)   add a member with a mobile; their card says Pending; take the
                    invite link from the icon beside their name.
  Invitee (desktop) open that link in a clean browser, sign in with the texted
                    code, land in the app and load a page that needs the session.
  Owner (desktop)   their card no longer says Pending.
  Invitee (desktop) the link is single-use: it is dead on a second visit.
"""
import json
import pathlib
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from ux_login import demo_login  # noqa: E402
from ux_team_nav import open_member  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

BASE = "http://localhost:3000"
API = "http://localhost:8001/api"
OUT = pathlib.Path(__file__).resolve().parents[2] / ".audit-artifacts" / "invite_accept"
OUT.mkdir(parents=True, exist_ok=True)
json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))   # same seed contract
STAMP = int(time.time())
NEW_NAME = "Nithya Balan"
NEW_EMAIL = f"nithya.{STAMP}@sharma.test"
# 5-series is not an Indian mobile prefix, so even if an SMS gateway were left
# configured this number cannot reach a real person.
NEW_PHONE = f"55500{STAMP % 100000:05d}"
results = []
CTX = {"role": "", "vp": "desktop"}


def rec(key, ok, detail):
    results.append({"check": key, "role": CTX["role"], "viewport": CTX["vp"], "ok": ok, "detail": detail})
    print(f"  [{'PASS' if ok is True else 'FAIL' if ok is False else 'INFO'}] {CTX['role']:<8} {key}: {detail}", flush=True)


def api(p, path, method="GET", body=None):
    return p.evaluate(
        """async ([a, x, m, b]) => {
             const r = await fetch(a + x, {method: m, credentials: 'include',
               headers: b ? {'Content-Type': 'application/json'} : {}, body: b ? JSON.stringify(b) : undefined});
             let j = null; try { j = await r.json(); } catch (e) {}
             return {status: r.status, body: j}; }""", [API, path, method, body])


def wait_id(p, tid, timeout=15000):
    try:
        p.wait_for_selector(f'[data-testid="{tid}"]', timeout=timeout, state="attached")
        return True
    except Exception:
        return False


def wait_text(p, txt, timeout=8000):
    try:
        p.wait_for_function("(t) => document.body.innerText.includes(t)", arg=txt, timeout=timeout)
        return True
    except Exception:
        return False


with sync_playwright() as pw:
    b = pw.chromium.launch()

    # ---------------- Owner: invite someone ----------------
    CTX["role"] = "owner"
    owner_ctx = b.new_context(viewport={"width": 1440, "height": 900})
    p = owner_ctx.new_page()
    owner_errors = []
    p.on("pageerror", lambda e: owner_errors.append(str(e)))
    demo_login(p, BASE, "owner")
    tenant = (api(p, "/auth/me")["body"] or {}).get("tenant") or {}
    if tenant.get("ui_check_marker") != "rbac":
        raise SystemExit("refusing to run: this is not the scratch workspace "
                         f"(ui_check_marker={tenant.get('ui_check_marker')!r})")

    p.goto(f"{BASE}/team")
    wait_id(p, "add-user-button", 20000)
    p.locator('[data-testid="add-user-button"]').first.click()
    wait_id(p, "member-dialog")
    p.locator('[data-testid="member-name-input"]').first.fill(NEW_NAME)
    p.locator('[data-testid="member-email-input"]').first.fill(NEW_EMAIL)
    p.locator('[data-testid="member-phone-input"]').first.fill(NEW_PHONE)
    # Mobile code, not a password: this is the invite path.
    if p.locator('[data-testid="login-method-otp"]').count():
        p.locator('[data-testid="login-method-otp"]').first.click()
    p.locator('[data-testid="member-save-submit"]').first.click()
    # Saving a member is a slow call here (~5-8s on this machine).
    rec("invite-on-create", wait_id(p, "invite-link-modal", 30000),
        "the link is offered as soon as they are added")
    p.keyboard.press("Escape")
    p.wait_for_timeout(800)
    member = next((u for u in api(p, "/users")["body"] or [] if u.get("email") == NEW_EMAIL), {})
    rec("member-invited", bool(member), member.get("id"))
    rec("starts-pending", member.get("invite_status") == "pending", member.get("invite_status"))

    uid = member["id"]
    rec("profile-opens", open_member(p, BASE, uid, wait_id), "their profile")
    # Taking it again from the icon mints a fresh token — so this is the live
    # link, and the journey below runs on the one a manager would hand over.
    p.locator(f'[data-testid="invite-link-{uid}"]').first.click()
    rec("invite-modal", wait_id(p, "invite-link-modal", 20000), "the link, from the icon beside their name")
    link = p.locator('[data-testid="invite-link-input"]').first.input_value()
    rec("invite-link-given", "/login?invite=" in link, link.split("invite=")[0] + "invite=...")
    p.screenshot(path=str(OUT / "owner_invite_link.png"))
    p.keyboard.press("Escape")

    # ---------------- The invitee: a clean browser, their link ----------------
    CTX["role"] = "invitee"
    guest_ctx = b.new_context(viewport={"width": 1440, "height": 900})
    g = guest_ctx.new_page()
    guest_errors = []
    g.on("pageerror", lambda e: guest_errors.append(str(e)))
    g.goto(link)
    rec("invite-welcomes-them", wait_text(g, NEW_NAME.split()[0], 15000) or wait_text(g, "code", 5000),
        "the invite page greets them")
    g.wait_for_timeout(1800)
    rec("invite-welcome-card", wait_id(g, "invite-welcome", 8000), "the workspace and the masked number")
    code = "".join(g.eval_on_selector_all(
        '[data-testid^="otp-box-"]', "els => els.map(e => e.value || '')")) if wait_id(g, "otp-boxes", 8000) else ""
    rec("code-texted", len(code) == 6, f"{len(code)} digits filled from the SMS")
    g.screenshot(path=str(OUT / "invitee_otp.png"))
    g.locator('[data-testid="otp-submit-button"]:visible').first.click()
    try:
        g.wait_for_url(lambda u: "/login" not in u, timeout=20000)
    except Exception:
        pass
    g.wait_for_timeout(1500)
    rec("lands-in-the-app", "/login" not in g.url, g.url)

    # The regression: the session was issued and then refused on the next call.
    me = api(g, "/auth/me")
    rec("session-holds", me["status"] == 200 and (me["body"] or {}).get("user", {}).get("id") == uid,
        f"GET /auth/me -> {me['status']}")
    tasks = api(g, "/tasks")
    rec("app-data-loads", tasks["status"] == 200, f"GET /tasks -> {tasks['status']}")
    g.goto(f"{BASE}/my-work")
    g.wait_for_timeout(2500)
    rec("my-work-opens", "/login" not in g.url and not wait_text(g, "no longer have access", 2000), g.url)
    g.screenshot(path=str(OUT / "invitee_in_app.png"))
    rec("no-page-errors-invitee", guest_errors == [], str(guest_errors[:2]))

    # ---------------- Owner again: they are in ----------------
    CTX["role"] = "owner"
    after = next((u for u in api(p, "/users")["body"] or [] if u.get("id") == uid), {})
    rec("no-longer-pending", after.get("invite_status") == "active", after.get("invite_status"))
    rec("no-page-errors-owner", owner_errors == [], str(owner_errors[:2]))

    # ---------------- The link is spent ----------------
    CTX["role"] = "invitee"
    g2 = b.new_context(viewport={"width": 1440, "height": 900}).new_page()
    g2.goto(link)
    g2.wait_for_timeout(2500)
    rec("link-is-single-use", wait_text(g2, "invalid", 6000) or wait_text(g2, "already been used", 2000),
        "a second visit is refused")

    b.close()

pathlib.Path(OUT / "results.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
ok = sum(1 for r in results if r["ok"] is True)
bad = sum(1 for r in results if r["ok"] is False)
print(f"\n{ok} pass / {bad} fail -> {OUT / 'results.json'}")
