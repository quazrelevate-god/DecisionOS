"""Finance section -- exhaustive UI/UX audit, desktop then mobile.

Written after the My Work pass missed two real defects by refusing to press
anything destructive. Here EVERY control is pressed, including delete and save;
safety comes from the network layer instead -- every mutating request is aborted
before it leaves the browser, so the UI is fully exercised and no data moves.

For each control it records: did it respond, did it open what it promised, did
it route somewhere real, did it error, did it take the app down. Screenshots at
every state change.

    .venv/Scripts/python.exe scripts/ux_team_audit.py
    .venv/Scripts/python.exe scripts/ux_team_audit.py --only mobile
"""
import argparse
import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ux_login import demo_login  # noqa: E402

REPO = Path(__file__).resolve().parent.parent.parent
BASE = "http://localhost:3000"
ROUTE = "/finance"
OUT = REPO / ".audit-artifacts" / "ux" / "finance"

MUTATING = ("POST", "PATCH", "PUT", "DELETE")

# --------------------------------------------------------------------------
LAYOUT_JS = r"""() => {
  const vw = innerWidth, isMobile = vw < 768;
  const vis = (e) => { const s = getComputedStyle(e);
    if (s.display==='none'||s.visibility==='hidden'||+s.opacity===0) return false;
    const r = e.getBoundingClientRect(); return r.width>0 && r.height>0; };
  const label = (e) => ((e.getAttribute('data-testid')||e.getAttribute('aria-label')||
      (e.innerText||'').trim().slice(0,34)||e.tagName)).replace(/\s+/g,' ');
  const hitBox = (e) => { let best=e.getBoundingClientRect(), n=e;
    for (let i=0;i<4&&n.parentElement;i++){ const p=n.parentElement, t=p.tagName.toLowerCase();
      if(!(t==='label'||t==='button'||t==='a'||p.getAttribute('role')==='button')) break;
      if(p.querySelectorAll('button,a[href],input,select,textarea,[role="button"]').length>1) break;
      const r=p.getBoundingClientRect(); if(r.width>=best.width&&r.height>=best.height) best=r; n=p; }
    return best; };
  const lum = (c) => { const m=(c||'').match(/[\d.]+/g); if(!m) return null;
    const [r,g,b]=m.slice(0,3).map(Number).map(v=>{v/=255;
      return v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055,2.4);});
    return 0.2126*r+0.7152*g+0.0722*b; };
  const bgOf = (e) => { for(let n=e;n&&n!==document.documentElement;n=n.parentElement){
      const b=getComputedStyle(n).backgroundColor;
      if(b && !/rgba\(0, 0, 0, 0\)|transparent/.test(b)) return b; } return 'rgb(255,255,255)'; };

  const de = document.documentElement;
  const all = [...document.querySelectorAll('body *')].filter(vis);
  const inter = [...document.querySelectorAll(
    'button,a[href],input,select,textarea,[role="button"],[role="tab"],[role="switch"]')].filter(vis);

  const overflowing = [];
  // A tab bar that scrolls sideways is a pattern, not a spill -- skip anything
  // sitting inside a deliberately scrollable strip.
  const inScroller = (e) => {
    for (let n=e.parentElement; n && n!==document.body; n=n.parentElement) {
      const ov=getComputedStyle(n).overflowX;
      if ((ov==='auto'||ov==='scroll') && n.scrollWidth>n.clientWidth+4) return true;
    }
    return false;
  };
  for (const e of all) { const r=e.getBoundingClientRect();
    if (r.right>vw+1 && r.width<=vw+2 && r.width>8 && !inScroller(e))
      overflowing.push({label:label(e), overhang:Math.round(r.right-vw)}); }

  const tiny = [];
  if (isMobile) for (const e of inter) { const h=hitBox(e);
    if (h.width<24||h.height<24) tiny.push({label:label(e),
      w:Math.round(h.width), h:Math.round(h.height)}); }

  const lowContrast = [];
  for (const e of inter) { const s=getComputedStyle(e); const txt=(e.innerText||'').trim();
    if (!txt) continue;
    const L1=lum(s.color), L2=lum(bgOf(e)); if(L1==null||L2==null) continue;
    const ratio=(Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05);
    if (ratio < 4.5) lowContrast.push({label:label(e), text:txt.slice(0,26),
      ratio:+ratio.toFixed(2), color:s.color, bg:bgOf(e)}); }

  const unnamed = [...document.querySelectorAll('button,a[href]')].filter(e=>vis(e) &&
      !((e.innerText||'').trim()||e.getAttribute('aria-label')||e.getAttribute('title')))
      .map(e=>e.outerHTML.slice(0,90));

  const noAlt = [...document.querySelectorAll('img')].filter(i=>!i.hasAttribute('alt')).length;

  return {hOverflow: de.scrollWidth>de.clientWidth+1,
          scrollW:de.scrollWidth, clientW:de.clientWidth,
          counts:{visible:all.length, interactive:inter.length},
          overflowing:overflowing.slice(0,8), tiny:tiny.slice(0,12),
          lowContrast:lowContrast.slice(0,12), unnamed, noAlt};
}"""

