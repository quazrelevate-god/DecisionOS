"""Interactive UI/UX audit -- drives a real signed-in browser through one
section at a time, on mobile AND desktop, and reports what a careful reviewer
would catch by hand: layout defects, dead controls, broken routes, console /
network errors, and unreachable state.

    .venv/Scripts/python.exe scripts/ux_audit.py my-work
    .venv/Scripts/python.exe scripts/ux_audit.py my-work --only mobile

Needs both servers up (backend :8001, frontend :3000). Screenshots + a JSON
report land in <repo>/.audit-artifacts/ux/<section>/.

Safety: the click sweep NEVER fires a destructive control (delete / approve /
reject / complete / send / pay / logout ...). Those are reported as
"skipped:destructive" so a human decides -- the dev DB is shared.
"""
import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

from playwright.sync_api import sync_playwright

from ux_login import demo_login

REPO = Path(__file__).resolve().parent.parent.parent
BASE = "http://localhost:3000"

SECTIONS = {
    "my-work": "/my-work",
    "finance": "/finance",
    "journal": "/journal",
    "crm": "/crm",
    "team": "/team",
    "desk": "/inbox",
}

# Classification is by TEST-ID, never by the visible label -- a task titled
# "Complete the Kapoor dispatch" must not make its expander look destructive.
#
# Read-only controls: navigation, tabs, filters, lenses, expanders, viewers.
SAFE_ID = re.compile(
    r"^(task-summary-|work-tab-|work-scope-|work-mobile-|work-status-|work-view-|"
    r"priority-band-|priority-col-|nav-|dock-|mywork-|ai-priority-toggle|"
    r"exec-view-|exec-step-close|detail-zoom-back-|task-trail-|"
    r"tab-|filter-|view-|lens-|segment-|crm-tab-|finance-tab-|team-tab-|desk-tab-)",
    re.I,
)

# Controls we refuse to click blind -- they mutate or destroy shared dev data.
DESTRUCTIVE = re.compile(
    r"(delete|remove|discard|archive|approve|reject|complete|cancel|reopen|submit|"
    r"send|pay|invoice|logout|sign.?out|confirm|save|publish|generate|regenerate|"
    r"reassign|clear|bulk|resolve|advance|escalate|reset|upload|record|voice|photo|"
    r"add.?update|log.?update|status-pill|status-select|progress-select|exec-toggle|"
    r"exec-accept|exec-add|manual-plan)",
    re.I,
)


def classify(control):
    """safe | destructive -- decided on the test-id when there is one."""
    tid = control.get("testid")
    if tid:
        if SAFE_ID.match(tid):
            return "safe"
        return "destructive" if DESTRUCTIVE.search(tid) else "safe"
    # No test-id: all we have is the label, so be conservative.
    return "destructive" if DESTRUCTIVE.search(control.get("name") or "") else "safe"

# Known dev-only console noise, kept out of the real-error list:
#  * @emergentbase/visual-edits wraps dynamic text in <span style=display:contents>,
#    invalid inside <option>. Dev server only -- craco gates it on
#    NODE_ENV !== "production", so it never reaches a build.
NOISE = re.compile(
    r"cannot be a child of|hydration error|visual-edits|Download the React DevTools",
    re.I,
)

