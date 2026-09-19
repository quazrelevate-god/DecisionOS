"""Workflows › pipeline counts, desktop and phone — browser acceptance on a
THROWAWAY database.

Run against a scratch backend and the frontend (defaults: backend 8002,
frontend 5174 — the ports the 2026-09-19 fix was checked on):

    python scripts/ux_workflow_counts_0919.py

Yokesh, 2026-09-19: "the count is not displaying very well — it only shows
when I click; the count should be how many workflows there are. In the PWA
it's not even listing the count."

The page loaded only the pipeline on screen (/workflows?type=<active>) and
counted every pipeline from that one list, so the pipeline you clicked showed
its real number and every other one showed 0. The phone's pipeline menu
counted from the same list, and its header showed no count at all.

This compares every count on screen with the database, on desktop and at
phone width, before and after switching pipelines.
"""
import json
import os
import pathlib
import sys
from collections import Counter

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from playwright.sync_api import sync_playwright  # noqa: E402
from ux_login import demo_login  # noqa: E402

BASE = os.environ.get("UX_BASE", "http://localhost:5174")
API = os.environ.get("UX_API", "http://localhost:8002/api")
DB_NAME = os.environ.get("UX_DB", "dos_uicheck_wf")
OUT = pathlib.Path(__file__).resolve().parents[2] / ".audit-artifacts" / "workflow_counts"
OUT.mkdir(parents=True, exist_ok=True)
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


def _db():
    from dotenv import load_dotenv
    from pymongo import MongoClient
    load_dotenv(pathlib.Path(__file__).resolve().parents[1] / ".env")
    return MongoClient(os.environ["MONGO_URL"], serverSelectionTimeoutMS=15000)[DB_NAME]


def truth(tenant_id):
    return Counter(w.get("type") for w in _db().workflows.find({"tenant_id": tenant_id}, {"type": 1}))


def desktop_counts(p, pipelines):
    out = {}
    for pip in pipelines:
        el = p.locator(f'[data-testid="workflow-tab-{pip["key"]}"]')
        if el.count():
            digits = "".join(ch for ch in el.first.inner_text().split()[-1] if ch.isdigit())
            out[pip["key"]] = int(digits) if digits else None
    return out


with sync_playwright() as pw:
    b = pw.chromium.launch()
    ctx = b.new_context(viewport={"width": 1440, "height": 950})
    p = ctx.new_page()
    demo_login(p, base=BASE, role="owner")
    me = api(p, "/auth/me")["body"] or {}
    tenant = me.get("tenant") or {}
    pipelines = ((tenant.get("operating_model") or {}).get("pipelines")) or []
    rec("signed-in-with-pipelines", len(pipelines) >= 2, [x["key"] for x in pipelines])

    # Make sure at least two pipelines hold workflows, so a wrong 0 shows.
    have = truth(tenant["id"])
    for pip in pipelines[:3]:
        if not have.get(pip["key"]):
            api(p, "/workflows", "POST", {"type": pip["key"], "title": f"Check {pip['label']}", "detail": ""})
    real = truth(tenant["id"])
    rec("the-database-says", True, dict(real))

    # ---------------- desktop ----------------
    p.goto(f"{BASE}/workflows", wait_until="domcontentloaded")
    p.locator('[data-testid="workflow-pipelines"]').first.wait_for(timeout=30000)
    p.wait_for_timeout(2500)
    shown = desktop_counts(p, pipelines)
    wrong = {k: (v, real.get(k, 0)) for k, v in shown.items() if v != real.get(k, 0)}
    rec("desktop-every-pipeline-shows-its-own-count", not wrong,
        "all match" if not wrong else f"shown vs real: {wrong}")
    p.screenshot(path=str(OUT / "1_desktop.png"))

    second = pipelines[1]["key"]
    p.locator(f'[data-testid="workflow-tab-{second}"]').first.click()
    p.wait_for_timeout(2500)
    shown2 = desktop_counts(p, pipelines)
    wrong2 = {k: (v, real.get(k, 0)) for k, v in shown2.items() if v != real.get(k, 0)}
    rec("desktop-counts-hold-after-switching", not wrong2,
        "all match" if not wrong2 else f"shown vs real: {wrong2}")

    # ---------------- phone ----------------
    mctx = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    m = mctx.new_page()
    demo_login(m, base=BASE, role="owner")
    m.goto(f"{BASE}/workflows", wait_until="domcontentloaded")
    m.locator('[data-testid="workflows-pipeline-menu"]').first.wait_for(timeout=30000)
    m.wait_for_timeout(2500)
    trigger = m.locator('[data-testid="workflows-pipeline-menu"]').first.inner_text()
    first = pipelines[0]
    rec("phone-header-shows-the-count", str(real.get(first["key"], 0)) in trigger,
        f'header reads "{trigger.strip()}" — {first["label"]} has {real.get(first["key"], 0)}')
    m.screenshot(path=str(OUT / "2_phone_header.png"))
    m.locator('[data-testid="workflows-pipeline-menu"]').first.click()
    m.wait_for_timeout(800)
    menu = {}
    for pip in pipelines:
        el = m.locator(f'[data-testid="workflows-pipeline-{pip["key"]}"]')
        if el.count():
            txt = el.first.inner_text().split()
            menu[pip["key"]] = int(txt[-1]) if txt and txt[-1].isdigit() else None
    wrong3 = {k: (v, real.get(k, 0)) for k, v in menu.items() if v != real.get(k, 0)}
    rec("phone-menu-every-pipeline-shows-its-own-count", menu and not wrong3,
        "all match" if menu and not wrong3 else f"shown vs real: {wrong3 or menu}")
    m.screenshot(path=str(OUT / "3_phone_menu.png"))
    b.close()

pathlib.Path(OUT / "results.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
ok = sum(1 for r in results if r["ok"] is True)
bad = sum(1 for r in results if r["ok"] is False)
print(f"\n{ok} pass / {bad} fail -> {OUT / 'results.json'}")
