"""Finance is one permission — browser acceptance with REAL saves in a THROWAWAY
database.

Run against the `backend-scratch-rbac` backend after seeding it with
<scratchpad>/seed_scratch_rbac.py:

    python scripts/ux_finance_one_perm_0916.py <scratchpad>/seed_scratch_rbac.json

Refuses to run unless the signed-in tenant carries the scratch marker "rbac".

There were two toggles for one page — "Finance (invoices, payments, 360°)" and
"Finance Ledger (expenses, assets, inventory)" — and nothing behind them: every
ledger endpoint accepted either key. Now there is one.

  Owner (desktop)  the member form offers ONE Finance toggle, and no Ledger one;
                   granting it to the sales member saves.
  Sales (desktop)  Finance is in the nav, all six tabs are there, and expenses,
                   assets and inventory all load.
  Owner (desktop)  takes it away again.
  Sales (desktop)  no Finance in the nav, and the ledger calls are refused.
"""
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from ux_login import demo_login  # noqa: E402
from ux_team_nav import open_member  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

BASE = "http://localhost:3000"
API = "http://localhost:8001/api"
OUT = pathlib.Path(__file__).resolve().parents[2] / ".audit-artifacts" / "finance_one_perm"
OUT.mkdir(parents=True, exist_ok=True)
SEED = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
SALES = SEED["sales_id"]
TABS = ("overview", "revenue", "expenses", "assets", "inventory", "inbox")
results = []
CTX = {"role": ""}


def rec(key, ok, detail):
    results.append({"check": key, "role": CTX["role"], "ok": ok, "detail": detail})
    print(f"  [{'PASS' if ok is True else 'FAIL' if ok is False else 'INFO'}] {CTX['role']:<6} {key}: {detail}", flush=True)


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
    CTX["role"] = role
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


with sync_playwright() as pw:
    b = pw.chromium.launch()

    # ---------------- Owner: one toggle, and it grants the whole page ----------
    ctx, p, owner_errors, _ = session(b, "owner")
    if open_member(p, BASE, SALES, wait_id):
        p.locator(f'[data-testid="edit-access-{SALES}"]').first.click()
        wait_id(p, "member-dialog")
    perm_keys = p.eval_on_selector_all(
        '[data-testid="permission-list"] [data-testid^="perm-"]',
        "els => els.map(e => e.getAttribute('data-testid').replace('perm-', ''))")
    labels = p.locator('[data-testid="permission-list"]').first.inner_text()
    rec("one-finance-toggle", perm_keys.count("finance") == 1 and "ledger" not in perm_keys,
        f"finance x{perm_keys.count('finance')}, ledger x{perm_keys.count('ledger')}")
    rec("no-ledger-wording", "Ledger" not in labels,
        "the access list no longer offers a second Finance toggle")
    rec("label-covers-the-page", "expenses" in labels.lower() and "invoices" in labels.lower(),
        "one label naming what the page actually holds")
    p.screenshot(path=str(OUT / "owner_access_list.png"))
    p.keyboard.press("Escape")

    granted = api(p, f"/users/{SALES}", "PATCH", {
        "role": "sales", "follow_role": False, "permissions": ["inbox", "tasks", "finance"]})
    rec("finance-granted", granted["status"] == 200
        and "finance" in (granted["body"] or {}).get("permissions", []), granted["status"])
    ctx.close()

    # ---------------- The member: the whole page, on that one key -------------
    ctx, p, sales_errors, _ = session(b, "sales")
    rec("finance-in-the-nav", p.locator('[data-testid="nav-ledger"]').count() > 0, "Finance tile")
    p.goto(f"{BASE}/finance")
    rec("finance-page-opens", wait_id(p, "ledger-tab-overview", 25000), p.url)
    shown = [t for t in TABS if p.locator(f'[data-testid="ledger-tab-{t}"]').count()]
    rec("all-six-tabs", shown == list(TABS), ", ".join(shown))
    calls = {name: api(p, path)["status"] for name, path in (
        ("expenses", "/expenses"), ("assets", "/assets"), ("inventory", "/inventory"),
        ("invoices", "/invoices"), ("summary", "/ledger/summary"))}
    rec("both-halves-load", all(s == 200 for s in calls.values()), str(calls))
    p.screenshot(path=str(OUT / "member_finance_page.png"))
    rec("no-page-errors-member", sales_errors == [], str(sales_errors[:2]))
    ctx.close()

    # ---------------- Owner: take it away -------------------------------------
    ctx, p, owner_errors2, _ = session(b, "owner")
    removed = api(p, f"/users/{SALES}", "PATCH", {
        "role": "sales", "follow_role": False, "permissions": ["inbox", "tasks"]})
    rec("finance-removed", removed["status"] == 200
        and "finance" not in (removed["body"] or {}).get("permissions", []), removed["status"])
    ctx.close()

    ctx, p, sales_errors2, _ = session(b, "sales")
    rec("no-finance-in-the-nav", p.locator('[data-testid="nav-ledger"]').count() == 0, "no Finance tile")
    refused = {name: api(p, path)["status"] for name, path in (
        ("expenses", "/expenses"), ("assets", "/assets"), ("invoices", "/invoices"))}
    rec("ledger-calls-refused", all(s == 403 for s in refused.values()), str(refused))
    ctx.close()

    # Put the workspace back the way it was found.
    ctx, p, _, _ = session(b, "owner")
    back = api(p, f"/users/{SALES}", "PATCH", {"role": "sales", "follow_role": True})
    rec("workspace-left-as-found", back["status"] == 200
        and not (back["body"] or {}).get("permissions"), "the member follows their role again")
    rec("no-page-errors-owner", owner_errors + owner_errors2 == [],
        str((owner_errors + owner_errors2)[:2]))
    ctx.close()

    b.close()

pathlib.Path(OUT / "results.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
ok = sum(1 for r in results if r["ok"] is True)
bad = sum(1 for r in results if r["ok"] is False)
print(f"\n{ok} pass / {bad} fail -> {OUT / 'results.json'}")