# --------------------------------------------------------------------------
# In-page analysis: everything that needs the live DOM + layout boxes.
# --------------------------------------------------------------------------
ANALYSE_JS = r"""
() => {
  const vw = window.innerWidth, vh = window.innerHeight;
  const isMobile = vw < 768;
  const out = { viewport:{vw,vh}, overflow:null, overflowingEls:[], tinyTapTargets:[],
                clippedText:[], overlaps:[], offscreen:[], imagesNoAlt:[], emptyLinks:[],
                counts:{} };
  const visible = (el) => {
    const s = getComputedStyle(el);
    if (s.display==='none'||s.visibility==='hidden'||+s.opacity===0) return false;
    const r = el.getBoundingClientRect();
    return r.width>0 && r.height>0;
  };
  const label = (el) => ((el.getAttribute('data-testid') || el.getAttribute('aria-label') ||
      (el.innerText||'').trim().slice(0,40) || el.getAttribute('title') ||
      (el.className&&el.className.toString?el.className.toString().slice(0,40):'') || el.tagName)
      ).replace(/\s+/g,' ');
  const sel = (el) => { const t = el.getAttribute('data-testid');
      return t ? `[data-testid="${t}"]` : el.tagName.toLowerCase()+(el.id?('#'+el.id):''); };
  // A control's REAL tap area is often its clickable wrapper (a <label> around a
  // 16px checkbox is still a 44px target), so measure that, not the bare input.
  const hitBox = (el) => {
    let best = el.getBoundingClientRect(), node = el;
    for (let i=0; i<4 && node.parentElement; i++) {
      const p = node.parentElement, tag = p.tagName.toLowerCase();
      const clickable = tag==='label'||tag==='button'||tag==='a'||p.getAttribute('role')==='button'||p.onclick;
      if (!clickable) break;
      if (p.querySelectorAll('button,a[href],input,select,textarea,[role="button"]').length > 1) break;
      const r = p.getBoundingClientRect();
      if (r.width>=best.width && r.height>=best.height) best = r;
      node = p;
    }
    return best;
  };
  // Fixed/sticky chrome (dock, FAB, sticky header) legitimately floats ABOVE
  // scrolling content -- overlapping it is the design, not a collision.
  const floats = (el) => {
    for (let n=el; n && n!==document.body; n=n.parentElement) {
      const p = getComputedStyle(n).position;
      if (p==='fixed'||p==='sticky') return true;
    }
    return false;
  };

  const de = document.documentElement;
  out.overflow = { scrollWidth: de.scrollWidth, clientWidth: de.clientWidth,
                   overflows: de.scrollWidth > de.clientWidth + 1 };

  const all = [...document.querySelectorAll('body *')].filter(visible);
  out.counts.visibleElements = all.length;

  for (const el of all) {
    const r = el.getBoundingClientRect();
    if (r.right > vw+1 && r.width <= vw+2 && r.width > 8) {
      out.overflowingEls.push({ label: label(el), sel: sel(el), right: Math.round(r.right),
        width: Math.round(r.width), overhang: Math.round(r.right-vw),
        position: getComputedStyle(el).position });
    }
  }

  const interactive = [...document.querySelectorAll(
    'button,a[href],input,select,textarea,[role="button"],[role="tab"],[role="switch"],[role="checkbox"],[tabindex]:not([tabindex="-1"])'
  )].filter(visible);
  out.counts.interactive = interactive.length;

  if (isMobile) {
    for (const el of interactive) {
      const own = el.getBoundingClientRect(), hb = hitBox(el);
      if (hb.width < 24 || hb.height < 24)   // WCAG 2.5.8 minimum, on the REAL hit area
        out.tinyTapTargets.push({ label: label(el), sel: sel(el),
          w: Math.round(hb.width), h: Math.round(hb.height),
          ownW: Math.round(own.width), ownH: Math.round(own.height),
          tag: el.tagName.toLowerCase() });
    }
  }

  for (const el of all) {
    if (el.children.length) continue;
    const txt = (el.innerText||'').trim();
    if (!txt) continue;
    const s = getComputedStyle(el);
    const hidX = s.overflowX==='hidden'||s.overflow==='hidden';
    if (hidX && el.scrollWidth > el.clientWidth+2 && s.textOverflow!=='ellipsis')
      out.clippedText.push({ label: label(el), sel: sel(el), text: txt.slice(0,50),
        scrollW: el.scrollWidth, clientW: el.clientWidth, axis:'x' });
    if ((s.overflowY==='hidden'||s.overflow==='hidden') && el.scrollHeight > el.clientHeight+4)
      out.clippedText.push({ label: label(el), sel: sel(el), text: txt.slice(0,50),
        scrollH: el.scrollHeight, clientH: el.clientHeight, axis:'y' });
  }

  const boxes = interactive.map(el => ({el, r: el.getBoundingClientRect(), fl: floats(el)}));
  for (let i=0;i<boxes.length;i++) for (let j=i+1;j<boxes.length;j++) {
    const a=boxes[i], b=boxes[j];
    if (a.el.contains(b.el)||b.el.contains(a.el)) continue;
    if (a.fl !== b.fl) continue;   // floating chrome over scrolling content is by design
    const ox = Math.min(a.r.right,b.r.right)-Math.max(a.r.left,b.r.left);
    const oy = Math.min(a.r.bottom,b.r.bottom)-Math.max(a.r.top,b.r.top);
    if (ox>4 && oy>4) {
      const area=ox*oy;
      const smaller=Math.min(a.r.width*a.r.height, b.r.width*b.r.height);
      if (smaller>0 && area/smaller>0.3)
        out.overlaps.push({a:label(a.el), b:label(b.el), overlapPct: Math.round(area/smaller*100)});
    }
  }

  for (const el of interactive) {
    const r = el.getBoundingClientRect();
    if (r.right < -2 || r.left > vw+2)
      out.offscreen.push({label: label(el), sel: sel(el), left: Math.round(r.left), right: Math.round(r.right)});
  }

  for (const img of document.querySelectorAll('img'))
    if (!img.hasAttribute('alt')) out.imagesNoAlt.push((img.getAttribute('src')||'(no src)').slice(0,60));
  for (const a of document.querySelectorAll('a[href],button')) {
    if (!visible(a)) continue;
    const name = (a.innerText||'').trim() || a.getAttribute('aria-label') || a.getAttribute('title');
    if (!name) out.emptyLinks.push({sel: sel(a), html: a.outerHTML.slice(0,90)});
  }
  return out;
}
"""

