"""The whole engine, several people, two industries — browser acceptance on a
THROWAWAY database.

Run against a scratch backend (DB_NAME=dos_engine_0921, DEV_OTP_IN_RESPONSE=1,
SMS/email/WhatsApp blanked) and the frontend on :5173:

    python scripts/ux_engine_multiuser_0921.py

Yokesh, 2026-09-21: "create your own scenarios, with multiple logins... do the
complete workflow as engine testing... use the decision desk, workflow, my task,
my approval section... check with a different industry as well, use the text
field in the COO interview, create different people and test it out."

COMPANY A — Kaveri Weaves, a textile mill (founder Rajesh)
  1. signs up through the wizard and answers the COO interview BY TYPING;
  2. adds three people on Team — sales, finance, production — each gets an
     invite link and signs in on their OWN browser;
  3. Rajesh types a decision on the Desk; Dex reads it; he reviews and approves;
  4. the decision's workflow and tasks exist, routed to the right people;
  5. Priya (sales) opens My Work, finds her task, completes it; the card moves;
  6. a task that needs approval before it starts: Murugan cannot start it,
     Anand approves it from HIS screen, then Murugan can;
  7. Rajesh adds a task to a stage by hand from the card; Murugan sees it;
  8. the Desk, the board and the card all say what is going on.
COMPANY B — Glow Studio, a salon (a different founder, Meera)
  9. signs up with a salon's COO interview typed in;
 10. her pipelines are a salon's (no production, no dispatch) and every stage
     carries real work;
 11. a stylist joins, a workflow is started, the stylist does the stage's work.
"""
import io
import json
import os
import pathlib
import re
import sys
import time

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from playwright.sync_api import sync_playwright  # noqa: E402

BASE = os.environ.get("UX_BASE", "http://localhost:5173")
API = os.environ.get("UX_API", "http://localhost:8001/api")
OUT = pathlib.Path(__file__).resolve().parents[2] / ".audit-artifacts" / "engine_0921"
OUT.mkdir(parents=True, exist_ok=True)
S = str(int(time.time()))[-5:]


def phone(prefix):
    return f"{prefix}{S}{S[-4:]}"[:10]


PEOPLE = {
    "rajesh": {"name": "Rajesh Iyer", "phone": phone("97"), "email": f"rajesh{S}@kaveri-{S}.in"},
    "priya": {"name": "Priya Nair", "phone": phone("96"), "dept": "sales"},
    # The mill's AI-designed departments have no accounts team (a finding in
    # itself); Anand buys the yarn and signs off on purchases.
    "anand": {"name": "Anand Rao", "phone": phone("95"), "dept": "procurement", "grant": ["approvals"]},
    "murugan": {"name": "Murugan S", "phone": phone("94"), "dept": "production"},
    "meera": {"name": "Meera Kapoor", "phone": phone("93"), "email": f"meera{S}@glow-{S}.in"},
    "divya": {"name": "Divya Menon", "phone": phone("92"), "dept": "stylist"},
}
results = []
errors = []
# The 14-day trial allows 3 seats (services/plans.py) and this scenario needs a
# real team. Test SETUP ONLY, on the throwaway database: lift the cap for the
# companies this run creates. The seat wall itself is reported, not hidden.
SCRATCH_DB = os.environ.get("UX_DB", "dos_engine_0921c")


def lift_seat_cap(company_prefix):
    from dotenv import load_dotenv
    from pymongo import MongoClient
    load_dotenv(pathlib.Path(__file__).resolve().parents[1] / ".env")
    db = MongoClient(os.environ["MONGO_URL"], serverSelectionTimeoutMS=15000)[SCRATCH_DB]
    assert SCRATCH_DB.startswith("dos_"), "never outside a throwaway database"
    r = db.tenants.update_many({"name": {"$regex": f"^{re.escape(company_prefix)}"}},
                               {"$set": {"seat_limit_override": 25}})
    return r.modified_count


def rec(key, ok, detail=""):
    results.append({"check": key, "ok": ok, "detail": str(detail)[:240]})
    mark = "PASS" if ok is True else "FAIL" if ok is False else "INFO"
    print(f"  [{mark}] {key}: {str(detail)[:240]}", flush=True)


