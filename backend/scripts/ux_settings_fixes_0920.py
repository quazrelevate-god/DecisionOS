"""Settings audit fixes — browser acceptance on a THROWAWAY database.

Run against the `backend-scratch-rbac` backend and the frontend on :5173:

    python scripts/ux_settings_fixes_0920.py

Yokesh, 2026-09-20: "check the settings — all the fields, what is required,
what we show", then "start to fix things". Checks, live:
  1. an AI key the owner saves never reaches a member's browser (/auth/me);
  2. Company card: adding a team no longer wipes an unsaved company field;
  3. Regenerate with AI asks first, and "Keep mine" sends nothing;
  4. a stage's owner (department) is shown, saved and reloaded;
  5. a duplicate stage name is refused with a readable message, not dropped.
"""
import json
import os
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from playwright.sync_api import sync_playwright  # noqa: E402
from ux_login import demo_login  # noqa: E402

BASE = os.environ.get("UX_BASE", "http://localhost:5173")
API = os.environ.get("UX_API", "http://localhost:8001/api")
OUT = pathlib.Path(__file__).resolve().parents[2] / ".audit-artifacts" / "settings_fixes_0920"
OUT.mkdir(parents=True, exist_ok=True)
FAKE = "sk-FAKEPROBE-settings-0920-abcdef"
results = []


def rec(key, ok, detail):
    results.append({"check": key, "ok": ok, "detail": detail})
    print(f"  [{'PASS' if ok is True else 'FAIL' if ok is False else 'INFO'}] {key}: {detail}", flush=True)


def fetch_js(method):
    return """async ([url, body]) => {
  const r = await fetch(url, {method: '%s', credentials: 'include',
    headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (localStorage.getItem('token') || '')},
    body: body ? JSON.stringify(body) : undefined});
  return [r.status, await r.text()];
}""" % method


def tid(p, t):
    return p.locator(f'[data-testid="{t}"]').first


with sync_playwright() as pw:
    b = pw.chromium.launch()
    errors = []

    # 1 · the owner's AI key stays on the server
    o = b.new_context(viewport={"width": 1440, "height": 950}).new_page()
    o.on("pageerror", lambda e: errors.append(str(e)))
    demo_login(o, base=BASE, role="owner")
    st, _ = o.evaluate(fetch_js("PATCH"), [f"{API}/tenant/ai-keys/openai", {"key": FAKE}])
    rec("owner-saves-a-key", st == 200, st)
    m = b.new_context().new_page()
    demo_login(m, base=BASE, role="sales")
    _, me = m.evaluate(fetch_js("GET"), [f"{API}/auth/me", None])
    rec("member-auth-me-has-no-key", FAKE not in me and '"ai_keys"' not in me, f"{len(me)} bytes")
    _, own = o.evaluate(fetch_js("GET"), [f"{API}/tenant/ai-keys", None])
    rec("owner-card-still-sees-it-masked", '"has_tenant_key":true' in own.replace(" ", "") and FAKE not in own, own[:90])

    # 2 · Company card: adding a team keeps an unsaved company field
    o.goto(f"{BASE}/settings?tab=business", wait_until="domcontentloaded")
    tid(o, "company-field-gst").wait_for(state="visible", timeout=30000)
    tid(o, "company-field-gst").fill("33AAAAA0000A1Z5")
    team_name = f"Dispatch {os.getpid() % 1000}"
    tid(o, "role-add-input").fill(team_name)
    tid(o, "role-add-button").click()
    o.get_by_text(f'Team "{team_name}" added').first.wait_for(timeout=15000)
    o.wait_for_timeout(1200)
    gst = tid(o, "company-field-gst").input_value()
    rec("company-field-survives-a-team-save", gst == "33AAAAA0000A1Z5", repr(gst))
    o.screenshot(path=str(OUT / "1_company_card.png"))

    # 3 · Regenerate asks first; Keep mine sends nothing
    regen_calls = []
    o.on("request", lambda r: regen_calls.append(r.url) if "/regenerate" in r.url else None)
    tid(o, "vocab-regenerate").scroll_into_view_if_needed()
    tid(o, "vocab-regenerate").click()
    asked = tid(o, "vocab-regenerate-confirm").is_visible()
    rec("regenerate-asks-first", asked, "confirm row shown")
    o.screenshot(path=str(OUT / "2_regenerate_confirm.png"))
    tid(o, "vocab-regenerate-no").click()
    o.wait_for_timeout(800)
    rec("keep-mine-sends-nothing", regen_calls == [] and tid(o, "vocab-regenerate").is_visible(), str(regen_calls))

    # 4 · stage owner round-trips
    o.goto(f"{BASE}/settings?tab=operations", wait_until="domcontentloaded")
    sel = tid(o, "op-stage-role-0-0")
    sel.wait_for(state="visible", timeout=30000)
    options = sel.locator("option").all_inner_texts()
    rec("stage-owner-picker-shows-team-names", "Sales" in options and "sales" not in options, str(options[:5]))
    pick = "finance" if sel.input_value() != "finance" else "sales"
    sel.select_option(pick)
    tid(o, "op-save").click()
    o.get_by_text("Operating model saved").first.wait_for(timeout=15000)
    o.reload(wait_until="domcontentloaded")
    tid(o, "op-stage-role-0-0").wait_for(state="visible", timeout=30000)
    rec("stage-owner-saved-and-reloaded", tid(o, "op-stage-role-0-0").input_value() == pick, pick)
    o.screenshot(path=str(OUT / "3_stage_owner.png"))

    # 5 · a NEW stage named like an existing one would have been dropped with its
    #     tasks (same key); it is refused with a reason now. (Renaming an existing
    #     stage keeps its own key, so both survive — that was never lossy.)
    o.reload(wait_until="domcontentloaded")
    tid(o, "op-add-stage-0").wait_for(state="visible", timeout=30000)
    first_name = o.locator('[data-testid="op-stage-0-0"] input[placeholder="Stage name"]').first.input_value()
    tid(o, "op-add-stage-0").click()
    # pipeline 0's stage boxes are op-stage-0-N; the one just added is last
    o.locator('[data-testid^="op-stage-0-"] input[placeholder="Stage name"]').last.fill(first_name)
    tid(o, "op-save").click()
    msg = o.get_by_text("rename one").first
    try:
        msg.wait_for(timeout=10000)
        rec("duplicate-stage-refused-with-a-reason", True, msg.inner_text()[:120])
    except Exception:
        rec("duplicate-stage-refused-with-a-reason", False, "no message")
    o.screenshot(path=str(OUT / "4_duplicate_stage.png"))

    rec("no-page-errors", errors == [], str(errors[:2]))
    b.close()

(OUT / "results.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
ok = sum(1 for r in results if r["ok"] is True)
bad = sum(1 for r in results if r["ok"] is False)
print(f"\n{ok} pass / {bad} fail -> {OUT / 'results.json'}")