CONTROLS_JS = r"""
() => {
  const visible = (el) => {
    const s = getComputedStyle(el);
    if (s.display==='none'||s.visibility==='hidden'||+s.opacity===0) return false;
    const r = el.getBoundingClientRect();
    return r.width>0 && r.height>0;
  };
  return [...document.querySelectorAll('button,[role="tab"],[role="button"],a[href],[role="switch"]')]
    .filter(visible).map(el => {
      const r = el.getBoundingClientRect();
      return {
        testid: el.getAttribute('data-testid'),
        name: (((el.innerText||'').trim()) || el.getAttribute('aria-label') || el.getAttribute('title') || '').replace(/\s+/g,' ').slice(0,50),
        tag: el.tagName.toLowerCase(),
        href: el.getAttribute('href'),
        disabled: el.hasAttribute('disabled') || el.getAttribute('aria-disabled')==='true',
        w: Math.round(r.width), h: Math.round(r.height), y: Math.round(r.top),
      };
    });
}
"""

# A cheap fingerprint of "what the user can currently see". Compared across a
# click to tell a working control from a dead one.
SIGNATURE_JS = r"""
() => {
  const t = (document.body.innerText || '').replace(/\s+/g, ' ');
  const pressed = [...document.querySelectorAll('[aria-pressed],[aria-selected],[aria-expanded],[data-state]')]
    .map(e => (e.getAttribute('data-testid')||'') + ':' +
              (e.getAttribute('aria-pressed')||e.getAttribute('aria-selected')||
               e.getAttribute('aria-expanded')||e.getAttribute('data-state')||'')).join('|');
  const dialogs = document.querySelectorAll('[role="dialog"],[role="alertdialog"]').length;
  return `${t.length}:${t.slice(0,400)}:${dialogs}:${pressed.length}:${pressed.slice(0,600)}`;
}
"""

ALIVE_JS = r"""
() => { const r = document.getElementById('root');
  return !!r && r.children.length>0 && (document.body.innerText||'').trim().length>20; }
"""


