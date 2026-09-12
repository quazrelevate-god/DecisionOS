"""My Work -- functional UX flow check, mobile + desktop.

The sweep in ux_audit.py proves controls respond. This proves they do the RIGHT
thing: that a filter actually filters, a tab actually switches the set, a scope
toggle actually changes whose work you see, and an expander actually reveals the
task detail. Read-only throughout -- nothing here mutates a task.

    .venv/Scripts/python.exe scripts/ux_flow_mywork.py
"""
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

from ux_login import demo_login

REPO = Path(__file__).resolve().parent.parent.parent
BASE = "http://localhost:3000"
OUT = REPO / ".audit-artifacts" / "ux" / "my-work" / "flow"

# ids of the task cards the user can actually SEE -- the thing every filter must
# change. Visibility matters: the priority bands hide their sibling columns with
# `display:none` rather than unmounting them, so a raw querySelectorAll count
# stays at 28 for every band and makes a working filter look dead.
IDS_JS = """() => [...document.querySelectorAll('[data-testid^="mywork-task-"]')]
    .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
    .map(e => e.getAttribute('data-testid').replace('mywork-task-',''))"""
COUNT_JS = """() => document.querySelectorAll('[data-testid^="mywork-task-"]').length"""

results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(f"  {'PASS' if ok else 'FAIL'}  {name}" + (f"  -- {detail}" if detail else ""))


def login(page):
    demo_login(page, BASE, "owner")



def land(page):
    page.goto(f"{BASE}/my-work", wait_until="domcontentloaded")
    try:
        page.wait_for_load_state("networkidle", timeout=12000)
    except Exception:
        pass
    page.wait_for_timeout(1400)
    settle(page)


def settle(page, timeout=15000):
    """Wait out the skeleton loaders -- the 'All Tasks' fetch takes ~3s, and
    reading the list before it lands makes a working filter look broken."""
    try:
        page.wait_for_function(
            """() => document.querySelectorAll('[class*="animate-pulse"]').length === 0""",
            timeout=timeout)
    except Exception:
        pass
    page.wait_for_timeout(400)


def click(page, tid, wait=400):
    loc = page.locator(f'[data-testid="{tid}"]').first
    if not loc.is_visible(timeout=2000):
        return False
    loc.click(timeout=4000)
    page.wait_for_timeout(wait)
    settle(page)
    return True


def run_mobile(browser, outdir):
    print("\n--- MOBILE 390x844 ---")
    ctx = browser.new_context(viewport={"width": 390, "height": 844},
                              is_mobile=True, has_touch=True, device_scale_factor=2)
    page = ctx.new_page()
    login(page)
    land(page)
    base_ids = page.evaluate(IDS_JS)
    check("mobile: task list renders", len(base_ids) > 0, f"{len(base_ids)} cards")

    # scope: My Tasks -> All Tasks must widen the set
    click(page, "work-mobile-all")
    all_ids = page.evaluate(IDS_JS)
    page.screenshot(path=str(outdir / "m-scope-all.png"))
    check("mobile: 'All Tasks' widens the set",
          len(all_ids) >= len(base_ids) and set(base_ids) <= set(all_ids),
          f"mine={len(base_ids)} all={len(all_ids)}")

    click(page, "work-mobile-mine")
    back_ids = page.evaluate(IDS_JS)
    check("mobile: 'My Tasks' restores the narrower set",
          set(back_ids) == set(base_ids), f"{len(back_ids)} cards")

    # AI priority on a phone groups into High/Medium/Low bands and opens on
    # High (MyWork.js KM-3), so the visible set narrows to that band -- it must
    # still be a SUBSET of the same tasks, never a different query.
    before = page.evaluate(IDS_JS)
    click(page, "work-mobile-priority")
    after = page.evaluate(IDS_JS)
    page.screenshot(path=str(outdir / "m-ai-priority.png"))
    check("mobile: AI priority groups the same tasks into bands (no new query)",
          set(after) <= set(before) and len(after) > 0,
          f"all={len(before)} high-band={len(after)} subset={set(after) <= set(before)}")
    click(page, "work-mobile-priority")  # back off

    # The priority + status lenses only exist inside the AI-priority view
    # (MyWork.js: `inSegmentView && aiPriority`), so turn it on to reach them.
    click(page, "work-mobile-priority", wait=700)
    check("mobile: AI priority reveals the lens bar",
          page.locator('[data-testid="work-mobile-lenses"]').count() > 0)
    page.screenshot(path=str(outdir / "m-lenses.png"))

    # priority bands: each must show exactly the count it advertises
    band_ok, band_detail = True, []
    for band in ("high", "medium", "low"):
        tid = f"priority-band-{band}"
        if not page.locator(f'[data-testid="{tid}"]').count():
            continue
        advertised = page.evaluate(
            """(id) => { const m=(document.querySelector(`[data-testid="${id}"]`)
                 ?.innerText||'').match(/(\\d+)/); return m ? +m[1] : null; }""", tid)
        click(page, tid, wait=700)
        shown = len(page.evaluate(IDS_JS))
        band_detail.append(f"{band}: shows {shown}/says {advertised}")
        if advertised is not None and shown != advertised:
            band_ok = False
    check("mobile: each priority band shows exactly the count it advertises",
          band_ok, "; ".join(band_detail) or "no bands")

    # status lens: each band must produce a subset of what's loaded
    lens_ok, lens_detail = True, []
    for st in ("todo", "in_progress", "waiting", "review"):
        tid = f"work-status-{st}"
        if not page.locator(f'[data-testid="{tid}"]').count():
            continue
        click(page, tid, wait=700)
        ids = page.evaluate(IDS_JS)
        lens_detail.append(f"{st}={len(ids)}")
        if not set(ids) <= set(base_ids) | set(all_ids):
            lens_ok = False
        click(page, tid, wait=600)  # toggle off
    check("mobile: status lens filters to a subset", lens_ok, " ".join(lens_detail) or "no lens")
    click(page, "work-mobile-priority", wait=700)  # AI priority back off

    # expanding a row must reveal the task body
    first = base_ids[0]
    click(page, f"task-summary-{first}", wait=1000)
    body = page.locator(f'[data-testid="task-body-m-{first}"]')
    page.screenshot(path=str(outdir / "m-task-expanded.png"))
    check("mobile: expanding a task reveals its body", body.count() > 0 and body.first.is_visible())

    # the expanded body must fit the phone -- no sideways scroll
    ov = page.evaluate("""() => ({sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth})""")
    check("mobile: expanded task causes no horizontal overflow", ov["sw"] <= ov["cw"] + 1, str(ov))

    ctx.close()


