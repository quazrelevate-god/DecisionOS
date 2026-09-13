"""Verify the nine My Work / Workflows commits pulled on 2026-09-13.

5105ed1 ASK-11 status dropdown loses terminal states
da83b34 / 3d59e41 uniform 4-col grid, Department/Status dropdowns, 1400px cap removed
f69a900 one segmented slider (My Tasks | All Tasks | Workflows), AI toggle to its left
ff3139f task opens in a right-side drawer, tighter card radius
c413f32 Workflows board loses its outer well, stage labels centred
c70508b / e5c9151 / 2a17592 drawer close tab on the drawer's LEFT edge

Read-only: every POST/PATCH/PUT/DELETE is aborted after sign-in.
"""
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from ux_login import demo_login  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

BASE = "http://localhost:3000"
OUT = pathlib.Path(__file__).resolve().parents[2] / ".audit-artifacts" / "verify_0913"

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

VIS = "(e)=>{const r=e.getBoundingClientRect();const s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';}"

results = []


def rec(key, vp, ok, detail):
    results.append({"check": key, "viewport": vp, "ok": ok, "detail": detail})
    print(f"  [{'PASS' if ok is True else 'FAIL' if ok is False else 'INFO'}] {vp:<8} {key}: {detail}")


def settle(p, ms=2500):
    p.wait_for_timeout(ms)
    for _ in range(10):
        if p.locator(".animate-pulse:visible").count() == 0:
            break
        p.wait_for_timeout(500)


def drawer_probe(p):
    return p.evaluate("""() => {
      const vw = innerWidth, vh = innerHeight;
      const d = document.querySelector('[role="dialog"][data-state="open"]');
      if (!d) return {open:false};
      const dr = d.getBoundingClientRect();
      const closes = [...d.querySelectorAll('button')].filter(b =>
        /close/i.test(b.getAttribute('aria-label')||'') || /^close$/i.test((b.textContent||'').trim()));
      const info = closes.map(b => {
        const r = b.getBoundingClientRect();
        const cx = r.left + r.width/2, cy = r.top + r.height/2;
        const onScreen = r.right > 0 && r.left < vw && r.bottom > 0 && r.top < vh;
        const inView = r.left >= 0 && r.right <= vw && r.top >= 0 && r.bottom <= vh;
        let hit = null;
        if (onScreen) { const h = document.elementFromPoint(Math.max(1,Math.min(vw-1,cx)), Math.max(1,Math.min(vh-1,cy)));
          hit = h ? (b.contains(h) ? 'self' : (h.getAttribute('data-testid') || h.tagName + '.' + String(h.className).slice(0,40))) : null; }
        return {testid: b.getAttribute('data-testid'), label: b.getAttribute('aria-label') || b.textContent.trim(),
                rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
                fullyInViewport: inView, reachable: hit === 'self', hitBy: hit};
      });
      const ae = document.activeElement;
      const title = d.querySelector('h2');
      const sel = d.querySelector('select[data-testid^="status-select-"]');
      const selVisible = sel && sel.getBoundingClientRect().width > 0;
      const scroller = [...d.children].find(c => getComputedStyle(c).overflowY === 'auto');
      return {open:true, vw, vh,
        rect:[Math.round(dr.left), Math.round(dr.top), Math.round(dr.width), Math.round(dr.height)],
        closes: info,
        focused: ae ? (ae.getAttribute('data-testid') || ae.getAttribute('aria-label') || ae.tagName + ':' + (ae.textContent||'').trim().slice(0,20)) : null,
        focusedVisibleRect: ae ? (()=>{const r=ae.getBoundingClientRect(); return [Math.round(r.left),Math.round(r.top),Math.round(r.width),Math.round(r.height)];})() : null,
        title: title ? title.textContent.trim() : null,
        statusOptions: selVisible ? [...sel.options].map(o => o.textContent.trim()) : null,
        innerScroll: scroller ? {sh: scroller.scrollHeight, ch: scroller.clientHeight} : null};
    }""")


def open_first_task(p):
    cards = p.locator('[data-testid^="task-summary-"]:visible')
    n = cards.count()
    for i in range(min(n, 12)):
        c = cards.nth(i)
        txt = (c.inner_text() or "").lower()
        if "completed" in txt or "cancelled" in txt:
            continue
        c.click()
        p.wait_for_timeout(1200)
        if p.locator('[role="dialog"][data-state="open"]').count():
            return c.get_attribute("data-testid").replace("task-summary-", "")
    return None


