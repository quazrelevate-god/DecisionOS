"""Your own details, and someone else's mobile — browser acceptance with REAL
saves in a THROWAWAY database.

Run against the `backend-scratch-rbac` backend after seeding it with
<scratchpad>/seed_scratch_rbac.py:

    python scripts/ux_profile_phone_0916.py <scratchpad>/seed_scratch_rbac.json

Refuses to run unless the signed-in tenant carries the scratch marker "rbac".
No password is ever typed: sign-in uses the demo seats, and the email check only
goes as far as the confirmation the form asks for.

  Owner (desktop)   hands Manage team to the sales member, and can still edit
                    anyone's mobile.
  Manager (desktop) a teammate's mobile is locked, with the reason; the server
                    refuses it too; everything else about them still saves; and
                    a member with NO number can still be given one.
  Manager (desktop) Settings > Your Profile: name, job title and what they
                    handle save without a manager, and there is nothing about
                    role or access on the card; changing the email asks for a
                    confirmation first.
  Owner (desktop)   the team sees what they handle on their profile.
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
OUT = pathlib.Path(__file__).resolve().parents[2] / ".audit-artifacts" / "profile_phone"
OUT.mkdir(parents=True, exist_ok=True)
SEED = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
SALES, FIN, MEERA = SEED["sales_id"], SEED["finance_id"], SEED["meera_id"]
STAMP = int(time.time())
# 5-series is not an Indian mobile prefix — these numbers cannot reach anyone.
OTHER_PHONE = f"55500{STAMP % 100000:05d}"
FILLED_PHONE = f"55501{STAMP % 100000:05d}"
ABOUT = "South India dealers, and every quote over 2 lakh"
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


def wait_id(p, testid, timeout=15000):
    try:
        p.locator(f'[data-testid="{testid}"]').first.wait_for(state="visible", timeout=timeout)
        return True
    except Exception:
        return False


def session(b, role):
    CTX.update(role=role)
    ctx = b.new_context(viewport={"width": 1440, "height": 900})
    p = ctx.new_page()
    errors = []
    p.on("pageerror", lambda e: errors.append(str(e)))
    demo_login(p, BASE, role)
    me = api(p, "/auth/me")["body"] or {}
    if (me.get("tenant") or {}).get("ui_check_marker") != "rbac":
        print("ABORT: the signed-in tenant is not the scratch database — nothing was saved.")
        sys.exit(2)
    return ctx, p, errors, (me.get("user") or {})


def open_edit(p, uid):
    """Their profile, then the form behind Edit access."""
    if not open_member(p, BASE, uid, wait_id):
        return False
    p.locator(f'[data-testid="edit-access-{uid}"]').first.click()
    return wait_id(p, "member-dialog")


with sync_playwright() as pw:
    b = pw.chromium.launch()

    # ---------------- Owner: hand out Manage team, keep the mobile ----------------
    ctx, p, owner_errors, owner = session(b, "owner")
    granted = api(p, f"/users/{SALES}", "PATCH", {
        "role": "sales", "follow_role": False,
        "permissions": ["inbox", "tasks", "approvals", "people", "team_manage"],
    })
    rec("manager-made", granted["status"] == 200 and "team_manage" in (granted["body"] or {}).get("permissions", []),
        f"{granted['status']} — the sales member now holds Manage team")

    # Someone with no number at all: the case a manager must still be able to fix.
    # Made by taking Meera's number away rather than adding a member, so the run
    # costs no seat and can be repeated on the same scratch database.
    cleared = api(p, f"/users/{MEERA}", "PATCH", {"phone": ""})
    nophone_id = MEERA
    rec("member-without-a-number", cleared["status"] == 200 and not (cleared["body"] or {}).get("phone"),
        f"{cleared['status']} — an owner cleared it, so they cannot sign in")

    rec("owner-can-edit-a-mobile", open_edit(p, FIN)
        and p.locator('[data-testid="member-phone-input"]').first.is_enabled(), "the field is open to an owner")
    p.screenshot(path=str(OUT / "owner_phone_open.png"))
    p.keyboard.press("Escape")
    ctx.close()

    # ---------------- The manager: someone else's mobile ----------------
    ctx, p, mgr_errors, mgr = session(b, "sales")
    rec("holds-manage-team", "team_manage" in (mgr.get("effective_permissions") or []),
        "signed in as a team manager, not an owner")

    rec("teammates-mobile-locked", open_edit(p, FIN)
        and not p.locator('[data-testid="member-phone-input"]').first.is_enabled(), "the field is closed")
    rec("and-it-says-why", wait_id(p, "member-phone-locked", 5000),
        "\"Only an owner can change someone's mobile number\"")
    p.screenshot(path=str(OUT / "manager_phone_locked.png"))
    p.keyboard.press("Escape")

    moved = api(p, f"/users/{FIN}", "PATCH", {"phone": OTHER_PHONE})
    rec("server-refuses-the-move", moved["status"] == 403, f"{moved['status']} {str(moved['body'])[:80]}")
    still = next((u for u in api(p, "/users")["body"] or [] if u.get("id") == FIN), {})
    rec("their-number-stands", (still.get("phone") or "").replace(" ", "") != OTHER_PHONE, still.get("phone"))

    titled = api(p, f"/users/{FIN}", "PATCH", {"title": "Head of Finance"})
    rec("the-rest-still-saves", titled["status"] == 200 and (titled["body"] or {}).get("title") == "Head of Finance",
        f"{titled['status']} — a manager still edits everything else")

    filled = api(p, f"/users/{nophone_id}", "PATCH", {"phone": FILLED_PHONE})
    rec("a-missing-number-can-be-filled-in", filled["status"] == 200, f"{filled['status']} — they can sign in now")

    # ---------------- The manager: their own details ----------------
    # A Manage team holder gets the tabbed Settings, where their own details sit
    # under Account; a plain teammate gets the same card in a single stack.
    p.goto(f"{BASE}/settings?tab=account")
    rec("own-profile-card", wait_id(p, "settings-profile-card", 20000), "Your Profile on Settings")
    # The card fills itself from /auth/me; typing before that lands gets wiped.
    p.wait_for_function(
        """() => { const e = document.querySelector('[data-testid="profile-name-input"]');
                   return !!e && e.value.trim().length > 0; }""", timeout=20000)
    p.locator('[data-testid="profile-title-input"]').first.fill("Sales Lead")
    p.locator('[data-testid="profile-about-input"]').first.fill(ABOUT)
    p.locator('[data-testid="profile-save"]').first.click()
    p.wait_for_timeout(2500)
    mine = (api(p, "/auth/me")["body"] or {}).get("user") or {}
    rec("own-details-saved", mine.get("title") == "Sales Lead" and mine.get("about") == ABOUT,
        f"{mine.get('title')} — {str(mine.get('about'))[:40]}")
    rec("access-is-not-on-the-card",
        p.locator('[data-testid="settings-profile-card"] [data-testid^="perm-"]').count() == 0
        and p.locator('[data-testid="settings-profile-card"] [data-testid="member-role-select"]').count() == 0,
        "no role, no permission toggles — that is a manager's call")
    p.screenshot(path=str(OUT / "manager_own_profile.png"))

    # The email is the sign-in, so the form asks for a confirmation before it saves.
    p.locator('[data-testid="profile-email-input"]').first.fill(f"priya.{STAMP}@sharma.test")
    p.wait_for_timeout(400)
    rec("email-change-asks-first", wait_id(p, "profile-email-confirm", 5000),
        "it asks for the current password before changing the sign-in email")
    p.locator('[data-testid="profile-save"]').first.click()
    p.wait_for_timeout(1500)
    unchanged = (api(p, "/auth/me")["body"] or {}).get("user") or {}
    rec("email-not-changed-without-it", unchanged.get("email") == mgr.get("email"), unchanged.get("email"))
    rec("no-page-errors-manager", mgr_errors == [], str(mgr_errors[:2]))
    ctx.close()

    # ---------------- Owner: the team sees what they handle ----------------
    ctx, p, owner_errors2, _ = session(b, "owner")
    rec("handles-shown-on-their-profile", open_member(p, BASE, SALES, wait_id)
        and ABOUT[:24] in p.locator(f'[data-testid="profile-dialog-{SALES}"]').first.inner_text(),
        "in their own words, on the Team page")
    p.screenshot(path=str(OUT / "owner_sees_handles.png"))
    rec("no-page-errors-owner", owner_errors + owner_errors2 == [], str((owner_errors + owner_errors2)[:2]))

    # Put the workspace back the way it was found: Manage team was handed out for
    # this run only, and a member holding it sees a different Settings, which the
    # other scripts read. Their number goes back too.
    given_back = api(p, f"/users/{SALES}", "PATCH", {"role": "sales", "follow_role": True})
    api(p, f"/users/{MEERA}", "PATCH", {"phone": "9820010055"})
    rec("workspace-left-as-found", given_back["status"] == 200
        and not (given_back["body"] or {}).get("permissions"), "Manage team handed back")
    ctx.close()

    b.close()

pathlib.Path(OUT / "results.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
ok = sum(1 for r in results if r["ok"] is True)
bad = sum(1 for r in results if r["ok"] is False)
print(f"\n{ok} pass / {bad} fail -> {OUT / 'results.json'}")