def shot(p, name):
    p.screenshot(path=str(OUT / f"{name}.png"), full_page=False)


def vis(p, t):
    return p.locator(f'[data-testid="{t}"]:visible').first


def wait(p, t, timeout=30000):
    try:
        vis(p, t).wait_for(state="visible", timeout=timeout)
        return True
    except Exception:
        return False


def api(p, path, method="GET", body=None):
    return p.evaluate("""async ([a,x,m,b]) => {
      const c = document.cookie.match(/(?:^|;\\s*)dos_csrf=([^;]*)/);
      const r = await fetch(a+x, {method:m, credentials:'include',
        headers:{...(b?{'Content-Type':'application/json'}:{}), ...(c?{'X-CSRF-Token':decodeURIComponent(c[1])}:{})},
        body: b?JSON.stringify(b):undefined});
      let j=null; try{j=await r.json()}catch(e){}; return {status:r.status, body:j}; }""",
                      [API, path, method, body])


def new_page(b, label):
    ctx = b.new_context(viewport={"width": 1440, "height": 950})
    p = ctx.new_page()
    p.on("pageerror", lambda e: errors.append(f"{label}: {str(e)[:160]}"))
    return p


def dismiss_welcome(p):
    if wait(p, "welcome-dismiss", 4000):
        vis(p, "welcome-dismiss").click()
        p.wait_for_timeout(700)


# ─────────────────────────────── signup ──────────────────────────────────
def answer(p, key, value):
    if not wait(p, f"signup-input-{key}", 30000):
        shot(p, f"x_stuck_{key}")
        raise AssertionError(f"wizard step {key} never came")
    vis(p, f"signup-input-{key}").fill(value)
    vis(p, "signup-basics-next").click()


def signup(p, who, company, industry, interview_answers, tag):
    """The real wizard, the COO interview answered by typing."""
    person = PEOPLE[who]
    p.goto(f"{BASE}/signup", wait_until="domcontentloaded")
    assert wait(p, "signup-input-phone", 60000), "the wizard never opened"
    vis(p, "signup-input-phone").fill(person["phone"])
    vis(p, "signup-basics-next").click()
    assert wait(p, "signup-phone-code", 20000), "no code panel"
    p.wait_for_timeout(1500)
    if vis(p, "signup-phone-confirm").is_enabled():
        vis(p, "signup-phone-confirm").click()
    p.wait_for_timeout(1500)
    answer(p, "name", person["name"])
    answer(p, "company_name", company)
    answer(p, "email", person["email"])
    if wait(p, "signup-team-size-chips", 15000):
        vis(p, "team-size-11-50").click()
    # website → skip; industry picked by hand
    wait(p, "signup-website", 30000)
    if p.locator('[data-testid="signup-website-skip"]:visible').count():
        vis(p, "signup-website-skip").click()
    p.wait_for_timeout(2500)
    if wait(p, "signup-manual-industry", 20000):
        vis(p, "signup-manual-industry").select_option(label=industry)
        p.wait_for_timeout(500)
        if p.locator('[data-testid="signup-manual-model-B2B"]:visible').count():
            vis(p, "signup-manual-model-B2B").click()
        vis(p, "signup-manual-continue").click()
    p.wait_for_timeout(2500)
    if wait(p, "lang-pick-en-IN", 15000):
        vis(p, "lang-pick-en-IN").click()
    # THE COO INTERVIEW, TYPED. Answer each question it asks until it builds.
    asked = []
    assert wait(p, "signup-interview", 60000), "the interview never opened"
    for ans in interview_answers:
        if not wait(p, "interview-answer-input", 90000):
            break
        q = vis(p, "interview-question").inner_text() if p.locator('[data-testid="interview-question"]:visible').count() else ""
        asked.append(q.strip()[:120])
        vis(p, "interview-answer-input").fill(ans)
        p.wait_for_timeout(300)
        vis(p, "interview-send-button").click()
        p.wait_for_timeout(4000)
        if p.locator('[data-testid="build-confirm-button"]:visible').count():
            break
    shot(p, f"{tag}_02_interview")
    rec(f"{tag}-coo-interview-answered-by-typing", len(asked) >= 2, " | ".join(asked[:4]))
    # If it still wants more, end it — what was typed is already on record.
    if not p.locator('[data-testid="build-confirm-button"]:visible').count() and \
            p.locator('[data-testid="interview-skip"]:visible').count():
        vis(p, "interview-skip").click()
    if not wait(p, "build-confirm-button", 300000):
        shot(p, f"x_{tag}_no_build")
        raise AssertionError("the OS never arrived")
    shot(p, f"{tag}_03_build_review")
    vis(p, "build-confirm-button").click()
    assert wait(p, "signup-enter-button", 180000), "no Enter button"
    vis(p, "signup-enter-button").click()
    p.wait_for_timeout(6000)
    dismiss_welcome(p)
    return asked