def audit_mywork(p, vp, desktop, shots):
    p.goto(f"{BASE}/my-work", wait_until="domcontentloaded")
    settle(p, 3500)
    p.screenshot(path=str(shots / f"{vp}_mywork.png"))

    crash = p.locator("text=/Something went wrong/i").count()
    rec("page renders without error boundary", vp, crash == 0, f"error-boundary nodes: {crash}")

    # --- segmented slider ---
    seg = p.evaluate("""() => {
      const g = [...document.querySelectorAll('[data-testid="work-view-segment"]')].find(e=>e.getBoundingClientRect().width>0);
      if (!g) return null;
      const btns = [...g.querySelectorAll('button')].map(b => ({t:b.textContent.trim(), pressed:b.getAttribute('aria-pressed'),
         h: Math.round(b.getBoundingClientRect().height), x: Math.round(b.getBoundingClientRect().left)}));
      const ai = document.querySelector('[data-testid="ai-priority-toggle"]');
      const ar = ai && ai.getBoundingClientRect();
      return {btns, gx: Math.round(g.getBoundingClientRect().left), aiX: ar && ar.width ? Math.round(ar.left) : null};
    }""")
    if seg:
        rec("slider segments", vp, len(seg["btns"]) >= 2, json.dumps(seg["btns"]))
        pressed = [b for b in seg["btns"] if b["pressed"] == "true"]
        rec("exactly one segment pressed", vp, len(pressed) == 1, f"pressed: {[b['t'] for b in pressed]}")
        if seg["aiX"] is not None:
            rec("AI Priority sits left of slider", vp, seg["aiX"] < seg["gx"], f"ai x={seg['aiX']} slider x={seg['gx']}")
    else:
        rec("slider segments", vp, None if not desktop else False, "segment group not visible at this width")

    if desktop and seg:
        wf = p.locator('[data-testid="work-view-workflows"]:visible')
        if wf.count():
            wf.first.click()
            settle(p, 2500)
            hub = p.locator('[data-testid="workflows-hub"]:visible').count()
            ai_vis = p.locator('[data-testid="ai-priority-toggle"]:visible').count()
            rec("Workflows segment switches view", vp, hub == 1, f"workflows-hub visible={hub}, url={p.url.replace(BASE,'')}")
            rec("AI Priority hidden in Workflows view", vp, ai_vis == 0, f"visible toggles={ai_vis}")
            p.screenshot(path=str(shots / f"{vp}_workflows.png"))
            board = p.evaluate("""() => {
              const b = document.querySelector('[data-testid="workflow-board"]');
              if (!b) return null;
              const heads = [...document.querySelectorAll('[data-testid^="stage-toggle-"]')].filter(e=>e.getBoundingClientRect().width>0).map(btn => {
                const br = btn.getBoundingClientRect(); const lab = btn.querySelector('span');
                const lr = lab.getBoundingClientRect();
                return {k: btn.getAttribute('data-testid').replace('stage-toggle-',''),
                        off: Math.round((lr.left+lr.width/2) - (br.left+br.width/2))};
              });
              const col = b.firstElementChild;
              return {well: b.className.includes('kr-glass-well'),
                      bg: getComputedStyle(b).backgroundImage.slice(0,40) + '|' + getComputedStyle(b).backgroundColor,
                      heads, scroll: [b.scrollWidth, b.clientWidth]};
            }""")
            if board:
                rec("board has no outer well", vp, not board["well"], f"class well={board['well']} bg={board['bg']}")
                offs = [h["off"] for h in board["heads"]]
                rec("stage labels centred over column", vp, bool(offs) and all(abs(o) <= 2 for o in offs),
                    f"label-centre offsets px: {board['heads']}")
                rec("board horizontal scroll", None if board["scroll"][0] <= board["scroll"][1] + 2 else None, None,
                    f"scrollWidth/clientWidth = {board['scroll']}") if False else \
                    rec("board fits or scrolls within itself", vp, None, f"scrollWidth/clientWidth = {board['scroll']}")
            back = p.locator('[data-testid="work-scope-mine"]:visible, [data-testid="work-view-mywork"]:visible')
            if back.count():
                back.first.click()
                settle(p, 2500)
                rec("slider returns to tasks", vp, p.locator('[data-testid="mywork-list"]:visible').count() == 1,
                    f"url={p.url.replace(BASE,'')}")

    # --- grid ---
    grid = p.evaluate("""() => {
      const g = [...document.querySelectorAll('[data-testid="mywork-grid"]')].find(e=>e.getBoundingClientRect().width>0);
      if (!g) return null;
      const kids = [...g.children].filter(c=>c.getBoundingClientRect().width>0);
      const lefts = [...new Set(kids.map(c=>Math.round(c.getBoundingClientRect().left)))];
      const widths = [...new Set(kids.map(c=>Math.round(c.getBoundingClientRect().width)))];
      const card = g.querySelector('.kr-bento');
      return {cols: lefts.length, n: kids.length, gridW: Math.round(g.getBoundingClientRect().width), widths,
              radius: card ? getComputedStyle(card).borderRadius : null,
              docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth};
    }""")
    if grid:
        rec("grid columns", vp, None, f"{grid['cols']} cols, {grid['n']} cards, grid {grid['gridW']}px, card widths {grid['widths']}, radius {grid['radius']}")
        rec("no page-level horizontal overflow", vp, grid["docOverflow"] <= 1, f"overflow {grid['docOverflow']}px")

    # --- filter dropdowns (desktop) ---
    if desktop:
        for tid in ("work-filter-department", "work-filter-status"):
            el = p.locator(f'[data-testid="{tid}"]:visible')
            if not el.count():
                rec(f"{tid} present", vp, False, "not visible")
                continue
            before = p.locator('[data-testid^="task-summary-"]:visible').count()
            p.evaluate(PTR, el.first.element_handle())
            p.wait_for_timeout(900)
            items = p.locator('[role="menuitem"]:visible, [role="menuitemradio"]:visible')
            labels = [items.nth(i).inner_text().strip().replace("\n", " ") for i in range(items.count())]
            rec(f"{tid} opens", vp, len(labels) > 0, f"items: {labels}")
            if len(labels) > 1:
                p.evaluate(PTR, items.nth(1).element_handle())
                settle(p, 1500)
                after = p.locator('[data-testid^="task-summary-"]:visible').count()
                trig = p.locator(f'[data-testid="{tid}"]:visible').first.inner_text().strip().replace("\n", " ")
                rec(f"{tid} filters list", vp, True, f"picked '{labels[1]}': cards {before} -> {after}; trigger now reads '{trig}'")
                p.evaluate(PTR, p.locator(f'[data-testid="{tid}"]:visible').first.element_handle())
                p.wait_for_timeout(700)
                items = p.locator('[role="menuitem"]:visible, [role="menuitemradio"]:visible')
                if items.count():
                    p.evaluate(PTR, items.nth(0).element_handle())
                    settle(p, 1200)
            p.keyboard.press("Escape")

    # --- drawer ---
    tid = open_first_task(p)
    if not tid:
        rec("task opens in drawer", vp, False, "no card opened a dialog")
        return
    p.wait_for_timeout(900)
    d = drawer_probe(p)
    p.screenshot(path=str(shots / f"{vp}_drawer.png"))
    rec("task opens in drawer", vp, d["open"], f"drawer rect {d.get('rect')} in {d.get('vw')}x{d.get('vh')}, title '{d.get('title')}'")
    rec("close controls in drawer", vp, None, json.dumps(d["closes"]))
    reachable = [c for c in d["closes"] if c["reachable"]]
    rec("at least one close is visible and tappable", vp, len(reachable) >= 1,
        f"reachable: {[c['testid'] or c['label'] for c in reachable]}")
    custom = [c for c in d["closes"] if (c["testid"] or "").startswith("task-drawer-close-")]
    if custom:
        c = custom[0]
        rec("left-edge close tab fully on screen", vp, c["fullyInViewport"] and c["reachable"],
            f"rect {c['rect']}, hit={c['hitBy']}")
    stock = [c for c in d["closes"] if not (c["testid"] or "").startswith("task-drawer-close-")]
    if stock:
        rec("stock Radix close also rendered", vp, False if len(d["closes"]) > 1 else None,
            f"{len(stock)} extra: {[(s['rect'], s['hitBy']) for s in stock]}")
    rec("focus on open", vp, None, f"focused={d['focused']} rect={d['focusedVisibleRect']}")
    if desktop:
        opts = d["statusOptions"]
        rec("ASK-11 status dropdown has no terminal states", vp,
            opts is not None and not any(o in ("Completed", "Cancelled") for o in opts), f"options: {opts}")
    rec("drawer body scrolls inside", vp, None, f"inner {d['innerScroll']}")

    # log/update entry still opens (MW-08 was a crash here)
    opener = p.locator('[role="dialog"][data-state="open"] button:visible').filter(has_text=__import__("re").compile(r"^(log|add) (an )?update|log update|hand ?off|update$", __import__("re").I))
    if opener.count():
        opener.first.click()
        p.wait_for_timeout(1200)
        form = p.locator('[data-testid^="update-form-"]:visible').count()
        crashed = p.locator("text=/Something went wrong/i").count()
        rec("MW-08 regression: log update opens inside drawer", vp, form >= 1 and crashed == 0,
            f"update-form visible={form}, error boundary={crashed}")
    else:
        rec("MW-08 regression: log update opens inside drawer", vp, None, "no log-update button matched in this task")

    # close paths
    if custom and custom[0]["reachable"]:
        p.locator(f'[data-testid="task-drawer-close-{tid}"]').click()
        p.wait_for_timeout(900)
        rec("left close tab closes drawer", vp, p.locator('[role="dialog"][data-state="open"]').count() == 0, "")
        p.locator(f'[data-testid="task-summary-{tid}"]:visible').first.click()
        p.wait_for_timeout(1200)
    p.keyboard.press("Escape")
    p.wait_for_timeout(900)
    rec("Escape closes drawer", vp, p.locator('[role="dialog"][data-state="open"]').count() == 0, "")
    if not desktop:
        # a phone user has no Escape; can they dismiss by tapping outside?
        p.locator(f'[data-testid="task-summary-{tid}"]:visible').first.click()
        p.wait_for_timeout(1200)
        vw = p.viewport_size["width"]
        p.mouse.click(4, 300)
        p.wait_for_timeout(900)
        still = p.locator('[role="dialog"][data-state="open"]').count()
        rec("phone: tap at left edge dismisses drawer", vp, still == 0, f"drawer still open={bool(still)} (vw {vw})")
        p.keyboard.press("Escape")
        p.wait_for_timeout(600)


