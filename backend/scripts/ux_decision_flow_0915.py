"""ASK-32 decision flow Phase 1 — browser acceptance, with REAL saves in a THROWAWAY database.

Run against the backend started from the `backend-scratch` launch config (its own
database, email and WhatsApp mocked) after seeding it:

    python <scratchpad>/seed_scratch_ask32.py
    python scripts/ux_decision_flow_0915.py <scratchpad>/seed_scratch_ask32.json

It refuses to do anything unless the signed-in tenant carries the scratch marker
the seed script sets, so it can never save into the production database.

Checks
  Desktop, owner   Desk card says what approval creates, oldest first, repeat marked;
                   popup lists the proposed tasks / workflow / meeting / reminder /
                   note and says nothing exists yet; Approve creates them (toast +
                   API); Reject of the repeat creates nothing; a decision
                   notification opens the decision.
  Desktop + phone, sales   an older decision's blocked task shows "Waiting for a
                   decision", the server refuses to start it, the link opens it.
  Phone, owner     Dex Decide by voice: the recording is held, the reviewed words
                   are sent once (one decision) and the reply says what Dex read;
                   Attach works and a file-only send is read ("Nothing to decide").
  Desktop, owner   /brain: an attached file is kept for the next note and sent with it.
Speech-to-text, the AI read and file storage are mocked in the phone and /brain
checks (they call paid or external services); everything else is real.
"""
import json
import pathlib
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from ux_login import demo_login  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

BASE = "http://localhost:3000"
API = "http://localhost:8001/api"
OUT = pathlib.Path(__file__).resolve().parents[2] / ".audit-artifacts" / "ask32_decision_flow"
OUT.mkdir(parents=True, exist_ok=True)
SEED = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
PNG = bytes.fromhex("89504e470d0a1a0a0000000d4948445200000001000000010806000000"
                    "1f15c4890000000d49444154789c6360000002000154a24f5f0000000049454e44ae426082")
results = []
CTX = {"role": "owner", "vp": "desktop"}


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


def session(b, role, phone=False):
    CTX.update(role=role, vp="phone" if phone else "desktop")
    opts = ({"viewport": {"width": 390, "height": 844}, "is_mobile": True, "has_touch": True}
            if phone else {"viewport": {"width": 1440, "height": 900}})
    ctx = b.new_context(permissions=["microphone"], **opts)
    p = ctx.new_page()
    errors = []
    p.on("pageerror", lambda e: errors.append(str(e)))
    demo_login(p, BASE, role)
    me = api(p, "/auth/me")["body"] or {}
    if (me.get("tenant") or {}).get("ui_check_marker") != "ask32":
        print("ABORT: the signed-in tenant is not the scratch database — nothing was saved.")
        sys.exit(2)
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
    # The popup shows "Loading…" until GET /decisions/{id} returns.
    p.locator('[data-testid="decision-summary-card"]').wait_for(state="visible", timeout=20000)
    p.wait_for_timeout(600)


