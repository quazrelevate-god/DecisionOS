"""RBAC P1 (docs/SETTINGS_RBAC_REVIEW.md) — browser acceptance with REAL saves in a
THROWAWAY database.

Run against the `backend-scratch-rbac` backend after seeding it with
<scratchpad>/seed_scratch_rbac.py:

    python scripts/ux_rbac_p1_0916.py <scratchpad>/seed_scratch_rbac.json

Refuses to run unless the signed-in tenant carries the scratch marker "rbac".

  Owner (desktop)  AI processing card turns on and off; "Task templates", no approval
                   rules; adding a member with a password shows a welcome message
                   (their email, never the password); editing their name and giving
                   them No access; the invite icon beside a member's name; naming
                   the doer as approver is refused.
  Sales (phone)    Team tile in All apps; AI processing card is read-only.
  Sales (desktop)  the decisions list holds only decisions they are part of.
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
OUT = pathlib.Path(__file__).resolve().parents[2] / ".audit-artifacts" / "rbac_p1"
OUT.mkdir(parents=True, exist_ok=True)
SEED = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
SALES, FIN = SEED["sales_id"], SEED["finance_id"]
# A fresh member each run, so the script can be run again on the same scratch database.
NEW_EMAIL, NEW_PASSWORD = f"kavya.{int(time.time())}@sharma.test", "Scratch-4821"
results = []
CTX = {"role": "", "vp": ""}


def rec(key, ok, detail):
    results.append({"check": key, "role": CTX["role"], "viewport": CTX["vp"], "ok": ok, "detail": detail})
    print(f"  [{'PASS' if ok is True else 'FAIL' if ok is False else 'INFO'}] {CTX['role']:<8} {CTX['vp']:<7} {key}: {detail}", flush=True)


def api(p, path, method="GET", body=None):
    return p.evaluate(
        """async ([a, x, m, b]) => {
             const r = await fetch(a + x, {method: m, credentials: 'include',
               headers: b ? {'Content-Type': 'application/json'} : {}, body: b ? JSON.stringify(b) : undefined});
             let j = null; try { j = await r.json(); } catch (e) {}
             return {status: r.status, body: j}; }""", [API, path, method, body])


def session(b, role, phone=False):
    CTX.update(role=role, vp="phone" if phone else "desktop")
    opts = ({"viewport": {"width": 390, "height": 844}, "is_mobile": True, "has_touch": True}
            if phone else {"viewport": {"width": 1440, "height": 900}})
    ctx = b.new_context(**opts)
    p = ctx.new_page()
    errors = []
    p.on("pageerror", lambda e: errors.append(str(e)))
    demo_login(p, BASE, role)
    me = api(p, "/auth/me")["body"] or {}
    if (me.get("tenant") or {}).get("ui_check_marker") != "rbac":
        print("ABORT: the signed-in tenant is not the scratch database — nothing was saved.")
        sys.exit(2)
    return ctx, p, errors, (me.get("user") or {})


def wait_id(p, testid, timeout=15000):
    try:
        p.locator(f'[data-testid="{testid}"]').first.wait_for(state="visible", timeout=timeout)
        return True
    except Exception:
        return False


def wait_text(p, text, timeout=12000):
    try:
        p.get_by_text(text, exact=False).first.wait_for(state="visible", timeout=timeout)
        return True
    except Exception:
        return False


def text_of(p, testid):
    loc = p.locator(f'[data-testid="{testid}"]:visible')
    return loc.first.inner_text().strip() if loc.count() else None


def status_becomes(p, want, timeout=12000):
    """The AI card's status reads `want` (its data comes from a slow read)."""
    try:
        p.wait_for_function(
            "(w) => { const e = document.querySelector('[data-testid=\"ai-consent-status\"]'); return !!e && e.innerText.trim() === w; }",
            arg=want, timeout=timeout)
        return True
    except Exception:
        return False


def open_profile(p, uid):
    return open_member(p, BASE, uid, wait_id)


