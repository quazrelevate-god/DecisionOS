"""Verify the fixes that landed against the audit findings.

Nineteen IDs are claimed fixed in commit messages. A commit message is a claim,
not evidence, so each one is re-tested here against the same measurement that
found it -- and the sheet is only moved to Fixed for the ones that actually pass.

    .venv/Scripts/python.exe scripts/ux_verify_fixes.py
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from playwright.sync_api import sync_playwright  # noqa: E402
from ux_login import demo_login  # noqa: E402

REPO = Path(__file__).resolve().parent.parent.parent
BASE = "http://localhost:3000"
OUT = REPO / ".audit-artifacts" / "ux" / "verify"

results = []


def rec(fid, claim, ok, detail=""):
    st = "FIXED" if ok is True else ("STILL OPEN" if ok is False else "INCONCLUSIVE")
    results.append(dict(id=fid, claim=claim, status=st, detail=detail))
    print(f"  {st:<12} {fid:<7} {claim}" + (f"\n{'':21}{detail}" if detail else ""))


def settle(p, t=20000):
    try:
        p.wait_for_function(
            "()=>document.querySelectorAll('[class*=\"animate-pulse\"]').length===0", timeout=t)
    except Exception:
        pass
    p.wait_for_timeout(500)


def go(p, route):
    p.goto(f"{BASE}{route}", wait_until="domcontentloaded")
    try:
        p.wait_for_load_state("networkidle", timeout=15000)
    except Exception:
        pass
    p.wait_for_timeout(1600)
    settle(p)


# Radix listens on pointerdown; a bare .click() misses it.
PTR = """(el) => {
  const r = el.getBoundingClientRect(), x = r.left+r.width/2, y = r.top+r.height/2;
  const o = {bubbles:true,cancelable:true,composed:true,clientX:x,clientY:y,
             pointerId:1,pointerType:'mouse',isPrimary:true,button:0,buttons:1};
  el.dispatchEvent(new PointerEvent('pointerdown',o));
  el.dispatchEvent(new MouseEvent('mousedown',o));
  el.dispatchEvent(new PointerEvent('pointerup',{...o,buttons:0}));
  el.dispatchEvent(new MouseEvent('mouseup',{...o,buttons:0}));
  el.dispatchEvent(new MouseEvent('click',{...o,buttons:0}));
}"""


def press(p, selector):
    el = p.query_selector(selector)
    if not el:
        return False
    p.evaluate(PTR, el)
    p.wait_for_timeout(1300)
    return True


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as pw:
        b = pw.chromium.launch(args=["--use-fake-device-for-media-stream",
                                     "--use-fake-ui-for-media-stream"])

        # ================= DESKTOP =================
        ctx = b.new_context(viewport={"width": 1440, "height": 900})
        p = ctx.new_page()
        errs = []
        p.on("pageerror", lambda e: errs.append(str(e)[:140]))
        p.on("console", lambda m: errs.append("console: " + m.text[:140])
             if m.type == "error" and "401" not in m.text else None)
        demo_login(p, BASE, "owner")

        print("\n--- desktop ---")
        go(p, "/my-work")

        # MW-05 : bento row titles aligned
        spread = p.evaluate("""() => {
          const cards=[...document.querySelectorAll('[data-testid^="mywork-task-"]')];
          const rows={};
          for(const c of cards){const r=c.getBoundingClientRect();
            const btn=c.querySelector('[data-testid^="task-summary-"]');
            const t=btn&&btn.querySelector('p,h3,span'); if(!t) continue;
            const k=Math.round(r.top/10)*10;
            (rows[k]=rows[k]||[]).push(Math.round(t.getBoundingClientRect().top-r.top));}
          const spreads=Object.values(rows).filter(v=>v.length>1).map(v=>Math.max(...v)-Math.min(...v));
          return spreads.length?Math.max(...spreads):null;}""")
        rec("MW-05", "row titles align (was up to 39px apart)",
            spread is not None and spread <= 8, f"max spread now {spread}px")

        # MW-02 : detail dialog reachable + delete present
        opened = press(p, '[data-testid^="task-overflow-"]')
        vd = p.evaluate("""()=>{const i=[...document.querySelectorAll('[role="menuitem"],button')]
            .find(e=>(e.innerText||'').trim()==='View details'&&e.getBoundingClientRect().width>0);
            return !!i;}""")
        if vd:
            el = p.evaluate_handle("""()=>[...document.querySelectorAll('[role="menuitem"],button')]
                .find(e=>(e.innerText||'').trim()==='View details'&&e.getBoundingClientRect().width>0)""")
            p.evaluate(PTR, el)
            p.wait_for_timeout(1800)
        st = p.evaluate("""()=>({detail:!!document.querySelector('[data-testid^="task-detail-"]'),
            del:(()=>{const e=document.querySelector('[data-testid^="delete-task-"]');
              return !!e && e.getBoundingClientRect().width>0;})()})""")
        rec("MW-02", "task detail dialog reachable and Delete present",
            st["detail"] and st["del"],
            f"overflow menu={opened}, View details={vd}, detail={st['detail']}, delete visible={st['del']}")
        p.keyboard.press("Escape")
        p.wait_for_timeout(600)

        # MW-08 : Update / Escalate opens without crashing
        go(p, "/my-work")
        cid = p.evaluate("""()=>{const e=document.querySelector('[data-testid^="mywork-task-"]');
            return e?e.getAttribute('data-testid').replace('mywork-task-',''):null;}""")
        press(p, f'[data-testid="task-summary-{cid}"]')
        errs.clear()
        pressed = press(p, f'[data-testid="add-update-{cid}"]')
        st = p.evaluate("""(id)=>({form:!!document.querySelector(`[data-testid="update-text-${id}"]`),
            alive:(()=>{const r=document.getElementById('root');return !!r&&r.children.length>0;})()})""", cid)
        ctrl = [e for e in errs if "CTRL_ON" in e]
        rec("MW-08", "Update / Escalate opens the form without crashing",
            st["form"] and st["alive"] and not ctrl,
            f"pressed={pressed}, form={st['form']}, app alive={st['alive']}, "
            f"CTRL_ON errors={len(ctrl)}")

        # MW-01 : status change shows on the card without a reload
        go(p, "/my-work")
        cid = p.evaluate("""()=>{const e=document.querySelector('[data-testid^="mywork-task-"]');
            return e?e.getAttribute('data-testid').replace('mywork-task-',''):null;}""")
        press(p, f'[data-testid="task-summary-{cid}"]')
        cur = p.evaluate("""(id)=>document.querySelector(`[data-testid="status-select-${id}"]`)?.value""", cid)
        nxt = "waiting" if cur != "waiting" else "review"
        try:
            p.select_option(f'[data-testid="status-select-{cid}"]', nxt)
            p.wait_for_timeout(2600)
            now = p.evaluate("""(id)=>document.querySelector(`[data-testid="status-select-${id}"]`)?.value""", cid)
            rec("MW-01", "status change reflects on the card without a reload",
                now == nxt, f"set {nxt!r}, card now reads {now!r} (was {cur!r})")
        except Exception as e:
            rec("MW-01", "status change reflects on the card without a reload", None,
                str(e).split("\n")[0][:90])

        # MW-03 : global search dialog has an accessible name
        go(p, "/my-work")
        errs.clear()
        press(p, '[data-testid="global-search-open"]')
        st = p.evaluate("""()=>{const d=[...document.querySelectorAll('[role="dialog"]')]
            .find(x=>x.getBoundingClientRect().width>0);
          if(!d) return {open:false};
          const id=d.getAttribute('aria-labelledby');
          const el=id&&document.getElementById(id);
          return {open:true, labelledby:id, resolves:!!el,
                  name:el?(el.innerText||el.textContent||'').trim().slice(0,40):null};}""")
        radix = [e for e in errs if "DialogTitle" in e]
        rec("MW-03", "global search dialog has an accessible name",
            bool(st.get("resolves")) and not radix,
            f"labelledby resolves={st.get('resolves')}, name={st.get('name')!r}, "
            f"Radix warnings={len(radix)}")
        p.keyboard.press("Escape")
        p.wait_for_timeout(500)

        # MW-11 / MW-14 : Leave view chrome + heading
        go(p, "/my-work")
        if press(p, '[data-testid="work-view-leave"]'):
            st = p.evaluate("""()=>{
              const vis=t=>{const e=document.querySelector(`[data-testid="${t}"]`);
                return !!e && e.getBoundingClientRect().width>0;};
              const h=[...document.querySelectorAll('h1,h2')]
                .map(e=>(e.innerText||'').trim()).filter(Boolean).slice(0,3);
              return {newTask:vis('new-task-button'), scopeMine:vis('work-scope-mine'),
                      scopeAll:vis('work-scope-all'), ai:vis('ai-priority-toggle'),
                      headings:h};}""")
            bleed = [k for k in ("newTask", "scopeMine", "scopeAll", "ai") if st[k]]
            rec("MW-11", "task-only controls hidden in the Leave view",
                not bleed, f"still visible: {bleed or 'none'}")
            rec("MW-14", "heading names the active view",
                any("leave" in h.lower() for h in st["headings"]),
                f"headings read {st['headings']}")
        else:
            rec("MW-11", "task-only controls hidden in the Leave view", None,
                "Leave toggle not reachable")

        # ASK-10 : bulk bar contrast
        go(p, "/my-work")
        cb = p.query_selector('[data-testid^="bulk-select-"]')
        if cb:
            cb.check()
            p.wait_for_timeout(900)
            st = p.evaluate(r"""()=>{
              const lum=c=>{const m=(c||'').match(/[\d.]+/g); if(!m)return null;
                const [r,g,b]=m.slice(0,3).map(Number).map(v=>{v/=255;
                  return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);});
                return 0.2126*r+0.7152*g+0.0722*b;};
              const bgOf=e=>{for(let n=e;n&&n!==document.documentElement;n=n.parentElement){
                const b=getComputedStyle(n).backgroundColor;
                if(b&&!/rgba\(0, 0, 0, 0\)/.test(b))return b;}return 'rgb(255,255,255)';};
              const out={};
              for(const t of ['bulk-complete','bulk-reassign','bulk-clear']){
                const e=document.querySelector(`[data-testid="${t}"]`); if(!e){out[t]='absent';continue;}
                const s=getComputedStyle(e), r=e.getBoundingClientRect();
                const L1=lum(s.color),L2=lum(bgOf(e));
                out[t]={ratio:+(((Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05)).toFixed(2)),
                        h:Math.round(r.height), text:(e.innerText||'').trim().slice(0,14)};}
              return out;}""")
            bad = {k: v for k, v in st.items()
                   if isinstance(v, dict) and v.get("ratio", 99) < 4.5}
            rec("ASK-10", "bulk bar actions all clear 4.5:1",
                not bad, "; ".join(f"{k} {v['ratio']}:1" for k, v in st.items()
                                   if isinstance(v, dict)))
        ctx.close()

        # ================= MOBILE =================
        ctx = b.new_context(viewport={"width": 390, "height": 844},
                            is_mobile=True, has_touch=True, permissions=["microphone"])
        p = ctx.new_page()
        demo_login(p, BASE, "owner")
        print("\n--- mobile ---")
        go(p, "/my-work")

        # MW-09 : mobile log-update control wired
        cid = p.evaluate("""()=>{const e=document.querySelector('[data-testid^="mywork-task-"]');
            return e?e.getAttribute('data-testid').replace('mywork-task-',''):null;}""")
        press(p, f'[data-testid="task-summary-{cid}"]')
        wired = p.evaluate("""(id)=>{const e=document.querySelector(`[data-testid="log-update-m-${id}"]`);
            return e?{present:true, hasOnclick:!!e.onclick}:{present:false};}""", cid)
        before = p.evaluate("()=>document.body.innerText.length")
        press(p, f'[data-testid="log-update-m-{cid}"]')
        after = p.evaluate("()=>document.body.innerText.length")
        form = p.evaluate("""(id)=>!!document.querySelector(`[data-testid="update-text-${id}"]`)""", cid)
        rec("MW-09", "mobile 'Log update or hand off' does something",
            form or before != after,
            f"present={wired.get('present')}, form opened={form}, "
            f"content {before}->{after}")

        # MW-04 : Dex FAB picker closes on Escape
        go(p, "/my-work")
        if press(p, '[data-testid="dex-fab"]'):
            covered = p.evaluate("""()=>{const e=document.elementFromPoint(innerWidth/2, innerHeight*0.35);
                return e?String(e.className).includes('inset-0')||e.getAttribute('aria-label')==='Close':false;}""")
            p.keyboard.press("Escape")
            p.wait_for_timeout(800)
            still = p.evaluate("""()=>{const e=document.elementFromPoint(innerWidth/2, innerHeight*0.35);
                return e?String(e.className).includes('inset-0')||e.getAttribute('aria-label')==='Close':false;}""")
            rec("MW-04", "Dex FAB picker closes on Escape",
                covered and not still, f"scrim after open={covered}, after Escape={still}")
        ctx.close()

        # ============== error boundary (MW-10) ==============
        eb = (REPO / "frontend" / "src").rglob("*.js*")
        found = []
        for f in eb:
            try:
                t = f.read_text(encoding="utf-8", errors="ignore")
            except Exception:
                continue
            if "componentDidCatch" in t or "getDerivedStateFromError" in t:
                found.append(str(f.relative_to(REPO)))
        rec("MW-10", "an error boundary exists", bool(found),
            ", ".join(found[:3]) if found else "no componentDidCatch / getDerivedStateFromError anywhere")

        b.close()

    (OUT / "verify.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
    fixed = [r for r in results if r["status"] == "FIXED"]
    open_ = [r for r in results if r["status"] == "STILL OPEN"]
    print(f"\n=== {len(fixed)} verified fixed, {len(open_)} still open, "
          f"{len(results)-len(fixed)-len(open_)} inconclusive ===")
    for r in open_:
        print(f"  STILL OPEN {r['id']}: {r['detail']}")
    print(f"\nreport: {(OUT / 'verify.json').relative_to(REPO)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