# ─────────────────────────────── team ────────────────────────────────────
def pick_role(p, want):
    """Open the Department list and pick the option closest to `want`."""
    vis(p, "member-role-select").click()
    p.wait_for_timeout(600)
    opts = p.locator('[data-testid^="member-role-select-option-"]:visible')
    keys = [o.get_attribute("data-testid").replace("member-role-select-option-", "") for o in opts.all()]
    chosen = next((k for k in keys if want in k), None) \
        or next((k for k in keys if k not in ("owner", "none")), keys[0] if keys else None)
    if chosen:
        vis(p, f"member-role-select-option-{chosen}").click()
        p.wait_for_timeout(400)
    return chosen, keys


def add_member(o, who):
    """Team › Add member, as the founder does it. Returns the invite link."""
    person = PEOPLE[who]
    o.goto(f"{BASE}/team", wait_until="domcontentloaded")
    assert wait(o, "add-user-button", 40000), "no Add member on Team"
    vis(o, "add-user-button").click()
    assert wait(o, "member-dialog", 10000), "no member dialog"
    vis(o, "member-name-input").fill(person["name"])
    vis(o, "member-phone-input").fill(person["phone"])
    role, all_roles = pick_role(o, person["dept"])
    person["role"] = role
    for perm in person.get("grant") or []:
        # A permission beyond the department's own: stop following the role first.
        tog = o.locator('[data-testid="member-follow-role-toggle"]:visible')
        if tog.count() and tog.first.is_checked():
            tog.first.click()
            o.wait_for_timeout(300)
        btn = vis(o, f"perm-{perm}")
        if btn.get_attribute("aria-pressed") != "true":
            btn.click()
    vis(o, "member-save-submit").click()
    said = ""
    for _ in range(20):   # a refusal is a toast that is gone in seconds — read it as it lands
        o.wait_for_timeout(500)
        if o.locator('[data-testid="invite-link-modal"]:visible').count():
            break
        said = said or " | ".join(t.strip() for t in o.locator("[data-sonner-toast]").all_inner_texts())
    ok = wait(o, "invite-link-modal", 10000)
    link = vis(o, "invite-link-input").input_value() if ok else ""
    if not link:
        shot(o, f"x_add_{who}_failed")
    rec(f"team-adds-{who}", bool(link),
        f"department={role}" + (f", grants={person.get('grant')}" if person.get("grant") else "")
        + ("" if link else f" — screen said: {said or 'nothing'}"))
    o.keyboard.press("Escape")
    o.wait_for_timeout(600)
    return link


def accept_invite(b, who, link, tag):
    """The person opens their link on their OWN browser and signs in."""
    p = new_page(b, who)
    p.goto(link, wait_until="domcontentloaded")
    ok = wait(p, "otp-boxes", 40000)
    p.wait_for_timeout(1000)
    if ok:
        vis(p, "otp-submit-button").click()
    if wait(p, "welcome-member-card", 40000):
        shot(p, f"{tag}_welcome_{who}")
        vis(p, "welcome-save").click()
        try:
            p.locator('[data-testid="welcome-member-card"]').first.wait_for(state="detached", timeout=60000)
        except Exception:
            pass
    me = api(p, "/auth/me")
    name = ((me["body"] or {}).get("user") or {}).get("name")
    rec(f"{who}-signs-in-on-their-own-browser", name == PEOPLE[who]["name"],
        f"{name} · {((me['body'] or {}).get('user') or {}).get('role')}")
    PEOPLE[who]["id"] = ((me["body"] or {}).get("user") or {}).get("id")
    return p