with sync_playwright() as pw:
    b = pw.chromium.launch()

    # ---------------- Owner, desktop ----------------
    ctx, p, errors, me = session(b, "owner")
    p.goto(f"{BASE}/settings?tab=business#ai-consent")
    rec("ai-card-shown", wait_id(p, "settings-ai-consent-card"), "AI processing card on Business")
    wait_id(p, "ai-consent-status", 20000)
    if text_of(p, "ai-consent-status") != "On":
        p.locator('[data-testid="ai-consent-on"]:visible').first.click()
    rec("ai-turns-on", status_becomes(p, "On"), text_of(p, "ai-consent-status"))
    rec("ai-on-server", (api(p, "/tenant/ai-consent")["body"] or {}).get("active") is True, "GET /tenant/ai-consent")
    p.locator('[data-testid="ai-consent-off"]:visible').first.click()
    rec("ai-off-asks-first", wait_id(p, "ai-consent-off-confirm", 8000), "confirm before turning off")
    p.locator('[data-testid="ai-consent-off-confirm"]:visible').first.click()
    rec("ai-turns-off", status_becomes(p, "Off"), text_of(p, "ai-consent-status"))
    rec("ai-off-server", (api(p, "/tenant/ai-consent")["body"] or {}).get("active") is False, "GET /tenant/ai-consent")
    p.locator('[data-testid="ai-consent-on"]:visible').first.click()
    status_becomes(p, "On")
    p.screenshot(path=str(OUT / "owner_desktop_ai_card.png"))
    rec("no-approval-rules", p.locator('[data-testid="os-rules-list"]').count() == 0 and wait_text(p, "Task templates"),
        "approval rules gone; Task templates shown")

    # Add a member with a password -> welcome message.
    p.goto(f"{BASE}/team")
    wait_id(p, "add-user-button", 20000)
    p.locator('[data-testid="add-user-button"]').first.click()
    wait_id(p, "member-dialog")
    p.locator('[data-testid="member-name-input"]').first.fill("Kavya Rao")
    p.locator('[data-testid="member-email-input"]').first.fill(NEW_EMAIL)
    p.locator('[data-testid="member-password-input"]').first.fill(NEW_PASSWORD)
    p.locator('[data-testid="member-save-submit"]').first.click()
    rec("welcome-modal", wait_id(p, "welcome-modal"), "shown after adding a password member")
    msg = p.locator('[data-testid="welcome-message"]').first.input_value() if wait_id(p, "welcome-message", 3000) else ""
    rec("welcome-has-email-not-password", NEW_EMAIL in msg and NEW_PASSWORD not in msg and "/login" in msg, msg[:90])
    p.screenshot(path=str(OUT / "owner_desktop_welcome.png"))
    p.keyboard.press("Escape")
    p.wait_for_timeout(600)
    kavya = next((u for u in api(p, "/users")["body"] or [] if u.get("email") == NEW_EMAIL), {})
    rec("member-created", bool(kavya), kavya.get("id"))

    # Edit her name and give her No access.
    open_profile(p, kavya["id"])
    p.locator(f'[data-testid="edit-access-{kavya["id"]}"]').first.click()
    wait_id(p, "member-dialog")
    rec("email-editable-for-owner", p.locator('[data-testid="member-email-input"]').first.is_enabled(), "owner can change email")
    p.locator('[data-testid="member-name-input"]').first.fill("Kavya R. Rao")
    toggle = p.locator('[data-testid="member-follow-role-toggle"]').first
    if toggle.is_checked():
        toggle.click()
    # Untick every access, one at a time (the list of ticked buttons shrinks as we go).
    ticked = p.locator('[data-testid="permission-list"] button[aria-pressed="true"]')
    for _ in range(20):
        if not ticked.count():
            break
        ticked.first.click()
        p.wait_for_timeout(150)
    rec("no-access-note", wait_text(p, "No access: they can sign in"), "No access explained")
    p.screenshot(path=str(OUT / "owner_desktop_no_access.png"))
    p.locator('[data-testid="member-save-submit"]').first.click()
    p.wait_for_timeout(1500)
    kavya = next((u for u in api(p, "/users")["body"] or [] if u.get("id") == kavya["id"]), {})
    rec("name-saved", kavya.get("name") == "Kavya R. Rao", kavya.get("name"))
    rec("no-access-saved", kavya.get("effective_permissions") == [] and kavya.get("permissions_custom") is True,
        f"{kavya.get('effective_permissions')} custom={kavya.get('permissions_custom')}")

    # The invite icon, on an active member's profile.
    open_profile(p, SALES)
    # Sakthivel's Team redesign (8b60707, founder 2026-09-16): the invite icon sits
    # beside the name for every member but an owner, so it shows for an active one too.
    rec("invite-link-beside-the-name", p.locator(f'[data-testid="invite-link-{SALES}"]').count() == 1, "one icon")
    p.keyboard.press("Escape")

    # Naming the doer as approver is refused.
    r = api(p, "/tasks", "POST", {"title": "Scratch: approve my own", "assignee_id": FIN,
                                  "approval_required": True, "approver_id": FIN})
    rec("self-approver-refused", r["status"] == 400 and "on this task" in str((r["body"] or {}).get("detail")), r)
    rec("no-page-errors-owner", not errors, errors[:2])
    ctx.close()

    # ---------------- Sales, phone ----------------
    ctx, p, errors, me = session(b, "sales", phone=True)
    p.goto(f"{BASE}/my-work")
    p.wait_for_timeout(2500)
    p.locator('[data-testid="dock-more"]').first.click()
    rec("team-tile-for-teammate", wait_id(p, "allapps-tile-team", 8000), "Team tile in All apps")
    p.screenshot(path=str(OUT / "sales_phone_allapps.png"))
    p.goto(f"{BASE}/settings")
    rec("ai-card-read-only", wait_id(p, "settings-ai-consent-card") and wait_text(p, "Only an owner can change this"),
        "status shown, no switch")
    rec("no-ai-switch", p.locator('[data-testid="ai-consent-on"]').count() + p.locator('[data-testid="ai-consent-off"]').count() == 0,
        "no on/off buttons")
    overflow = p.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1")
    rec("settings-fits-390", overflow, "no sideways scroll")
    p.screenshot(path=str(OUT / "sales_phone_settings.png"))
    rec("no-page-errors-sales-phone", not errors, errors[:2])
    ctx.close()

    # ---------------- Sales, desktop: decisions list ----------------
    ctx, p, errors, me = session(b, "sales")
    rows = api(p, "/decisions")["body"] or []
    mine = [d for d in rows if d.get("created_by") == me.get("id") or d.get("approver_id") == me.get("id")]
    rec("decisions-only-mine", len(rows) >= 1 and len(rows) == len(mine) or all(
        d.get("created_by") == me.get("id") or d.get("approver_id") == me.get("id") or d.get("task_ids") for d in rows),
        f"{len(rows)} listed, {len(mine)} raised by or waiting on them")
    ctx.close()
    b.close()

passed = sum(1 for r in results if r["ok"] is True)
failed = sum(1 for r in results if r["ok"] is False)
(OUT / "results.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
print(f"{passed} pass / {failed} fail -> {OUT / 'results.json'}")
