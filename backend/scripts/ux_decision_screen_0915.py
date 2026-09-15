"""ASK-32 decision flow Phases 3 and 4 — browser acceptance, with REAL saves in a THROWAWAY database.

Run against the `backend-scratch` backend after seeding it with
<scratchpad>/seed_scratch_ask32_p34.py:

    python scripts/ux_decision_screen_0915.py <scratchpad>/seed_scratch_ask32_p34.json

Refuses to run unless the signed-in tenant carries the scratch marker.

  Owner, desktop   the decision screen shows what was said (with the voice note) and the
                   work as plain rows: a task with nobody asks to pick who does it; who
                   and when can be changed and an item removed before approving; the
                   Toyota card is named as already on the board and moving to Dispatched;
                   a task about Toyota says it is part of that order; approving keeps the
                   popup open with links to what was made; the Toyota card moved (no
                   duplicate), the dye purchase went into its approval stage, the plain
                   task has no workflow; the task drawer and the workflow card link back.
  Owner, phone     the editable rows fit a 390px screen.
The voice-note audio itself is mocked (object storage); everything else is real.
"""
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from ux_login import demo_login  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

BASE = "http://localhost:3000"
API = "http://localhost:8001/api"
OUT = pathlib.Path(__file__).resolve().parents[2] / ".audit-artifacts" / "ask32_decision_screen"
OUT.mkdir(parents=True, exist_ok=True)
SEED = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
results = []
CTX = {"role": "owner", "vp": "desktop"}
WEBM = b"\x1aE\xdf\xa3" + b"\x00" * 64


def rec(key, ok, detail):
    results.append({"check": key, "role": CTX["role"], "viewport": CTX["vp"], "ok": ok, "detail": detail})
    print(f"  [{'PASS' if ok is True else 'FAIL' if ok is False else 'INFO'}] {CTX['role']:<6} {CTX['vp']:<7} {key}: {detail}", flush=True)


def api(p, path, method="GET", body=None):
    return p.evaluate(
        """async ([a, x, m, b]) => {
             const r = await fetch(a + x, {method: m, credentials: 'include',
               headers: b ? {'Content-Type': 'application/json'} : {}, body: b ? JSON.stringify(b) : undefined});
             let j = null; try { j = await r.json(); } catch (e) {}
             return {status: r.status, body: j}; }""", [API, path, method, body])


def session(b, phone=False):
    CTX.update(vp="phone" if phone else "desktop")
    opts = ({"viewport": {"width": 390, "height": 844}, "is_mobile": True, "has_touch": True}
            if phone else {"viewport": {"width": 1440, "height": 900}})
    ctx = b.new_context(**opts)
    p = ctx.new_page()
    errors = []
    p.on("pageerror", lambda e: errors.append(str(e)))
    demo_login(p, BASE, "owner")
    me = api(p, "/auth/me")["body"] or {}
    if (me.get("tenant") or {}).get("ui_check_marker") != "ask32":
        print("ABORT: the signed-in tenant is not the scratch database — nothing was saved.")
        sys.exit(2)
    p.route(f"**/api/voice-notes/{SEED['voice_note_id']}/audio",
            lambda route: route.fulfill(status=200, content_type="audio/webm", body=WEBM))
    return ctx, p, errors


def text_of(p, testid):
    loc = p.locator(f'[data-testid="{testid}"]:visible')
    return loc.first.inner_text().strip() if loc.count() else None


def wait_text(p, text, timeout=12000):
    try:
        p.get_by_text(text, exact=False).first.wait_for(state="visible", timeout=timeout)
        return True
    except Exception:
        return False


def open_decision(p, did):
    p.goto(f"{BASE}/inbox?decision={did}")
    p.locator('[data-testid="decision-dialog"]').wait_for(state="visible", timeout=15000)
    p.locator('[data-testid="decision-summary-card"]').wait_for(state="visible", timeout=20000)
    p.wait_for_timeout(900)


def proposal(p, did):
    return ((api(p, f"/decisions/{did}")["body"] or {}).get("proposal")) or {}


BIG, SMALL = SEED["big"], SEED["small"]
T_CALL, T_CLEAN, T_COURIER = (SEED["tasks"]["Call Toyota about the dispatch date"], SEED["tasks"]["Clean the warehouse"],
                              SEED["tasks"]["Book a courier for Friday"])

