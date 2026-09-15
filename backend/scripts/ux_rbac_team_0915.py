"""RBAC P0 — Remove member and the role permission editor: browser acceptance with REAL
saves in a THROWAWAY database.

Run against the `backend-scratch-rbac` backend after seeding it with
<scratchpad>/seed_scratch_rbac.py (Meera Iyer, sales, with open work, an approval,
a decision waiting on her, a contact, and the demo sales user reporting to her):

    python scripts/ux_rbac_team_0915.py <scratchpad>/seed_scratch_rbac.json

Refuses to run unless the signed-in tenant carries the scratch marker "rbac".

  Owner (desktop)   Meera's profile -> Remove from company: what she holds, hand it to
                    Finance, confirm; she leaves the tree and the list; open task,
                    approval, decision, report and contact moved; finished task kept.
  Owner (desktop)   Settings > Business > Team roles > Sales > Access: tick People,
                    save; the role carries it; a member dialog offers "Use the role's access".
  Owner (phone)     the remove panel and the role access editor fit 390px.
  Finance (desktop) no Remove on a profile, no Access under roles.
"""
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from ux_login import demo_login  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

BASE = "http://localhost:3000"
API = "http://localhost:8001/api"
OUT = pathlib.Path(__file__).resolve().parents[2] / ".audit-artifacts" / "rbac_team"
OUT.mkdir(parents=True, exist_ok=True)
SEED = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
MEERA, SALES, FIN = SEED["meera_id"], SEED["sales_id"], SEED["finance_id"]
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
    return ctx, p, errors


def visible(p, testid):
    return p.locator(f'[data-testid="{testid}"]:visible').count() > 0


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


def no_sideways_scroll(p):
    return p.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1")


def open_profile(p, uid):
    p.goto(f"{BASE}/team")
    wait_id(p, f"team-member-{uid}", 20000)
    p.locator(f'[data-testid="team-member-{uid}"]').first.click()
    return wait_id(p, f"profile-dialog-{uid}")