def sign_in(page, role):
    """Use the login screen's own demo seats -- no password in logs."""
    return demo_login(page, BASE, role)


def audit_viewport(browser, vp, route, role, outdir):
    v = {"name": vp["name"], "size": f'{vp["width"]}x{vp["height"]}',
         "shots": [], "findings": [], "controls": [], "clicks": []}
    console_errors, page_errors, net_failures, dev_noise = [], [], [], []
    escape_deaf = set()

    ctx = browser.new_context(
        viewport={"width": vp["width"], "height": vp["height"]},
        device_scale_factor=2, is_mobile=vp["isMobile"], has_touch=vp["hasTouch"],
        permissions=["microphone"],
    )
    page = ctx.new_page()

    def on_console(m):
        if m.type != "error":
            return
        (dev_noise if NOISE.search(m.text) else console_errors).append(m.text[:300])

    page.on("console", on_console)
    page.on("pageerror", lambda e: page_errors.append(str(e)[:300]))
    page.on("response", lambda r: net_failures.append(
        f"{r.status} {r.request.method} {r.url.replace(BASE,'')}") if r.status >= 400 else None)

    if not sign_in(page, role):
        v["findings"].append({"severity": "blocker", "kind": "auth",
                              "detail": f"could not sign in as {role}"})
        ctx.close()
        return v

    page.goto(f"{BASE}{route}", wait_until="domcontentloaded")
    try:
        page.wait_for_load_state("networkidle", timeout=12000)
    except Exception:
        pass
    page.wait_for_timeout(1500)

    from urllib.parse import urlparse
    u = urlparse(page.url)
    landed = u.path + (("?" + u.query) if u.query else "")
    v["landedAt"] = landed
    if not landed.startswith(route):
        v["findings"].append({"severity": "info", "kind": "routing",
                              "detail": f"{route} redirected to {landed}"})

    outdir.mkdir(parents=True, exist_ok=True)

    def shot(name, full=True):
        f = outdir / f"{name}.png"
        try:
            page.screenshot(path=str(f), full_page=full)
            v["shots"].append(str(f.relative_to(REPO)))
        except Exception as e:
            v["findings"].append({"severity": "info", "kind": "screenshot",
                                  "detail": f"{name}: {e}"})
        return f

    # The app shell scrolls an INNER container, so full_page captures only one
    # screen. Walk that scroller and shoot each viewport-worth instead.
    FIND_SCROLLER = r"""() => {
      let best = null, bestH = 0;
      for (const el of document.querySelectorAll('div,main,section')) {
        const s = getComputedStyle(el);
        if (s.overflowY!=='auto' && s.overflowY!=='scroll') continue;
        if (el.scrollHeight <= el.clientHeight + 8) continue;
        if (el.scrollHeight > bestH) { bestH = el.scrollHeight; best = el; }
      }
      if (!best) return null;
      best.setAttribute('data-ux-scroller','1');
      return {scrollH: best.scrollHeight, clientH: best.clientHeight};
    }"""

    def scroll_capture(prefix, max_frames=6):
        info = page.evaluate(FIND_SCROLLER)
        if not info:
            shot(f"{prefix}-full")
            return 1
        step = info["clientH"]
        frames = min(max_frames, max(1, -(-info["scrollH"] // max(step, 1))))
        for i in range(frames):
            page.evaluate(
                "(y) => { const e=document.querySelector('[data-ux-scroller]'); if(e) e.scrollTop=y; }",
                i * step)
            page.wait_for_timeout(420)
            shot(f"{prefix}-scroll{i + 1}", full=False)
        page.evaluate("() => { const e=document.querySelector('[data-ux-scroller]'); if(e) e.scrollTop=0; }")
        page.wait_for_timeout(250)
        return frames

    shot("01-landing", full=False)
    v["scrollFrames"] = scroll_capture("01-landing")
    v["layout"] = page.evaluate(ANALYSE_JS)
    controls = page.evaluate(CONTROLS_JS)
    v["controls"] = controls

    start_url = page.url

    # Anything covering the page hides every later control. Escape is the
    # contract the app documents for its sheets; where that fails we fall back
    # to a scrim tap, and RECORD the failure -- an overlay that ignores Escape
    # is itself a finding, not just a harness inconvenience.
    COVERED_JS = r"""() => {
      const el = document.elementFromPoint(innerWidth/2, Math.round(innerHeight*0.35));
      if (!el) return null;
      const s = getComputedStyle(el);
      const fixedFull = (s.position==='fixed') &&
        el.getBoundingClientRect().width >= innerWidth-2 &&
        el.getBoundingClientRect().height >= innerHeight-2;
      const inDialog = !!el.closest('[role="dialog"],[role="alertdialog"]');
      if (!fixedFull && !inDialog) return null;
      return {tag: el.tagName, cls: String(el.className).slice(0,80),
              aria: el.getAttribute('aria-label'), dialog: inDialog};
    }"""

    def dismiss_overlay():
        cover = page.evaluate(COVERED_JS)
        if not cover:
            return
        page.keyboard.press("Escape")
        page.wait_for_timeout(350)
        if not page.evaluate(COVERED_JS):
            return
        # Escape did not work -- note it once, then clear it by tapping the scrim.
        sig = cover.get("aria") or cover.get("cls", "")[:40]
        if sig not in escape_deaf:
            escape_deaf.add(sig)
            v["findings"].append({
                "severity": "medium", "kind": "a11y-dismiss",
                "detail": f"full-screen overlay ({cover['tag']} aria={cover.get('aria')!r}) "
                          f"is not dismissed by Escape; only a pointer tap closes it"})
        try:
            page.mouse.click(8, 8)
            page.wait_for_timeout(400)
        except Exception:
            pass
        if page.evaluate(COVERED_JS):
            restore()

    def restore(force=False):
        """Return to the section and wait until it is actually interactive --
        a shallow goto leaves every later control looking 'gone'. `force`
        reloads outright, which clears any popover/menu layer still intercepting
        pointer events."""
        for _ in range(2):
            try:
                if force or page.url != start_url:
                    page.goto(start_url, wait_until="domcontentloaded")
                try:
                    page.wait_for_load_state("networkidle", timeout=8000)
                except Exception:
                    pass
                page.wait_for_timeout(700)
                if page.evaluate(ALIVE_JS):
                    return True
            except Exception:
                page.wait_for_timeout(500)
        return False

    # Navigation controls leave the page, so click them last; and a list of 28
    # identical row-expanders only needs a few samples.
    def order_key(c):
        tid = c.get("testid") or ""
        return (1 if re.match(r"^(nav-|dock-)", tid) else 0, tid)

    seen_prefix = {}
    ordered = []
    for c in sorted(controls, key=order_key):
        tid = c.get("testid") or ""
        m = re.match(r"^([a-z-]+?-)[0-9a-f]{8}-", tid)
        if m:  # per-row control (uuid suffix) -- sample a few, not all 28
            p = m.group(1)
            seen_prefix[p] = seen_prefix.get(p, 0) + 1
            if seen_prefix[p] > 3:
                continue
        ordered.append(c)
    v["sweptCount"] = len(ordered)

    for c in ordered:
        ident = c.get("testid") or c.get("name")
        if not ident:
            continue
        if c.get("disabled"):
            v["clicks"].append({"control": ident, "result": "skipped:disabled"})
            continue
        if classify(c) == "destructive":
            v["clicks"].append({"control": ident, "result": "skipped:destructive"})
            continue

        if c.get("testid"):
            loc = page.locator(f'[data-testid="{c["testid"]}"]').first
        else:
            role_name = "link" if c["tag"] == "a" else "button"
            loc = page.get_by_role(role_name, name=c["name"], exact=True).first

        dismiss_overlay()

        before = len(console_errors) + len(page_errors)
        sig_before = page.evaluate(SIGNATURE_JS)
        result = "ok"
        try:
            if not loc.is_visible(timeout=1200):
                restore(force=True)          # a stale overlay can hide a live control
                if not loc.is_visible(timeout=1500):
                    v["clicks"].append({"control": ident, "result": "skipped:gone"})
                    continue
            loc.click(timeout=2500)
            page.wait_for_timeout(550)
        except Exception as e:
            # Most often a menu/popover layer from the PREVIOUS control is still
            # intercepting pointer events. Reload to a clean page and try once
            # more, so a real dead control is distinguishable from harness drift.
            restore(force=True)
            try:
                loc = (page.locator(f'[data-testid="{c["testid"]}"]').first if c.get("testid")
                       else page.get_by_role("link" if c["tag"] == "a" else "button",
                                             name=c["name"], exact=True).first)
                loc.click(timeout=3000)
                page.wait_for_timeout(550)
                result = "ok-after-reload"
            except Exception:
                result = "click-failed: " + str(e).split("\n")[0][:110]
        sig_after = page.evaluate(SIGNATURE_JS)

        navigated = page.url != start_url
        new_errs = len(console_errors) + len(page_errors) - before
        try:
            alive = page.evaluate(ALIVE_JS)
        except Exception:
            alive = False

        entry = {"control": ident, "result": result, "alive": alive}
        if navigated:
            entry["navigated"] = page.url.replace(BASE, "")
        if new_errs:
            entry["newErrors"] = new_errs

        # A control that changes nothing -- no navigation, no DOM delta, no
        # dialog, no pressed-state flip -- is a dead button the user can press
        # forever with no feedback. That is a real UX defect, so record it.
        # ...unless it was already the active choice, where "nothing happens" is
        # the correct behaviour for a segmented control or selected tab.
        already_active = False
        if c.get("testid"):
            already_active = page.evaluate(
                """(id) => { const e = document.querySelector(`[data-testid="${id}"]`);
                   if (!e) return false;
                   return e.getAttribute('aria-pressed')==='true' ||
                          e.getAttribute('aria-selected')==='true' ||
                          e.getAttribute('aria-current')==='page' ||
                          e.getAttribute('data-state')==='active'; }""",
                c["testid"]) or False
        if result == "ok" and not navigated and sig_before == sig_after and not already_active:
            entry["noEffect"] = True
            v["findings"].append({"severity": "medium", "kind": "dead-control",
                                  "detail": f"{ident} produced no visible change on click"})
        elif already_active:
            entry["alreadyActive"] = True
        v["clicks"].append(entry)

        if not alive:
            v["findings"].append({"severity": "high", "kind": "crash",
                                  "detail": f"clicking {ident} blanked the page"})
        if new_errs:
            v["findings"].append({"severity": "medium", "kind": "console",
                                  "detail": f"{ident} produced {new_errs} console/page error(s)"})

        dismiss_overlay()
        page.wait_for_timeout(150)
        if page.url != start_url and not restore():
            v["findings"].append({"severity": "info", "kind": "sweep",
                                  "detail": f"could not return to {route} after {ident}; sweep stopped"})
            break

    shot("02-after-sweep", full=False)

    v["consoleErrors"] = sorted(set(console_errors))
    v["devNoise"] = sorted({e[:120] for e in dev_noise})
    v["pageErrors"] = sorted(set(page_errors))
    v["netFailures"] = [f for f in sorted(set(net_failures)) if "401 GET /api/auth/me" not in f]
    ctx.close()
    return v


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("section", nargs="?", default="my-work")
    ap.add_argument("--role", default="owner")
    ap.add_argument("--only", default=None, choices=["mobile", "desktop"])
    a = ap.parse_args()

    route = SECTIONS.get(a.section, a.section)
    viewports = [
        {"name": "mobile", "width": 390, "height": 844, "isMobile": True, "hasTouch": True},
        {"name": "desktop", "width": 1440, "height": 900, "isMobile": False, "hasTouch": False},
    ]
    if a.only:
        viewports = [v for v in viewports if v["name"] == a.only]

    out = REPO / ".audit-artifacts" / "ux" / a.section
    report = {"section": a.section, "route": route, "role": a.role, "base": BASE,
              "at": datetime.now(timezone.utc).isoformat(), "viewports": {}}

    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=[
            "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"])
        for vp in viewports:
            report["viewports"][vp["name"]] = audit_viewport(
                browser, vp, route, a.role, out / vp["name"])
        browser.close()

    out.mkdir(parents=True, exist_ok=True)
    (out / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")

    print(f"\n=== UX AUDIT: {a.section}  ({route})  role={a.role} ===")
    for name, v in report["viewports"].items():
        print(f"\n--- {name} {v['size']} --- landed: {v.get('landedAt')}")
        lay = v.get("layout")
        if lay:
            print(f"  elements: {lay['counts']['visibleElements']} visible, "
                  f"{lay['counts']['interactive']} interactive")
            ov = lay["overflow"]
            print(f"  h-overflow: {'YES (%d > %d)' % (ov['scrollWidth'], ov['clientWidth']) if ov['overflows'] else 'no'}")
            print(f"  overflowing els: {len(lay['overflowingEls'])}")
            for e in lay["overflowingEls"][:8]:
                print(f"      +{e['overhang']}px  {e['label']}  {e['sel']}")
            print(f"  tiny tap targets (<24px): {len(lay['tinyTapTargets'])}")
            for e in lay["tinyTapTargets"][:12]:
                print(f"      {e['w']}x{e['h']}  {e['label']}")
            print(f"  clipped text: {len(lay['clippedText'])}")
            for e in lay["clippedText"][:8]:
                print(f"      [{e.get('axis')}] \"{e['text']}\"  {e['sel']}")
            print(f"  overlapping controls: {len(lay['overlaps'])}")
            for e in lay["overlaps"][:8]:
                print(f"      {e['overlapPct']}%  {e['a']}  <=>  {e['b']}")
            print(f"  offscreen controls: {len(lay['offscreen'])}")
            print(f"  images w/o alt: {len(lay['imagesNoAlt'])} | unnamed buttons/links: {len(lay['emptyLinks'])}")
            for e in lay["emptyLinks"][:6]:
                print(f"      {e['html']}")
        clicks = v.get("clicks", [])
        ok = [c for c in clicks if c["result"].startswith("ok")]
        failed = [c for c in clicks if c["result"].startswith("click-failed")]
        skipped = [c for c in clicks if c["result"].startswith("skipped")]
        print(f"  controls: {len(v.get('controls', []))} | clicked ok: {len(ok)} | "
              f"click failures: {len(failed)} | skipped: {len(skipped)}")
        for c in failed:
            print(f"      FAIL {c['control']}: {c['result']}")
        for c in ok:
            if c.get("navigated"):
                print(f"      nav  {c['control']} -> {c['navigated']}")
        dead = [c for c in ok if c.get("noEffect")]
        if dead:
            print(f"  dead controls (no visible change): {len(dead)}")
            for c in dead:
                print(f"      DEAD {c['control']}")
        print(f"  console errors: {len(v.get('consoleErrors', []))}"
              f"  (+{len(v.get('devNoise', []))} dev-only noise, ignored)")
        for e in v.get("consoleErrors", [])[:8]:
            print(f"      {e}")
        print(f"  page errors: {len(v.get('pageErrors', []))}")
        for e in v.get("pageErrors", [])[:6]:
            print(f"      {e}")
        print(f"  network >=400: {len(v.get('netFailures', []))}")
        for e in v.get("netFailures", [])[:12]:
            print(f"      {e}")
        for f in v.get("findings", []):
            print(f"  [{f['severity']}] {f['kind']}: {f['detail']}")
    print(f"\nreport: {(out / 'report.json').relative_to(REPO)}")


if __name__ == "__main__":
    sys.exit(main())