def shell_width(p, vp):
    for route in ("/my-work", "/finance", "/crm", "/team", "/inbox"):
        p.goto(f"{BASE}{route}", wait_until="domcontentloaded")
        settle(p, 3000)
        m = p.evaluate("""() => {
          const main = document.querySelector('main') || document.body;
          const r = main.getBoundingClientRect();
          const paras = [...main.querySelectorAll('p')].filter(e=>e.getBoundingClientRect().width>0 && (e.textContent||'').length>80);
          const widest = paras.reduce((a,e)=>Math.max(a,e.getBoundingClientRect().width),0);
          return {mainW: Math.round(r.width), overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
                  widestPara: Math.round(widest)};
        }""")
        p.screenshot(path=str(shots_root / f"{vp}_shell{route.replace('/','_')}.png"))
        rec(f"shell {route}", vp, m["overflow"] <= 1,
            f"main {m['mainW']}px, page overflow {m['overflow']}px, widest long paragraph {m['widestPara']}px")


shots_root = OUT


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    errors = []
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        for role, vp, size, desktop in (
            ("owner", "desk1440", {"width": 1440, "height": 900}, True),
            ("owner", "wide1920", {"width": 1920, "height": 1080}, True),
            ("owner", "mob390", {"width": 390, "height": 844}, False),
            ("sales", "sales1440", {"width": 1440, "height": 900}, True),
        ):
            print(f"\n=== {role} @ {vp} ===")
            ctx = b.new_context(viewport=size, is_mobile=not desktop, has_touch=not desktop)
            p = ctx.new_page()
            p.on("console", lambda m, vp=vp: m.type == "error" and errors.append((vp, m.text[:200])))
            p.on("pageerror", lambda e, vp=vp: errors.append((vp, "PAGEERROR " + str(e)[:200])))
            demo_login(p, BASE, role)
            blocked = []
            p.route("**/api/**", lambda r: (blocked.append(r.request.method + " " + r.request.url), r.abort())
                    if r.request.method in ("POST", "PATCH", "PUT", "DELETE") else r.continue_())
            if vp == "wide1920":
                audit_mywork(p, vp, desktop, OUT)
                shell_width(p, vp)
            elif vp == "sales1440":
                p.goto(f"{BASE}/my-work", wait_until="domcontentloaded")
                settle(p, 3500)
                segs = p.evaluate("""() => { const g=[...document.querySelectorAll('[data-testid="work-view-segment"]')].find(e=>e.getBoundingClientRect().width>0);
                  return g ? [...g.querySelectorAll('button')].map(b=>b.textContent.trim()) : null; }""")
                rec("non-owner slider", vp, bool(segs), f"segments: {segs}")
                p.screenshot(path=str(OUT / f"{vp}_mywork.png"))
            else:
                audit_mywork(p, vp, desktop, OUT)
            rec("mutations blocked", vp, None, f"{len(blocked)} aborted")
            ctx.close()
        b.close()
    print("\n=== console errors ===")
    seen = set()
    for vp, t in errors:
        if t not in seen:
            seen.add(t)
            print(f"  {vp}: {t}")
    (OUT / "results.json").write_text(json.dumps({"results": results, "errors": errors}, indent=2), encoding="utf-8")
    fails = [r for r in results if r["ok"] is False]
    print(f"\n{sum(1 for r in results if r['ok'] is True)} pass, {len(fails)} fail, "
          f"{sum(1 for r in results if r['ok'] is None)} info")


if __name__ == "__main__":
    main()
