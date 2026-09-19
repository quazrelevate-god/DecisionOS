"""Creating a workspace, clicked through step by step — browser acceptance with
REAL saves (and real AI) on a THROWAWAY database.

Run against a FRESHLY seeded `backend-scratch-rbac` backend:

    python scripts/ux_signup_0917.py

Every step of the signup is typed and clicked the way a founder does: the
basics, the website step, the interview, the build, the confirm. Two of the
calls are real LLM work, so this costs a little money.

What it holds to:
  * each step refuses to advance on bad input, and says what is wrong;
  * the email step catches an email that already has a workspace, there and
    then — not sixty seconds later;
  * the workspace is created and the founder lands inside it;
  * creating takes seconds, not a minute (the AI setup fills in behind them,
    which is what stopped a proxy timeout from costing a founder a workspace);
  * pressing Create a second time signs them in rather than refusing them;
  * an email that truly belongs to someone else is refused with a Sign in link.
"""
import json
import pathlib
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from playwright.sync_api import sync_playwright  # noqa: E402

BASE = "http://localhost:3000"
API = "http://localhost:8001/api"
OUT = pathlib.Path(__file__).resolve().parents[2] / ".audit-artifacts" / "signup"
OUT.mkdir(parents=True, exist_ok=True)
STAMP = int(time.time())
EMAIL = f"founder.{STAMP}@newcompany.co"
PASSWORD = "Scratch-4821"
COMPANY = "Nalla Foods"
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


def step_text(p):
    el = p.locator('[data-testid="signup-basics"]').first
    return el.inner_text().replace("\n", " | ") if el.count() else ""


def step_error(p):
    el = p.locator('[data-testid="signup-basics-error"]')
    return el.first.inner_text().strip() if el.count() else ""


def next_step(p, wait=900):
    """Press Continue, the way a founder does."""
    p.locator('[data-testid="signup-basics-next"]').first.click()
    p.wait_for_timeout(wait)


def type_step(p, value, wait=900):
    box = p.locator('[data-testid="signup-basics"] input').first
    if box.count():
        box.fill(value)
    next_step(p, wait)