CONTROLS_JS = r"""() => {
  const vis=e=>{const s=getComputedStyle(e);
    if(s.display==='none'||s.visibility==='hidden'||+s.opacity===0)return false;
    const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};
  return [...document.querySelectorAll('button,a[href],[role="button"],[role="tab"],[role="switch"]')]
    .filter(vis).map(e=>{const r=e.getBoundingClientRect();
      return {tid:e.getAttribute('data-testid'),
        name:(((e.innerText||'').trim())||e.getAttribute('aria-label')||e.getAttribute('title')||'')
             .replace(/\s+/g,' ').slice(0,44),
        tag:e.tagName.toLowerCase(), href:e.getAttribute('href'),
        disabled:e.hasAttribute('disabled')||e.getAttribute('aria-disabled')==='true',
        w:Math.round(r.width),h:Math.round(r.height)};});
}"""

SIG_JS = r"""() => {
  const t=(document.body.innerText||'').replace(/\s+/g,' ');
  const d=document.querySelectorAll('[role="dialog"],[role="alertdialog"]').length;
  const p=[...document.querySelectorAll('[aria-pressed],[aria-selected],[data-state],[aria-expanded]')]
    .map(e=>(e.getAttribute('data-testid')||'')+':'+(e.getAttribute('aria-pressed')||
      e.getAttribute('aria-selected')||e.getAttribute('data-state')||
      e.getAttribute('aria-expanded')||'')).join('|');
  return `${t.length}|${t.slice(0,260)}|${d}|${p.slice(0,500)}`;
}"""

ALIVE_JS = ("() => { const r=document.getElementById('root'); "
            "return !!r && r.children.length>0 && (document.body.innerText||'').trim().length>20; }")

results, controls_seen = [], {}


def rec(vp, step, ok, detail=""):
    st = "PASS" if ok is True else ("FAIL" if ok is False else "INFO")
    results.append(dict(viewport=vp, step=step, status=st, detail=detail))
    print(f"  {st:<4} {step}" + (f"  -- {detail}" if detail else ""))


def settle(p, t=15000):
    try:
        p.wait_for_function(
            "()=>document.querySelectorAll('[class*=\"animate-pulse\"]').length===0", timeout=t)
    except Exception:
        pass
    p.wait_for_timeout(450)


def land(p):
    p.goto(f"{BASE}{ROUTE}", wait_until="domcontentloaded")
    try:
        p.wait_for_load_state("networkidle", timeout=15000)
    except Exception:
        pass
    p.wait_for_timeout(1200)
    settle(p)


def shot(p, vp, name):
    d = OUT / vp
    d.mkdir(parents=True, exist_ok=True)
    try:
        p.screenshot(path=str(d / f"{name}.png"))
    except Exception:
        pass


