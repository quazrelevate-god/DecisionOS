"""RBAC P2 (docs/SETTINGS_RBAC_REVIEW.md) — browser acceptance with REAL saves in a
THROWAWAY database.

Run against the `backend-scratch-rbac` backend after seeding it with
<scratchpad>/seed_scratch_rbac.py:

    python scripts/ux_rbac_p2_0916.py <scratchpad>/seed_scratch_rbac.json

Refuses to run unless the signed-in tenant carries the scratch marker "rbac".

  Owner (desktop)  Workspace tab: plan and seats, one AI key added and removed, what
                   owners can open, the audit log; Overdue work days and email; no
                   currency on Business; "While you're away" hands approvals to Priya,
                   who then approves a task that names the owner; making someone an
                   owner asks in the app's own dialog; /people lands on Team.
  Sales (desktop)  Language, Theme and the hand-over card in Settings; no AI-priority toggle.
  Owner (phone)    the Workspace tab and its cards fit 390px.
"""
import json
import pathlib
import sys
from datetime import date, timedelta

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from ux_login import demo_login  # noqa: E402
from ux_team_nav import reveal_member  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

BASE = "http://localhost:3000"
API = "http://localhost:8001/api"
OUT = pathlib.Path(__file__).resolve().parents[2] / ".audit-artifacts" / "rbac_p2"
OUT.mkdir(parents=True, exist_ok=True)
SEED = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
SALES, FIN, OWNER_ID = SEED["sales_id"], SEED["finance_id"], SEED["owner_id"]
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
    errors, dialogs = [], []
    p.on("pageerror", lambda e: errors.append(str(e)))
    p.on("dialog", lambda d: (dialogs.append(d.message), d.dismiss()))
    demo_login(p, BASE, role)
    me = api(p, "/auth/me")["body"] or {}
    if (me.get("tenant") or {}).get("ui_check_marker") != "rbac":
        print("ABORT: the signed-in tenant is not the scratch database — nothing was saved.")
        sys.exit(2)
    return ctx, p, errors, dialogs


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


def fits(p):
    return p.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1")


