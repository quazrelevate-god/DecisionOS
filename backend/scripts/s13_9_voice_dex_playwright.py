"""T10-13.9 -- Voice / Dex UI surfaces, browser-driven with a FAKE microphone.

Verifies the async voice pipeline STATES surface correctly in the real UI:
  * the 'Dex is structuring N' inflight badge (seeded voice_note in 'structuring')
  * the capture bar + mic record button
  * the record -> stop transition WITH a live recording state -- exercised via a
    Chromium fake media device (--use-fake-device-for-media-stream), so getUserMedia
    resolves and the pulsing stop button + timer appear WITHOUT a real microphone
  * the decision-review dialog for a pending_approval (voice-sourced) decision,
    with Approve/Reject actions

Run (after seeding + both servers up):
    PYTHONIOENCODING=utf-8 .venv/Scripts/python.exe scripts/s13_9_voice_dex_playwright.py
"""
import sys
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"
OWNER = ("ravi.kumar@weaveco.in", "testpass123")
DEC_ID = "s139-dec"


def login(page, email, pw):
    page.goto(f"{BASE}/login", wait_until="domcontentloaded")
    # prefer test-ids; fall back to placeholders
    try:
        page.get_by_test_id("login-email-input").fill(email)
        page.get_by_test_id("login-password-input").fill(pw)
        page.get_by_test_id("login-submit-button").click()
    except Exception:
        page.get_by_placeholder("Email").fill(email)
        page.get_by_placeholder("Password").fill(pw)
        page.get_by_role("button", name="Sign in").click()
    page.wait_for_url(lambda u: "/login" not in u, timeout=20000)
    page.wait_for_load_state("networkidle", timeout=20000)
    page.wait_for_timeout(1000)


def main():
    r = {"inflight_badge": False, "badge_text": "", "capture_bar": False, "mic_record": False,
         "recording_state": False, "record_status": "", "decision_dialog": False,
         "approve_reject": False, "errors": []}
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, args=[
            "--use-fake-device-for-media-stream",   # supply a fake audio stream
            "--use-fake-ui-for-media-stream",        # auto-accept the mic permission prompt
        ])
        ctx = browser.new_context(viewport={"width": 1280, "height": 900},
                                  permissions=["microphone"])
        page = ctx.new_page()
        try:
            login(page, *OWNER)

            # --- /brain: inflight badge + capture bar + mic button ---
            page.goto(f"{BASE}/brain", wait_until="networkidle")
            # the badge polls /dex/inflight-count every 8s -> wait for it
            try:
                page.get_by_test_id("dex-inflight-badge").wait_for(state="visible", timeout=12000)
                r["inflight_badge"] = True
                r["badge_text"] = page.get_by_test_id("dex-inflight-badge").inner_text().strip()
            except Exception as e:
                r["errors"].append(f"inflight badge: {type(e).__name__}")

            # the capture bar is the DexStage composer (dex-stage-*), not dex-capture-bar
            r["capture_bar"] = page.get_by_test_id("dex-stage").count() > 0
            rec = page.get_by_test_id("dex-stage-mic")
            r["mic_record"] = rec.count() > 0

            # --- record -> stop, exercised with the fake mic ---
            if r["mic_record"]:
                try:
                    rec.first.click()
                    # getUserMedia resolves (fake device) -> mic swaps to the stop button
                    # (aria "Stop recording, N seconds" + Ns timer) and status -> "Listening…"
                    page.get_by_test_id("dex-stage-stop").wait_for(state="visible", timeout=6000)
                    r["recording_state"] = True
                    r["record_status"] = page.get_by_test_id("dex-stage-status").inner_text().strip()
                    page.wait_for_timeout(1200)  # let the timer tick
                    page.get_by_test_id("dex-stage-stop").first.click(force=True)
                    page.wait_for_timeout(800)
                except Exception as e:
                    r["errors"].append(f"recording state: {type(e).__name__}: {str(e)[:80]}")

            # --- /inbox?decision=... : the decision-review dialog ---
            page.goto(f"{BASE}/inbox?decision={DEC_ID}", wait_until="networkidle")
            try:
                page.get_by_test_id("decision-dialog").wait_for(state="visible", timeout=10000)
                r["decision_dialog"] = True
                r["approve_reject"] = (page.get_by_test_id("decision-approve").count() > 0
                                       and page.get_by_test_id("decision-reject").count() > 0)
            except Exception as e:
                r["errors"].append(f"decision dialog: {type(e).__name__}")
        except Exception as e:
            r["errors"].append(f"fatal: {type(e).__name__}: {str(e)[:120]}")
        finally:
            browser.close()

    print("\n===== T10-13.9 Voice / Dex UI surfaces =====")
    for k in ("inflight_badge", "capture_bar", "mic_record", "recording_state",
              "decision_dialog", "approve_reject"):
        print(f"  {k:18} {'PASS' if r[k] else 'FAIL'}")
    print(f"  badge_text: {r['badge_text']!r}   record_status: {r['record_status']!r}")
    if r["errors"]:
        print("  errors:", r["errors"])
    ok = all(r[k] for k in ("inflight_badge", "capture_bar", "mic_record",
                            "recording_state", "decision_dialog", "approve_reject"))
    print(f"\nVERDICT: {'ALL SURFACES PASS' if ok else 'SOME SURFACES FAILED'}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