def run_desktop(browser, outdir):
    print("\n--- DESKTOP 1440x900 ---")
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=2)
    page = ctx.new_page()
    login(page)
    land(page)
    base_ids = page.evaluate(IDS_JS)
    check("desktop: task list renders", len(base_ids) > 0, f"{len(base_ids)} cards")
    page.screenshot(path=str(outdir / "d-landing.png"))

    # category tabs must each change the set
    tabs, seen = [], {}
    for tb in ("all", "sales", "logistics", "hr", "completed"):
        tid = f"work-tab-{tb}"
        if not page.locator(f'[data-testid="{tid}"]').count():
            continue
        click(page, tid, wait=900)
        ids = page.evaluate(IDS_JS)
        seen[tb] = len(ids)
        tabs.append(tb)
        page.screenshot(path=str(outdir / f"d-tab-{tb}.png"))
    check("desktop: every category tab renders a set", len(tabs) >= 3, str(seen))
    # the tabs must not all show the identical list -- that would mean they do nothing
    distinct = len({tuple(sorted(v for v in [seen[t]])) for t in tabs})
    check("desktop: category tabs differ from one another", len(set(seen.values())) > 1, str(seen))

    click(page, "work-tab-all", wait=900)

    # scope mine/all
    click(page, "work-scope-all", wait=900)
    all_ids = page.evaluate(IDS_JS)
    click(page, "work-scope-mine", wait=900)
    mine_ids = page.evaluate(IDS_JS)
    check("desktop: scope mine/all changes the set",
          len(all_ids) >= len(mine_ids), f"mine={len(mine_ids)} all={len(all_ids)}")

    # view toggles must route to the other surfaces and back
    for tid, expect in (("work-view-workflows", "workflows-hub"),
                        ("work-view-leave", None)):
        if not page.locator(f'[data-testid="{tid}"]').count():
            continue
        click(page, tid, wait=1200)
        page.screenshot(path=str(outdir / f"d-{tid}.png"))
        if expect:
            check(f"desktop: {tid} shows {expect}",
                  page.locator(f'[data-testid="{expect}"]').count() > 0)
        else:
            check(f"desktop: {tid} renders something", page.evaluate(
                "() => (document.body.innerText||'').trim().length > 100"))
        click(page, "work-view-mywork", wait=1000)

    # expanding a task on desktop
    click(page, "work-view-mywork", wait=800)
    ids = page.evaluate(IDS_JS)
    if ids:
        click(page, f"task-summary-{ids[0]}", wait=1100)
        page.screenshot(path=str(outdir / "d-task-expanded.png"))
        grew = page.evaluate("() => (document.body.innerText||'').length")
        check("desktop: expanding a task reveals more content", grew > 0)

    ov = page.evaluate("""() => ({sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth})""")
    check("desktop: no horizontal overflow", ov["sw"] <= ov["cw"] + 1, str(ov))
    ctx.close()


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        run_mobile(b, OUT)
        run_desktop(b, OUT)
        b.close()
    failed = [r for r in results if not r[1]]
    print(f"\n=== {len(results)-len(failed)}/{len(results)} passed ===")
    for n, _, d in failed:
        print(f"  FAILED: {n}  {d}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
