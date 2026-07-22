import os, time
from playwright.sync_api import sync_playwright

OUT = "/app/assets/mobile"
os.makedirs(OUT, exist_ok=True)
with open('/app/frontend/.env') as f:
    for line in f:
        if line.startswith('REACT_APP_BACKEND_URL'):
            BASE = line.split('=', 1)[1].strip()

EXEC = "/root/bin/chromium" if os.path.exists("/root/bin/chromium") else "/usr/bin/google-chrome"

shots = []  # (filename, title)

def snap(page, name, full=False):
    path = f"{OUT}/{name}.png"
    page.screenshot(path=path, full_page=full)
    print("saved", name, os.path.getsize(path))

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=EXEC, args=["--no-sandbox", "--disable-dev-shm-usage"])
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2,
                              is_mobile=True, has_touch=True,
                              user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148")
    page = ctx.new_page()

    # Login screen (logged out)
    page.goto(BASE + "/login", wait_until="networkidle"); page.wait_for_timeout(1500)
    snap(page, "01_login")

    page.fill('input[type="email"]', 'owner@sharma.com')
    page.fill('input[type="password"]', 'demo1234')
    page.click('button[type="submit"]'); page.wait_for_timeout(3500)

    def go(path, name, wait=2600, full=False):
        page.goto(BASE + path, wait_until="networkidle"); page.wait_for_timeout(wait)
        snap(page, name, full=full)

    go("/inbox", "02_decision_desk", full=True)
    go("/brief", "03_ceo_brief", full=True)
    go("/my-work", "04_my_work", full=True)

    # My Work views
    try:
        page.click('[data-testid="work-view-board"]', force=True); page.wait_for_timeout(1800); snap(page, "05_my_work_board", full=True)
    except Exception as e: print("board", e)
    try:
        page.click('[data-testid="work-view-workflows"]', force=True); page.wait_for_timeout(1800); snap(page, "06_workflows", full=True)
    except Exception as e: print("wf", e)
    go("/my-work?view=leave", "07_leave", full=True)

    go("/contacts", "08_people_employees", full=True)
    # customers tab
    try:
        page.click('[data-testid="people-tab-customers"]', force=True); page.wait_for_timeout(1500); snap(page, "09_people_customers", full=True)
    except Exception as e: print("cust", e)

    go("/brain", "10_brain_ask", full=True)
    try:
        page.click('[data-testid="brain-tab-search"]', force=True); page.wait_for_timeout(1500); snap(page, "11_brain_search", full=True)
    except Exception as e: print("search", e)

    go("/ledger", "12_finance_overview", full=True)
    try:
        page.click('[data-testid="ledger-tab-expenses"]', force=True); page.wait_for_timeout(1800); snap(page, "13_finance_expenses", full=True)
    except Exception as e: print("exp", e)

    go("/ingest", "14_capture_import", full=True)
    try:
        page.click('[data-testid="capture-maintab-review"]', force=True); page.wait_for_timeout(1800); snap(page, "15_capture_review", full=True)
    except Exception as e: print("rev", e)

    go("/meetings", "16_meetings", full=True)
    go("/settings", "17_settings", full=True)
    go("/notifications", "18_notifications", full=True)

    # Mobile drawer menu (open hamburger)
    page.goto(BASE + "/my-work", wait_until="networkidle"); page.wait_for_timeout(2000)
    try:
        page.click('[data-testid="mobile-menu-button"]', force=True); page.wait_for_timeout(1200); snap(page, "19_mobile_menu")
    except Exception as e: print("drawer", e)

    browser.close()
print("DONE")
