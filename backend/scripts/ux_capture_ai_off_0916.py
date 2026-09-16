"""A brand-new workspace can decide, and one with AI off says so — browser
acceptance with REAL saves (and real AI) on a THROWAWAY database.

Run against a FRESHLY seeded `backend-scratch-rbac` backend (drop the scratch
database first, so the demo workspace is created by this build's seeder):

    python scripts/ux_capture_ai_off_0916.py <scratchpad>/seed_scratch_rbac.json

Refuses to run unless the signed-in tenant carries the scratch marker "rbac".
Two of the captures are real LLM calls, so this costs a little money.

Why it exists: a fresh workspace had no AI-consent record, so every capture came
back "Nothing to decide in that" while the log said ai_consent_required — the
first thing anyone saw on a new install. Both halves are checked here:

  Owner  a new workspace has AI on, and its FIRST capture becomes a decision.
  Owner  with consent revoked, a capture FAILS with the consent reason (the Desk
         turns it into "AI is off for this company" + Open Settings), nothing is
         raised, and the capture is not reported as "nothing to decide".
  Owner  consent granted again, and captures work again.
"""
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from ux_login import demo_login  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

BASE = "http://localhost:3000"
API = "http://localhost:8001/api"
OUT = pathlib.Path(__file__).resolve().parents[2] / ".audit-artifacts" / "capture_ai_off"
OUT.mkdir(parents=True, exist_ok=True)
if len(sys.argv) > 1:
    json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))   # same seed contract
results = []

JS_SEND = """async ([api, text]) => {
  const r = await fetch(api + '/voice-notes/text', {method:'POST', credentials:'include',
    headers:{'Content-Type':'application/json'}, body: JSON.stringify({text, language:'en'})});
  return {status: r.status, body: await r.json().catch(() => null)};
}"""

JS_NOTE = """async ([api, id]) => {
  const b = await (await fetch(api + '/voice-notes/' + id, {credentials:'include'})).json().catch(() => null);
  return b ? {status: b.status, outcome: b.outcome, decision_id: b.decision_id,
              error: b.error, summary: b.summary} : null;
}"""


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


def capture(p, text, tries=40):
    """Send a capture and follow it to its ending, the way the Desk does."""
    sent = p.evaluate(JS_SEND, [API, text])
    nid = (sent.get("body") or {}).get("id")
    if not nid:
        return {"status": f"send failed {sent.get('status')}"}
    for _ in range(tries):
        p.wait_for_timeout(1500)
        n = p.evaluate(JS_NOTE, [API, nid]) or {}
        if n.get("status") in ("done", "failed"):
            return n
    return {"status": "timeout"}


with sync_playwright() as pw:
    b = pw.chromium.launch()
    ctx = b.new_context(viewport={"width": 1440, "height": 900})
    p = ctx.new_page()
    errors = []
    p.on("pageerror", lambda e: errors.append(str(e)))
    demo_login(p, BASE, "owner")
    me = api(p, "/auth/me")["body"] or {}
    if ((me.get("tenant") or {}).get("ui_check_marker")) != "rbac":
        print("ABORT: the signed-in tenant is not the scratch database — nothing was saved.")
        sys.exit(2)

    # ---------------- A fresh workspace has AI on ----------------
    consent = api(p, "/tenant/ai-consent")["body"] or {}
    rec("fresh-workspace-has-ai-on", consent.get("active") is True,
        f"granted_by={consent.get('granted_by_email')} version={consent.get('granted_version')}")

    first = capture(p, "Send the revised quote to the Delhi retailer by Friday")
    rec("first-capture-becomes-a-decision", first.get("status") == "done"
        and first.get("outcome") == "decision" and bool(first.get("decision_id")),
        f"{first.get('status')}/{first.get('outcome')}")

    # ---------------- With AI off, the capture says why ----------------
    off = api(p, "/tenant/ai-consent", "DELETE")
    rec("consent-revoked", off["status"] == 200
        and (api(p, "/tenant/ai-consent")["body"] or {}).get("active") is False, off["status"])

    blocked = capture(p, "Move our packaging to Anand Industries from next month")
    rec("capture-fails-instead-of-looking-empty", blocked.get("status") == "failed",
        f"status={blocked.get('status')} outcome={blocked.get('outcome')}")
    rec("and-says-ai-is-off", "ai_consent_required" in (blocked.get("error") or ""),
        (blocked.get("error") or "")[:90])
    rec("not-reported-as-nothing-to-decide", blocked.get("outcome") != "nothing_to_decide",
        f"outcome={blocked.get('outcome')!r}")
    rec("nothing-was-raised", not blocked.get("decision_id"), f"decision_id={blocked.get('decision_id')}")

    # The Desk turns that reason into the consent screen with a way out.
    p.goto(f"{BASE}/inbox")
    p.wait_for_timeout(4000)
    p.screenshot(path=str(OUT / "desk_ai_off.png"))

    # ---------------- On again, and it works again ----------------
    on = api(p, "/tenant/ai-consent", "POST", {"version": consent.get("current_version") or "1.0"})
    rec("consent-granted-again", on["status"] == 200
        and (api(p, "/tenant/ai-consent")["body"] or {}).get("active") is True, on["status"])
    again = capture(p, "Arrange a meeting with Kapoor Traders tomorrow at 4pm")
    rec("captures-work-again", again.get("status") == "done" and bool(again.get("decision_id")),
        f"{again.get('status')}/{again.get('outcome')}")
    rec("no-page-errors", errors == [], str(errors[:2]))
    ctx.close()
    b.close()

pathlib.Path(OUT / "results.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
ok = sum(1 for r in results if r["ok"] is True)
bad = sum(1 for r in results if r["ok"] is False)
print(f"\n{ok} pass / {bad} fail -> {OUT / 'results.json'}")
