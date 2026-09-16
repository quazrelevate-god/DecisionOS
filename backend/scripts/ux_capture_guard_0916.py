"""What the Decision Desk raises as a decision — ten captures through the REAL AI.

Run against the `backend-scratch-rbac` backend after seeding it with
<scratchpad>/seed_scratch_rbac.py:

    python scripts/ux_capture_guard_0916.py

Refuses to run unless the signed-in tenant carries the scratch marker "rbac".
NOTE: every case is a real LLM call, so this costs money — it is the acceptance
for the extraction prompt's decision guard (prompts/extraction.py 1.1), not a
test to run on every change.

A decision is what an owner DECIDED or is DIRECTING. Each case below says what
it must end as: a decision on someone's desk, news kept in the company brain, or
nothing at all. The one thing that must never happen again is a remark — "the
new chairs arrived and everyone likes them" — becoming a card asking an owner to
approve it.
"""
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from ux_login import demo_login          # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

BASE = "http://localhost:3000"
API = "http://localhost:8001/api"

# (what is typed, what it must end as)
CASES = [
    ("Arrange a meeting with Kapoor Traders tomorrow at 4pm about the pending quote", "decision"),
    ("Ravi Packers has been late on three Delhi shipments this month. Move our packaging to "
     "Anand Industries from next month, get fresh quotes from both and tell the dispatch team", "decision"),
    ("Never buy from Ravi Packers again", "decision"),          # a rule is a decision
    ("Give Priya a 10 percent discount for Anand Fabrics", "decision"),
    # News: either kept as a note or dropped — what matters is that it raises
    # no decision. The model decides whether the fact is worth the brain.
    ("The new office chairs arrived and everyone likes them", "news"),
    ("The Delhi shipment reached the warehouse this morning", "news"),
    # Tanglish, the way a founder actually talks — still a directive.
    ("Priya kitta sollu, Delhi order ku revised quote anuppanum by Friday", "decision"),
    ("Good morning", "nothing_to_decide"),                       # chatter
    ("How many invoices are still pending?", "nothing_to_decide"),  # a question
    ("Maybe we should look at new packaging some day", "nothing_to_decide"),  # thinking out loud
]

JS_SEND = """async ([api, text]) => {
  const r = await fetch(api + '/voice-notes/text', {method:'POST', credentials:'include',
    headers:{'Content-Type':'application/json'}, body: JSON.stringify({text, language:'en'})});
  return {status: r.status, body: await r.json().catch(() => null)};
}"""

JS_POLL = """async ([api, id]) => {
  const r = await fetch(api + '/voice-notes/' + id, {credentials:'include'});
  const b = await r.json().catch(() => null);
  return b ? {status: b.status, outcome: b.outcome, decision_id: b.decision_id, summary: b.summary} : null;
}"""

rows = []
with sync_playwright() as pw:
    b = pw.chromium.launch()
    ctx = b.new_context(viewport={"width": 1440, "height": 900})
    p = ctx.new_page()
    demo_login(p, BASE, "owner")
    me = p.evaluate("""async a => (await (await fetch(a + '/auth/me', {credentials:'include'})).json())""", API)
    marker = ((me or {}).get("tenant") or {}).get("ui_check_marker")
    if marker != "rbac":
        raise SystemExit(f"refusing: not the scratch workspace (marker={marker!r})")

    for text, want in CASES:
        sent = p.evaluate(JS_SEND, [API, text])
        nid = (sent.get("body") or {}).get("id")
        if not nid:
            rows.append((text, want, f"send failed {sent.get('status')}", None, False))
            continue
        got, summary, dec = None, None, None
        for _ in range(40):
            p.wait_for_timeout(2000)
            n = p.evaluate(JS_POLL, [API, nid]) or {}
            if n.get("status") in ("done", "failed"):
                got = n.get("outcome") or ("failed" if n.get("status") == "failed" else None)
                summary, dec = n.get("summary"), n.get("decision_id")
                break
        if want == "decision":
            ok = got == "decision" and bool(dec)
        elif want == "news":
            ok = got in ("noted", "nothing_to_decide") and not dec
        else:
            ok = got == want and not dec
        rows.append((text, want, got, summary, ok))
        print(f"  [{'PASS' if ok else 'FAIL'}] want {want:<18} got {str(got):<18} | {text[:58]}", flush=True)
        if summary:
            print(f"          said: {summary[:110]}", flush=True)

    # And the decisions that did get raised, for the record.
    decs = p.evaluate("""async a => {
        const j = await (await fetch(a + '/decisions', {credentials:'include'})).json();
        const arr = Array.isArray(j) ? j : (j.items || []);
        return arr.map(d => ({title: d.title, dtype: d.dtype, tasks: (d.proposal?.tasks||[]).length,
                              notes: (d.proposal?.memory_notes||[]).length, status: d.status}));
    }""", API)
    ctx.close(); b.close()

print("\nDecisions now on the desk:")
for d in decs:
    print(f"  · {d['title'][:62]:<64} {d['dtype']:<12} tasks={d['tasks']} notes={d['notes']}")

ok = sum(1 for r in rows if r[4])
print(f"\n{ok} pass / {len(rows)-ok} fail")
out = pathlib.Path(__file__).resolve().parents[2] / ".audit-artifacts" / "capture_guard" / "results.json"
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps([{"text": t, "want": w, "got": g, "said": s, "ok": o} for t, w, g, s, o in rows], indent=2),
               encoding="utf-8")
print("->", out)