with sync_playwright() as pw:
    b = pw.chromium.launch(args=["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"])

    # ---------------- Desktop, owner ----------------
    ctx, p, errors = session(b, "owner")
    cards = (api(p, "/desk?chip=needs_decision")["body"] or {}).get("cards") or []
    by_id = {c["id"]: c for c in cards}
    rich, rep, legacy = by_id.get(SEED["rich"]), by_id.get(SEED["repeat"]), by_id.get(SEED["legacy"])
    rec("desk-card-says-what-approval-creates", bool(rich) and "On approval: 1 task, 1 workflow" in rich["context_line"]
        and rich.get("amount") == 80000, f"{(rich or {}).get('context_line')} · amount {(rich or {}).get('amount')}")
    rec("desk-card-marks-repeat", bool(rep) and "Possible repeat" in rep["context_line"], (rep or {}).get("context_line"))
    rec("desk-card-older-decision-unblocks", bool(legacy) and "Unblocks 1 task" in legacy["context_line"], (legacy or {}).get("context_line"))
    order = [c["id"] for c in cards]
    rec("desk-decisions-oldest-first", SEED["rich"] in order and SEED["legacy"] in order
        and order.index(SEED["rich"]) < order.index(SEED["legacy"]), f"{len(order)} cards; rich #{order.index(SEED['rich']) if SEED['rich'] in order else '-'}")
    p.goto(BASE + "/inbox")
    p.wait_for_timeout(3500)
    rec("desk-shows-card-line", wait_text(p, "On approval: 1 task, 1 workflow", 8000), "context line rendered on the Desk")
    p.screenshot(path=str(OUT / "owner_desktop_desk.png"))

    open_decision(p, SEED["rich"])
    creates = text_of(p, "decision-unblocks")
    rec("popup-says-what-approving-creates", bool(creates) and creates.startswith("Approving creates 1 task, 1 workflow"), creates)
    waiting = text_of(p, "decision-waiting-on")
    rec("popup-names-who-decides", bool(waiting) and waiting.startswith("Waiting on"), waiting)
    rec("popup-nothing-created-yet", wait_text(p, "Nothing below is created until it's approved", 3000), "subtitle shown")
    task_rows = p.locator('[data-testid^="decision-timeline-task-"]:visible')
    first_task = task_rows.first.inner_text() if task_rows.count() else ""
    # Phase 3: the owner decides, so the row is editable — who (picker) and when (date field).
    due_field = task_rows.first.locator('input[type="date"]') if task_rows.count() else None
    rec("popup-lists-proposed-task", task_rows.count() == 1 and SEED["sales_name"] in first_task
        and bool(due_field and due_field.count() and due_field.input_value()),
        f"{first_task.replace(chr(10), ' · ')} · due {due_field.input_value() if due_field and due_field.count() else None}")
    extras = [x.inner_text().split("\n")[0] for x in p.locator('[data-testid^="decision-timeline-extra-"]:visible').all()]
    rec("popup-lists-workflow-meeting-reminder-note", len(extras) == 4 and any("Meeting:" in e for e in extras)
        and any("Reminder:" in e for e in extras) and any("Company note:" in e for e in extras), extras)
    rec("popup-amount-from-workflow", text_of(p, "decision-amount") == "₹80,000", text_of(p, "decision-amount"))
    p.screenshot(path=str(OUT / "owner_desktop_popup_proposal.png"))

    open_decision(p, SEED["repeat"])
    rec("popup-flags-repeat", bool(text_of(p, "decision-repeat")), text_of(p, "decision-repeat"))

    # Approve the first one — real save in the scratch database.
    open_decision(p, SEED["rich"])
    p.locator('[data-testid="decision-approve"]').click()
    rec("approve-toast-says-what-was-created", wait_text(p, "Approved — 1 task and 1 workflow created"), "toast")
    p.wait_for_timeout(1500)
    d = api(p, f"/decisions/{SEED['rich']}")["body"] or {}
    made = d.get("created_on_approval") or {}
    rec("approve-created-the-work", d.get("status") == "approved" and made.get("task_ids") == 1 and made.get("workflow_ids") == 1
        and made.get("meetings") == 1 and made.get("reminders") == 1, f"status {d.get('status')}; created {made}")
    tid = (d.get("task_ids") or [None])[0]
    t = api(p, f"/tasks/{tid}")["body"] if tid else {}
    # Phase 4.2: this task names no supplier/customer with a workflow, so it stays a plain task.
    rec("approved-task-is-ready-for-sales", (t or {}).get("status") == "todo" and (t or {}).get("assignee_id") == SEED["sales_id"],
        f"{(t or {}).get('title')} · {(t or {}).get('status')} · {(t or {}).get('assignee_name')} · workflow {(t or {}).get('workflow_id')}")
    again = api(p, f"/decisions/{SEED['rich']}/approve", "POST")
    rec("approve-twice-refused", again["status"] == 409, f"{again['status']} {(again['body'] or {}).get('detail')}")

    open_decision(p, SEED["repeat"])
    p.locator('[data-testid="decision-reject"]').click()
    warn = text_of(p, "decision-reject-warning")
    rec("reject-warning-says-nothing-created", bool(warn) and warn.startswith("Nothing it proposes will be created"), warn)
    p.locator('[data-testid="decision-reject"]').click()
    rec("reject-toast", wait_text(p, "Rejected — nothing was created"), "toast")
    p.wait_for_timeout(1200)
    r = api(p, f"/decisions/{SEED['repeat']}")["body"] or {}
    rec("reject-created-nothing", r.get("status") == "rejected" and not r.get("task_ids"), f"status {r.get('status')}; tasks {r.get('task_ids')}")

    # A decision notification opens the decision.
    p.goto(BASE + "/inbox")
    p.wait_for_timeout(2500)
    notes = api(p, "/notifications")["body"]
    notes = notes if isinstance(notes, list) else (notes or {}).get("items") or (notes or {}).get("notifications") or []
    note = next((n for n in notes if n.get("entity_id") == SEED["rich"]), None)
    opened = False
    if note:
        p.locator('[data-testid="notif-bell"]:visible').first.click()
        p.wait_for_timeout(800)
        item = p.locator(f'[data-testid="notif-item-{note["id"]}"]')
        if item.count():
            item.first.click()
            try:
                p.locator('[data-testid="decision-dialog"]').wait_for(state="visible", timeout=10000)
                opened = True
            except Exception:
                opened = False
    rec("notification-opens-decision", opened, f"url {p.url}; dialog {'open' if opened else 'not open'}; decided line {text_of(p, 'decision-waiting-on')}")
    rec("no-page-errors", not errors, errors[:3] or "none")
    ctx.close()

    # ---------------- Sales: the older decision's blocked task ----------------
    for phone in (False, True):
        ctx, p, errors = session(b, "sales", phone=phone)
        task = SEED["legacy_task"]
        p.goto(f"{BASE}/my-work?task={task}")
        p.locator(f'[data-testid="task-drawer-{task}"]').wait_for(state="visible", timeout=15000)
        p.wait_for_timeout(1500)
        banner = p.locator(f'[data-testid="decision-locked-{task}"]:visible, [data-testid="decision-locked-m-{task}"]:visible')
        rec("blocked-task-says-waiting-for-decision", banner.count() > 0, banner.first.inner_text().split("\n")[0] if banner.count() else "no banner")
        refused = api(p, f"/tasks/{task}", "PATCH", {"status": "in_progress"})
        rec("blocked-task-cannot-start", refused["status"] == 403 and "starts when the decision" in str((refused["body"] or {}).get("detail")),
            f"{refused['status']} {(refused['body'] or {}).get('detail')}")
        p.screenshot(path=str(OUT / f"sales_{CTX['vp']}_blocked_task.png"))
        link = p.locator(f'[data-testid="decision-locked-open-{task}"]:visible, [data-testid="decision-locked-open-m-{task}"]:visible')
        ok = False
        if link.count():
            link.first.click()
            try:
                p.locator('[data-testid="decision-dialog"]').wait_for(state="visible", timeout=10000)
                ok = "/inbox" in p.url
            except Exception:
                ok = False
        rec("blocked-task-link-opens-decision", ok, p.url)
        rec("no-page-errors", not errors, errors[:3] or "none")
        ctx.close()

    # ---------------- Phone, owner: Dex Decide ----------------
    ctx, p, errors = session(b, "owner", phone=True)
    calls = {"hold_posts": 0, "plain_posts": 0, "submits": [], "text_posts": [], "files": 0}
    state = {"held_sent": False}

    def voice_route(route):
        req = route.request
        path = req.url.split("/api")[-1].split("?")[0]
        if req.method == "POST" and path == "/voice-notes":
            body = req.post_data_buffer or b""
            if b'name="hold"' in body:
                calls["hold_posts"] += 1
            else:
                calls["plain_posts"] += 1
            return route.fulfill(status=200, content_type="application/json", body=json.dumps({"id": "mock-held", "status": "queued"}))
        if req.method == "GET" and path == "/voice-notes/mock-held":
            note = ({"id": "mock-held", "status": "done", "outcome": "decision", "decision_id": SEED["dispatch"],
                     "transcript": "Dispatch the Kapoor order Friday"} if state["held_sent"]
                    else {"id": "mock-held", "status": "transcribed", "transcript": "Dispatch the Kapoor order Friday"})
            return route.fulfill(status=200, content_type="application/json", body=json.dumps(note))
        if req.method == "POST" and path == "/voice-notes/mock-held/submit":
            calls["submits"].append(req.post_data_json)
            state["held_sent"] = True
            return route.fulfill(status=200, content_type="application/json", body=json.dumps({"id": "mock-held", "status": "queued"}))
        if req.method == "POST" and path == "/voice-notes/text":
            calls["text_posts"].append(req.post_data_json)
            return route.fulfill(status=200, content_type="application/json", body=json.dumps({"id": "mock-file-note", "status": "queued"}))
        if req.method == "GET" and path == "/voice-notes/mock-file-note":
            return route.fulfill(status=200, content_type="application/json", body=json.dumps(
                {"id": "mock-file-note", "status": "done", "outcome": "nothing_to_decide", "decision_id": None,
                 "summary": "A photo of a visiting card"}))
        return route.continue_()

    def files_route(route):
        if route.request.method == "POST":
            calls["files"] += 1
            return route.fulfill(status=200, content_type="application/json",
                                 body=json.dumps({"id": f"mock-file-{calls['files']}", "filename": "card.png"}))
        return route.continue_()

    p.route("**/api/voice-notes**", voice_route)
    p.route("**/api/files", files_route)
    p.goto(BASE + "/inbox")
    p.wait_for_timeout(2500)
    p.locator('[data-testid="dex-fab"]:visible').click()
    p.locator('[data-testid="dex-pick-decide"]').wait_for(state="visible", timeout=8000)
    p.locator('[data-testid="dex-pick-decide"]').click()
    p.locator('[data-testid="dex-chat"]').wait_for(state="visible", timeout=8000)
    p.wait_for_timeout(600)
    p.locator('[data-testid="dex-fab"]:visible').click()   # mic
    p.wait_for_timeout(1800)
    p.locator('[data-testid="dex-fab"]:visible').click()   # stop
    draft = None
    for _ in range(40):
        loc = p.locator('[data-testid="dock-dex-input"]:visible')
        if loc.count() and (loc.first.input_value() or "").strip():
            draft = loc.first.input_value()
            break
        p.wait_for_timeout(300)
    rec("voice-held-and-words-back-for-review", calls["hold_posts"] == 1 and calls["plain_posts"] == 0 and draft == "Dispatch the Kapoor order Friday",
        f"held uploads {calls['hold_posts']}, plain uploads {calls['plain_posts']}, draft {draft!r}")
    p.locator('[data-testid="dex-fab"]:visible').click()   # send
    replied = wait_text(p, "Ready for a decision", 15000)
    rec("voice-sent-once-one-decision", len(calls["submits"]) == 1 and not calls["text_posts"] and calls["plain_posts"] == 0,
        f"submits {calls['submits']}, text posts {len(calls['text_posts'])}")
    chat_text = p.locator('[data-testid="dex-chat"]').inner_text()
    rec("voice-reply-says-what-dex-read", replied and "Pack the Kapoor order" not in chat_text and "Nothing is created until it's approved" in chat_text
        and "1 task" in chat_text, chat_text[-220:].replace("\n", " / "))
    p.screenshot(path=str(OUT / "owner_phone_dex_voice.png"))

    p.locator('[data-testid="dex-plus"]').click()
    p.locator('[data-testid="dex-action-file"]').wait_for(state="visible", timeout=5000)
    p.locator('[data-testid="dex-attach-input"]').set_input_files({"name": "card.png", "mimeType": "image/png", "buffer": PNG})
    attached = wait_text(p, "Attached. Say or type what to do with it", 8000)
    chip = text_of(p, "dex-attached")
    rec("attach-works-and-is-kept", attached and calls["files"] == 1 and bool(chip) and "card.png" in chip, f"uploads {calls['files']}; chip {chip!r}")
    p.locator('[data-testid="dex-fab"]:visible').click()   # send the file alone
    read = wait_text(p, "Nothing to decide in that", 15000)
    sent = calls["text_posts"][-1] if calls["text_posts"] else {}
    rec("file-alone-is-sent-and-read", read and sent.get("file_ids") == ["mock-file-1"], f"sent {sent}")
    p.screenshot(path=str(OUT / "owner_phone_dex_file.png"))
    rec("no-page-errors", not errors, errors[:3] or "none")
    ctx.close()

    # ---------------- Desktop /brain: attachment rides with the note ----------------
    ctx, p, errors = session(b, "owner")
    brain = {"files": 0, "text": []}

    def brain_files(route):
        if route.request.method == "POST":
            brain["files"] += 1
            return route.fulfill(status=200, content_type="application/json", body=json.dumps({"id": "mock-brain-file", "filename": "bill.png"}))
        return route.continue_()

    def brain_text(route):
        if route.request.method == "POST":
            brain["text"].append(route.request.post_data_json)
            return route.fulfill(status=200, content_type="application/json", body=json.dumps({"id": "mock-brain-note", "status": "queued"}))
        return route.continue_()

    p.route("**/api/files", brain_files)
    p.route("**/api/voice-notes/text", brain_text)
    p.goto(BASE + "/brain")
    p.locator('[data-testid="dex-stage-composer"]').wait_for(state="visible", timeout=15000)
    p.locator('[data-testid="dex-stage-composer"] input[type="file"]').set_input_files({"name": "bill.png", "mimeType": "image/png", "buffer": PNG})
    p.wait_for_timeout(1200)
    chips = text_of(p, "dex-stage-attachments")
    rec("brain-attachment-kept-for-next-note", bool(chips) and "bill.png" in chips and p.locator('[data-testid="dex-stage-note"]:visible').count() == 1, chips)
    p.locator('[data-testid="dex-stage-input"]').fill("File this bill against Rajesh Traders")
    p.locator('[data-testid="dex-stage-note"]').click()
    p.wait_for_timeout(1500)
    sent = brain["text"][-1] if brain["text"] else {}
    rec("brain-note-carries-the-file", sent.get("file_ids") == ["mock-brain-file"] and text_of(p, "dex-stage-attachments") is None, f"sent {sent}")
    rec("no-page-errors", not errors, errors[:3] or "none")
    ctx.close()
    b.close()

(OUT / "results.json").write_text(json.dumps(results, indent=1, ensure_ascii=False), encoding="utf-8")
fails = [r for r in results if r["ok"] is False]
print(f"\n{sum(r['ok'] is True for r in results)} pass / {len(fails)} fail -> {OUT / 'results.json'}")