# ─────────────────────────────── desk ────────────────────────────────────
def decide(p, text, tag):
    """Type a decision on the Desk, let Dex read it, review, approve."""
    p.goto(f"{BASE}/inbox", wait_until="domcontentloaded")
    # ASK-47 — the field is behind the keyboard circle.
    assert wait(p, "desk-dex-keyboard", 40000), "no Desk well"
    if not p.locator('[data-testid="desk-dex-composer"]:visible').count():
        vis(p, "desk-dex-keyboard").click()
    assert wait(p, "desk-dex-composer", 10000), "no Desk composer"
    box = p.locator('[data-testid="desk-dex-composer"] textarea:visible, [data-testid="desk-dex-composer"] input:visible').first
    box.click()
    box.fill(text)
    box.press("Enter")
    # PILOT-2 A — a typed decision goes straight to the Dex pop-up, and its
    # third step ("What Dex made") IS the review: the counts over
    # DecisionDialog's own breakdown, with Approve pinned at the foot. There
    # is no Review button any more.
    got = wait(p, "dex-popup-counts", 180000)
    outcome = vis(p, "desk-dex-summary").inner_text()[:200] if p.locator('[data-testid="desk-dex-summary"]:visible').count() else ""
    rec(f"{tag}-dex-reads-the-typed-decision", got, outcome or "no outcome")
    shot(p, f"{tag}_05_dex_read")
    if not got:
        return None
    p.wait_for_timeout(2500)
    tasks = [x.inner_text().split("\n")[0] for x in p.locator('[data-testid^="decision-timeline-task-"]:visible').all()]
    extras = [x.inner_text().split("\n")[0] for x in p.locator('[data-testid^="decision-timeline-extra-"]:visible').all()]
    rec(f"{tag}-the-decision-says-what-approving-creates", bool(tasks) or bool(extras),
        f"tasks={tasks[:5]} other={extras[:4]}")
    shot(p, f"{tag}_06_decision_dialog")
    decisions = api(p, "/decisions?status=pending")
    vis(p, "decision-approve").click()
    p.wait_for_timeout(6000)
    if p.locator('[data-testid="decision-panel-done"]:visible').count():
        vis(p, "decision-panel-done").click()
    return decisions