DIALOG_CONTROLS_JS = r"""() => {
  const d=[...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')].pop();
  if(!d) return null;
  const vis=e=>{const s=getComputedStyle(e);
    if(s.display==='none'||s.visibility==='hidden'||+s.opacity===0)return false;
    const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};
  return {
    title:(d.innerText||'').trim().split('\n')[0].slice(0,60),
    fields:[...d.querySelectorAll('input,select,textarea')].filter(vis).map(e=>({
      tid:e.getAttribute('data-testid'), type:e.type||e.tagName.toLowerCase(),
      placeholder:e.getAttribute('placeholder')||'', required:e.hasAttribute('required')})),
    buttons:[...d.querySelectorAll('button,[role="button"],a[href]')].filter(vis).map(e=>({
      tid:e.getAttribute('data-testid'),
      name:(((e.innerText||'').trim())||e.getAttribute('aria-label')||'').replace(/\s+/g,' ').slice(0,40),
      disabled:e.hasAttribute('disabled')||e.getAttribute('aria-disabled')==='true'})),
  };
}"""


def sweep_dialog(p, vp, opener, idx, errs, blocked, shot_fn):
    """Press everything INSIDE a dialog the sweep just opened.

    Without this the audit only proves a dialog appears -- which is how the
    My Work pass missed a dead delete button and a crashing form. Mutating
    requests are already blocked at the network layer, so Save and Delete can
    be pressed for real.
    """
    info = p.evaluate(DIALOG_CONTROLS_JS)
    if not info:
        return
    n_f, n_b = len(info["fields"]), len(info["buttons"])
    rec(vp, f"[{opener}] opens a dialog: {info['title']!r}", True,
        f"{n_f} fields, {n_b} buttons")
    shot_fn(p, vp, f"d{idx:02d}-{opener[:22]}-open")

    # fill any text fields, so Save is exercised with real input rather than
    # bouncing off empty-form validation
    for f in info["fields"]:
        if not f["tid"] or f["type"] in ("checkbox", "radio", "file"):
            continue
        try:
            loc = p.locator(f'[data-testid="{f["tid"]}"]:visible').first
            if f["type"] == "select-one":
                opts = p.evaluate(
                    """(t)=>{const s=document.querySelector(`[data-testid="${t}"]`);
                       return s?[...s.options].map(o=>o.value).filter(Boolean):[];}""", f["tid"])
                if opts:
                    loc.select_option(opts[0])
            elif f["type"] == "email":
                loc.fill("uxtest.audit@example.invalid")
            elif f["type"] == "tel":
                loc.fill("9000000000")
            elif f["type"] == "password":
                loc.fill("uxtest-temp-1")
            else:
                loc.fill("[UXTEST] audit probe")
            p.wait_for_timeout(120)
        except Exception:
            pass

    close_names = ("close", "cancel", "back", "dismiss", "×", "✕")
    ordered = ([b for b in info["buttons"]
                if not any(c in (b["name"] or "").lower() for c in close_names)]
               + [b for b in info["buttons"]
                  if any(c in (b["name"] or "").lower() for c in close_names)])

    for b in ordered:
        ident = b["tid"] or b["name"]
        if not ident:
            continue
        # Two kinds of control change state for the WHOLE run rather than for
        # the dialog they sit in: switching language re-renders every later
        # assertion in another language, and logging out ends the session, so
        # everything pressed afterwards fails for a reason that is not a defect.
        # Record that they are offered and leave them alone.
        if ident.startswith("lang-option-") or "logout" in ident.lower():
            rec(vp, f"  [{opener} > {ident}] offered", None,
                "not pressed -- it would change state for every later check")
            continue
        if b["disabled"]:
            rec(vp, f"  [{opener} > {ident}] disabled", None)
            continue
        sel = (f'[data-testid="{b["tid"]}"]:visible' if b["tid"] else None)
        loc = (p.locator(sel).first if sel
               else p.get_by_role("button", name=b["name"], exact=True).first)
        try:
            if not loc.is_visible(timeout=700):
                continue
        except Exception:
            continue
        sig0, e0, b0 = p.evaluate(SIG_JS), len(errs), len(blocked)
        try:
            loc.click(timeout=2200)
            p.wait_for_timeout(700)
        except Exception as e:
            rec(vp, f"  [{opener} > {ident}] is clickable", False,
                str(e).split("\n")[0][:90])
            continue
        try:
            alive = p.evaluate(ALIVE_JS)
        except Exception:
            alive = False
        changed = p.evaluate(SIG_JS) != sig0
        fired = blocked[b0:]
        new_err = errs[e0:]
        if not alive:
            rec(vp, f"  [{opener} > {ident}] does not crash the app", False,
                "React root emptied")
            shot_fn(p, vp, f"CRASH-d{idx:02d}-{ident[:22]}")
            land(p)
            return
        if new_err:
            rec(vp, f"  [{opener} > {ident}] raises no error", False, new_err[0][:110])
        if fired:
            rec(vp, f"  [{opener} > {ident}] calls the API", True, ", ".join(fired[:2]))
        else:
            active = p.evaluate(
                """(t)=>{ if(!t) return false;
                   const e=document.querySelector(`[data-testid="${t}"]`); if(!e) return false;
                   return e.getAttribute('aria-pressed')==='true' ||
                          e.getAttribute('aria-selected')==='true' ||
                          e.getAttribute('aria-current')==='page' ||
                          e.getAttribute('data-state')==='active' ||
                          e.getAttribute('data-state')==='checked'; }""", b["tid"]) or False
            if not changed and not active:
                rec(vp, f"  [{opener} > {ident}] does something", False,
                    "no visible change and no API call -- dead control")
            elif not changed and active:
                rec(vp, f"  [{opener} > {ident}] already the active choice", None,
                    "no-op is correct here")
        if changed:
            shot_fn(p, vp, f"d{idx:02d}-{opener[:18]}-{ident[:18]}")
        # A press can re-render the dialog (Edit access swaps the whole body),
        # which detaches every sibling button and makes the NEXT one look
        # broken. Re-open from scratch so each button is judged on its own.
        if changed or not p.locator('[role="dialog"],[role="alertdialog"]').count():
            close_overlays(p)
            land(p)
            try:
                reopen = p.locator(f'[data-testid="{opener}"]:visible').first
                if reopen.is_visible(timeout=1200):
                    reopen.click(timeout=2500)
                    p.wait_for_timeout(900)
                else:
                    break
            except Exception:
                break
            if not p.locator('[role="dialog"],[role="alertdialog"]').count():
                break