with sync_playwright() as pw:
    b = pw.chromium.launch()
    ctx = b.new_context(viewport={"width": 1440, "height": 950})
    p = ctx.new_page()
    errors = []
    p.on("pageerror", lambda e: errors.append(str(e)))

    # An email that IS taken, for the check below: the demo owner's.
    taken_email = "owner@sharma.com"

    p.goto(f"{BASE}/signup", wait_until="domcontentloaded")
    rec("signup-opens", wait_id(p, "signup-basics"), p.url)

    # ---- company name: refuses a blank, accepts a name ----
    next_step(p, 700)
    rec("blank-company-refused", "Tell us your company name" in step_error(p),
        step_error(p) or "no error shown")
    type_step(p, COMPANY)
    rec("company-accepted", COMPANY.split()[0] in step_text(p) or "running" in step_text(p).lower(),
        step_text(p)[:70])

    # ---- your name ----
    type_step(p, "Arun Kumar")

    # ---- email: a taken one is caught HERE, not at the end ----
    box = p.locator('[data-testid="signup-basics"] input').first
    box.fill("not-an-email")
    next_step(p, 700)
    rec("bad-email-refused", "doesn't look right" in step_error(p), step_error(p))
    box.fill(taken_email)
    next_step(p, 3500)
    rec("taken-email-caught-on-the-step", "already has a workspace" in step_error(p),
        step_error(p) or "no error - it would only fail at the end")
    box.fill(EMAIL)
    next_step(p, 3500)

    # ---- password: too short, then good ----
    box = p.locator('[data-testid="signup-basics"] input').first
    box.fill("123")
    next_step(p, 700)
    rec("short-password-refused", "8 characters" in step_error(p), step_error(p))
    box.fill(PASSWORD)
    next_step(p)

    # ---- mobile: required and confirmed by a code since 2026-09-19 ----
    box = p.locator('[data-testid="signup-basics"] input').first
    box.fill("98200 " + str(int(time.time()))[-5:])
    next_step(p, 2500)
    code = "".join(p.locator('[data-testid="signup-phone-code-boxes"] input').nth(i).input_value() for i in range(6))
    p.locator('[data-testid="signup-phone-confirm"]').first.click()
    p.wait_for_timeout(2500)

    # ---- team size: a chip ----
    chips = p.locator('[data-testid^="team-size-"]')
    picked = False
    if chips.count():
        chips.first.click()
        picked = True
    p.wait_for_timeout(2000)
    rec("team-size-picked", picked, "the last basics step")
    p.screenshot(path=str(OUT / "1_basics_done.png"))

    # ---- website step: skip it ----
    rec("website-step-shown", wait_id(p, "signup-website", 15000), "the website step")
    skipped = False
    if p.locator('[data-testid="signup-website-skip"]').count():
        p.locator('[data-testid="signup-website-skip"]').first.click()
        skipped = True
    p.wait_for_timeout(3500)
    rec("website-step-passed", skipped, "skipped it, as a founder without a site would")

    # ---- the manual step: an industry is required, and Continue says so ----
    if p.locator('[data-testid="signup-manual-industry"]').count():
        cont = p.locator('[data-testid="signup-manual-continue"]').first
        rec("industry-required-before-continue", not cont.is_enabled(),
            "Continue stays closed until an industry is chosen")
        p.locator('[data-testid="signup-manual-industry"]').first.select_option(index=1)
        p.wait_for_timeout(500)
        if p.locator('[data-testid="signup-manual-model-B2B"]').count():
            p.locator('[data-testid="signup-manual-model-B2B"]').first.click()
            p.wait_for_timeout(300)
        rec("industry-chosen-opens-continue", cont.is_enabled(), "and opens once it is")
        cont.click()
        p.wait_for_timeout(3500)
    if p.locator('[data-testid="lang-pick-en-IN"]').count():
        p.locator('[data-testid="lang-pick-en-IN"]').first.click()
        p.wait_for_timeout(3500)
    rec("interview-reached",
        p.locator('[data-testid="signup-interview"], [data-testid="interview-skip"]').count() > 0,
        "the interview step")
    if p.locator('[data-testid="interview-skip"]').count():
        p.locator('[data-testid="interview-skip"]').first.click()
    p.wait_for_timeout(8000)
    p.screenshot(path=str(OUT / "2_before_build.png"))
    body = p.inner_text("body")
    rec("reached-the-build", "Dex" in body or "building" in body.lower()
        or p.locator('[data-testid="build-confirm"], [data-testid="build-error-banner"]').count() > 0,
        p.url)

    # ---- create the workspace by pressing the button ----
    rec("confirm-button-shown", wait_id(p, "build-confirm-button", 90000),
        "the blueprint is ready and the founder can confirm it")
    t0 = time.time()
    p.locator('[data-testid="build-confirm-button"]').first.click()
    landed = wait_id(p, "signup-enter-button", 60000)
    took = round(time.time() - t0, 1)
    rec("workspace-created-from-the-button", landed, f"the reveal appeared in {took}s")
    rec("created-in-seconds-not-a-minute", landed and took < 25,
        f"{took}s — the AI setup fills in behind the founder, so this is no longer the 14s+ wait "
        f"that a 60s proxy timeout could cut in half")
    p.screenshot(path=str(OUT / "3_reveal.png"))
    me_now = api(p, "/auth/me")
    rec("signed-in-by-creating", me_now["status"] == 200
        and (me_now["body"] or {}).get("user", {}).get("email") == EMAIL,
        f"{me_now['status']} {((me_now['body'] or {}).get('user') or {}).get('email')}")
    if p.locator('[data-testid="signup-enter-button"]').count():
        p.locator('[data-testid="signup-enter-button"]').first.click()
        p.wait_for_timeout(6000)
    rec("enters-the-app", "/signup" not in p.url, p.url)
    p.screenshot(path=str(OUT / "4_inside.png"))

    # ---- pressing Create again: signed in, not refused ----
    # (This is the reported fault: the first answer was lost, so they press
    #  again. It must end in their workspace, not in a wall.)
    again = api(p, "/auth/register", "POST", {
        "company_name": COMPANY, "name": "Arun Kumar", "email": EMAIL, "password": PASSWORD})
    rec("second-press-signs-them-in", again["status"] == 200
        and (again["body"] or {}).get("user", {}).get("email") == EMAIL,
        f"{again['status']} - the lost-answer case ends in their workspace")

    # ---- somebody else's email: refused, with a way out ----
    theirs = api(p, "/auth/register", "POST", {
        "company_name": "Other Co", "name": "Someone", "email": taken_email, "password": "not-their-password"})
    detail = (theirs["body"] or {}).get("detail") or {}
    if theirs["status"] == 429:
        # Three workspaces per network per hour: the budget for this run is
        # spent. The message itself is the thing to check then.
        rec("rate-limit-says-how-long", "minute" in str(detail) and "sign in" in str(detail).lower(),
            str(detail)[:110])
    else:
        rec("someone-elses-email-refused", theirs["status"] == 400 and detail.get("code") == "email_registered",
            f"{theirs['status']} {str(detail)[:70]}")

    # ---- the founder is inside their workspace, as its owner ----
    me = api(p, "/auth/me")
    rec("signed-in-as-the-owner", me["status"] == 200
        and (me["body"] or {}).get("user", {}).get("email") == EMAIL
        and (me["body"] or {}).get("user", {}).get("role") == "owner",
        f"{me['status']} {((me['body'] or {}).get('tenant') or {}).get('name')}")
    p.goto(f"{BASE}/inbox")
    p.wait_for_timeout(5000)
    rec("lands-on-the-desk", "/login" not in p.url, p.url)
    p.screenshot(path=str(OUT / "5_new_workspace_desk.png"))

    # ---- and the AI setup arrives behind them ----
    status = None
    for _ in range(12):
        t = api(p, "/auth/me")["body"] or {}
        status = ((t.get("tenant") or {}).get("ai_setup_status")) or {}
        if status and all(v == "generated" for v in status.values()):
            break
        p.wait_for_timeout(5000)
    rec("ai-setup-lands-behind-them", bool(status) and all(v in ("generated", "defaulted") for v in status.values()),
        str(status))
    rec("no-page-errors", errors == [], str(errors[:2]))
    ctx.close()
    b.close()

pathlib.Path(OUT / "results.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
ok = sum(1 for r in results if r["ok"] is True)
bad = sum(1 for r in results if r["ok"] is False)
print(f"\n{ok} pass / {bad} fail -> {OUT / 'results.json'}")
