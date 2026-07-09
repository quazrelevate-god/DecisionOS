import base64, pathlib, markdown, asyncio, urllib.request
from playwright.async_api import async_playwright

ROOT = pathlib.Path("/app")
ASSETS = ROOT / "doc_assets"
MD = (ROOT / "DecisionOS_Project_Document.md").read_text()

def b64(path):
    return base64.b64encode(pathlib.Path(path).read_bytes()).decode()

# logo
LOGO = ""
try:
    u = "https://customer-assets.emergentagent.com/job_founder-os-58/artifacts/0ntrxfwq_DecisionOS_Logo_Transparent.png"
    LOGO = base64.b64encode(urllib.request.urlopen(u, timeout=20).read()).decode()
except Exception as e:
    print("logo err", e)

body_html = markdown.markdown(MD, extensions=["tables", "fenced_code", "toc"])

def gallery(items):
    cards = ""
    for name, cap in items:
        f = ASSETS / f"{name}.png"
        if f.exists():
            cards += f'<figure><img src="data:image/png;base64,{b64(f)}"/><figcaption>{cap}</figcaption></figure>'
    return cards

DESKTOP = [
    ("login","Login — Email/Password + Mobile OTP, demo logins"),
    ("desk","Decision Desk — voice/text capture & decision approvals"),
    ("brief","CEO Brief — period counters with clickable drill-downs"),
    ("mywork","My Work — AI Execution Guide, proof, escalations, Messages"),
    ("people","People — Employees / Customers / Vendors, RBAC + invite links"),
    ("brain","Company Brain — Ask (RAG) + Search"),
    ("capture","Capture — PDF/Photo OCR + CSV/Excel ingestion"),
    ("workflows","Workflows — Order Fulfilment & Procurement kanban"),
    ("score","Operating Score — company health + team leaderboard (owner)"),
]
MOBILE = [
    ("m_desk","Mobile — Decision Desk"),
    ("m_brief","Mobile — CEO Brief"),
    ("m_drawer","Mobile — nav drawer with Sign out"),
]

logo_tag = f'<img class="logo" src="data:image/png;base64,{LOGO}"/>' if LOGO else '<div class="logo-fallback">D</div>'

HTML = f"""<!doctype html><html><head><meta charset="utf-8"><style>
@page {{ size: A4; margin: 16mm 14mm; }}
* {{ box-sizing: border-box; }}
body {{ font-family: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif; color:#141414; font-size:10.5pt; line-height:1.5; }}
.cover {{ height: 245mm; display:flex; flex-direction:column; justify-content:center; background:#141414; color:#fff; margin:-16mm -14mm 0; padding:0 22mm; page-break-after:always; }}
.cover .logo {{ height:64px; width:auto; margin-bottom:28px; filter: brightness(0) invert(1); }}
.cover .logo-fallback {{ width:64px;height:64px;background:#e5352b;color:#fff;font-weight:900;font-size:40px;display:flex;align-items:center;justify-content:center;margin-bottom:28px; }}
.cover h1 {{ font-size:44pt; font-weight:900; letter-spacing:-1.5px; line-height:1.02; margin:0; text-transform:uppercase; }}
.cover h1 .r {{ color:#e5352b; }}
.cover .sub {{ color:#e5352b; letter-spacing:3px; text-transform:uppercase; font-size:10pt; margin:26px 0 6px; }}
.cover .tag {{ color:rgba(255,255,255,.7); max-width:130mm; font-size:12pt; }}
.cover .meta {{ margin-top:40px; color:rgba(255,255,255,.55); font-size:9pt; letter-spacing:1px; }}
h1 {{ font-size:20pt; font-weight:900; letter-spacing:-.5px; border-bottom:3px solid #141414; padding-bottom:5px; margin-top:26px; text-transform:uppercase; }}
h2 {{ font-size:15pt; font-weight:800; margin-top:22px; color:#141414; border-left:5px solid #e5352b; padding-left:9px; }}
h3 {{ font-size:12pt; font-weight:700; margin-top:16px; }}
p, li {{ font-size:10.5pt; }}
code {{ background:#f4f4f4; padding:1px 4px; border-radius:3px; font-size:9pt; }}
pre {{ background:#141414; color:#eee; padding:12px; border-radius:6px; overflow:auto; font-size:8pt; line-height:1.35; }}
pre code {{ background:none; color:#eee; }}
table {{ border-collapse:collapse; width:100%; margin:10px 0; font-size:9.2pt; }}
th, td {{ border:1px solid #ccc; padding:6px 8px; text-align:left; vertical-align:top; }}
th {{ background:#141414; color:#fff; text-transform:uppercase; font-size:8pt; letter-spacing:.5px; }}
tr:nth-child(even) td {{ background:#fafafa; }}
blockquote {{ border-left:4px solid #f2c200; background:#fffdf3; margin:10px 0; padding:8px 14px; color:#333; font-size:9.6pt; }}
hr {{ border:none; border-top:1px solid #ddd; margin:18px 0; }}
a {{ color:#1a4fd6; text-decoration:none; }}
.section-title {{ page-break-before:always; font-size:20pt; font-weight:900; text-transform:uppercase; border-bottom:3px solid #141414; padding-bottom:5px; margin-top:0; }}
.grid {{ display:flex; flex-wrap:wrap; gap:10px; }}
figure {{ margin:0 0 12px; border:1.5px solid #141414; border-radius:4px; overflow:hidden; page-break-inside:avoid; box-shadow:4px 4px 0 rgba(0,0,0,.12); }}
.grid.desktop figure {{ width:100%; }}
.grid.mobile figure {{ width:31.5%; }}
figure img {{ width:100%; display:block; }}
figcaption {{ font-size:8.4pt; padding:6px 9px; background:#141414; color:#fff; font-weight:600; }}
</style></head><body>
<div class="cover">
  {logo_tag}
  <div class="sub">The operational brain for founder-led SMEs</div>
  <h1>DECISION<span class="r">OS</span><br>PROJECT DOCUMENT</h1>
  <div class="tag">Speak the decision. We run the company. — an AI operating system that turns spoken directives into structured tasks, workflows and a shared company brain.</div>
  <div class="meta">Complete product walkthrough · architecture · features · API · screens (desktop &amp; mobile)</div>
</div>
{body_html}
<h1 class="section-title">Appendix A — Visual Tour (Desktop)</h1>
<div class="grid desktop">{gallery(DESKTOP)}</div>
<h1 class="section-title">Appendix B — Visual Tour (Mobile)</h1>
<div class="grid mobile">{gallery(MOBILE)}</div>
</body></html>"""

(ROOT / "doc_build.html").write_text(HTML)

async def render():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page()
        await pg.goto("file:///app/doc_build.html", wait_until="networkidle")
        await pg.wait_for_timeout(800)
        await pg.pdf(path="/app/DecisionOS_Project_Document.pdf", format="A4",
                     print_background=True, margin={"top":"0","bottom":"0","left":"0","right":"0"})
        await b.close()

asyncio.run(render())
print("PDF built")
