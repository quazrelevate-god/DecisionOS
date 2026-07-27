import os
from playwright.sync_api import sync_playwright
OUT = "/exports/decisionos_v2_migration_pack/SCREENSHOTS"
os.makedirs(OUT, exist_ok=True)
with open('/app/frontend/.env') as f:
    for line in f:
        if line.startswith('REACT_APP_BACKEND_URL'):
            BASE = line.split('=', 1)[1].strip()
EXEC = "/root/bin/chromium" if os.path.exists("/root/bin/chromium") else "/usr/bin/google-chrome"
pages = [("/inbox","desktop_02_decision_desk"),("/brief","desktop_03_ceo_brief"),
         ("/my-work","desktop_04_my_work"),("/contacts","desktop_08_people"),
         ("/brain","desktop_10_brain"),("/ledger","desktop_12_finance"),
         ("/ingest","desktop_14_capture"),("/meetings","desktop_16_meetings"),
         ("/settings","desktop_17_settings"),("/notifications","desktop_18_notifications")]
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=EXEC, args=["--no-sandbox","--disable-dev-shm-usage"])
    ctx = b.new_context(viewport={"width":1440,"height":900}, device_scale_factor=1)
    pg = ctx.new_page()
    pg.goto(BASE+"/login", wait_until="networkidle"); pg.wait_for_timeout(1200)
    pg.screenshot(path=f"{OUT}/desktop_01_login.png")
    pg.fill('input[type="email"]','owner@sharma.com'); pg.fill('input[type="password"]','demo1234')
    pg.click('button[type="submit"]'); pg.wait_for_timeout(3500)
    for route,name in pages:
        try:
            pg.goto(BASE+route, wait_until="networkidle"); pg.wait_for_timeout(2500)
            pg.screenshot(path=f"{OUT}/{name}.png"); print("saved",name)
        except Exception as e:
            print("ERR",name,e)
    b.close()
print("DONE")