with sync_playwright() as pw:
    b = pw.chromium.launch()

    # ---------------- Owner, phone first (Meera still here) ----------------
    ctx, p, errors = session(b, "owner", phone=True)
    rec("profile-opens", open_profile(p, MEERA), "Meera's profile")
    p.locator(f'[data-testid="remove-member-open-{MEERA}"]').first.scroll_into_view_if_needed()
    p.locator(f'[data-testid="remove-member-open-{MEERA}"]').first.click()
    rec("remove-panel-summary", wait_id(p, f"offboarding-summary-{MEERA}"), "summary shown")
    p.screenshot(path=str(OUT / "owner_phone_remove_panel.png"), full_page=False)
    rec("remove-panel-fits-390", no_sideways_scroll(p), "no sideways scroll")
    p.keyboard.press("Escape")
    p.goto(f"{BASE}/settings?tab=business")
    wait_id(p, "role-access-toggle-sales", 20000)
    p.locator('[data-testid="role-access-toggle-sales"]').first.click()
    rec("role-editor-opens-phone", wait_id(p, "role-access-sales"), "Sales access editor")
    p.locator('[data-testid="role-access-sales"]').first.scroll_into_view_if_needed()
    p.screenshot(path=str(OUT / "owner_phone_role_access.png"), full_page=False)
    rec("role-editor-fits-390", no_sideways_scroll(p), "no sideways scroll")
    rec("no-page-errors-phone", not errors, errors[:2])
    ctx.close()

    # ---------------- Owner, desktop: remove Meera ----------------
    ctx, p, errors = session(b, "owner")
    open_profile(p, MEERA)
    p.locator(f'[data-testid="remove-member-open-{MEERA}"]').first.click()
    wait_id(p, f"offboarding-summary-{MEERA}")
    summary = p.locator(f'[data-testid="offboarding-summary-{MEERA}"]').first.inner_text()
    nums = [int(x) for x in summary.split() if x.isdigit()]
    rec("summary-counts", nums == [1, 0, 1, 1, 1, 1], f"{nums} (doing, helping, approving, decisions, reports, contacts)")
    p.locator(f'[data-testid="remove-member-to-{MEERA}"]').first.click()
    p.locator(f'[data-testid="remove-member-to-{MEERA}-option-{FIN}"]').first.click()
    p.wait_for_timeout(300)
    p.screenshot(path=str(OUT / "owner_desktop_remove_panel.png"))
    p.locator(f'[data-testid="remove-member-confirm-{MEERA}"]').first.click()
    rec("toast-removed", wait_text(p, "Meera Iyer removed"), "toast")
    p.wait_for_timeout(1500)
    rec("gone-from-tree", p.locator(f'[data-testid="team-member-{MEERA}"]').count() == 0, "no card")
    users = api(p, "/users")["body"] or []
    by_id = {u["id"]: u for u in users}
    rec("gone-from-list", MEERA not in by_id, f"{len(users)} members")
    rec("report-moved", (by_id.get(SALES) or {}).get("reporting_manager_id") == FIN, (by_id.get(SALES) or {}).get("reporting_manager_id"))
    t_open = api(p, "/tasks/rb-open")["body"] or {}
    t_done = api(p, "/tasks/rb-done")["body"] or {}
    t_appr = api(p, "/tasks/rb-appr")["body"] or {}
    rec("open-task-moved", t_open.get("assignee_id") == FIN, t_open.get("assignee_id"))
    rec("finished-task-kept", t_done.get("assignee_id") == MEERA, t_done.get("assignee_id"))
    fin_perms = (by_id.get(FIN) or {}).get("effective_permissions") or []
    want_appr = FIN if "approvals" in fin_perms else SEED["owner_id"]
    rec("approval-moved", t_appr.get("approver_id") == want_appr, f"{t_appr.get('approver_id')} (finance may approve: {'approvals' in fin_perms})")
    dec = api(p, "/decisions/rb-dec")["body"] or {}
    want_dec = FIN if "decisions_approve" in fin_perms else SEED["owner_id"]
    rec("decision-moved", dec.get("approver_id") == want_dec, f"{dec.get('approver_id')} (finance may decide: {'decisions_approve' in fin_perms})")

    # ---------------- Owner, desktop: role access editor ----------------
    p.goto(f"{BASE}/settings?tab=business")
    wait_id(p, "role-access-toggle-sales", 20000)
    p.locator('[data-testid="role-access-toggle-sales"]').first.click()
    wait_id(p, "role-access-sales")
    before = next((r for r in ((api(p, "/auth/me")["body"] or {}).get("tenant") or {}).get("roles") or []
                   if r.get("key") == "sales"), {})
    saved_before = "people" in (before.get("permissions") or [])  # the built-in sales default has no People
    people = p.locator('[data-testid="role-perm-sales-people"]').first
    was_on = people.get_attribute("aria-pressed") == "true"
    rec("role-editor-starts-from-saved", was_on == saved_before,
        f"People shown {'on' if was_on else 'off'}, saved {'on' if saved_before else 'off'}")
    people.click()
    apply_all = p.locator('[data-testid="role-apply-all-sales"]')
    if apply_all.count():
        apply_all.first.check()
    p.screenshot(path=str(OUT / "owner_desktop_role_access.png"))
    p.locator('[data-testid="role-access-save-sales"]').first.click()
    rec("toast-role-saved", wait_text(p, "Access for Sales saved"), "toast")
    p.wait_for_timeout(1200)
    tenant = (api(p, "/auth/me")["body"] or {}).get("tenant") or {}
    sales_role = next((r for r in tenant.get("roles") or [] if r.get("key") == "sales"), {})
    rec("role-carries-change", ("people" in (sales_role.get("permissions") or [])) == (not saved_before), sales_role.get("permissions"))
    users = api(p, "/users")["body"] or []
    sales_members = [u for u in users if u.get("role") == "sales"]
    following = [u for u in sales_members if not (u.get("permissions") or [])]
    rec("members-follow-role", bool(sales_members) and all(
        sorted(u.get("effective_permissions") or []) == sorted(sales_role.get("permissions") or []) for u in following),
        f"{len(following)}/{len(sales_members)} sales members follow the role")
    open_profile(p, SALES)
    p.locator(f'[data-testid="edit-access-{SALES}"]').first.click()
    rec("member-dialog-follow-role", wait_id(p, "member-follow-role"), "Use the role's access shown")
    toggle = p.locator('[data-testid="member-follow-role-toggle"]').first
    rec("follow-role-ticked", toggle.is_checked(), "ticked for a member who follows the role")
    rec("perms-locked-while-following", p.locator('[data-testid="perm-people"]').first.is_disabled(), "toggles disabled")
    p.screenshot(path=str(OUT / "owner_desktop_member_follow_role.png"))
    rec("no-page-errors-owner", not errors, errors[:2])
    ctx.close()

    # ---------------- Finance (not an owner) ----------------
    ctx, p, errors = session(b, "finance")
    open_profile(p, SALES)
    rec("no-remove-for-non-owner", not visible(p, f"remove-member-open-{SALES}"), "no Remove button")
    p.goto(f"{BASE}/settings?tab=business")
    p.wait_for_timeout(2500)
    rec("no-role-access-for-non-owner", not visible(p, "role-access-toggle-sales"), "no Access under roles")
    rec("no-page-errors-finance", not errors, errors[:2])
    ctx.close()
    b.close()

passed = sum(1 for r in results if r["ok"] is True)
failed = sum(1 for r in results if r["ok"] is False)
(OUT / "results.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
print(f"{passed} pass / {failed} fail -> {OUT / 'results.json'}")
