"""My Work sub-views: Workflows and Leave.

The main audit only proved the two toggles switch surface. This sweeps what is
INSIDE them - every control, on both viewports - and looks for the thing a
reviewer is really asking about: controls that do nothing, controls that say the
same thing twice, and chrome the embedded view inherited from its standalone
page and does not need here.

Read-only: destructive controls are catalogued, never fired.

    .venv/Scripts/python.exe scripts/ux_subviews_mywork.py
"""
import json
import re
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

from ux_login import demo_login

REPO = Path(__file__).resolve().parent.parent.parent
BASE = "http://localhost:3000"
OUT = REPO / ".audit-artifacts" / "ux" / "my-work" / "subviews"

DESTRUCTIVE = re.compile(
    r"(delete|remove|approve|reject|cancel|submit|apply|save|create|new|advance|"
    r"complete|escalate|assign|start|stop|archive|decline|grant)", re.I)

SIG = r"""() => {
  const t=(document.body.innerText||'').replace(/\s+/g,' ');
  const d=document.querySelectorAll('[role="dialog"]').length;
  const p=[...document.querySelectorAll('[aria-pressed],[aria-selected],[data-state]')]
    .map(e=>(e.getAttribute('data-testid')||'')+':'+(e.getAttribute('aria-pressed')||
      e.getAttribute('aria-selected')||e.getAttribute('data-state')||'')).join('|');
  return `${t.length}:${t.slice(0,300)}:${d}:${p.slice(0,400)}`;
}"""

CONTROLS = r"""() => {
  const vis=e=>{const s=getComputedStyle(e);
    if(s.display==='none'||s.visibility==='hidden'||+s.opacity===0)return false;
    const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};
  // only what is inside the section body, not the global shell
  const scope = document.querySelector('[data-testid="workflows-hub"]')
             || document.querySelector('main') || document.body;
  return [...scope.querySelectorAll('button,a[href],[role="button"],[role="tab"],[role="switch"],select')]
    .filter(vis).map(e=>{
      const r=e.getBoundingClientRect();
      return {tid:e.getAttribute('data-testid'),
        name:(((e.innerText||'').trim())||e.getAttribute('aria-label')||e.getAttribute('title')||'')
             .replace(/\s+/g,' ').slice(0,44),
        tag:e.tagName.toLowerCase(),
        disabled:e.hasAttribute('disabled')||e.getAttribute('aria-disabled')==='true',
        w:Math.round(r.width),h:Math.round(r.height),y:Math.round(r.top)};});
}"""

LAYOUT = r"""() => {
  const de=document.documentElement;
  const vis=e=>{const s=getComputedStyle(e);
    if(s.display==='none'||s.visibility==='hidden'||+s.opacity===0)return false;
    const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};
  const over=[];
  for(const e of [...document.querySelectorAll('body *')].filter(vis)){
    const r=e.getBoundingClientRect();
    if(r.right>innerWidth+1 && r.width<=innerWidth+2 && r.width>8)
      over.push({label:(e.getAttribute('data-testid')||(e.innerText||'').trim().slice(0,30)||e.tagName),
                 overhang:Math.round(r.right-innerWidth)});
  }
  const unnamed=[...document.querySelectorAll('button,a[href]')].filter(e=>vis(e) &&
    !((e.innerText||'').trim()||e.getAttribute('aria-label')||e.getAttribute('title')))
    .map(e=>e.outerHTML.slice(0,80));
  return {hOverflow: de.scrollWidth>de.clientWidth+1,
          scrollW:de.scrollWidth, clientW:de.clientWidth,
          overflowing:over.slice(0,8), unnamed};
}"""

results = []


def rec(view, vp, step, ok, detail=""):
    s = "PASS" if ok is True else ("FAIL" if ok is False else "INFO")
    results.append(dict(view=view, viewport=vp, step=step, status=s, detail=detail))
    print(f"  {s:<4} [{view}/{vp}] {step}" + (f"  -- {detail}" if detail else ""))


def settle(p, t=20000):
    try:
        p.wait_for_function(
            "() => document.querySelectorAll('[class*=\"animate-pulse\"]').length === 0",
            timeout=t)
    except Exception:
        pass
    p.wait_for_timeout(500)


def login(p):
    demo_login(p, BASE, "owner")


def work(p):
    p.goto(f"{BASE}/my-work", wait_until="domcontentloaded")
    try:
        p.wait_for_load_state("networkidle", timeout=15000)
    except Exception:
        pass
    p.wait_for_timeout(1300)
    settle(p)