with sync_playwright() as pw:
    b = pw.chromium.launch()

    # ---------------- Owner, desktop ----------------
    ctx, p, errors, dialogs = session(b, "owner")
    p.goto(f"{BASE}/settings?tab=workspace")
    rec("workspace-tab", wait_id(p, "settings-tab-workspace") and wait_id(p, "settings-plan-card", 20000), "owner sees Workspace")
    rec("plan-and-seats", wait_id(p, "plan-seats", 20000), p.locator('[data-testid="plan-seats"]').first.inner_text() if wait_id(p, "plan-seats", 1) else None)

    wait_id(p, "settings-ai-keys-card", 20000)
    first = p.locator('[data-testid^="ai-key-edit-"]').first
    wait_id(p, "settings-ai-keys-card")
    try:
        first.wait_for(state="visible", timeout=20000)
        provider = first.get_attribute("data-testid").replace("ai-key-edit-", "")
    except Exception:
        provider = None
    rec("ai-keys-listed", bool(provider), provider)
    if provider:
        first.click()
        p.locator(f'[data-testid="ai-key-input-{provider}"]').first.fill("scratch-key-abcdef123456")
        p.locator(f'[data-testid="ai-key-save-{provider}"]').first.click()
        rec("ai-key-added", wait_text(p, "Your key"), "masked key shown")
        keys = {r["provider"]: r for r in (api(p, "/tenant/ai-keys")["body"] or {}).get("providers", [])}
        rec("ai-key-on-server", keys.get(provider, {}).get("has_tenant_key") is True, keys.get(provider, {}).get("masked"))
        p.locator(f'[data-testid="ai-key-remove-{provider}"]').first.click()
        p.wait_for_timeout(1500)
        keys = {r["provider"]: r for r in (api(p, "/tenant/ai-keys")["body"] or {}).get("providers", [])}
        rec("ai-key-removed", keys.get(provider, {}).get("has_tenant_key") is False, keys.get(provider, {}).get("source"))

    wait_id(p, "owner-perm-finance")
    rec("manage-team-locked", p.locator('[data-testid="owner-perm-team_manage"]').first.is_disabled(), "always on")
    p.locator('[data-testid="owner-perm-finance"]').first.click()
    p.locator('[data-testid="owner-exclusions-save"]').first.click()
    p.wait_for_timeout(1500)
    excl = ((api(p, "/auth/me")["body"] or {}).get("tenant") or {}).get("owner_exclusions")
    rec("owner-exclusion-saved", excl == ["finance"], excl)
    p.locator('[data-testid="owner-perm-finance"]').first.click()
    p.locator('[data-testid="owner-exclusions-save"]').first.click()
    p.wait_for_timeout(1500)
    excl = ((api(p, "/auth/me")["body"] or {}).get("tenant") or {}).get("owner_exclusions")
    rec("owner-exclusion-restored", excl == [], excl)
    p.reload()
    rec("audit-log-rows", wait_id(p, "audit-table", 20000) and wait_text(p, "Ai key updated"), "the key change is in the log")
    p.screenshot(path=str(OUT / "owner_desktop_workspace.png"), full_page=True)

    # Overdue work
    p.goto(f"{BASE}/settings?tab=operations")
    rec("overdue-card", wait_id(p, "settings-escalation-card", 20000), "Operations tab")
    p.locator('[data-testid="escalation-manager-days"]').first.fill("3")
    p.locator('[data-testid="escalation-owner-days"]').first.fill("2")
    p.locator('[data-testid="escalation-save"]').first.click()
    rec("overdue-invalid-refused", wait_text(p, "The owner should hear after the manager"), "owner before manager refused")
    p.locator('[data-testid="escalation-owner-days"]').first.fill("6")
    p.locator('[data-testid="escalation-owner-email"]').first.uncheck()
    p.locator('[data-testid="escalation-save"]').first.click()
    p.wait_for_timeout(1500)
    t = (api(p, "/auth/me")["body"] or {}).get("tenant") or {}
    rec("overdue-saved", (t.get("followup_manager_days"), t.get("followup_owner_days"), t.get("owner_alert_email")) == (3, 6, False),
        (t.get("followup_manager_days"), t.get("followup_owner_days"), t.get("owner_alert_email")))

    # Business: one currency place, Teams wording
    p.goto(f"{BASE}/settings?tab=business")
    wait_id(p, "settings-company-card", 20000)
    rec("no-currency-on-business", p.locator('[data-testid="company-field-currency"]').count() == 0 and wait_text(p, "Teams"),
        "currency only in Money; 'Teams'")

    # While you're away -> Priya approves a task that names the owner
    p.goto(f"{BASE}/settings?tab=account")
    wait_id(p, "settings-delegation-card", 20000)
    # The card reads the hand-over first; decide once it has.
    p.locator('[data-testid="delegation-clear"], [data-testid="delegation-save"]').first.wait_for(state="visible", timeout=20000)
    if p.locator('[data-testid="delegation-clear"]').count():
        p.locator('[data-testid="delegation-clear"]').first.click()
        wait_id(p, "delegation-save")
    p.locator('[data-testid="delegation-person"]').first.click()
    p.locator(f'[data-testid="delegation-person-option-{SALES}"]').first.click()
    p.locator('[data-testid="delegation-from"]').first.fill(str(date.today()))
    p.locator('[data-testid="delegation-to"]').first.fill(str(date.today() + timedelta(days=2)))
    p.locator('[data-testid="delegation-save"]').first.click()
    rec("delegation-set", wait_id(p, "delegation-status", 12000) and "is handling" in p.locator('[data-testid="delegation-status"]').first.inner_text(),
        p.locator('[data-testid="delegation-status"]').first.inner_text() if p.locator('[data-testid="delegation-status"]').count() else None)
    p.screenshot(path=str(OUT / "owner_desktop_delegation.png"))
    task = api(p, "/tasks", "POST", {"title": "Scratch: new loom belt", "assignee_id": SEED["meera_id"],
                                     "approval_required": True, "approver_id": OWNER_ID})
    task_id = (task["body"] or {}).get("id")
    rec("task-naming-owner", task["status"] == 200 and (task["body"] or {}).get("approver_id") == OWNER_ID, task["status"])

    # Make-owner asks in the app's own dialog
    p.goto(f"{BASE}/team")
    wait_id(p, "team-tree", 20000)
    reveal_member(p, SALES)
    p.locator(f'[data-testid="team-member-{SALES}"]').first.click()
    p.locator(f'[data-testid="edit-access-{SALES}"]').first.click()
    wait_id(p, "member-dialog")
    rec("perm-labels", wait_text(p, "Decision Desk") and wait_text(p, "Export Company Brain"), "renamed and new toggle")
    p.locator('[data-testid="member-role-select"]').first.click()
    p.locator('[data-testid="member-role-select-option-owner"]').first.click()
    p.locator('[data-testid="member-save-submit"]').first.click()
    rec("owner-confirm-in-app", wait_id(p, "owner-confirm", 8000) and not dialogs, f"browser dialogs: {dialogs}")
    p.screenshot(path=str(OUT / "owner_desktop_owner_confirm.png"))
    rec("owner-confirm-on-top", p.locator('[data-testid="owner-confirm"]').first.evaluate(
        "(el) => { const r = el.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + 12);"
        " return !!top && el.contains(top); }"), "the confirmation is not covered")
    p.locator('[data-testid="owner-confirm-cancel"]').first.click()
    p.wait_for_timeout(800)
    role_now = next((u.get("role") for u in api(p, "/users")["body"] or [] if u.get("id") == SALES), None)
    rec("cancel-keeps-role", role_now == "sales", role_now)
    p.keyboard.press("Escape")

    p.goto(f"{BASE}/people")
    p.wait_for_timeout(2500)
    rec("people-redirects", p.url.rstrip("/").endswith("/team"), p.url)
    rec("no-page-errors-owner", not errors, errors[:2])
    ctx.close()

    # ---------------- Sales, desktop ----------------
    ctx, p, errors, dialogs = session(b, "sales")
    me = (api(p, "/auth/me")["body"] or {}).get("user") or {}
    rec("delegate-holds-owner", OWNER_ID in (me.get("_acting_for") or []), me.get("_acting_for"))
    appr = api(p, "/tasks?view=approvals")["body"] or []
    rec("delegate-sees-approval", any(t.get("id") == task_id for t in appr), f"{len(appr)} in Approvals")
    r = api(p, f"/tasks/{task_id}/approve", "POST")
    rec("delegate-approves", r["status"] == 200 and (r["body"] or {}).get("approval_status") == "approved", r["status"])
    p.goto(f"{BASE}/settings")
    rec("teammate-language-theme-handover", wait_id(p, "settings-language-card", 20000) and wait_id(p, "settings-theme-card")
        and wait_id(p, "settings-delegation-card"), "cards shown")
    p.goto(f"{BASE}/my-work")
    p.wait_for_timeout(3000)
    rec("no-ai-priority-for-teammate", p.locator('[data-testid="ai-priority-toggle"]').count() == 0, "toggle hidden")
    rec("no-page-errors-sales", not errors, errors[:2])
    ctx.close()

    # ---------------- Owner, phone ----------------
    ctx, p, errors, dialogs = session(b, "owner", phone=True)
    p.goto(f"{BASE}/settings?tab=workspace")
    wait_id(p, "settings-audit-card", 20000)
    p.wait_for_timeout(1500)
    rec("workspace-fits-390", fits(p), "no sideways scroll")
    p.screenshot(path=str(OUT / "owner_phone_workspace.png"), full_page=True)
    p.goto(f"{BASE}/settings?tab=account")
    wait_id(p, "settings-delegation-card", 20000)
    p.locator('[data-testid="delegation-clear"], [data-testid="delegation-save"]').first.wait_for(state="visible", timeout=20000)
    if p.locator('[data-testid="delegation-clear"]').count():
        p.locator('[data-testid="delegation-clear"]').first.click()
    rec("delegation-cleared", wait_id(p, "delegation-save", 10000), "hand-over stopped")
    rec("no-page-errors-owner-phone", not errors, errors[:2])
    ctx.close()
    b.close()

passed = sum(1 for r in results if r["ok"] is True)
failed = sum(1 for r in results if r["ok"] is False)
(OUT / "results.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
print(f"{passed} pass / {failed} fail -> {OUT / 'results.json'}")