# ═════════════════════════════════ run ═══════════════════════════════════
with sync_playwright() as pw:
    b = pw.chromium.launch()

    # ── COMPANY A · textile mill ──────────────────────────────────────────
    print("\n=== COMPANY A · Kaveri Weaves (textiles) ===", flush=True)
    o = new_page(b, "rajesh")
    signup(o, "rajesh", f"Kaveri Weaves {S}", "Textile & Apparel", [
        "We weave cotton and poplin fabric in Erode and sell to garment exporters in Tiruppur. "
        "About 40 looms, 28 people.",
        "Orders come from exporters by phone or WhatsApp; we confirm the quantity and rate, take a 30% "
        "advance, schedule the looms, weave, inspect, pack and dispatch by lorry.",
        "The biggest headache is orders slipping between sales and the loom floor, and chasing the "
        "balance payment after dispatch.",
        "I approve every yarn purchase above one lakh and every rate below our floor price.",
        "Priya handles sales, Anand does accounts, Murugan runs the loom floor.",
    ], "A")
    me = api(o, "/auth/me")["body"] or {}
    tenant = me.get("tenant") or {}
    rec("A-founder-inside-their-own-company", (tenant.get("name") or "").startswith("Kaveri Weaves"),
        f"{tenant.get('name')} · industry={tenant.get('industry')}")
    PEOPLE["rajesh"]["id"] = (me.get("user") or {}).get("id")
    rec("A-trial-seat-cap-lifted-for-the-test", lift_seat_cap("Kaveri Weaves") == 1, "setup only")
    om = api(o, "/tenant/operating-model")["body"] or tenant.get("operating_model") or {}
    pipes = (om or {}).get("pipelines") or (tenant.get("operating_model") or {}).get("pipelines") or []
    rec("A-pipelines-fit-a-textile-mill", bool(pipes),
        "; ".join(f"{pp['label']}: " + " → ".join(s['label'] for s in pp.get('stages', [])) for pp in pipes)[:240])
    with_work = sum(1 for pp in pipes for s in pp.get("stages", []) if s.get("tasks"))
    all_st = sum(len(pp.get("stages", [])) for pp in pipes)
    rec("A-every-stage-carries-real-work", with_work >= max(1, all_st - len(pipes)),
        f"{with_work} of {all_st} stages have tasks, e.g. "
        + "; ".join(t["title"] for pp in pipes[:1] for s in pp.get("stages", [])[:2] for t in s.get("tasks", [])[:1]))
    shot(o, "A_04_desk_empty")

    # People on their own browsers
    print("\n--- A · the team joins ---", flush=True)
    pages = {"rajesh": o}
    for who in ("priya", "anand", "murugan"):
        link = add_member(o, who)
        if link:
            pages[who] = accept_invite(b, who, link, "A")
    shot(o, "A_05_team")

    # The decision
    print("\n--- A · a decision on the Desk ---", flush=True)
    decide(o, (
        "Kumar Exports ordered 2,000 metres of cotton poplin at Rs 185 a metre, delivery by 15 October. "
        "Priya to confirm the order and collect the 30% advance, Anand to raise the advance invoice, "
        "Murugan to schedule looms 4 to 9 for it."), "A")
    after = api(o, "/workflows?with_tasks=true")["body"] or []
    wf = next((w for w in after if w.get("decision_id")), None)
    rec("A-approving-creates-a-workflow", bool(wf),
        f"{wf.get('title')} at {wf.get('stage')}" if wf else f"{len(after)} card(s), none from the decision")
    all_tasks = api(o, "/tasks")["body"] or []
    by_person = {}
    for t in all_tasks:
        by_person.setdefault(t.get("assignee_name") or t.get("assignee_role") or "nobody", []).append(t["title"])
    nobody = len(by_person.get("nobody", []))
    rec("A-approving-creates-tasks-for-the-right-people", len(all_tasks) >= 2 and nobody <= 2,
        "; ".join(f"{k}: {len(v)}" for k, v in by_person.items()))
    shot(o, "A_07_desk_after_approval")

    # Priya works her task from My Work
    print("\n--- A · Priya on My Work ---", flush=True)
    pr = pages.get("priya")
    if pr:
        pr.goto(f"{BASE}/my-work", wait_until="domcontentloaded")
        pr.wait_for_timeout(5000)
        shot(pr, "A_08_priya_my_work")
        mine = [t for t in (api(pr, "/tasks?mine=true")["body"] or []) if t.get("status") not in ("done", "cancelled")]
        rec("A-priya-sees-her-own-work", bool(mine), [t["title"] for t in mine][:4])
        target = next((t for t in mine if t.get("workflow_id") and t.get("status") == "todo"), mine[0] if mine else None)
        if target:
            before = api(o, f"/workflows/{target['workflow_id']}")["body"] if target.get("workflow_id") else None
            pr.goto(f"{BASE}/my-work?task={target['id']}", wait_until="domcontentloaded")
            ok = wait(pr, f"complete-{target['id']}", 30000)
            if ok:
                shot(pr, "A_09_priya_task_open")
                vis(pr, f"complete-{target['id']}").click()
                pr.wait_for_timeout(3000)
                if pr.locator('[data-testid="complete-confirm"]:visible').count():
                    vis(pr, "complete-confirm").click()
                    pr.wait_for_timeout(3000)
            done = api(pr, f"/tasks/{target['id']}")["body"] or {}
            rec("A-priya-completes-it-from-the-drawer", done.get("status") in ("done", "review"),
                f"'{target['title']}' → {done.get('status')}")
            if before:
                now = api(o, f"/workflows/{target['workflow_id']}")["body"] or {}
                rec("A-the-card-knows", True,
                    f"stage {before.get('stage')} → {now.get('stage')} · readiness: {now.get('readiness', {}).get('reason')}")

    # Approval before start: Murugan cannot start it; Anand approves it
    print("\n--- A · approval before work starts ---", flush=True)
    mu, an = pages.get("murugan"), pages.get("anand")
    if mu and an:
        made = api(o, "/tasks", "POST", {
            "title": "Buy 400 kg of 40s combed yarn", "assignee_id": PEOPLE["murugan"]["id"],
            "approval_required": True, "approval_stage": "start", "approver_id": PEOPLE["anand"]["id"],
            "due_date": "2026-10-03", "amount": 145000})
        tid = (made["body"] or {}).get("id")
        rec("A-a-task-that-needs-approval-first", made["status"] == 200,
            f"{(made['body'] or {}).get('status')} · approver Anand")
        blocked = api(mu, f"/tasks/{tid}", "PATCH", {"status": "in_progress"})
        rec("A-murugan-cannot-start-it-yet", blocked["status"] == 403, (blocked["body"] or {}).get("detail"))
        mu.goto(f"{BASE}/my-work", wait_until="domcontentloaded")
        mu.wait_for_timeout(4000)
        shot(mu, "A_10_murugan_locked")
        an.goto(f"{BASE}/inbox", wait_until="domcontentloaded")
        an.wait_for_timeout(5000)
        on_desk = an.locator(f'[data-testid="desk-approvals-row-{tid}"]:visible').count() > 0
        rec("A-it-waits-on-anands-desk", on_desk, "Task approvals list")
        shot(an, "A_11_anand_desk")
        an.goto(f"{BASE}/my-work?task={tid}", wait_until="domcontentloaded")
        if wait(an, f"approve-{tid}", 30000):
            vis(an, f"approve-{tid}").click()
            an.wait_for_timeout(3000)
        row = api(o, f"/tasks/{tid}")["body"] or {}
        rec("A-anand-approves-from-his-own-screen", row.get("approval_status") == "approved",
            f"{row.get('approval_status')} · status {row.get('status')}")
        started = api(mu, f"/tasks/{tid}", "PATCH", {"status": "in_progress"})
        rec("A-now-murugan-can-start", started["status"] == 200, (started["body"] or {}).get("status"))

    # Rajesh adds work to a stage by hand from the card; Murugan sees it
    print("\n--- A · adding work to a stage from the card ---", flush=True)
    wfs = api(o, "/workflows?with_tasks=true")["body"] or []
    if wfs:
        card = wfs[0]
        o.goto(f"{BASE}/workflows?type={card['type']}", wait_until="domcontentloaded")
        o.wait_for_timeout(4000)
        if wait(o, f"open-workflow-{card['id']}", 20000):
            vis(o, f"open-workflow-{card['id']}").click()
            wait(o, "workflow-detail", 20000)
            o.wait_for_timeout(2500)
            shot(o, "A_12_card_detail")
            stage = card["stage"]
            if wait(o, f"wf-add-task-{stage}", 10000):
                vis(o, f"wf-add-task-{stage}").click()
                vis(o, f"wf-add-task-title-{stage}").fill("Photograph the first 50 metres for Kumar Exports")
                if PEOPLE["murugan"].get("id"):
                    vis(o, f"wf-add-task-assignee-{stage}").select_option(value=PEOPLE["murugan"]["id"])
                vis(o, f"wf-add-task-submit-{stage}").click()
                o.wait_for_timeout(3000)
                shot(o, "A_13_task_added_to_stage")
        if mu:
            got = [t for t in (api(mu, "/tasks?mine=true")["body"] or [])
                   if t["title"].startswith("Photograph the first 50 metres")]
            rec("A-murugan-sees-the-hand-added-task", bool(got),
                f"on card '{(got[0].get('workflow_summary') or {}).get('title')}'" if got else "not in his list")
        o.goto(f"{BASE}/workflows?type={card['type']}", wait_until="domcontentloaded")
        o.wait_for_timeout(4000)
        rec("A-board-summary", wait(o, "workflow-summary", 15000),
            vis(o, "workflow-summary").inner_text().replace("\n", " ") if wait(o, "workflow-summary", 2000) else "")
        shot(o, "A_14_board")

    o.goto(f"{BASE}/inbox", wait_until="domcontentloaded")
    o.wait_for_timeout(5000)
    shot(o, "A_15_founder_desk_end")

    # ── COMPANY B · salon ─────────────────────────────────────────────────
    print("\n=== COMPANY B · Glow Studio (salon) ===", flush=True)
    m = new_page(b, "meera")
    signup(m, "meera", f"Glow Studio {S}", "Beauty & Wellness", [
        "We run a hair and beauty salon in Indiranagar, Bangalore — 3 chairs, 2 bridal rooms, 9 stylists "
        "and therapists. No manufacturing, no delivery.",
        "Clients book on WhatsApp or walk in. We confirm the slot, assign a stylist, do the service, take "
        "payment at the counter and send a follow-up for the next visit. Bridal packages need a trial first.",
        "No-shows and stylists double-booked are our biggest problems, and running out of colour and "
        "keratin stock in the middle of the week.",
        "I approve any discount over 20% and every product order above 25,000.",
    ], "B")
    tb = (api(m, "/auth/me")["body"] or {}).get("tenant") or {}
    pipes_b = ((tb.get("operating_model") or {}).get("pipelines")) or []
    labels = " ".join(pp["label"] + " " + " ".join(s["label"] for s in pp.get("stages", [])) for pp in pipes_b).lower()
    rec("B-a-salon-gets-a-salons-pipelines", bool(pipes_b) and not re.search(r"\b(loom|weav|dispatch|production)\b", labels),
        "; ".join(f"{pp['label']}: " + " → ".join(s['label'] for s in pp.get('stages', [])) for pp in pipes_b)[:240])
    stage_work = [t["title"] for pp in pipes_b for s in pp.get("stages", []) for t in s.get("tasks", [])]
    rec("B-and-its-stages-carry-salon-work", len(stage_work) >= 3, stage_work[:5])
    rec("B-industry-recorded", True, f"industry={tb.get('industry')}")
    link = add_member(m, "divya")
    dv = accept_invite(b, "divya", link, "B") if link else None
    first = pipes_b[0] if pipes_b else None
    if first:
        made = api(m, "/workflows", "POST", {"type": first["key"], "title": "Bridal trial — Ananya", "counterparty": "Ananya R", "amount": 18000})
        card = made["body"] or {}
        rec("B-a-salon-workflow-starts-with-its-own-work", made["status"] == 200 and bool(card.get("stage_tasks")),
            f"{card.get('stage')}: {[t['title'] for t in card.get('stage_tasks') or []]}")
        if dv and card.get("stage_tasks"):
            tk = card["stage_tasks"][0]
            api(m, f"/tasks/{tk['id']}", "PATCH", {"assignee_id": PEOPLE["divya"]["id"]})
            dv.goto(f"{BASE}/my-work?task={tk['id']}", wait_until="domcontentloaded")
            if wait(dv, f"complete-{tk['id']}", 30000):
                shot(dv, "B_06_divya_task")
                vis(dv, f"complete-{tk['id']}").click()
                dv.wait_for_timeout(3000)
            st = (api(dv, f"/tasks/{tk['id']}")["body"] or {}).get("status")
            rec("B-the-stylist-does-the-stage-work", st in ("done", "review"), f"'{tk['title']}' → {st}")
        m.goto(f"{BASE}/workflows?type={first['key']}", wait_until="domcontentloaded")
        m.wait_for_timeout(4000)
        shot(m, "B_07_salon_board")

    rec("no-uncaught-errors-on-any-screen", not errors, errors[:4])
    (OUT / "results.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
    passed = sum(1 for r in results if r["ok"] is True)
    total = sum(1 for r in results if r["ok"] in (True, False))
    print(f"\n==== {passed}/{total} checks passed ====", flush=True)
    for r in results:
        if r["ok"] is False:
            print(f"  FAILED: {r['check']} — {r['detail']}", flush=True)
    b.close()
