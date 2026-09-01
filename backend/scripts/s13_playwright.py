"""Sprint 13 Playwright driver (T10-13.6 RBAC UI + T10-13.8 E2E per persona).

Reliable browser automation (real clicks + auto-waits) -- avoids the coordinate/
React-timing issues of the preview harness. Requires the app running (frontend
:3000, backend :8001) and scripts/s13_setup_members.py already run.

    .venv/Scripts/python scripts/s13_playwright.py
"""
import sys
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

BASE = "http://localhost:3000"
PW = "testpass123"
ACCOUNTS = {
    "owner": "ravi.kumar@weaveco.in",
    "finance": "s13.finance@weaveco.in",
    "sales": "s13.sales@weaveco.in",
    "operations": "s13.ops@weaveco.in",
}


def login(page, email):
    page.goto(f"{BASE}/login", wait_until="domcontentloaded")
    page.get_by_placeholder("Email").fill(email)
    page.get_by_placeholder("Password").fill(PW)
    page.get_by_role("button", name="Sign in").click()
    # land in the app: wait for a nav landmark or the greeting
    page.wait_for_url(lambda u: "/login" not in u, timeout=15000)
    page.wait_for_load_state("networkidle", timeout=15000)
    page.wait_for_timeout(1200)


def visible_texts(page, selector):
    out = []
    for el in page.locator(selector).all():
        try:
            if el.is_visible():
                t = (el.inner_text() or "").strip()
                if t:
                    out.append(t)
        except Exception:
            pass
    return out


def rbac_probe(page, role):
    """DATA-LEVEL gating: nav is not gated in this app (all roles see the tabs);
    the real RBAC is whether the DATA/actions inside are visible. Probe Finance
    (money data) + Settings (owner-only workspace config)."""
    login(page, ACCOUNTS[role])
    nav = [n for n in visible_texts(page, "nav a, nav button, header a, header button") if 1 < len(n) < 20]
    # -- money DATA: open Finance, count rupee amounts + look for a denial --
    page.goto(f"{BASE}/finance", wait_until="networkidle")
    page.wait_for_timeout(1800)
    fin = page.locator("body").inner_text()
    money_amounts = fin.count("₹")
    denied = any(k in fin.lower() for k in
                 ("don't have access", "no access", "restricted", "not allowed",
                  "you don't have permission", "insufficient"))
    # -- owner-only: Settings workspace/roles config --
    page.goto(f"{BASE}/settings", wait_until="networkidle")
    page.wait_for_timeout(1200)
    setxt = page.locator("body").inner_text().lower()
    settings_config = ("team roles" in setxt) or ("company details" in setxt) or ("workspace" in setxt)
    settings_denied = any(k in setxt for k in ("don't have access", "no access", "not allowed", "restricted"))
    return {"role": role, "nav": sorted(set(nav)),
            "finance_money_amounts": money_amounts, "finance_denied": denied,
            "settings_config_visible": settings_config, "settings_denied": settings_denied}


def e2e_owner(page):
    """T10-13.8: owner creates a task through the REAL UI and it appears."""
    login(page, ACCOUNTS["owner"])
    result = {"task_created": False, "contact_flow_reached": False}
    # --- create a task ---
    page.goto(f"{BASE}/my-work", wait_until="networkidle")
    page.wait_for_timeout(800)
    title = f"S13 Playwright task"
    page.get_by_role("button", name="New Task").first.click()
    dlg = page.get_by_role("dialog")
    dlg.wait_for(state="visible", timeout=8000)
    dlg.locator("input[type='text'], input:not([type])").first.fill(title)
    # kr-lift buttons animate -> Playwright's stability wait times out; force past it.
    dlg.get_by_test_id("task-create-submit").click(force=True, no_wait_after=True)
    page.wait_for_timeout(1800)
    # reload My Work (All Tasks) -- a directly-created task lands but the default
    # view doesn't auto-show it; assert it persisted + is retrievable in the UI.
    page.goto(f"{BASE}/my-work", wait_until="networkidle")
    page.wait_for_timeout(1000)
    try:
        page.get_by_role("button", name="All Tasks").first.click()
        page.wait_for_timeout(800)
    except Exception:
        pass
    result["task_created"] = page.get_by_text(title).count() > 0
    # --- reach the add-contact flow ---
    page.goto(f"{BASE}/crm", wait_until="networkidle")
    page.wait_for_timeout(800)
    try:
        page.get_by_role("button", name="Add contact").first.click()
        page.wait_for_timeout(600)
        result["contact_flow_reached"] = (
            page.get_by_role("dialog").count() > 0
            or page.get_by_text("Supplier", exact=False).count() > 0)
    except Exception:
        result["contact_flow_reached"] = False
    return result


def main():
    report = {"rbac": [], "e2e": None, "errors": []}
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 1280, "height": 900})
        page = ctx.new_page()

        # T10-13.8 owner E2E
        try:
            report["e2e"] = e2e_owner(page)
        except Exception as e:
            report["errors"].append(f"e2e: {type(e).__name__}: {e}")

        # T10-13.6 RBAC per persona (fresh context each so no session bleed)
        for role in ("owner", "finance", "sales", "operations"):
            ctx2 = browser.new_context(viewport={"width": 1280, "height": 900})
            p2 = ctx2.new_page()
            try:
                report["rbac"].append(rbac_probe(p2, role))
            except Exception as e:
                report["errors"].append(f"rbac {role}: {type(e).__name__}: {e}")
            ctx2.close()
        browser.close()

    print("\n===== T10-13.8  Owner E2E =====")
    print(f"  {report['e2e']}")
    print("\n===== T10-13.6  RBAC UI per persona (DATA-level) =====")
    for r in report["rbac"]:
        print(f"  {r['role']:11} finance_amounts={r['finance_money_amounts']:>3}  "
              f"finance_denied={r['finance_denied']!s:5}  settings_config={r['settings_config_visible']!s:5}  "
              f"settings_denied={r['settings_denied']!s}")
    if report["errors"]:
        print("\nERRORS:")
        for e in report["errors"]:
            print("  " + e)

    # verdict
    e = report["e2e"] or {}
    rbac = {r["role"]: r for r in report["rbac"]}
    ok_e2e = bool(e.get("task_created"))
    # data-level gating: finance/owner see money; sales/ops see less (fewer ₹ or denied)
    def amt(role):
        return rbac.get(role, {}).get("finance_money_amounts", 0)
    ok_rbac = (
        len(rbac) == 4
        and amt("finance") > 0 and amt("owner") > 0
        and (amt("sales") < amt("finance") or rbac["sales"]["finance_denied"])
        and (amt("operations") < amt("finance") or rbac["operations"]["finance_denied"])
    )
    print(f"\nVERDICT: E2E task-create={'PASS' if ok_e2e else 'FAIL'}  "
          f"RBAC data-gating={'PASS' if ok_rbac else 'CHECK -- nav+data may be ungated'}")
    return 0 if (ok_e2e and ok_rbac) else 1


if __name__ == "__main__":
    sys.exit(main())
