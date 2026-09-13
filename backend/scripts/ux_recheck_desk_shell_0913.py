"""Re-checks for Desk / shell results that could be harness artefacts (2026-09-13)."""
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from ux_login import demo_login  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

BASE = "http://localhost:3000"
OUT = pathlib.Path(__file__).resolve().parents[2] / ".audit-artifacts" / "desk_0913"


def block(p):
    p.route("**/api/**", lambda r: r.abort() if r.request.method in ("POST", "PATCH", "PUT", "DELETE") else r.continue_())


with sync_playwright() as pw:
    b = pw.chromium.launch()
    # 1. bell dropdown on desktop - give it time
    ctx = b.new_context(viewport={"width": 1440, "height": 900}); p = ctx.new_page(); demo_login(p, BASE, "owner"); block(p)
    p.goto(f"{BASE}/my-work"); p.wait_for_timeout(4000)
    p.locator('[data-testid="notif-bell"]').first.click(); p.wait_for_timeout(3500)
    dd = p.locator('[data-testid="notif-dropdown"]')
    print("1 bell: dropdown", dd.count(), "| items", p.locator('[data-testid^="notif-item-"]').count(),
          "| dropdown text:", dd.first.inner_text().replace("\n", " ")[:200] if dd.count() else None)
    p.screenshot(path=str(OUT / "recheck_bell.png"))
    # 2. desktop Close from a real Review flow
    p.goto(f"{BASE}/inbox"); p.wait_for_timeout(6000)
    act = p.locator('[data-testid^="desk-card-action-"]').filter(has_text=re.compile("Review"))
    if act.count():
        act.first.scroll_into_view_if_needed(); act.first.click(); p.wait_for_timeout(3000)
        at = p.url.replace(BASE, "")
        p.locator('[data-testid="decision-close"]').first.click(); p.wait_for_timeout(2500)
        print("2 close from review flow:", at, "->", p.url.replace(BASE, ""))
    # 3. leave Info
    p.goto(f"{BASE}/inbox"); p.wait_for_timeout(6000)
    info = p.locator('[data-testid="desk-leave-approvals"] [data-testid^="leave-info-"]')
    if info.count():
        lid = info.first.get_attribute("data-testid")[11:]
        info.first.scroll_into_view_if_needed(); info.first.click(); p.wait_for_timeout(1200)
        print("3 leave Info: note field", p.locator(f'[data-testid="leave-note-{lid}"]').count(),
              "| confirm", p.locator(f'[data-testid="leave-confirm-{lid}"]').count(),
              "| card text:", p.locator(f'[data-testid="leave-card-{lid}"]').first.inner_text().replace("\n", " ")[:160])
        ap = p.locator(f'[data-testid="leave-approve-{lid}"]')
        print("  leave Approve has a confirm step? (inspect after click)")
    ctx.close()
    # 4. mobile scope pills + card actions
    ctx = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True); p = ctx.new_page(); demo_login(p, BASE, "owner"); block(p)
    p.goto(f"{BASE}/inbox"); p.wait_for_timeout(7000)
    pills = p.evaluate("()=>[...document.querySelectorAll('[data-testid^=\"desk-scope\"]')].map(e=>[e.getAttribute('data-testid'), e.tagName, Math.round(e.getBoundingClientRect().width), (e.innerText||'').trim().slice(0,20)])")
    print("4 mobile scope elements:", pills)
    cards = p.evaluate("()=>[...document.querySelectorAll('[data-testid^=\"desk-card-\"]')].map(e=>[e.getAttribute('data-testid').slice(0,40), Math.round(e.getBoundingClientRect().width), Math.round(e.getBoundingClientRect().top)])")
    print("  mobile desk cards / actions (testid, width, top):", cards[:12])
    band = p.locator('[data-testid="desk-band"]')
    print("  band:", band.count(), band.first.inner_text().replace("\n", " ")[:220] if band.count() else None)
    p.evaluate("()=>{const b=document.querySelector('[data-testid=\"desk-band\"]'); if(b) b.scrollIntoView();}"); p.wait_for_timeout(1500)
    p.screenshot(path=str(OUT / "recheck_mobile_band.png"))
    ctx.close()
    b.close()
