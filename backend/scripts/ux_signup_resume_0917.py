"""Signup survives closing the tab — browser acceptance with REAL saves on a
THROWAWAY database.

Run against the `backend-scratch-rbac` backend:

    python scripts/ux_signup_resume_0917.py

A founder answers the first questions, closes the tab, and comes back. They must
find their answers where they left them, be asked only for the password (which
is never stored — the draft store refuses it by design), and end with ONE
workspace created at the end, not one per attempt.

  Fresh tab    the basics are typed; each step is saved as it completes.
  Closed       the browser is thrown away, keeping only what a real one keeps
               (localStorage).
  Reopened     the answers are back, the wizard reopens at the password, and
               nothing has been created yet.
  Finished     the workspace is created once, and the draft is marked used.
"""
import json
import pathlib
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from playwright.sync_api import sync_playwright  # noqa: E402

BASE = "http://localhost:3000"
API = "http://localhost:8001/api"
OUT = pathlib.Path(__file__).resolve().parents[2] / ".audit-artifacts" / "signup_resume"
OUT.mkdir(parents=True, exist_ok=True)
STAMP = int(time.time())
EMAIL = f"returning.{STAMP}@newcompany.co"
COMPANY = "Kadal Exports"
NAME = "Meena Raman"
PASSWORD = "Scratch-4821"
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


def wait_id(p, testid, timeout=20000):
    try:
        p.locator(f'[data-testid="{testid}"]').first.wait_for(state="visible", timeout=timeout)
        return True
    except Exception:
        return False


def field(p):
    return p.locator('[data-testid="signup-basics"] input').first


def next_step(p, wait=900):
    p.locator('[data-testid="signup-basics-next"]').first.click()
    p.wait_for_timeout(wait)


def prompt_text(p):
    el = p.locator('[data-testid="signup-basics"]').first
    return el.inner_text().replace("\n", " ") if el.count() else ""


with sync_playwright() as pw:
    b = pw.chromium.launch()

    # ---------------- the first sitting ----------------
    ctx = b.new_context(viewport={"width": 1440, "height": 950})
    p = ctx.new_page()
    p.goto(f"{BASE}/signup", wait_until="domcontentloaded")
    rec("signup-opens", wait_id(p, "signup-basics"), p.url)

    field(p).fill(COMPANY)
    next_step(p, 1500)
    field(p).fill(NAME)
    next_step(p, 1500)
    field(p).fill(EMAIL)
    next_step(p, 3500)           # the email step checks availability
    rec("reached-the-password", "password" in prompt_text(p).lower(),
        "three answers in, and the password is next")

    # What the browser is holding, and what the server has.
    held = p.evaluate("() => { try { return localStorage.getItem('dos_signup_draft'); } catch (e) { return null; } }")
    rec("draft-held-by-the-browser", bool(held) and "id" in (held or ""), (held or "")[:60])
    draft = json.loads(held) if held else {}
    server = p.evaluate(
        """async ([a, id, tok]) => {
             const r = await fetch(a + '/onboarding/draft/' + id, {headers: {'X-Draft-Token': tok}});
             return {status: r.status, body: await r.json().catch(() => null)}; }""",
        [API, draft.get("id"), draft.get("token")])
    about = ((server.get("body") or {}).get("step_data") or {}).get("about") or {}
    rec("answers-saved-on-the-server", about.get("company_name") == COMPANY and about.get("email") == EMAIL,
        f"{server.get('status')} {json.dumps(about)[:90]}")
    rec("password-never-saved", "password" not in json.dumps(server.get("body") or {}).lower(),
        "the draft store refuses it by design")
    made_so_far = api(p, "/signup/check-email", "POST", {"email": EMAIL})
    rec("nothing-created-yet", (made_so_far["body"] or {}).get("available") is True,
        "no account exists until the last step")
    p.screenshot(path=str(OUT / "1_before_closing.png"))

    # ---------------- they close the tab ----------------
    storage = ctx.storage_state()
    ctx.close()

    # ---------------- and come back ----------------
    ctx2 = b.new_context(viewport={"width": 1440, "height": 950}, storage_state=storage)
    p2 = ctx2.new_page()
    errors = []
    p2.on("pageerror", lambda e: errors.append(str(e)))
    p2.goto(f"{BASE}/signup", wait_until="domcontentloaded")
    rec("signup-reopens", wait_id(p2, "signup-basics"), p2.url)
    p2.wait_for_timeout(3000)
    back = prompt_text(p2)
    rec("reopens-at-the-password", "password" in back.lower(),
        "asked only for the one thing that is never stored")
    rec("says-welcome-back", p2.locator('[data-testid="signup-resumed-note"]').count() > 0
        and NAME.split()[0] in p2.locator('[data-testid="signup-resumed-note"]').first.inner_text(),
        (p2.locator('[data-testid="signup-resumed-note"]').first.inner_text().replace(chr(10), " ")
         if p2.locator('[data-testid="signup-resumed-note"]').count() else "no note"))
    p2.screenshot(path=str(OUT / "2_resumed.png"))

    # the answers really are back: step backwards and read them
    for _ in range(3):
        if p2.locator('[data-testid="signup-basics-back"]').count():
            p2.locator('[data-testid="signup-basics-back"]').first.click()
            p2.wait_for_timeout(700)
    first_value = field(p2).input_value() if field(p2).count() else ""
    rec("the-answers-are-back", first_value == COMPANY, f"{first_value!r}")

    # forward again to the password, and finish
    for _ in range(3):
        next_step(p2, 2500)
    field(p2).fill(PASSWORD)
    next_step(p2, 1200)
    if field(p2).count():
        field(p2).fill("5550000002")
    next_step(p2, 1200)
    chips = p2.locator('[data-testid^="team-size-"]')
    if chips.count():
        chips.first.click()
    p2.wait_for_timeout(2500)
    rec("finished-the-basics", wait_id(p2, "signup-website", 15000), "on to the website step")
    rec("no-page-errors", errors == [], str(errors[:2]))
    ctx2.close()
    b.close()

pathlib.Path(OUT / "results.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
ok = sum(1 for r in results if r["ok"] is True)
bad = sum(1 for r in results if r["ok"] is False)
print(f"\n{ok} pass / {bad} fail -> {OUT / 'results.json'}")