def audit_view(p, view, vp, errs):
    """Switch into a sub-view and sweep it."""
    work(p)
    toggle = f"work-view-{view}"
    loc = p.locator(f'[data-testid="{toggle}"]:visible')
    if not loc.count():
        rec(view, vp, f"the {view} toggle is reachable", False,
            f"{toggle} not visible at this viewport")
        return
    rec(view, vp, f"the {view} toggle is reachable", True)
    loc.first.click()
    p.wait_for_timeout(1800)
    settle(p)

    OUT.mkdir(parents=True, exist_ok=True)
    p.screenshot(path=str(OUT / f"{view}-{vp}.png"))

    body = p.evaluate("() => (document.body.innerText||'').trim().length")
    rec(view, vp, f"the {view} view renders content", body > 150, f"{body} chars")

    lay = p.evaluate(LAYOUT)
    rec(view, vp, "no horizontal overflow", not lay["hOverflow"],
        f"{lay['scrollW']} vs {lay['clientW']}")
    if lay["overflowing"]:
        rec(view, vp, "nothing spills past the right edge", False,
            "; ".join(f"{o['label']} +{o['overhang']}px" for o in lay["overflowing"][:4]))
    else:
        rec(view, vp, "nothing spills past the right edge", True)
    rec(view, vp, "every button and link has an accessible name",
        not lay["unnamed"], f"{len(lay['unnamed'])} unnamed" if lay["unnamed"] else "")

    ctrls = p.evaluate(CONTROLS)
    rec(view, vp, "controls present", True, f"{len(ctrls)} interactive")

    # --- duplicates: the same visible label offered more than once ---
    names = {}
    for c in ctrls:
        n = (c["name"] or "").strip().lower()
        if n:
            names.setdefault(n, []).append(c)
    dupes = {n: v for n, v in names.items() if len(v) > 1}
    if dupes:
        rec(view, vp, "no control is offered twice under the same label", False,
            "; ".join(f"{n!r} x{len(v)}" for n, v in list(dupes.items())[:5]))
    else:
        rec(view, vp, "no control is offered twice under the same label", True)

    # --- dead controls: click the safe ones, see if anything changes ---
    dead, fired, skipped = [], 0, 0
    for c in ctrls:
        ident = c["tid"] or c["name"]
        if not ident or c["disabled"]:
            continue
        if DESTRUCTIVE.search(f"{c['tid'] or ''} {c['name'] or ''}"):
            skipped += 1
            continue
        sel = (f'[data-testid="{c["tid"]}"]:visible' if c["tid"]
               else None)
        loc2 = (p.locator(sel).first if sel
                else p.get_by_role("button", name=c["name"], exact=True).first)
        try:
            if not loc2.is_visible(timeout=800):
                continue
            before = p.evaluate(SIG)
            n_err = len(errs)
            loc2.click(timeout=2500)
            p.wait_for_timeout(700)
            after = p.evaluate(SIG)
            alive = p.evaluate(
                "() => { const r=document.getElementById('root'); return !!r && r.children.length>0; }")
            if not alive:
                rec(view, vp, f"clicking {ident} does not crash the app", False,
                    "React root emptied")
                work(p)
                p.locator(f'[data-testid="{toggle}"]:visible').first.click()
                p.wait_for_timeout(1500)
                settle(p)
                continue
            if len(errs) > n_err:
                rec(view, vp, f"clicking {ident} raises no error", False, errs[-1][:90])
            fired += 1
            if before == after and p.url.endswith("/my-work"):
                already = p.evaluate(
                    """(id)=>{const e=id&&document.querySelector(`[data-testid="${id}"]`);
                       return !!e && (e.getAttribute('aria-pressed')==='true'||
                         e.getAttribute('aria-selected')==='true'||
                         e.getAttribute('data-state')==='active'||
                         e.getAttribute('aria-current')==='page');}""", c["tid"])
                if not already:
                    dead.append(ident)
            p.keyboard.press("Escape")
            p.wait_for_timeout(150)
            if not p.url.endswith("/my-work"):
                work(p)
                p.locator(f'[data-testid="{toggle}"]:visible').first.click()
                p.wait_for_timeout(1500)
                settle(p)
        except Exception:
            pass
    rec(view, vp, "no dead controls (click changes something)", not dead,
        ", ".join(dead[:6]) if dead else f"{fired} exercised, {skipped} destructive skipped")

    # catalogue what we refused to press, so the report is honest about coverage
    if skipped:
        rec(view, vp, "destructive controls catalogued, not fired", None,
            f"{skipped} left for manual review")
    return ctrls


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    catalogue = {}
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        for vp, dims, mob in (("desktop", {"width": 1440, "height": 900}, False),
                              ("mobile", {"width": 390, "height": 844}, True)):
            ctx = b.new_context(viewport=dims, is_mobile=mob, has_touch=mob)
            p = ctx.new_page()
            errs = []
            p.on("pageerror", lambda e: errs.append(str(e)[:160]))
            p.on("console", lambda m: errs.append(m.text[:160]) if m.type == "error"
                 and "401" not in m.text and "child of" not in m.text else None)
            login(p)
            for view in ("workflows", "leave"):
                print(f"\n--- {view} / {vp} ---")
                c = audit_view(p, view, vp, errs)
                catalogue[f"{view}-{vp}"] = c
            ctx.close()
        b.close()

    (OUT / "subviews.json").write_text(
        json.dumps({"results": results, "controls": catalogue}, indent=2), encoding="utf-8")

    print("\n=== control inventory ===")
    for k, v in catalogue.items():
        if not v:
            continue
        print(f"\n{k} ({len(v)}):")
        for c in v:
            flag = " [disabled]" if c["disabled"] else ""
            print(f"   {str(c['tid'] or '-'):<34} {c['name'][:40]!r}{flag}")

    f = [r for r in results if r["status"] == "FAIL"]
    print(f"\n=== {sum(1 for r in results if r['status']=='PASS')} passed, {len(f)} failed ===")
    for r in f:
        print(f"  FAIL [{r['view']}/{r['viewport']}] {r['step']}  {r['detail']}")
    print(f"\nreport: {(OUT / 'subviews.json').relative_to(REPO)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