with sync_playwright() as pw:
    b = pw.chromium.launch()
    ctx, p, errors = session(b)
    open_decision(p, BIG)

    said = text_of(p, "decision-said")
    card = text_of(p, "decision-said-card") or ""
    rec("shows-what-was-said", bool(said) and "Toyota order-a dispatched" in said and "Voice note" in card, (said or "")[:80])
    p.locator('[data-testid="decision-play"]').click()
    try:
        p.locator('[data-testid="decision-said-audio"]').wait_for(state="attached", timeout=8000)
        rec("voice-note-plays", True, "audio player shown")
    except Exception:
        rec("voice-note-plays", False, "no audio player")
    rec("no-ai-jargon", p.locator('[data-testid="decision-dialog"]').inner_text().lower().count("confidence") == 0,
        "no confidence or type labels on the screen")

    extras = {x.get_attribute("data-testid"): x.inner_text() for x in p.locator('[data-testid^="decision-timeline-extra-"]').all()}
    toyota_row = next((v for v in extras.values() if "Toyota" in v), "")
    rec("existing-card-named-and-moving", "already on the board" in toyota_row
        and f"to {SEED['dist_next_label'].lower()}" in toyota_row.lower(), toyota_row.replace("\n", " · "))
    rec("new-purchase-workflow-listed", any("New " in v and "dye" in v.lower() for v in extras.values()), [v.split("\n")[0] for v in extras.values()])
    call_link = text_of(p, f"decision-task-workflow-{T_CALL}")
    rec("toyota-task-part-of-the-order", bool(call_link) and "Toyota order" in call_link, call_link)
    rec("plain-task-not-in-a-workflow", p.locator(f'[data-testid="decision-task-workflow-{T_CLEAN}"]').count() == 0, "Clean the warehouse")
    courier = p.locator(f'[data-testid="decision-task-person-{T_COURIER}"]')
    rec("nobody-matched-asks-to-pick", courier.count() == 1 and "Pick who does this" in courier.inner_text(), courier.inner_text() if courier.count() else None)
    p.screenshot(path=str(OUT / "owner_desktop_before_edits.png"))

    # Pick who books the courier.
    courier.click()
    opt = p.locator(f'[data-testid="decision-task-person-{T_COURIER}-option-{SEED["ops_id"]}"]')
    opt.wait_for(state="visible", timeout=8000)
    opt.click()
    p.wait_for_timeout(2500)
    pr = proposal(p, BIG)
    t = next(x for x in pr["tasks"] if x["key"] == T_COURIER)
    rec("pick-person-saves", (t.get("assignee_id"), t.get("assignee_how")) == (SEED["ops_id"], "picked"), f"{t.get('assignee_id')} {t.get('assignee_how')}")
    # Change the due date on Toyota's call.
    p.locator(f'[data-testid="decision-task-due-{T_CALL}"]').fill("2026-09-30")
    p.wait_for_timeout(2500)
    t = next(x for x in proposal(p, BIG)["tasks"] if x["key"] == T_CALL)
    rec("change-due-date-saves", t.get("due_date") == "2026-09-30", t.get("due_date"))
    # Remove the reminder.
    p.locator(f'[data-testid="decision-extra-remove-{SEED["reminder_key"]}"]').click()
    rec("remove-item-toast", wait_text(p, "Removed — it won't be created"), "toast")
    p.wait_for_timeout(2000)
    rec("remove-item-saves", proposal(p, BIG).get("reminders") == [], "reminder gone from the proposal")
    p.screenshot(path=str(OUT / "owner_desktop_after_edits.png"))

    # Approve — the popup stays and links to what was made. What gets CREATED depends
    # on the board: a dye card left open by an earlier run is matched, not duplicated.
    before = proposal(p, BIG)
    n_new = sum(1 for w in before.get("workflows") or [] if w.get("mode") != "existing")
    dye_item = next((w for w in before.get("workflows") or [] if "dye" in (w.get("title") or "").lower()), {})
    expected = "Approved — 3 tasks" + (f" and {n_new} workflow{'s' if n_new != 1 else ''}" if n_new else "") + " created"
    p.locator('[data-testid="decision-approve"]').click()
    # Approving also moves workflows (engine advances, first-stage automation), which is slower on a remote database.
    rec("approve-toast", wait_text(p, expected, 45000), expected)
    try:
        p.locator('[data-testid^="decision-task-link-"]').first.wait_for(state="visible", timeout=15000)
        links = p.locator('[data-testid^="decision-task-link-"]').count()
    except Exception:
        links = 0
    wf_links = p.locator('[data-testid^="decision-workflow-"]').count()
    rec("popup-stays-with-links", p.locator('[data-testid="decision-dialog"]:visible').count() == 1 and links == 3 and wf_links >= 2,
        f"task links {links}, workflow links {wf_links}")
    p.screenshot(path=str(OUT / "owner_desktop_after_approve.png"))

    d = api(p, f"/decisions/{BIG}")["body"] or {}
    wfs = api(p, "/workflows")["body"] or []
    toyota = next((w for w in wfs if w["id"] == SEED["toyota_id"]), {})
    # No Toyota card was created by this decision (re-seeding may leave older Toyota cards from earlier runs).
    made_toyota = [w for w in wfs if w.get("decision_id") == BIG and "toyota" in (w.get("title") or "").lower()]
    rec("toyota-card-moved-not-duplicated", toyota.get("stage") == SEED["dist_keys"][1] and not made_toyota,
        f"stage {toyota.get('stage')}; new Toyota cards from this decision {len(made_toyota)}")
    dye = next((w for w in wfs if (dye_item.get("workflow_id") and w["id"] == dye_item["workflow_id"])
                or (not dye_item.get("workflow_id") and w.get("decision_id") == BIG and "dye" in (w.get("title") or "").lower())), {})
    rec("purchase-moved-into-approval", dye.get("stage") == SEED["proc_approval"], f"{dye.get('title')} at {dye.get('stage')}")
    tasks = {}
    for tid in d.get("task_ids") or []:
        tt = api(p, f"/tasks/{tid}")["body"] or {}
        tasks[tt.get("title")] = tt
    call = tasks.get("Call Toyota about the dispatch date") or {}
    rec("toyota-task-linked-at-new-stage", call.get("workflow_id") == SEED["toyota_id"] and call.get("stage_key") == SEED["dist_keys"][1]
        and call.get("due_date") == "2026-09-30", f"{call.get('workflow_id')} {call.get('stage_key')} due {call.get('due_date')}")
    rec("plain-task-stays-plain", (tasks.get("Clean the warehouse") or {}).get("workflow_id") is None, "Clean the warehouse")
    rec("picked-person-got-the-task", (tasks.get("Book a courier for Friday") or {}).get("assignee_id") == SEED["ops_id"], "Book a courier")
    rec("removed-reminder-not-created", not any(e.get("label", "").startswith("Created") and "reminder" in e.get("label", "") for e in d.get("timeline") or [])
        and (d.get("created_on_approval") or {}).get("reminders") == 0, d.get("created_on_approval"))
    rec("timeline-says-card-moved", any("moved to" in e.get("label", "") for e in d.get("timeline") or []),
        [e.get("label") for e in d.get("timeline") or [] if "moved" in e.get("label", "")])

    # Links back: the task drawer and the workflow card.
    p.goto(f"{BASE}/my-work?task={call.get('id')}")
    p.locator(f'[data-testid="task-drawer-{call.get("id")}"]').wait_for(state="visible", timeout=15000)
    p.wait_for_timeout(1500)
    link = text_of(p, f"decision-link-{call.get('id')}")
    rec("task-links-back-to-decision", bool(link) and "Dispatch the Toyota order" in link, link)
    p.goto(f"{BASE}/my-work?view=workflows&type={SEED['proc_key']}")
    p.wait_for_timeout(4000)
    wf_link = p.locator(f'[data-testid="wf-card-decision-{dye.get("id")}"]')
    rec("workflow-card-links-back", wf_link.count() > 0 and "Dispatch the Toyota order" in (wf_link.first.inner_text() if wf_link.count() else ""),
        wf_link.first.inner_text() if wf_link.count() else "no link on the card")
    p.screenshot(path=str(OUT / "owner_desktop_board.png"))
    rec("no-page-errors", not errors, errors[:3] or "none")
    ctx.close()

    # Phone: the editable rows fit.
    ctx, p, errors = session(b, phone=True)
    open_decision(p, SMALL)
    small_task = (proposal(p, SMALL).get("tasks") or [{}])[0].get("key")
    picker = p.locator(f'[data-testid="decision-task-person-{small_task}"]:visible')
    over = p.evaluate("() => document.documentElement.scrollWidth - innerWidth")
    dialog_over = p.evaluate("""() => { const d = document.querySelector('[data-testid="decision-dialog"]');
                                        return d ? d.scrollWidth - d.clientWidth : -1; }""")
    rec("phone-edit-row-fits", picker.count() == 1 and over <= 0 and dialog_over <= 1
        and p.locator(f'[data-testid="decision-task-due-{small_task}"]:visible').count() == 1,
        f"picker {picker.count()}; page overflow {over}px; dialog overflow {dialog_over}px")
    p.screenshot(path=str(OUT / "owner_phone_edit_rows.png"), full_page=False)
    rec("no-page-errors", not errors, errors[:3] or "none")
    ctx.close()
    b.close()

(OUT / "results.json").write_text(json.dumps(results, indent=1, ensure_ascii=False), encoding="utf-8")
fails = [r for r in results if r["ok"] is False]
print(f"\n{sum(r['ok'] is True for r in results)} pass / {len(fails)} fail -> {OUT / 'results.json'}")
