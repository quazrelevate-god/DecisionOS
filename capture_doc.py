import asyncio, os, pathlib, urllib.request, json
from playwright.async_api import async_playwright

BASE = "https://founder-os-58.preview.emergentagent.com"
OUT = pathlib.Path("/app/doc_assets"); OUT.mkdir(exist_ok=True)

def api(path, method="GET", token=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token: req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())

async def login(page):
    await page.goto(BASE + "/login", wait_until="networkidle")
    if await page.query_selector('input[type="email"]'):
        await page.fill('input[type="email"]', 'owner@sharma.com')
        await page.fill('input[type="password"]', 'demo1234')
        await page.click('button[type="submit"]', force=True)
        await page.wait_for_timeout(3500)

DESKTOP = [
    ("desk", "/"), ("brief", "/brief"), ("mywork", "/my-work"), ("people", "/contacts"),
    ("brain", "/brain"), ("capture", "/ingest"), ("workflows", "/workflows"), ("score", "/operating-score"),
]

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        # --- login page (logged out) ---
        ctx = await b.new_context(viewport={"width":1440,"height":900})
        pg = await ctx.new_page()
        await pg.goto(BASE + "/login", wait_until="networkidle"); await pg.wait_for_timeout(1500)
        await pg.screenshot(path=str(OUT/"login.png")); print("login")
        await ctx.close()
        # --- desktop authed ---
        ctx = await b.new_context(viewport={"width":1440,"height":900})
        pg = await ctx.new_page(); await login(pg)
        for name, path in DESKTOP:
            await pg.goto(BASE + path, wait_until="networkidle"); await pg.wait_for_timeout(2800)
            await pg.screenshot(path=str(OUT/f"{name}.png")); print(name)
        await ctx.close()
        # --- mobile authed ---
        ctx = await b.new_context(viewport={"width":390,"height":844})
        pg = await ctx.new_page(); await login(pg)
        await pg.goto(BASE + "/", wait_until="networkidle"); await pg.wait_for_timeout(1800)
        await pg.screenshot(path=str(OUT/"m_desk.png")); print("m_desk")
        await pg.goto(BASE + "/brief", wait_until="networkidle"); await pg.wait_for_timeout(1800)
        await pg.screenshot(path=str(OUT/"m_brief.png")); print("m_brief")
        # drawer
        await pg.goto(BASE + "/", wait_until="networkidle"); await pg.wait_for_timeout(1200)
        try:
            await pg.click('[data-testid="mobile-menu-button"]', force=True); await pg.wait_for_timeout(1000)
            await pg.screenshot(path=str(OUT/"m_drawer.png")); print("m_drawer")
        except Exception as e: print("drawer err", e)
        await ctx.close()
        # --- invite deep-link (create temp member -> token) ---
        try:
            tok = api("/api/auth/login", "POST", body={"email":"owner@sharma.com","password":"demo1234"})["token"]
            u = api("/api/users", "POST", token=tok, body={"name":"Aarav Mehta","email":"doc_invite@sharma.com","role":"sales","phone":"+91 90000 12321"})
            itok = u.get("invite_token")
            ctx = await b.new_context(viewport={"width":390,"height":844})
            pg = await ctx.new_page()
            await pg.goto(f"{BASE}/login?invite={itok}", wait_until="networkidle"); await pg.wait_for_timeout(3500)
            await pg.screenshot(path=str(OUT/"m_invite.png")); print("m_invite")
            await ctx.close()
        except Exception as e:
            print("invite err", e)
        await b.close()

asyncio.run(main())
