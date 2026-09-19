"""My Work's way into Workflows — browser acceptance on a THROWAWAY database.

Run against the `backend-scratch-rbac` backend and the frontend on :5173:

    python scripts/ux_mywork_workflows_pill_0919.py

Yokesh, 2026-09-19: "check whether there is a workflow pill in the My Work
page — it got removed in some iteration by mistake; bring it back." ASK-42 C
had removed it when /workflows became a page, and on desktop nothing else
reached that page. It is back as a way in: a Workflows pill on desktop and an
entry in the phone's view menu, both opening /workflows.
"""
import json
import os
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from playwright.sync_api import sync_playwright  # noqa: E402
from ux_login import demo_login  # noqa: E402

BASE = os.environ.get("UX_BASE", "http://localhost:5173")
OUT = pathlib.Path(__file__).resolve().parents[2] / ".audit-artifacts" / "mywork_workflows_pill"
OUT.mkdir(parents=True, exist_ok=True)
results = []


def rec(key, ok, detail):
    results.append({"check": key, "ok": ok, "detail": detail})
    print(f"  [{'PASS' if ok is True else 'FAIL' if ok is False else 'INFO'}] {key}: {detail}", flush=True)


def wait_id(p, testid, timeout=20000):
    try:
        p.locator(f'[data-testid="{testid}"]').first.wait_for(state="visible", timeout=timeout)
        return True
    except Exception:
        return False


with sync_playwright() as pw:
    b = pw.chromium.launch()
    errors = []
    for role in ("owner", "sales"):
        ctx = b.new_context(viewport={"width": 1440, "height": 950})
        p = ctx.new_page()
        p.on("pageerror", lambda e: errors.append(str(e)))
        demo_login(p, base=BASE, role=role)
        p.goto(f"{BASE}/my-work", wait_until="domcontentloaded")
        shown = wait_id(p, "work-open-workflows", 30000)
        rec(f"desktop-pill-for-{role}", shown, "in My Work's header")
        if role == "owner":
            p.wait_for_timeout(800)
            p.screenshot(path=str(OUT / "1_desktop_pill.png"))
        if shown:
            p.locator('[data-testid="work-open-workflows"]').first.click()
            rec(f"desktop-pill-opens-workflows-for-{role}", wait_id(p, "workflows-page", 20000) and "/workflows" in p.url, p.url)
        ctx.close()

    m = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True).new_page()
    m.on("pageerror", lambda e: errors.append(str(e)))
    demo_login(m, base=BASE, role="sales")
    m.goto(f"{BASE}/my-work", wait_until="domcontentloaded")
    wait_id(m, "work-mobile-view", 30000)
    m.locator('[data-testid="work-mobile-view"]').first.click()
    in_menu = wait_id(m, "work-mobile-view-workflows", 8000)
    rec("phone-view-menu-has-workflows", in_menu, "last in the list, marked as a way out")
    m.wait_for_timeout(600)
    m.screenshot(path=str(OUT / "2_phone_menu.png"))
    if in_menu:
        m.locator('[data-testid="work-mobile-view-workflows"]').first.click()
        rec("phone-entry-opens-workflows", wait_id(m, "workflows-page", 20000) and "/workflows" in m.url, m.url)
        m.wait_for_timeout(1500)
        m.screenshot(path=str(OUT / "3_phone_workflows.png"))

    rec("no-page-errors", errors == [], str(errors[:2]))
    b.close()

pathlib.Path(OUT / "results.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
ok = sum(1 for r in results if r["ok"] is True)
bad = sum(1 for r in results if r["ok"] is False)
print(f"\n{ok} pass / {bad} fail -> {OUT / 'results.json'}")