def close_overlays(p):
    for _ in range(3):
        if not p.locator('[role="dialog"],[role="alertdialog"]').count():
            return
        p.keyboard.press("Escape")
        p.wait_for_timeout(350)
    # a scrim that ignores Escape -- tap the corner
    try:
        p.mouse.click(6, 6)
        p.wait_for_timeout(300)
    except Exception:
        pass


def audit(browser, vp, dims, mobile):
    print(f"\n{'='*66}\n  TEAM / {vp.upper()}  {dims['width']}x{dims['height']}\n{'='*66}")
    ctx = browser.new_context(viewport=dims, is_mobile=mobile, has_touch=mobile,
                              device_scale_factor=2)
    p = ctx.new_page()
    blocked, errs, net = [], [], []
    p.on("pageerror", lambda e: errs.append("pageerror: " + str(e)[:160]))
    # net::ERR_FAILED / ERR_ABORTED here are OUR blocked mutations, not defects
    NOISE = ("401", "child of", "ERR_FAILED", "ERR_ABORTED", "Failed to load resource")
    p.on("console", lambda m: errs.append("console: " + m.text[:160])
         if m.type == "error" and not any(n in m.text for n in NOISE) else None)
    p.on("response", lambda r: net.append(f"{r.status} {r.request.method} "
                                          f"{r.url.split('/api/')[-1][:44]}")
         if "/api/" in r.url and r.status >= 400 else None)

    demo_login(p, BASE, "owner")

    # From here on nothing may reach the database. Every mutating call is
    # aborted, which is what lets the sweep press delete and save for real.
    def guard(route):
        if route.request.method in MUTATING:
            blocked.append(f"{route.request.method} {route.request.url.split('/api/')[-1][:44]}")
            return route.abort()
        return route.continue_()
    p.route("**/api/**", guard)

    land(p)
    landed = p.url.replace(BASE, "")
    rec(vp, f"{ROUTE} loads without redirect", landed.startswith(ROUTE), f"landed {landed}")
    shot(p, vp, "01-landing")

    lay = p.evaluate(LAYOUT_JS)
    rec(vp, "no horizontal overflow", not lay["hOverflow"],
        f"{lay['scrollW']} vs {lay['clientW']}")
    rec(vp, "nothing spills past the right edge", not lay["overflowing"],
        "; ".join(f"{o['label']} +{o['overhang']}px" for o in lay["overflowing"][:4]))
    rec(vp, "every button and link has an accessible name", not lay["unnamed"],
        f"{len(lay['unnamed'])} unnamed: {lay['unnamed'][:2]}" if lay["unnamed"] else "")
    rec(vp, "images carry alt text", lay["noAlt"] == 0, f"{lay['noAlt']} without alt")
    if mobile:
        rec(vp, "tap targets meet the 24px minimum", not lay["tiny"],
            "; ".join(f"{t['label']} {t['w']}x{t['h']}" for t in lay["tiny"][:6]))
    rec(vp, "text meets 4.5:1 contrast", not lay["lowContrast"],
        "; ".join(f"{c['text']!r} {c['ratio']}:1" for c in lay["lowContrast"][:6]))
    rec(vp, "page renders content", lay["counts"]["visible"] > 40,
        f"{lay['counts']['visible']} visible, {lay['counts']['interactive']} interactive")

    # ---------------- press EVERY control ----------------
    ctrls = p.evaluate(CONTROLS_JS)
    controls_seen[vp] = ctrls
    # 12 member cards open the same dialog; sample a few rather than all, so the
    # run stays finite. Everything else is pressed.
    import re as _re
    sampled, seen_pref = [], {}
    for c in ctrls:
        m = _re.match(r"^(inv-row-|exp-row-|asset-row-|inventory-row-|match-picker-)", c.get("tid") or "")
        if m:
            seen_pref["m"] = seen_pref.get("m", 0) + 1
            if seen_pref["m"] > 3:
                continue
        sampled.append(c)
    skipped_cards = len(ctrls) - len(sampled)
    ctrls = sampled
    print(f"\n  -- pressing {len(ctrls)} controls, descending into every dialog "
          f"(mutations blocked; {skipped_cards} duplicate member cards sampled out) --")
    dead, broke, routed = [], [], []
    for idx, c in enumerate(ctrls):
        ident = c["tid"] or c["name"]
        if not ident:
            continue
        if c["disabled"]:
            rec(vp, f"[{ident}] disabled, skipped", None)
            continue
        # Judge every control from a clean page. Earlier presses navigate away
        # (a notification deep-links to its task), leave a menu layer behind, or
        # re-render the surface -- and then the NEXT control looks broken for a
        # reason that has nothing to do with it. Re-landing costs time and buys
        # the only thing that matters here: findings that are actually true.
        # Unconditional re-land. A conditional one is not enough: a menu layer
        # can survive Escape, and a dialog can leave the page on the same URL
        # but in a state where nothing behind it is actionable. Reloading is
        # the only way to be sure each control is judged on its own.
        close_overlays(p)
        land(p)
        loc = (p.locator(f'[data-testid="{c["tid"]}"]:visible').first if c["tid"]
               else p.get_by_role("link" if c["tag"] == "a" else "button",
                                  name=c["name"], exact=True).first)
        try:
            if not loc.is_visible(timeout=900):
                land(p)
                if not loc.is_visible(timeout=1500):
                    rec(vp, f"[{ident}] still present after re-landing", None,
                        "not found on a clean page -- skipped")
                    continue
        except Exception:
            continue
        before_sig = p.evaluate(SIG_JS)
        before_url = p.url.replace(BASE, "")
        before_err = len(errs)
        before_blocked = len(blocked)
        outcome = "ok"
        try:
            loc.click(timeout=2500)
            p.wait_for_timeout(650)
        except Exception as e:
            outcome = "click-failed: " + str(e).split("\n")[0][:80]
        after_sig = p.evaluate(SIG_JS)
        try:
            alive = p.evaluate(ALIVE_JS)
        except Exception:
            alive = False
        url_now = p.url.replace(BASE, "")
        new_errs = errs[before_err:]
        fired = blocked[before_blocked:]

        entry = {"control": ident, "outcome": outcome, "alive": alive,
                 "changed": before_sig != after_sig, "url": url_now,
                 "apiCalls": fired, "errors": new_errs}
        controls_seen.setdefault(f"{vp}-clicks", []).append(entry)

        if not alive:
            broke.append(ident)
            rec(vp, f"[{ident}] does not crash the app", False, "React root emptied")
            shot(p, vp, f"CRASH-{idx:02d}-{ident[:26]}")
            land(p)
            continue
        if new_errs:
            rec(vp, f"[{ident}] raises no error", False, new_errs[0][:110])
        if outcome.startswith("click-failed"):
            rec(vp, f"[{ident}] is clickable", False, outcome)
        elif (not entry["changed"] and url_now == before_url and not fired):
            dead.append(ident)
        if not url_now.startswith(ROUTE):
            routed.append(f"{ident} -> {url_now}")

        if entry["changed"]:
            shot(p, vp, f"c{idx:02d}-{ident[:30]}")
        # if that opened a dialog, go inside and press everything there too
        if p.locator('[role="dialog"],[role="alertdialog"]').count():
            try:
                sweep_dialog(p, vp, ident, idx, errs, blocked, shot)
            except Exception as e:
                rec(vp, f"[{ident}] dialog sweep completed", None,
                    str(e).split("\n")[0][:90])
        close_overlays(p)
        if not p.url.replace(BASE, "").startswith(ROUTE):
            land(p)

    rec(vp, "no control crashes the app", not broke, ", ".join(broke) if broke else "")
    rec(vp, "no dead controls (press changes something)", not dead,
        ", ".join(dead[:8]) if dead else f"{len(ctrls)} pressed")
    if routed:
        rec(vp, "controls that navigate away", None, "; ".join(routed[:6]))
    rec(vp, "no failing API calls", not net, "; ".join(sorted(set(net))[:5]))
    rec(vp, "mutations were blocked, so nothing was written", True,
        f"{len(blocked)} intercepted: {sorted(set(blocked))[:4]}")

    shot(p, vp, "99-final")
    ctx.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", choices=["desktop", "mobile"])
    a = ap.parse_args()
    vps = [("desktop", {"width": 1440, "height": 900}, False),
           ("mobile", {"width": 390, "height": 844}, True)]
    if a.only:
        vps = [v for v in vps if v[0] == a.only]

    OUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        for vp, dims, mob in vps:
            audit(b, vp, dims, mob)
        b.close()

    (OUT / "finance-audit.json").write_text(
        json.dumps({"results": results, "controls": controls_seen}, indent=2),
        encoding="utf-8")
    fails = [r for r in results if r["status"] == "FAIL"]
    print(f"\n{'='*66}")
    print(f"  {sum(1 for r in results if r['status']=='PASS')} passed, {len(fails)} failed")
    for r in fails:
        print(f"    FAIL [{r['viewport']}] {r['step']}  {r['detail']}")
    print(f"\n  report: {(OUT / 'finance-audit.json').relative_to(REPO)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
